import type { ModelProfile } from "../native";
import type { CatalogItem } from "./types";

export function isCloudWritingProfileCandidate(item: CatalogItem, providerIds: readonly string[]): boolean {
  return item.classification.capabilities.includes("llm.structured")
    && item.execution.boundaries.includes("cloud")
    && providerIds.includes(item.identity.providerId);
}

export function stageCatalogWritingModel(profile: ModelProfile, item: CatalogItem): ModelProfile {
  return {
    ...profile,
    routes: {
      ...profile.routes,
      writing: {
        ...(profile.routes.writing ?? {}),
        providerId: item.identity.providerId,
        modelId: item.identity.sourceId,
        modelRevision: item.identity.revision,
        installFingerprint: null,
      },
    },
  };
}
