// Build a fresh production payload from pinned tools and this checkout's builds.
import { cp, readFile, writeFile, mkdir, readdir, realpath, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [toolsRoot, sidecarRoot, destination] = process.argv.slice(2).map(value => path.resolve(value));
if (!destination) throw new Error("Usage: assemble-release-runtime.mjs TOOLS SIDECAR DESTINATION");
await mkdir(destination); // A fresh directory prevents stale files entering releases.
const pins = JSON.parse(await readFile(path.join(repo, "runtime-manifest.json"), "utf8"));
const version = JSON.parse(await readFile(path.join(repo, "package.json"), "utf8")).version;
async function copy(source, relative) {
  const target = path.join(destination, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target, { recursive: true, dereference: true });
}
await copy(path.join(sidecarRoot, "alystria-pipeline.exe"), "alystria-pipeline.exe");
await copy(path.join(sidecarRoot, "assets"), "assets");
const node = path.join(toolsRoot, "node", `node-v${pins.toolchains.node.version}-win-x64`);
await copy(path.join(node, "node.exe"), "node/node.exe");
await copy(path.join(node, "LICENSE"), "node/LICENSE.txt");
await copy(path.join(toolsRoot, "chromium/chrome-win64"), "chromium");
const ffmpeg = pins.media.ffmpeg.windowsLgplShared;
const ffmpegRoot = path.join(toolsRoot, "ffmpeg", ffmpeg.extractedDirectory);
for (const item of ffmpeg.files) await copy(path.join(ffmpegRoot, "bin", item.name), `ffmpeg/${item.name}`);
await copy(path.join(ffmpegRoot, "LICENSE.txt"), "ffmpeg/LICENSE.txt");
for (const item of ["dist", "package.json"]) {
  await copy(path.join(repo, "services/renderer", item), `renderer/${item}`);
  await copy(path.join(repo, "packages/scenes", item), `renderer/node_modules/@alystria/scenes/${item}`);
}
const require = createRequire(path.join(repo, "services/renderer/package.json"));
for (const name of ["playwright-core", "react", "react-dom", "scheduler"]) {
  const resolver = name === "scheduler" ? createRequire(require.resolve("react-dom/package.json")) : require;
  const root = path.dirname(await realpath(resolver.resolve(`${name}/package.json`)));
  await copy(root, `renderer/node_modules/${name}`);
}
const identities = {
  "alystria-pipeline.exe": ["pipeline-worker", version, "MIT"],
  "node/node.exe": ["node", pins.toolchains.node.version, "MIT"],
  "chromium/chrome.exe": ["chromium", pins.renderer.chromium.browserVersion, "BSD-3-Clause"],
  "ffmpeg/ffmpeg.exe": ["ffmpeg", pins.media.ffmpeg.version, pins.media.ffmpeg.coreRuntimeLicense],
  "ffmpeg/ffprobe.exe": ["ffprobe", pins.media.ffmpeg.version, pins.media.ffmpeg.coreRuntimeLicense],
  "renderer/dist/src/cli.js": ["renderer-cli", version, "MIT"],
  "assets/starter/audio/catalog.json": ["starter-audio-catalog", version, "MIT"],
  "assets/starter/visuals/packages/themes/starter-kits/core.v1.json": ["starter-visual-catalog", version, "MIT"],
};
const components = [];
async function walk(relative = "") {
  for (const name of (await readdir(path.join(destination, relative))).sort()) {
    const file = path.posix.join(relative, name);
    const entry = await lstat(path.join(destination, file));
    if (entry.isSymbolicLink()) throw new Error(`Unexpected runtime link: ${file}`);
    if (entry.isDirectory()) { await walk(file); continue; }
    const bytes = await readFile(path.join(destination, file));
    const [id, componentVersion, license] = identities[file] ?? [`payload-${components.length}`, version, "SEE-BUNDLED-NOTICES"];
    components.push({ id, version: componentVersion, target: "windows-x86_64", relativePath: file,
      url: `https://github.com/AkshitIreddy/AI-Powered-Video-Tutorial-Generator/releases/tag/v${version}`,
      sha256: createHash("sha256").update(bytes).digest("hex"), sizeBytes: bytes.length, license, optional: false });
  }
}
await walk();
for (const [file, [id]] of Object.entries(identities)) {
  if (!components.some(component => component.id === id)) throw new Error(`Required runtime file missing: ${file}`);
}
await writeFile(path.join(destination, "runtime-manifest.json"), JSON.stringify({ components }, null, 2) + "\n");
console.log(`Assembled ${components.length} production runtime files.`);
