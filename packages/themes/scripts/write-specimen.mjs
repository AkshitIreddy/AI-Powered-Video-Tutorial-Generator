import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createThemeSpecimenHtml } from "../dist/specimen.js";

const packageDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const outputDirectory = join(packageDirectory, "dist");
const outputPath = join(outputDirectory, "theme-specimen.html");

await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, createThemeSpecimenHtml(process.argv[2] ?? "en"), "utf8");
process.stdout.write(`${outputPath}\n`);
