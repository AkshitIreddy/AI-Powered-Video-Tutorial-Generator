import type { AppSnapshot, JobRecord, ProjectRecord, Scene, SourceRecord } from "./types";
import type { AuthoredStoryboardScene } from "@alystria/scenes";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const LEGACY_DEMO_PROJECTS = new Map([
  ["karatsuba", "Karatsuba, visually"],
  ["binary-search", "Binary search without guessing"],
  ["french-revolution", "A revolution in six turning points"],
]);
const LEGACY_DEMO_JOBS = new Set(["job-1", "job-2", "job-3"]);

function isLegacySeededSnapshot(snapshot: AppSnapshot): boolean {
  if (snapshot.version !== 12 || snapshot.recentProjectId !== "karatsuba") return false;
  if (snapshot.projects.length !== LEGACY_DEMO_PROJECTS.size || snapshot.jobs.length !== LEGACY_DEMO_JOBS.size) return false;
  const hasOnlySeededProjects = snapshot.projects.every((project) => (
    LEGACY_DEMO_PROJECTS.get(project.id) === project.title
    && !project.nativeProjectId
    && !project.nativeProjectDirectory
    && !project.nativeHeadRevisionId
  ));
  const hasOnlySeededJobs = snapshot.jobs.every((job) => LEGACY_DEMO_JOBS.has(job.id) && !job.projectDirectory);
  return hasOnlySeededProjects && hasOnlySeededJobs;
}

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
    scenes: generatedScenes(snapshot, project.scenes),
    sources: generatedSources(snapshot, project.sources),
    id: links.nativeProjectId ?? project.id,
    ...(generationId ? { nativeGenerationId: generationId } : {}),
    ...links,
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function generatedSources(snapshot: Record<string, unknown>, fallback: SourceRecord[]): SourceRecord[] {
  const rawSources = record(snapshot.payload)?.sources;
  if (!Array.isArray(rawSources)) return Array.isArray(snapshot.sources) ? snapshot.sources as SourceRecord[] : fallback;
  return rawSources.flatMap((raw) => {
    const source = record(raw);
    if (!source || typeof source.id !== "string" || typeof source.title !== "string") return [];
    const existing = fallback.find((item) => item.id === source.id);
    return [{
      ...existing,
      id: source.id,
      title: source.title,
      origin: typeof source.locator === "string" ? source.locator : existing?.origin ?? "Generation source",
      kind: existing?.kind ?? "document",
      license: typeof source.licenseId === "string" ? source.licenseId : existing?.license ?? "Rights review required",
      evidence: existing?.evidence ?? 0,
      status: existing?.status ?? "review",
      ...(typeof source.versionId === "string" ? { versionId: source.versionId } : {}),
      ...(typeof source.artifactHash === "string" ? { artifactHash: source.artifactHash } : {}),
    } satisfies SourceRecord];
  });
}

/** Hydrate generated content instead of leaving the pre-generation scaffold on screen. */
function generatedScenes(snapshot: Record<string, unknown>, fallback: Scene[]): Scene[] {
  const storyboard = record(record(snapshot.payload)?.storyboard);
  const rawScenes = Array.isArray(storyboard?.scenes) ? storyboard.scenes : null;
  if (!rawScenes) return Array.isArray(snapshot.scenes) ? snapshot.scenes as Scene[] : fallback;
  return rawScenes.flatMap((raw, index) => {
    const source = record(raw);
    if (!source || typeof source.id !== "string" || typeof source.title !== "string") return [];
    const existing = (Array.isArray(snapshot.scenes) ? snapshot.scenes as Scene[] : fallback).find((scene) => scene.id === source.id);
    const kind = String(source.type ?? source.kind ?? "definition").replaceAll("_", "-");
    const visual = kind.includes("code") ? "code" : kind === "whiteboard" ? "whiteboard" : kind === "diagram" ? "thread" : kind.includes("example") ? "formula" : "summary";
    const duration = typeof source.durationTicks === "number" ? source.durationTicks / 240_000 : typeof source.duration === "number" ? source.duration : existing?.duration ?? 10;
    const objectives = Array.isArray(source.objectiveIds) ? source.objectiveIds.filter((value): value is string => typeof value === "string") : [];
    return [{
      ...existing,
      id: source.id, index: index + 1, title: source.title,
      kind: kind as Scene["kind"], visual: visual as Scene["visual"],
      duration: Math.max(1 / 30, duration),
      narration: typeof source.narration === "string" ? source.narration : "",
      objective: typeof source.visualIntent === "string" ? source.visualIntent : objectives.join(" · "),
      status: existing?.status ?? "draft",
      citations: Array.isArray(source.claimIds) ? source.claimIds.length : 0,
      locked: existing?.locked ?? false,
      authored: source as unknown as AuthoredStoryboardScene,
    } satisfies Scene];
  });
}

/** Repair safe UI references after a portable profile outlives a rebuilt sandbox. */
export function normalizeAppSnapshot(snapshot: AppSnapshot): AppSnapshot {
  // Builds before the Alystria overhaul stored the showcase workspace as if it
  // belonged to every user. Remove that exact fingerprint once, while leaving
  // any real native project or user-created job untouched.
  if (isLegacySeededSnapshot(snapshot)) {
    return {
      projects: [],
      recentProjectId: null,
      studioMode: snapshot.studioMode,
      version: 0,
      jobs: [],
    };
  }
  const projects = snapshot.projects.map((project) => {
    const legacyGenerationId = (project as ProjectRecord & { generationId?: unknown }).generationId;
    return !project.nativeGenerationId && typeof legacyGenerationId === "string" && UUID_PATTERN.test(legacyGenerationId)
      ? { ...project, nativeGenerationId: legacyGenerationId }
      : project;
  });
  const recent = projects.find((project) => project.id === snapshot.recentProjectId)
    ?? projects.find((project) => project.nativeProjectId === snapshot.recentProjectId)
    ?? projects[0];
  const jobs = snapshot.jobs.map((job) => {
    if (job.projectId && job.projectDirectory) return job;
    const project = projects.find((candidate) => candidate.nativeGenerationId === job.id);
    return project?.nativeProjectId && project.nativeProjectDirectory
      ? { ...job, projectId: project.nativeProjectId, projectDirectory: project.nativeProjectDirectory }
      : job;
  });
  return {
    ...snapshot,
    projects,
    recentProjectId: recent?.id ?? null,
    jobs,
  };
}

export function isDurableNativeJob(job: JobRecord): job is JobRecord & Required<Pick<JobRecord, "projectId" | "projectDirectory">> {
  return Boolean(job.projectId && job.projectDirectory && job.result?.durable !== false);
}
