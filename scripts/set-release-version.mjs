import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2]?.replace(/^v/, "");
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) throw new Error("Provide a stable version, for example 1.8.1");
const check = process.argv.includes("--check");
const edits = [];
async function replace(file, pattern, replacement) {
  const before = await readFile(path.join(root, file), "utf8");
  if (!pattern.test(before)) throw new Error(`Version field missing: ${file}`);
  const after = before.replace(pattern, replacement);
  if (check && after !== before) throw new Error(`Version does not match ${version}: ${file}`);
  edits.push([file, after]);
}
for (const file of ["package.json", "apps/desktop/package.json", "apps/desktop/src-tauri/tauri.conf.json", "packages/contracts/package.json", "packages/scenes/package.json", "packages/themes/package.json", "services/renderer/package.json"]) {
  await replace(file, /("version"\s*:\s*")[^"]+(")/, `$1${version}$2`);
}
for (const file of ["apps/desktop/src-tauri/Cargo.toml", "services/pipeline/pyproject.toml"]) {
  await replace(file, /(^version = ")[^"]+(")/m, `$1${version}$2`);
}
await replace("apps/desktop/src-tauri/Cargo.lock", /(name = "alystria-desktop"\r?\nversion = ")[^"]+(")/, `$1${version}$2`);
await replace("services/pipeline/uv.lock", /(name = "alystria-pipeline"\r?\nversion = ")[^"]+(")/, `$1${version}$2`);
await replace("services/pipeline/src/alystria/__init__.py", /(__version__ = ")[^"]+(")/, `$1${version}$2`);
await replace("services/renderer/src/runtime.ts", /(RENDERER_VERSION = ")[^"]+(")/, `$1${version}$2`);
if (!check) {
  for (const [file, text] of edits) await writeFile(path.join(root, file), text);
  const readme = path.join(root, "README.md");
  await writeFile(readme, (await readFile(readme, "utf8"))
    .replace(/Download-v\d+\.\d+\.\d+-/g, `Download-v${version}-`)
    .replace(/Download version \d+\.\d+\.\d+/g, `Download version ${version}`)
    .replace(/AI-Video-Tutorial-Generator_\d+\.\d+\.\d+_x64-setup.exe/g, `AI-Video-Tutorial-Generator_${version}_x64-setup.exe`));
}
console.log(`${check ? "Confirmed" : "Set"} application and package versions: ${version}`);
