#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT, parseFlags, readJson } from "./lib/shared.mjs";

const ALLOWED_EXECUTION = new Set(["local", "cloud"]);
const ALLOWED_CREDENTIALS = new Set(["none", "secret-reference", "optional-secret-reference"]);
const MUTABLE_REVISIONS = new Set(["latest", "main", "master", "head"]);

export function validateCatalogs() {
  const errors = [];
  const warnings = [];
  const providerPath = resolve(ROOT, "providers.catalog.json");
  const modelPath = resolve(ROOT, "models.catalog.json");
  const runtimePath = resolve(ROOT, "runtime-manifest.json");

  for (const path of [providerPath, modelPath, runtimePath]) {
    if (!existsSync(path)) errors.push(`Missing required manifest: ${path}`);
  }
  if (errors.length) return { errors, warnings, providerCount: 0, modelCount: 0 };

  let providers;
  let models;
  let runtime;
  try {
    providers = readJson(providerPath);
    models = readJson(modelPath);
    runtime = readJson(runtimePath);
  } catch (error) {
    return { errors: [`Manifest JSON parse failed: ${error.message}`], warnings, providerCount: 0, modelCount: 0 };
  }

  for (const [name, document] of [["providers", providers], ["models", models]]) {
    if (document.schemaVersion !== 1) errors.push(`${name}: schemaVersion must be 1`);
    if (!/^\d{4}\.\d{2}\.\d{2}\.\d+$/.test(document.catalogVersion ?? "")) {
      errors.push(`${name}: catalogVersion must use YYYY.MM.DD.N`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(document.lastVerifiedAt ?? "")) {
      errors.push(`${name}: lastVerifiedAt must use YYYY-MM-DD`);
    }
  }

  const providerIds = new Set();
  for (const provider of providers.providers ?? []) {
    const prefix = `provider ${provider.id ?? "<missing>"}`;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(provider.id ?? "")) errors.push(`${prefix}: invalid id`);
    if (providerIds.has(provider.id)) errors.push(`${prefix}: duplicate id`);
    providerIds.add(provider.id);
    if (!provider.displayName) errors.push(`${prefix}: displayName is required`);
    if (!ALLOWED_EXECUTION.has(provider.execution)) errors.push(`${prefix}: execution must be local or cloud`);
    if (!ALLOWED_CREDENTIALS.has(provider.credentialKind)) errors.push(`${prefix}: invalid credentialKind`);
    if (!Array.isArray(provider.capabilities) || provider.capabilities.length === 0) errors.push(`${prefix}: capabilities are required`);
    if (new Set(provider.capabilities ?? []).size !== (provider.capabilities ?? []).length) errors.push(`${prefix}: duplicate capability`);
    if (provider.execution === "cloud" && provider.approvedByDefault !== false) {
      errors.push(`${prefix}: cloud providers may not be approved by default`);
    }
    if (provider.execution === "cloud" && provider.credentialKind === "none" && provider.id !== "openverse") {
      warnings.push(`${prefix}: cloud provider has no credential reference`);
    }
    if (!provider.pricing?.status) errors.push(`${prefix}: explicit pricing status is required`);
  }

  const aliases = providers.aliases ?? {};
  if (!aliases || typeof aliases !== "object" || Array.isArray(aliases)) {
    errors.push("providers: aliases must be an object");
  } else {
    for (const [alias, canonicalId] of Object.entries(aliases)) {
      const prefix = `provider alias ${alias}`;
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(alias)) errors.push(`${prefix}: invalid id`);
      if (providerIds.has(alias)) errors.push(`${prefix}: aliases may not shadow canonical ids`);
      if (!providerIds.has(canonicalId)) errors.push(`${prefix}: unknown canonical id ${canonicalId}`);
      if (aliases[canonicalId]) errors.push(`${prefix}: alias chains are not allowed`);
    }
  }

  const modelIds = new Set();
  for (const model of models.models ?? []) {
    const prefix = `model ${model.id ?? "<missing>"}`;
    if (!/^[a-z0-9][a-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(model.id ?? "")) errors.push(`${prefix}: invalid id`);
    if (modelIds.has(model.id)) errors.push(`${prefix}: duplicate id`);
    modelIds.add(model.id);
    if (!providerIds.has(model.providerId)) errors.push(`${prefix}: unknown providerId ${model.providerId}`);
    if (!model.providerModelId) errors.push(`${prefix}: providerModelId is required`);
    if (!model.revision || MUTABLE_REVISIONS.has(String(model.revision).toLowerCase())) errors.push(`${prefix}: immutable revision is required`);
    if (!ALLOWED_EXECUTION.has(model.execution)) errors.push(`${prefix}: execution must be local or cloud`);
    if (!Array.isArray(model.capabilities) || model.capabilities.length === 0) errors.push(`${prefix}: capabilities are required`);
    if (!model.launchStatus) errors.push(`${prefix}: launchStatus is required`);
    if (model.execution === "local" && model.providerId !== "mock") {
      if (model.artifactPolicy?.trustRemoteCode !== false) errors.push(`${prefix}: local artifacts must disable trustRemoteCode`);
      if (model.artifactPolicy?.sha256Required !== true) errors.push(`${prefix}: local artifacts must require SHA-256`);
      if (model.revision === "pin-required-before-download" && !model.launchStatus.includes("artifact-pin-required")) {
        errors.push(`${prefix}: unpinned artifact must remain launch-blocked`);
      }
    }
  }

  const packageJson = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
  const packageManagerVersion = String(packageJson.packageManager ?? "").split("@").at(-1);
  if (packageManagerVersion !== runtime.toolchains?.pnpm?.version) {
    errors.push(`runtime pnpm ${runtime.toolchains?.pnpm?.version} does not match packageManager ${packageManagerVersion}`);
  }
  const nodeVersionFile = readFileSync(resolve(ROOT, ".node-version"), "utf8").trim();
  if (nodeVersionFile !== runtime.toolchains?.node?.version) errors.push(".node-version does not match runtime-manifest.json");
  const pythonVersionFile = readFileSync(resolve(ROOT, ".python-version"), "utf8").trim();
  if (pythonVersionFile !== runtime.toolchains?.python?.version) errors.push(".python-version does not match runtime-manifest.json");
  if (runtime.policies?.runtimePackRequiresSignatureAndSha256 !== true) errors.push("runtime packs must require signatures and SHA-256");
  if (runtime.policies?.modelDownloadRequiresImmutableRevisionAndSha256 !== true) errors.push("model downloads must require immutable revisions and SHA-256");

  const desktopManifestPath = resolve(ROOT, "apps/desktop/package.json");
  if (existsSync(desktopManifestPath)) {
    const desktop = JSON.parse(readFileSync(desktopManifestPath, "utf8"));
    const playwrightRange = desktop.devDependencies?.["@playwright/test"];
    if (playwrightRange && playwrightRange.replace(/^[~^]/, "") !== runtime.renderer?.playwright?.version) {
      errors.push(`runtime Playwright ${runtime.renderer?.playwright?.version} does not match desktop ${playwrightRange}`);
    }
  }

  return {
    errors,
    warnings,
    providerCount: (providers.providers ?? []).length,
    modelCount: (models.models ?? []).length
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const { flags } = parseFlags(process.argv.slice(2));
  const result = validateCatalogs();
  if (flags.has("json")) {
    console.log(JSON.stringify({ ok: result.errors.length === 0, ...result }, null, 2));
  } else {
    for (const warning of result.warnings) console.warn(`WARN  ${warning}`);
    for (const error of result.errors) console.error(`FAIL  ${error}`);
    if (!result.errors.length) console.log(`PASS  catalogs (${result.providerCount} providers, ${result.modelCount} models)`);
  }
  process.exitCode = result.errors.length ? 1 : 0;
}
