import type { ProjectRecord } from "./types";

export function projectTitleFromTopic(topic: string): string {
  const normalized = topic.trim().replace(/\s+/gu, " ") || "Untitled tutorial";
  const firstClause = normalized.split(/[:\n.!?]/u, 1)[0]?.trim() ?? "";
  const candidate = firstClause.length >= 12 ? firstClause : normalized;
  if (candidate.length <= 160) return candidate;
  const prefix = candidate.slice(0, 157);
  const wordBoundary = prefix.lastIndexOf(" ");
  return `${wordBoundary >= 80 ? prefix.slice(0, wordBoundary) : prefix}…`;
}

export function canonicalFixtureIdFromTopic(topic: string): ProjectRecord["canonicalFixtureId"] {
  const normalized = topic.trim().replace(/\s+/gu, " ");
  const asksForKaratsuba = /\bkaratsuba\b/iu.test(normalized);
  const asksForFlagship = /\bcanonical\b/iu.test(normalized)
    || /\b(?:12|twelve)[ -]minute\b/iu.test(normalized);
  return asksForKaratsuba && asksForFlagship
    ? "fixture.karatsuba.undergraduate.en"
    : undefined;
}

export function hydrateDurableProject(
  project: ProjectRecord,
  snapshot: Record<string, unknown>,
  links: Pick<
    ProjectRecord,
    "nativeProjectId" | "nativeProjectDirectory" | "nativeHeadRevisionId" | "nativeRevisionNumber"
  >,
): ProjectRecord {
  const isFullProject = typeof snapshot.title === "string"
    && Array.isArray(snapshot.scenes)
    && Array.isArray(snapshot.sources);
  const isLegacyStageSnapshot = typeof snapshot.projectId === "string"
    && typeof snapshot.stage === "string"
    && typeof snapshot.payload === "object"
    && snapshot.payload !== null;
  if (!isFullProject && !isLegacyStageSnapshot) {
    throw new Error("The durable project snapshot has an unsupported shape.");
  }
  return {
    ...project,
    ...(snapshot as unknown as ProjectRecord),
    id: links.nativeProjectId ?? project.id,
    ...links,
  };
}
