#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { ROOT, parseFlags } from "./lib/shared.mjs";
import { collectComplianceComponents, collectInventory, inventoryFindings } from "./lib/inventory.mjs";

const { flags } = parseFlags(process.argv.slice(2));
const inventory = collectInventory({ includeAllLocked: flags.has("all-locked") });
const components = collectComplianceComponents();
const thirdParty = inventory.filter((item) => !item.workspace);
const findings = inventoryFindings(inventory, components);
const lines = [
  "# Third-Party Software Notices",
  "",
  "Generated without network access from committed manifests/locks and locally installed package metadata.",
  "This inventory describes the current distributable dependency set. Use `--all-locked` to audit optional and development-only Python lock entries.",
  "",
  "## Distributed dependencies",
  "",
  "| Package | Version | Ecosystem | Declared license | Local evidence |",
  "|---|---:|---|---|---|",
  ...thirdParty.map((item) => `| ${item.name.replaceAll("|", "\\|")} | ${item.version.replaceAll("|", "\\|")} | ${item.ecosystem} | ${item.license} | ${item.sources.join(", ")} |`),
  "",
  "## Gated runtime and model catalog",
  "",
  "These entries are not proof that an artifact is bundled, signed, redistributable, or downloaded. A catalog entry with `NOASSERTION` is intentionally blocked on artifact-specific license evidence.",
  "",
  "| Component | Version/revision | License | Distribution status | Evidence note |",
  "|---|---:|---|---|---|",
  ...components.map((item) => `| ${item.name.replaceAll("|", "\\|")} | ${String(item.version).replaceAll("|", "\\|")} | ${item.license} | ${item.distributionStatus} | ${(item.licenseReason ?? "Manifest declaration available").replaceAll("|", "\\|")} |`),
  "",
  "## Evidence boundary",
  "",
  "This document does **not** claim that signed runtime packs, a production installer, model artifacts, Content Credentials/C2PA manifests, or a complete Chromium third-party license bundle were generated.",
  "The `--strict` check covers dependencies/components currently marked for distribution. `--release` additionally rejects required catalog-only or unassembled runtime/model entries; optional packs remain disclosed without being treated as bundled.",
  ""
];

if (flags.has("check")) {
  console.log(`PASS  notice inventory can be generated (${thirdParty.length} distributed dependencies, ${findings.unresolvedDependencies.length} unresolved; ${components.length} gated/runtime components)`);
} else {
  const output = resolve(ROOT, String(flags.get("output") || "dist/compliance/THIRD_PARTY_NOTICES.md"));
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${lines.join("\n")}\n`, { encoding: "utf8", flag: flags.has("force") ? "w" : "wx" });
  console.log(`WROTE ${output} (${thirdParty.length} distributed dependencies, ${findings.unresolvedDependencies.length} unresolved; ${components.length} gated/runtime components)`);
}

if (flags.has("strict") && (findings.unresolvedDependencies.length || findings.unresolvedBundledComponents.length || findings.invalidDependencyRecords.length)) {
  console.error(`FAIL  ${findings.unresolvedDependencies.length} dependencies and ${findings.unresolvedBundledComponents.length} bundled components lack licenses; ${findings.invalidDependencyRecords.length} dependency records lack exact lock/SPDX evidence`);
  process.exitCode = 1;
}
if (flags.has("release") && findings.releaseBlockers.length) {
  console.error(`FAIL  ${findings.releaseBlockers.length} required runtime/model components remain unassembled or lack artifact-specific license evidence; this notice is not release evidence`);
  process.exitCode = 1;
}
