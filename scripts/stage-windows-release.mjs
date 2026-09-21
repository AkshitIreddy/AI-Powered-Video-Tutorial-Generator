// Assemble only declared runtime payloads; never copy sandbox profiles, models,
// caches, credentials, test harnesses or user projects into an installer.
import { createHash, generateKeyPairSync, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { readFile, writeFile, mkdir, copyFile, stat, symlink, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [sourceRoot, outputRoot, keyRoot, workerPath] = process.argv.slice(2).map((value) => path.resolve(value));
if (!sourceRoot || !outputRoot || !keyRoot || !workerPath) throw new Error("Usage: node scripts/stage-windows-release.mjs SOURCE_RUNTIME OUTPUT_DIRECTORY PRIVATE_KEY_DIRECTORY BUILT_WORKER");
const version = JSON.parse(await readFile(path.join(repo, "package.json"), "utf8")).version;
const readJson = async (file) => JSON.parse((await readFile(file, "utf8")).replace(/^\uFEFF/, ""));
const canonical = (value) => value === null || typeof value !== "object" ? JSON.stringify(value)
  : Array.isArray(value) ? `[${value.map(canonical).join(",")}]`
  : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const contained = (root, relative) => {
  const candidate = path.resolve(root, relative);
  if (!candidate.startsWith(root + path.sep)) throw new Error(`Payload escapes its root: ${relative}`);
  return candidate;
};
await mkdir(keyRoot, { recursive: true });
const privatePath = path.join(keyRoot, "runtime-signing.key");
let privateKey;
try { privateKey = createPrivateKey(await readFile(privatePath)); }
catch (error) {
  if (error.code !== "ENOENT") throw error;
  const keys = generateKeyPairSync("ed25519");
  privateKey = keys.privateKey;
  await writeFile(privatePath, privateKey.export({ type: "pkcs8", format: "pem" }), { flag: "wx", mode: 0o600 });
}
const publicKey = createPublicKey(privateKey).export({ format: "jwk" });
const expectedPublicKey = (await readFile(path.join(repo, "apps/desktop/src-tauri/runtime-release-public-key.txt"), "utf8")).trim();
if (Buffer.from(publicKey.x, "base64url").toString("base64") !== expectedPublicKey) {
  throw new Error("Runtime signing key does not match the application's trusted public key");
}
const ledger = await readJson(path.join(sourceRoot, "runtime-manifest.json"));
const runtimeRoot = path.join(outputRoot, "runtime");
await mkdir(runtimeRoot, { recursive: true });
const components = [];
for (const original of ledger.components) {
  if (["chromium/debug.log", "chromium/First Run"].includes(original.relativePath)) continue;
  let source = contained(sourceRoot, original.relativePath);
  const prior = await readFile(source);
  if (sha256(prior) !== original.sha256 || prior.length !== original.sizeBytes) throw new Error(`Source runtime changed: ${original.relativePath}`);
  if (original.id === "pipeline-worker") source = workerPath;
  if (original.relativePath.startsWith("renderer/dist/")) source = contained(path.join(repo, "services/renderer"), original.relativePath.slice("renderer/".length));
  if (original.relativePath === "renderer/package.json") source = path.join(repo, "services/renderer/package.json");
  if (original.relativePath === "renderer/node_modules/@alystria/scenes/package.json") source = path.join(repo, "packages/scenes/package.json");
  const bytes = await readFile(source);
  const target = contained(runtimeRoot, original.relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);
  components.push({ ...original, version: original.version === "2.0.0-rc.0" ? version : original.version,
    url: `https://github.com/AkshitIreddy/AI-Powered-Video-Tutorial-Generator/releases/tag/v${version}#${encodeURIComponent(original.relativePath)}`,
    sha256: sha256(bytes), sizeBytes: bytes.length });
}
for (const [index, relative] of ["LICENSE", "THIRD_PARTY_NOTICES.md"].entries()) {
  const source = path.join(repo, relative);
  try { await stat(source); } catch { if (relative === "LICENSE") throw new Error("Missing project license"); else continue; }
  const bytes = await readFile(source);
  const target = path.join(runtimeRoot, "notices", relative);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(source, target);
  components.push({ id: `release-notice-${index}`, version, target: "windows-x86_64", relativePath: `notices/${relative}`,
    url: `https://github.com/AkshitIreddy/AI-Powered-Video-Tutorial-Generator/blob/v${version}/${relative}`,
    sha256: sha256(bytes), sizeBytes: bytes.length, license: "SEE-BUNDLED-NOTICES", optional: false });
}
const manifest = { schemaVersion: 1, channel: "stable", generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), components, note: `Core runtime bundled with AI Video Tutorial Generator ${version}. Optional models are downloaded separately.` };
const signature = sign(null, Buffer.from(canonical(manifest)), privateKey).toString("base64");
await writeFile(path.join(runtimeRoot, "runtime-manifest.json"), JSON.stringify({ ...manifest, signature: { algorithm: "Ed25519", keyId: "ai-video-tutorial-runtime-v1", value: signature } }, null, 2) + "\n");
// Tauri 2's resource normalizer drops Windows drive prefixes. A build-only
// junction gives it a relative path while keeping the large payload on E:.
const link = path.join(repo, "apps/desktop/src-tauri/staging/release-runtime");
await mkdir(path.dirname(link), { recursive: true });
try { await symlink(runtimeRoot, link, "junction"); }
catch (error) { if (error.code !== "EEXIST" || await realpath(link) !== await realpath(runtimeRoot)) throw error; }
await writeFile(path.join(outputRoot, "tauri.release.json"), JSON.stringify({ bundle: { resources: { "staging/release-runtime/": "runtime/" } } }, null, 2) + "\n");
console.log(`Staged ${components.length} signed runtime components for ${version} in ${outputRoot}`);
