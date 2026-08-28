import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { ROOT, run } from "./shared.mjs";

const UNKNOWN_LICENSE = "NOASSERTION";

function repoRelative(path) {
  return relative(ROOT, path).replaceAll("\\", "/");
}

function normalizeName(name, ecosystem) {
  const value = String(name ?? "").trim();
  return ecosystem === "pypi" ? value.toLowerCase().replaceAll("_", "-") : value;
}

function packageKey(candidate) {
  return `${candidate.ecosystem}:${normalizeName(candidate.name, candidate.ecosystem)}@${candidate.version}`;
}

function normalizeLicense(raw, classifiers = []) {
  const value = String(raw ?? "").trim();
  const aliases = new Map([
    ["apache 2.0", "Apache-2.0"],
    ["apache software license", "Apache-2.0"],
    ["apache software license 2.0", "Apache-2.0"],
    ["bsd", "BSD-3-Clause"],
    ["bsd license", "BSD-3-Clause"],
    ["isc license", "ISC"],
    ["mit license", "MIT"],
    ["mozilla public license 2.0 (mpl 2.0)", "MPL-2.0"],
    ["python software foundation license", "Python-2.0"],
    ["the unlicense (unlicense)", "Unlicense"]
  ]);
  const normalized = aliases.get(value.toLowerCase());
  if (normalized) return normalized;
  if (value && !/^(unknown|n\/a|none|noassertion)$/i.test(value) && value.length <= 160 && !value.includes("\n")) {
    if (/^[A-Za-z0-9.+-]+\s*\/\s*[A-Za-z0-9.+-]+$/.test(value)) return value.split("/").map((part) => part.trim()).join(" OR ");
    return value;
  }

  const classifierMap = [
    ["License :: OSI Approved :: MIT License", "MIT"],
    ["License :: OSI Approved :: Apache Software License", "Apache-2.0"],
    ["License :: OSI Approved :: BSD License", "BSD-3-Clause"],
    ["License :: OSI Approved :: ISC License (ISCL)", "ISC"],
    ["License :: OSI Approved :: Mozilla Public License 2.0 (MPL 2.0)", "MPL-2.0"],
    ["License :: OSI Approved :: Python Software Foundation License", "Python-2.0"],
    ["License :: OSI Approved :: The Unlicense (Unlicense)", "Unlicense"]
  ];
  const resolved = classifierMap.filter(([classifier]) => classifiers.includes(classifier)).map(([, license]) => license);
  return [...new Set(resolved)].join(" OR ") || UNKNOWN_LICENSE;
}

function addPackage(packages, candidate) {
  const normalized = {
    installed: false,
    strictRequired: true,
    distributionStatus: candidate.workspace ? "workspace-source" : "distributed-dependency",
    licenseReason: null,
    ...candidate,
    license: normalizeLicense(candidate.license, candidate.licenseClassifiers)
  };
  const key = packageKey(normalized);
  const existing = packages.get(key);
  if (existing) {
    existing.sources = [...new Set([...existing.sources, ...normalized.sources])].sort();
    existing.installed ||= normalized.installed;
    if (existing.license === UNKNOWN_LICENSE && normalized.license !== UNKNOWN_LICENSE) {
      existing.license = normalized.license;
      existing.licenseReason = normalized.licenseReason;
    }
    if (existing.supplier === UNKNOWN_LICENSE && normalized.supplier !== UNKNOWN_LICENSE) existing.supplier = normalized.supplier;
    return;
  }
  packages.set(key, normalized);
}

function findManifests(directory, filename, results) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory).sort()) {
    if (["node_modules", "target", "dist", ".venv", "legacy"].includes(entry)) continue;
    const path = resolve(directory, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) findManifests(path, filename, results);
    else if (entry === filename) results.push(path);
  }
}

function findNodeModuleDirectories(directory, results) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory).sort()) {
    if ([".git", ".venv", "target", "dist", "legacy"].includes(entry)) continue;
    const path = resolve(directory, entry);
    if (!lstatSync(path).isDirectory()) continue;
    if (entry === "node_modules") results.push(path);
    else findNodeModuleDirectories(path, results);
  }
}

function collectInstalledNodePackages(moduleDirectories, packages) {
  const visited = new Set();
  function scanLevel(directory) {
    if (!existsSync(directory)) return;
    let real;
    try { real = realpathSync(directory); } catch { return; }
    if (visited.has(real)) return;
    visited.add(real);
    for (const entry of readdirSync(directory).sort()) {
      if (entry === ".bin") continue;
      const path = resolve(directory, entry);
      if (entry === ".pnpm") {
        for (const storeEntry of readdirSync(path).sort()) scanLevel(resolve(path, storeEntry, "node_modules"));
        continue;
      }
      if (entry.startsWith("@")) {
        scanLevel(path);
        continue;
      }
      const manifestPath = resolve(path, "package.json");
      if (!existsSync(manifestPath)) continue;
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
        addPackage(packages, {
          name: manifest.name ?? entry,
          version: manifest.version ?? "0.0.0-unknown",
          license: typeof manifest.license === "string" ? manifest.license : manifest.license?.type,
          downloadLocation: manifest.repository?.url ?? `https://registry.npmjs.org/${encodeURIComponent(manifest.name ?? entry)}`,
          supplier: manifest.author?.name ? `Person: ${manifest.author.name}` : UNKNOWN_LICENSE,
          sources: [repoRelative(manifestPath)],
          workspace: false,
          installed: true,
          ecosystem: "npm"
        });
        scanLevel(resolve(path, "node_modules"));
      } catch {
        // A malformed installed package is retained through direct-dependency fallback below.
      }
    }
  }
  for (const directory of moduleDirectories) scanLevel(directory);
}

function parsePythonDependencyNames(pyprojectSource) {
  const projectBlock = pyprojectSource.match(/\[project\]([\s\S]*?)(?=\n\[|$)/)?.[1] ?? "";
  const dependencies = projectBlock.match(/dependencies\s*=\s*\[([\s\S]*?)\]/)?.[1] ?? "";
  return [...dependencies.matchAll(/["']([A-Za-z0-9._-]+)/g)].map((match) => normalizeName(match[1], "pypi"));
}

function parseUvLock(lockSource) {
  const result = [];
  for (const block of lockSource.split("[[package]]").slice(1)) {
    const name = block.match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1];
    const version = block.match(/^\s*version\s*=\s*"([^"]+)"/m)?.[1];
    const registry = block.match(/^\s*source\s*=\s*\{\s*registry\s*=\s*"([^"]+)"/m)?.[1];
    if (name && version && registry) result.push({ name, version, registry });
  }
  return result;
}

function readPythonInstalledMetadata(venvPython) {
  if (!existsSync(venvPython)) return [];
  const metadataScript = [
    "import importlib.metadata as m,json;",
    "print(json.dumps([{'name':d.metadata.get('Name'),'version':d.version,",
    "'license':d.metadata.get('License-Expression') or d.metadata.get('License'),",
    "'classifiers':d.metadata.get_all('Classifier') or [],",
    "'author':d.metadata.get('Author') or d.metadata.get('Author-email')} for d in m.distributions()]))"
  ].join("");
  const metadata = run(venvPython, ["-c", metadataScript], { maxBuffer: 64 * 1024 * 1024 });
  if (!metadata.ok) return [];
  try { return JSON.parse(metadata.stdout); } catch { return []; }
}

function readCargoPackageManifest(path) {
  if (!existsSync(path)) return null;
  const source = readFileSync(path, "utf8");
  const packageBlock = source.match(/\[package\]([\s\S]*?)(?=\n\[|$)/)?.[1] ?? "";
  const license = packageBlock.match(/^license\s*=\s*"([^"]+)"/m)?.[1];
  const repository = packageBlock.match(/^repository\s*=\s*"([^"]+)"/m)?.[1];
  return { license, repository };
}

function collectCargoTreePackages(cargoCommand, cargoManifest, packages) {
  const tree = run(cargoCommand, [
    "tree", "--locked", "--offline", "--target", "x86_64-pc-windows-msvc",
    "--edges", "normal,build", "--prefix", "none", "--format", "{p}",
    "--manifest-path", cargoManifest
  ]);
  if (!tree.ok) return false;
  const selected = new Map();
  for (const line of tree.stdout.split("\n")) {
    const match = line.match(/^([^ ]+) v([^ ]+)/);
    if (match && match[1] !== "alystria-desktop") selected.set(`${match[1]}@${match[2]}`, { name: match[1], version: match[2] });
  }

  const registryRoot = process.env.USERPROFILE ? resolve(process.env.USERPROFILE, ".cargo/registry/src") : null;
  const registryIndexes = registryRoot && existsSync(registryRoot) ? readdirSync(registryRoot).map((entry) => resolve(registryRoot, entry)) : [];
  for (const item of selected.values()) {
    let manifestPath = null;
    for (const index of registryIndexes) {
      const candidate = resolve(index, `${item.name}-${item.version}`, "Cargo.toml");
      if (existsSync(candidate)) { manifestPath = candidate; break; }
    }
    const metadata = manifestPath ? readCargoPackageManifest(manifestPath) : null;
    addPackage(packages, {
      name: item.name,
      version: item.version,
      license: metadata?.license,
      downloadLocation: metadata?.repository ?? `https://crates.io/crates/${encodeURIComponent(item.name)}/${encodeURIComponent(item.version)}`,
      supplier: UNKNOWN_LICENSE,
      sources: ["apps/desktop/src-tauri/Cargo.lock", ...(manifestPath ? [`local Cargo registry metadata: ${item.name}@${item.version}/Cargo.toml`] : [])],
      workspace: false,
      installed: Boolean(manifestPath),
      ecosystem: "cargo",
      licenseReason: manifestPath ? null : "Selected by the offline Windows Cargo dependency tree, but its local registry manifest is unavailable."
    });
  }
  return true;
}

function collectRuntimeComponents() {
  const components = [];
  const runtimePath = resolve(ROOT, "runtime-manifest.json");
  if (existsSync(runtimePath)) {
    const manifest = JSON.parse(readFileSync(runtimePath, "utf8"));
    const toolchains = manifest.toolchains ?? {};
    const toolchainDeclarations = [
      ["Node.js developer toolchain", toolchains.node, "MIT", false, "development-toolchain-not-bundled"],
      ["pnpm developer toolchain", toolchains.pnpm, "MIT", false, "development-toolchain-not-bundled"],
      ["Python sidecar runtime", toolchains.python, "Python-2.0", true, "runtime-pin-not-assembled"],
      ["uv developer toolchain", toolchains.uv, "Apache-2.0 OR MIT", false, "development-toolchain-not-bundled"],
      ["Rust developer toolchain", toolchains.rust, "Apache-2.0 OR MIT", false, "development-toolchain-not-bundled"]
    ];
    for (const [name, declaration, license, releaseRequired, distributionStatus] of toolchainDeclarations) {
      if (!declaration?.version) continue;
      components.push({
        name,
        version: declaration.version,
        license,
        ecosystem: "generic",
        sources: [repoRelative(runtimePath)],
        distributionStatus,
        strictRequired: false,
        releaseRequired,
        licenseReason: releaseRequired
          ? "The version pin exists, but the signed sidecar runtime and its complete license bundle have not been assembled."
          : "Pinned reproducibility tool only; not bundled as an Alystria runtime component."
      });
    }
    const ffmpeg = manifest.media?.ffmpeg;
    if (ffmpeg) components.push({
      name: "FFmpeg core runtime pack",
      version: ffmpeg.version,
      license: ffmpeg.coreRuntimeLicense ?? UNKNOWN_LICENSE,
      ecosystem: "generic",
      sources: [repoRelative(runtimePath)],
      distributionStatus: ffmpeg.bundled ? "bundled" : "not-bundled",
      strictRequired: Boolean(ffmpeg.bundled),
      releaseRequired: true,
      licenseReason: ffmpeg.bundled ? null : "Catalog declaration only; no signed FFmpeg runtime pack or runtime build-configuration report has been assembled."
    });
    const gpl = manifest.media?.gplCodecPack;
    if (gpl) components.push({
      name: "FFmpeg optional GPL codec pack",
      version: gpl.version,
      license: gpl.license ?? UNKNOWN_LICENSE,
      ecosystem: "generic",
      sources: [repoRelative(runtimePath)],
      distributionStatus: gpl.bundled ? "bundled" : "not-bundled",
      strictRequired: Boolean(gpl.bundled),
      releaseRequired: false,
      licenseReason: gpl.bundled ? null : "Optional catalog entry only; no signed GPL codec pack or runtime build-configuration report has been assembled."
    });
    const chromium = manifest.renderer?.chromium;
    if (chromium) components.push({
      name: "Pinned Chromium renderer",
      version: chromium.browserVersion ?? chromium.revision,
      license: UNKNOWN_LICENSE,
      ecosystem: "generic",
      sources: [repoRelative(runtimePath)],
      distributionStatus: "runtime-required-not-assembled",
      strictRequired: false,
      releaseRequired: true,
      licenseReason: "The executable is pinned for development, but its complete Chromium third-party license bundle has not been assembled for distribution."
    });
  }

  const modelsPath = resolve(ROOT, "models.catalog.json");
  if (existsSync(modelsPath)) {
    const catalog = JSON.parse(readFileSync(modelsPath, "utf8"));
    for (const model of catalog.models ?? []) {
      if (model.providerId === "mock" || model.execution !== "local") continue;
      components.push({
        name: `Model catalog: ${model.id}`,
        version: model.revision ?? "pin-required",
        license: model.license ?? UNKNOWN_LICENSE,
        ecosystem: "generic",
        sources: [repoRelative(modelsPath)],
        distributionStatus: "catalog-only-not-downloaded",
        strictRequired: false,
        releaseRequired: true,
        licenseReason: model.license
          ? "Catalog-declared model license; artifact terms must still be verified at download."
          : "Catalog entry only; immutable artifact revision, checksum, and license evidence are required before download."
      });
    }
  }
  return components;
}

export function collectInventory(options = {}) {
  const includeAllLocked = Boolean(options.includeAllLocked);
  const packages = new Map();
  const manifests = [];
  for (const base of [ROOT, resolve(ROOT, "apps"), resolve(ROOT, "packages"), resolve(ROOT, "services")]) {
    if (base === ROOT) {
      const rootManifest = resolve(ROOT, "package.json");
      if (existsSync(rootManifest)) manifests.push(rootManifest);
    } else findManifests(base, "package.json", manifests);
  }

  const workspaceNames = new Set();
  const directNodeDependencies = new Map();
  for (const path of [...new Set(manifests)]) {
    const manifest = JSON.parse(readFileSync(path, "utf8"));
    const name = manifest.name ?? repoRelative(path);
    workspaceNames.add(name);
    addPackage(packages, {
      name,
      version: manifest.version ?? "0.0.0-workspace",
      license: manifest.license,
      downloadLocation: UNKNOWN_LICENSE,
      supplier: "Organization: Alystria contributors",
      sources: [repoRelative(path)],
      workspace: true,
      ecosystem: "workspace"
    });
    for (const section of ["dependencies", "optionalDependencies", "devDependencies", "peerDependencies"]) {
      for (const [dependency, specifier] of Object.entries(manifest[section] ?? {})) {
        const sources = directNodeDependencies.get(dependency) ?? [];
        sources.push(`${repoRelative(path)}#${section} (${specifier})`);
        directNodeDependencies.set(dependency, sources);
      }
    }
  }

  const moduleDirectories = [];
  for (const base of [ROOT, resolve(ROOT, "apps"), resolve(ROOT, "packages"), resolve(ROOT, "services")]) findNodeModuleDirectories(base, moduleDirectories);
  collectInstalledNodePackages([...new Set(moduleDirectories)], packages);
  for (const item of [...packages.values()]) {
    if (item.ecosystem === "npm" && workspaceNames.has(item.name)) packages.delete(packageKey(item));
  }
  const pnpmLock = resolve(ROOT, "pnpm-lock.yaml");
  if (existsSync(pnpmLock)) {
    for (const item of packages.values()) {
      if (item.ecosystem !== "npm" || !item.installed) continue;
      item.sources = [...new Set([...item.sources, `pnpm-lock.yaml#${item.name}@${item.version}`, ...(directNodeDependencies.get(item.name) ?? [])])].sort();
    }
  }
  const installedNodeNames = new Set([...packages.values()].filter((item) => item.ecosystem === "npm" && item.installed).map((item) => item.name));
  for (const [name, sources] of directNodeDependencies) {
    if (workspaceNames.has(name) || installedNodeNames.has(name)) continue;
    addPackage(packages, {
      name,
      version: "unresolved-from-manifest",
      license: UNKNOWN_LICENSE,
      downloadLocation: `https://registry.npmjs.org/${encodeURIComponent(name)}`,
      supplier: UNKNOWN_LICENSE,
      sources,
      workspace: false,
      ecosystem: "npm",
      licenseReason: "Install from the committed pnpm lockfile to resolve exact package metadata locally."
    });
  }

  const cargoManifest = existsSync(resolve(ROOT, "Cargo.toml")) ? resolve(ROOT, "Cargo.toml") : resolve(ROOT, "apps/desktop/src-tauri/Cargo.toml");
  const userCargo = process.env.USERPROFILE ? resolve(process.env.USERPROFILE, ".cargo/bin/cargo.exe") : null;
  const cargoCommand = userCargo && existsSync(userCargo) ? userCargo : "cargo";
  const cargoTreeCollected = existsSync(cargoManifest) && collectCargoTreePackages(cargoCommand, cargoManifest, packages);
  const cargo = !cargoTreeCollected && existsSync(cargoManifest) ? run(cargoCommand, ["metadata", "--format-version", "1", "--locked", "--offline", "--manifest-path", cargoManifest]) : { ok: false, stdout: "" };
  if (!cargoTreeCollected && cargo.ok) {
    try {
      const metadata = JSON.parse(cargo.stdout);
      const workspaceMembers = new Set(metadata.workspace_members ?? []);
      for (const item of metadata.packages ?? []) {
        addPackage(packages, {
          name: item.name,
          version: item.version,
          license: item.license,
          downloadLocation: item.source ?? UNKNOWN_LICENSE,
          supplier: item.authors?.length ? `Organization: ${item.authors.join(", ")}` : UNKNOWN_LICENSE,
          sources: [repoRelative(item.manifest_path), ...(existsSync(resolve(ROOT, "apps/desktop/src-tauri/Cargo.lock")) ? ["apps/desktop/src-tauri/Cargo.lock"] : [])],
          workspace: workspaceMembers.has(item.id),
          installed: true,
          ecosystem: item.source?.startsWith("registry+") ? "cargo" : "workspace"
        });
      }
    } catch {
      // Lock/manifests remain represented by the workspace package if cargo metadata is malformed.
    }
  }

  const pyproject = resolve(ROOT, "services/pipeline/pyproject.toml");
  let pipelineName = null;
  let directPythonDependencies = [];
  if (existsSync(pyproject)) {
    const source = readFileSync(pyproject, "utf8");
    const name = source.match(/^name\s*=\s*"([^"]+)"/m)?.[1] ?? "alystria-pipeline";
    pipelineName = normalizeName(name, "pypi");
    directPythonDependencies = parsePythonDependencyNames(source);
    const version = source.match(/^version\s*=\s*"([^"]+)"/m)?.[1] ?? "0.0.0-workspace";
    const license = source.match(/^license\s*=\s*\{\s*text\s*=\s*"([^"]+)"/m)?.[1];
    addPackage(packages, {
      name,
      version,
      license,
      downloadLocation: UNKNOWN_LICENSE,
      supplier: "Organization: Alystria contributors",
      sources: [repoRelative(pyproject)],
      workspace: true,
      ecosystem: "workspace"
    });
  }

  const uvLock = resolve(ROOT, "services/pipeline/uv.lock");
  const lockedPython = existsSync(uvLock) ? parseUvLock(readFileSync(uvLock, "utf8")) : [];
  const lockedPythonByName = new Map(lockedPython.map((item) => [normalizeName(item.name, "pypi"), item]));
  const venvPython = process.platform === "win32" ? resolve(ROOT, "services/pipeline/.venv/Scripts/python.exe") : resolve(ROOT, "services/pipeline/.venv/bin/python");
  for (const item of readPythonInstalledMetadata(venvPython)) {
    if (!item.name || !item.version) continue;
    const normalizedName = normalizeName(item.name, "pypi");
    addPackage(packages, {
      name: item.name,
      version: item.version,
      license: item.license,
      licenseClassifiers: item.classifiers,
      downloadLocation: `https://pypi.org/project/${encodeURIComponent(item.name)}/${encodeURIComponent(item.version)}/`,
      supplier: item.author ? `Person: ${item.author}` : UNKNOWN_LICENSE,
      sources: [repoRelative(venvPython), ...(lockedPythonByName.has(normalizedName) ? [repoRelative(uvLock)] : [])],
      workspace: normalizedName === pipelineName,
      installed: true,
      ecosystem: normalizedName === pipelineName ? "workspace" : "pypi"
    });
  }

  const selectedPythonNames = includeAllLocked ? lockedPython.map((item) => normalizeName(item.name, "pypi")) : directPythonDependencies;
  for (const name of selectedPythonNames) {
    const item = lockedPythonByName.get(name);
    if (!item || [...packages.values()].some((candidate) => candidate.ecosystem === "pypi" && normalizeName(candidate.name, "pypi") === name && candidate.version === item.version)) continue;
    addPackage(packages, {
      name: item.name,
      version: item.version,
      license: UNKNOWN_LICENSE,
      downloadLocation: item.registry,
      supplier: UNKNOWN_LICENSE,
      sources: [repoRelative(uvLock)],
      workspace: false,
      ecosystem: "pypi",
      licenseReason: includeAllLocked ? "Locked optional/development dependency is not installed; no local wheel metadata is available." : "Required locked dependency is not installed; install from uv.lock to resolve local wheel metadata."
    });
  }

  return [...packages.values()].sort((left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version));
}

export function collectComplianceComponents() {
  return collectRuntimeComponents().sort((left, right) => left.name.localeCompare(right.name));
}

export function inventoryFindings(inventory, components = []) {
  const unresolvedDependencies = inventory.filter((item) => !item.workspace && item.strictRequired && item.license === UNKNOWN_LICENSE);
  const unresolvedBundledComponents = components.filter((item) => item.strictRequired && item.license === UNKNOWN_LICENSE);
  const gatedComponents = components.filter((item) => !item.strictRequired || item.distributionStatus !== "bundled");
  const releaseBlockers = components.filter((item) => item.releaseRequired && (item.distributionStatus !== "bundled" || item.license === UNKNOWN_LICENSE));
  const invalidDependencyRecords = inventory.filter((item) => {
    if (item.workspace) return false;
    const exactVersion = item.version && !/[~^*]|unresolved/.test(item.version);
    const spdxLikeLicense = item.license === UNKNOWN_LICENSE || (!item.license.includes("/") && /^[A-Za-z0-9.+() -]+$/.test(item.license));
    const locked = item.ecosystem === "npm"
      ? item.sources.some((source) => source.startsWith("pnpm-lock.yaml#"))
      : item.ecosystem === "cargo"
        ? item.sources.includes("apps/desktop/src-tauri/Cargo.lock")
        : item.ecosystem === "pypi"
          ? item.sources.includes("services/pipeline/uv.lock")
          : true;
    return !exactVersion || !spdxLikeLicense || !locked;
  });
  return { unresolvedDependencies, unresolvedBundledComponents, gatedComponents, releaseBlockers, invalidDependencyRecords };
}

function spdxId(name, version, ecosystem) {
  const digest = createHash("sha256").update(`${ecosystem}:${name}@${version}`).digest("hex").slice(0, 16);
  return `SPDXRef-Package-${digest}`;
}

export function toSpdxPackage(item) {
  return {
    SPDXID: spdxId(item.name, item.version, item.ecosystem),
    name: item.name,
    versionInfo: item.version,
    downloadLocation: item.downloadLocation ?? UNKNOWN_LICENSE,
    filesAnalyzed: false,
    licenseConcluded: UNKNOWN_LICENSE,
    licenseDeclared: item.license,
    copyrightText: UNKNOWN_LICENSE,
    supplier: item.supplier ?? UNKNOWN_LICENSE,
    ...(item.distributionStatus ? { packageComment: `Distribution status: ${item.distributionStatus}.${item.licenseReason ? ` ${item.licenseReason}` : ""}` } : {}),
    externalRefs: item.ecosystem !== "workspace" ? [{
      referenceCategory: "PACKAGE-MANAGER",
      referenceType: "purl",
      referenceLocator: `pkg:${item.ecosystem}/${encodeURIComponent(item.name)}@${encodeURIComponent(item.version)}`
    }] : [],
    annotations: [{
      annotationDate: new Date(0).toISOString(),
      annotationType: "OTHER",
      annotator: "Tool: alystria-inventory",
      comment: `Sources: ${item.sources.join(", ")}`
    }]
  };
}
