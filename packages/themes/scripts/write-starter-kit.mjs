#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BUILT_IN_STARTER_KIT } from "../dist/starterKitCatalog.js";

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(packageDirectory, "starter-kits/core.v1.json");
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(BUILT_IN_STARTER_KIT, null, 2)}\n`, "utf8");
process.stdout.write(`${outputPath}\n`);
