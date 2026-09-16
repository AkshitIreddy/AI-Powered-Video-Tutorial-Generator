import type { ModelDownloadCatalogEntry } from "../native";
import type { CatalogItem } from "./types";

const knownPackageAliases: Readonly<Record<string, string>> = Object.freeze({
  "local/sdxl-offset-lora-1.0": "local/sdxl-base-1.0",
});

const explicitPackageToken = /^(?:download-model|download-package|package)\s*[:=]\s*(local\/[a-z0-9][a-z0-9._-]*)$/i;

function normalizedModelId(value: string): string {
  return value.trim().replaceAll("\\", "/").toLowerCase();
}

function explicitPackageIds(item: CatalogItem): readonly string[] {
  const values = [...item.classification.tags, ...item.execution.runtimes];
  return values.flatMap((value) => {
    const match = explicitPackageToken.exec(value.trim());
    return match?.[1] ? [normalizedModelId(match[1])] : [];
  });
}

/**
 * Resolves a catalog row to one immutable package exposed by the native
 * download manager. The match is deliberately strict: a fuzzy model-name
 * match could start a multi-gigabyte package that the user did not choose.
 */
export function findModelDownloadEntry<TEntry extends ModelDownloadCatalogEntry>(
  item: CatalogItem,
  entries: readonly TEntry[],
): TEntry | null {
  if (!item.execution.boundaries.includes("local")) return null;

  const byId = new Map(entries.map((entry) => [normalizedModelId(entry.modelId), entry] as const));
  const sourceId = normalizedModelId(item.identity.sourceId);
  const direct = byId.get(sourceId);
  if (direct) return direct;

  const alias = knownPackageAliases[sourceId];
  if (alias) return byId.get(alias) ?? null;

  const explicitMatches = new Map<string, TEntry>();
  for (const packageId of explicitPackageIds(item)) {
    const entry = byId.get(packageId);
    if (entry) explicitMatches.set(packageId, entry);
  }
  return explicitMatches.size === 1 ? [...explicitMatches.values()][0] ?? null : null;
}
