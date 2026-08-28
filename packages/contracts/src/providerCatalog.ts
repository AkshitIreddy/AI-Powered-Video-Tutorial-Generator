/** Distribution provider catalog consumed by desktop/tooling boundaries. */

export type ProviderExecution = "local" | "cloud";
export type ProviderCredentialKind = "none" | "secret-reference" | "optional-secret-reference";

export interface DistributionProviderEntry {
  id: string;
  displayName: string;
  execution: ProviderExecution;
  credentialKind: ProviderCredentialKind;
  approvedByDefault: boolean;
  capabilities: string[];
  dataBoundary: string;
  pricing: { status: string; hardBudgetEligible: boolean };
  usagePolicy?: {
    productionEligible: boolean;
    acceptedDataClasses: string[];
    explicitTermsApprovalRequired: boolean;
    modelAvailabilityCheckRequired: boolean;
    trainingUse: string;
    retention: string;
    selfHostedEntitlementSeparate: boolean;
    termsUrl: string;
  };
}

export interface DistributionProviderCatalog {
  schemaVersion: 1;
  catalogVersion: string;
  lastVerifiedAt: string;
  aliases: Record<string, string>;
  providers: DistributionProviderEntry[];
}

export interface ProviderCatalogValidation {
  valid: boolean;
  errors: string[];
  canonicalProviderIds: string[];
}

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const CREDENTIAL_KINDS = new Set<ProviderCredentialKind>([
  "none",
  "secret-reference",
  "optional-secret-reference",
]);

/** Validate IDs and aliases without accepting provider-specific secret values. */
export function validateDistributionProviderCatalog(value: unknown): ProviderCatalogValidation {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { valid: false, errors: ["catalog must be an object"], canonicalProviderIds: [] };
  }
  if (value.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (typeof value.catalogVersion !== "string" || !/^\d{4}\.\d{2}\.\d{2}\.\d+$/u.test(value.catalogVersion)) {
    errors.push("catalogVersion must use YYYY.MM.DD.N");
  }
  if (!Array.isArray(value.providers)) {
    return { valid: false, errors: [...errors, "providers must be an array"], canonicalProviderIds: [] };
  }

  const ids = new Set<string>();
  for (const entry of value.providers) {
    if (!isRecord(entry) || typeof entry.id !== "string" || !ID_PATTERN.test(entry.id)) {
      errors.push("provider id is invalid");
      continue;
    }
    if (ids.has(entry.id)) errors.push(`duplicate provider id ${entry.id}`);
    ids.add(entry.id);
    if (entry.execution !== "local" && entry.execution !== "cloud") {
      errors.push(`${entry.id}: invalid execution boundary`);
    }
    if (!CREDENTIAL_KINDS.has(entry.credentialKind as ProviderCredentialKind)) {
      errors.push(`${entry.id}: invalid credential kind`);
    }
    if (entry.execution === "cloud" && entry.approvedByDefault !== false) {
      errors.push(`${entry.id}: cloud providers cannot be approved by default`);
    }
    if (entry.id === "nvidia-nim") {
      const policy = entry.usagePolicy;
      if (!isRecord(policy) || policy.productionEligible !== false) {
        errors.push("nvidia-nim: hosted preview must be marked non-production");
      }
      if (!isRecord(policy) || policy.explicitTermsApprovalRequired !== true) {
        errors.push("nvidia-nim: explicit Trial Terms approval is required");
      }
      if (!isRecord(policy) || !Array.isArray(policy.acceptedDataClasses) || policy.acceptedDataClasses.join(",") !== "public") {
        errors.push("nvidia-nim: hosted preview must be public/synthetic-only");
      }
      if (!isRecord(policy) || policy.selfHostedEntitlementSeparate !== true) {
        errors.push("nvidia-nim: self-hosted entitlement must remain separate");
      }
    }
  }

  if (!isRecord(value.aliases)) {
    errors.push("aliases must be an object");
  } else {
    for (const [alias, target] of Object.entries(value.aliases)) {
      if (!ID_PATTERN.test(alias) || typeof target !== "string") {
        errors.push(`invalid provider alias ${alias}`);
      } else if (ids.has(alias)) {
        errors.push(`provider alias ${alias} shadows a canonical id`);
      } else if (!ids.has(target)) {
        errors.push(`provider alias ${alias} targets unknown provider ${target}`);
      } else if (Object.hasOwn(value.aliases, target)) {
        errors.push(`provider alias ${alias} forms an alias chain`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    canonicalProviderIds: [...ids].sort(),
  };
}

export function resolveCanonicalProviderId(
  catalog: DistributionProviderCatalog,
  providerId: string,
): string {
  return catalog.aliases[providerId] ?? providerId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
