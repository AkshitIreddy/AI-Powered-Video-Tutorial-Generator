import { readFile, writeFile, copyFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [installer, destination, sbom] = process.argv.slice(2);
if (!installer || !destination || !sbom) throw new Error("Usage: node scripts/prepare-release-assets.mjs INSTALLER OUTPUT_DIRECTORY SBOM");
const { version } = JSON.parse(await readFile(path.join(repo, "package.json"), "utf8"));
const name = `AI-Video-Tutorial-Generator_${version}_x64-setup.exe`;
await mkdir(destination, { recursive: true });
await copyFile(installer, path.join(destination, name));
await copyFile(`${installer}.sig`, path.join(destination, `${name}.sig`));
await copyFile(sbom, path.join(destination, "sbom.spdx.json"));
const signature = (await readFile(`${installer}.sig`, "utf8")).trim();
if (!signature) throw new Error("The updater signature is missing");
const manifest = {
  version,
  notes: `AI Video Tutorial Generator ${version}. Includes the tutorial studio, managed model downloads, and signed automatic updates.`,
  pub_date: new Date().toISOString(),
  platforms: { "windows-x86_64": {
    signature,
    url: `https://github.com/AkshitIreddy/AI-Powered-Video-Tutorial-Generator/releases/download/v${version}/${name}`,
  } },
};
await writeFile(path.join(destination, "latest.json"), JSON.stringify(manifest, null, 2) + "\n");
const sums = [];
for (const filename of [name, `${name}.sig`, "latest.json", "sbom.spdx.json"]) {
  const bytes = await readFile(path.join(destination, filename));
  sums.push(`${createHash("sha256").update(bytes).digest("hex")}  ${filename}`);
}
await writeFile(path.join(destination, "SHA256SUMS.txt"), sums.join("\n") + "\n");
console.log(`Prepared installer, signature, updater feed, SBOM and checksums in ${destination}`);
