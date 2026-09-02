import { demandFromCatalogRequirements, evaluateResourceFit } from "./resourcePolicy";
import type {
  CatalogItem,
  CompatibilityContext,
  CompatibilityLevel,
  CompatibilityReason,
  CompatibilityResult,
  DistributionPurpose,
  LicenseDecision,
} from "./types";

const levelRank: Record<CompatibilityLevel, number> = {
  ready: 0,
  "ready-with-changes": 1,
  "needs-setup": 2,
  unknown: 3,
  blocked: 4,
};

export function evaluateCatalogCompatibility(item: CatalogItem, context: CompatibilityContext): CompatibilityResult {
  const reasons: CompatibilityReason[] = [];
  const resource = evaluateResourceFit(demandFromCatalogRequirements({
    estimatedVramBytes: item.requirements.estimatedVramBytes,
    estimatedRamBytes: item.requirements.estimatedRamBytes,
    installedBytes: item.requirements.installedBytes,
  }), context.hardware, context.resourcePolicy);
  const license = evaluateLicense(item, context.distributionPurpose, context.allowUnknownLicenseForPrivateUse);

  if (context.capability && !item.classification.capabilities.includes(context.capability)) {
    reasons.push(error("capability-mismatch", `This model does not provide ${context.capability}.`, "Choose a model that lists the required capability."));
  }

  if (!item.execution.boundaries.some((boundary) => context.allowedBoundaries.includes(boundary))) {
    reasons.push(error("boundary-disallowed", `This model runs ${item.execution.boundaries.join(" or ")}, outside the allowed execution boundary.`, "Allow the required boundary or choose another model."));
  }

  const selectedBase = normalizeFamily(context.selectedBaseFamily);
  if (selectedBase && requiresBaseFamilyMatch(item)) {
    const compatible = item.compatibility.compatibleBaseFamilies.map(normalizeFamily);
    const incompatible = item.compatibility.incompatibleBaseFamilies.map(normalizeFamily);
    if (incompatible.includes(selectedBase) || (compatible.length > 0 && !compatible.includes(selectedBase))) {
      reasons.push(error("base-family-mismatch", `${item.identity.name} is not compatible with the selected ${context.selectedBaseFamily} base family.`, "Choose an adapter built for the selected base family."));
    } else if (compatible.length === 0) {
      reasons.push(warning("metadata-incomplete", "The adapter does not declare a compatible base-model family.", "Review its source metadata before attaching it."));
    }
  }

  if (!item.compatibility.supportedOperatingSystems.includes(context.hardware.operatingSystem)) {
    reasons.push(error("operating-system", `The model metadata does not list ${context.hardware.operatingSystem} as supported.`, "Choose a Windows-compatible runtime or a hosted endpoint."));
  }

  if (item.compatibility.requiredGpuVendors.length > 0 && !item.compatibility.requiredGpuVendors.includes(context.hardware.gpuVendor)) {
    reasons.push(error("hardware-vendor", `This local deployment requires ${item.compatibility.requiredGpuVendors.join(" or ")} GPU hardware.`, "Use a compatible GPU or select a cloud route."));
  }

  const eligibleBoundaries = item.execution.boundaries.filter((boundary) => context.allowedBoundaries.includes(boundary));
  const localIsMandatory = eligibleBoundaries.includes("local") && !eligibleBoundaries.includes("cloud");
  const cloudIsMandatory = eligibleBoundaries.includes("cloud") && !eligibleBoundaries.includes("local");
  const requiredRuntimes = localIsMandatory
    ? (context.requiredRuntime ? [context.requiredRuntime] : item.execution.runtimes)
    : [];
  for (const runtime of requiredRuntimes) {
    const installed = context.hardware.installedRuntimes[runtime];
    if (!installed) {
      reasons.push(setup("runtime-missing", `${runtime} is required but is not installed.`, `Install and verify ${runtime}, then re-run preflight.`));
      continue;
    }
    const minimum = item.requirements.minimumRuntimeVersions[runtime];
    if (installed && minimum && compareVersions(installed, minimum) < 0) {
      reasons.push(setup("runtime-outdated", `${runtime} ${installed} is older than the required ${minimum}.`, `Update ${runtime} and verify the installation.`));
    }
  }

  if (item.trust.gated && item.trust.termsAccepted !== true) {
    reasons.push(setup("terms-required", "Provider or publisher terms must be reviewed and accepted before access.", "Open the source page, review the current terms, and record acceptance."));
  }

  if (cloudIsMandatory && !context.hardware.providerConnectionIds.includes(item.identity.providerId)) {
    reasons.push(setup("credential-required", `${item.identity.providerId} is not connected.`, "Configure and test this provider in the OS-backed credential settings."));
  }

  if (item.requirements.requiredArtifacts.some((artifact) => !artifact.optional)) {
    const names = item.requirements.requiredArtifacts.filter((artifact) => !artifact.optional).map((artifact) => artifact.identifier);
    reasons.push(setup("artifact-required", `Additional artifacts are required: ${names.join(", ")}.`, "Install a tested recipe that includes every required component."));
  }

  if (item.localInstall && item.localInstall.status !== "verified") {
    reasons.push(setup("unverified-install", `The local install is ${item.localInstall.status}.`, "Verify its immutable fingerprint and required files before selection."));
  }

  if (item.availability === "unavailable") {
    reasons.push(error("availability", "This catalog entry is currently unavailable.", "Refresh its source or choose another revision."));
  } else if (item.availability === "unknown") {
    reasons.push(warning("availability", "Current availability has not been verified.", "Probe the endpoint or refresh the source before starting a job."));
  }

  for (const message of license.messages) {
    reasons.push(license.status === "blocked"
      ? error("license-blocked", message, "Choose a model whose terms match the project's distribution purpose.")
      : warning("license-review", message, "Review and record the exact license before export."));
  }

  if (resource.level === "red") {
    reasons.push(error("resource-exceeded", resource.messages.join(" ") || "The model exceeds the selected resource policy.", "Choose a smaller variant, change policy deliberately, or use a cloud route."));
  } else if (resource.level === "amber") {
    reasons.push(warning("resource-adaptation", resource.messages.join(" ") || "The model needs resource adaptations.", "Review and approve the proposed adaptations."));
  } else if (resource.level === "unknown") {
    reasons.push(warning("metadata-incomplete", resource.messages.join(" ") || "Resource requirements are incomplete.", "Run a low-cost estimate or probe before loading."));
  }

  let level: CompatibilityLevel = "ready";
  if (reasons.some((reason) => reason.severity === "error")) level = "blocked";
  else if (reasons.some((reason) => reason.code === "runtime-missing" || reason.code === "runtime-outdated" || reason.code === "terms-required" || reason.code === "credential-required" || reason.code === "artifact-required" || reason.code === "unverified-install")) level = "needs-setup";
  else if (reasons.some((reason) => reason.code === "metadata-incomplete" || reason.code === "availability")) level = "unknown";
  else if (reasons.some((reason) => reason.severity === "warning")) level = "ready-with-changes";

  return { level, reasons, resource, license, canSelect: level === "ready" || level === "ready-with-changes" };
}

export function evaluateLicense(item: CatalogItem, purpose: DistributionPurpose, allowUnknownForPrivate: boolean): LicenseDecision {
  const license = item.license;
  if (purpose === "private") {
    if (license.status === "unknown" && !allowUnknownForPrivate) {
      return { status: "review", messages: ["License metadata is unknown, even for private project use."] };
    }
    return license.status === "unknown"
      ? { status: "review", messages: ["Private use is allowed by project policy, but the model license remains unresolved."] }
      : { status: "allowed", messages: [] };
  }

  if (license.status === "unknown" || license.commercialUse === "unknown") {
    return { status: "blocked", messages: ["Public distribution is blocked because commercial and publication rights are unknown."] };
  }
  if (purpose === "commercial" && license.commercialUse !== "allowed") {
    return { status: "blocked", messages: [`Commercial use is ${license.commercialUse.replace("-", " ")} under the recorded model terms.`] };
  }
  if (purpose === "public-noncommercial" && license.commercialUse === "restricted") {
    return { status: "review", messages: ["The recorded license has restrictions that require review before public distribution."] };
  }
  return { status: "allowed", messages: license.attributionRequired ? ["Attribution is required in the export provenance report."] : [] };
}

export function compareCompatibility(left: CompatibilityResult, right: CompatibilityResult): number {
  return levelRank[left.level] - levelRank[right.level];
}

function requiresBaseFamilyMatch(item: CatalogItem): boolean {
  return ["lora", "control-adapter", "reference-adapter"].includes(item.classification.artifactType);
}

function normalizeFamily(value: string | null): string {
  return value?.trim().toLowerCase().replace(/[\s_]+/g, "-") ?? "";
}

function compareVersions(left: string, right: string): number {
  const a = left.split(/[^0-9]+/).filter(Boolean).map(Number);
  const b = right.split(/[^0-9]+/).filter(Boolean).map(Number);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

function error(code: CompatibilityReason["code"], message: string, remediation: string): CompatibilityReason {
  return { code, severity: "error", message, remediation };
}

function warning(code: CompatibilityReason["code"], message: string, remediation: string): CompatibilityReason {
  return { code, severity: "warning", message, remediation };
}

function setup(code: CompatibilityReason["code"], message: string, remediation: string): CompatibilityReason {
  return { code, severity: "info", message, remediation };
}
