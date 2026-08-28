#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { ROOT, parseFlags, run } from "./lib/shared.mjs";
import { collectComplianceComponents, collectInventory, inventoryFindings, toSpdxPackage } from "./lib/inventory.mjs";

const { flags } = parseFlags(process.argv.slice(2));
const inventory = collectInventory({ includeAllLocked: flags.has("all-locked") });
const components = collectComplianceComponents();
const findings = inventoryFindings(inventory, components);
const git = run("git", ["rev-parse", "HEAD"]);
const revision = git.ok ? git.stdout : "unversioned";
const namespaceSeed = createHash("sha256").update(`${revision}:${inventory.map((item) => `${item.name}@${item.version}`).join("|")}`).digest("hex");
const packages = [...inventory, ...components].map(toSpdxPackage);
const documentId = "SPDXRef-DOCUMENT";
const workspacePackages = inventory.filter((item) => item.workspace).map((item) => toSpdxPackage(item).SPDXID);
const sbom = {
  spdxVersion: "SPDX-2.3",
  dataLicense: "CC0-1.0",
  SPDXID: documentId,
  name: `Alystria-Studio-${revision.slice(0, 12)}`,
  documentNamespace: `https://alystria.local/spdx/${namespaceSeed}`,
  creationInfo: {
    created: new Date().toISOString(),
    creators: ["Tool: alystria-generate-sbom"]
  },
  documentDescribes: workspacePackages,
  packages,
  relationships: workspacePackages.map((id) => ({ spdxElementId: documentId, relationshipType: "DESCRIBES", relatedSpdxElement: id }))
};

if (flags.has("check")) {
  const duplicateIds = packages.filter((item, index) => packages.findIndex((candidate) => candidate.SPDXID === item.SPDXID) !== index);
  if (duplicateIds.length) {
    console.error(`FAIL  SBOM contains ${duplicateIds.length} duplicate SPDX package identifiers`);
    process.exitCode = 1;
  } else {
    console.log(`PASS  SBOM inventory can be generated (${inventory.length} software packages, ${components.length} gated/runtime components)`);
  }
  if (flags.has("strict") && (findings.unresolvedDependencies.length || findings.unresolvedBundledComponents.length || findings.invalidDependencyRecords.length)) {
    console.error(`FAIL  ${findings.unresolvedDependencies.length} dependencies and ${findings.unresolvedBundledComponents.length} bundled components lack licenses; ${findings.invalidDependencyRecords.length} dependency records lack exact lock/SPDX evidence`);
    process.exitCode = 1;
  }
  if (flags.has("release") && findings.releaseBlockers.length) {
    console.error(`FAIL  ${findings.releaseBlockers.length} required runtime/model components remain unassembled or lack artifact-specific license evidence; this is not release evidence`);
    process.exitCode = 1;
  }
  process.exit();
}

const output = resolve(ROOT, String(flags.get("output") || "dist/compliance/alystria-studio.spdx.json"));
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(sbom, null, 2)}\n`, { encoding: "utf8", flag: flags.has("force") ? "w" : "wx" });
console.log(`WROTE ${output} (${packages.length} package records)`);
