import type { AppSnapshot, JobRecord, ProjectRecord } from "./types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

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
  const generationId = typeof snapshot.generationId === "string" && UUID_PATTERN.test(snapshot.generationId)
    ? snapshot.generationId
    : project.nativeGenerationId;
  return {
    ...project,
    ...(snapshot as unknown as ProjectRecord),
    id: links.nativeProjectId ?? project.id,
    ...(generationId ? { nativeGenerationId: generationId } : {}),
    ...links,
  };
}

/** Repair safe UI references after a portable profile outlives a rebuilt sandbox. */
export function normalizeAppSnapshot(snapshot: AppSnapshot): AppSnapshot {
  const projects = snapshot.projects.map((project) => {
    const legacyGenerationId = (project as ProjectRecord & { generationId?: unknown }).generationId;
    return !project.nativeGenerationId && typeof legacyGenerationId === "string" && UUID_PATTERN.test(legacyGenerationId)
      ? { ...project, nativeGenerationId: legacyGenerationId }
      : project;
  });
  const recent = projects.find((project) => project.id === snapshot.recentProjectId)
    ?? projects.find((project) => project.nativeProjectId === snapshot.recentProjectId)
    ?? projects[0];
  return {
    ...snapshot,
    projects,
    recentProjectId: recent?.id ?? snapshot.recentProjectId,
  };
}

export function isDurableNativeJob(job: JobRecord): job is JobRecord & Required<Pick<JobRecord, "projectId" | "projectDirectory">> {
  return Boolean(job.projectId && job.projectDirectory && job.result?.durable !== false);
}
