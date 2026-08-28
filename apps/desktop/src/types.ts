export type GlobalArea = "home" | "projects" | "templates" | "library" | "providers" | "diagnostics";
export type Workspace = "plan" | "storyboard" | "studio" | "review" | "export";
export type StudioMode = "guided" | "studio";
export type ProjectStatus = "Planning" | "Ready to review" | "Rendering" | "Complete";
export type JobStatus = "running" | "queued" | "complete" | "attention";
export type SceneKind = "title" | "definition" | "diagram" | "worked-example" | "comparison" | "code" | "recap";

export interface Scene {
  id: string;
  index: number;
  title: string;
  kind: SceneKind;
  duration: number;
  narration: string;
  objective: string;
  status: "approved" | "draft" | "attention";
  visual: "thread" | "split" | "formula" | "code" | "summary";
  citations: number;
  locked: boolean;
}

export interface SourceRecord {
  id: string;
  title: string;
  origin: string;
  kind: "paper" | "book" | "web" | "document";
  license: string;
  evidence: number;
  status: "verified" | "review";
  versionId?: string;
  filename?: string;
  mediaType?: string;
  byteSize?: number;
  artifactHash?: string;
  storedRelativePath?: string;
  privacy?: "public" | "project_local" | "sensitive" | "restricted";
  rightsStatus?: "owned" | "licensed" | "public_domain" | "fair_use" | "unknown";
  attribution?: string | null;
}

export interface ProjectRecord {
  id: string;
  title: string;
  topic: string;
  description: string;
  locale: "English" | "Spanish" | "Hindi";
  audience: string;
  duration: number;
  updatedAt: string;
  progress: number;
  status: ProjectStatus;
  theme: string;
  privacy: "Local only" | "Approved cloud";
  scenes: Scene[];
  sources: SourceRecord[];
  /** Desktop project identity; safe to persist because it contains no credentials. */
  nativeProjectId?: string;
  nativeProjectDirectory?: string;
  nativeHeadRevisionId?: string;
  nativeRevisionNumber?: number;
  nativeArchivePath?: string;
  /** IDs selected from a durable QA gate; decorative review rows never populate this. */
  nativeRepairableFindingIds?: string[];
}

export interface JobRecord {
  id: string;
  title: string;
  detail: string;
  status: JobStatus;
  progress: number;
  eta?: string;
  cost?: string;
  /** Durable desktop job link; safe to persist because it contains no credentials. */
  projectId?: string;
  projectDirectory?: string;
  retryable?: boolean;
  operation?: "regenerate_scene" | "render_scene" | "repair_qa" | "export_master";
  result?: Record<string, unknown> | null;
}

export interface AppSnapshot {
  projects: ProjectRecord[];
  recentProjectId: string;
  studioMode: StudioMode;
  jobs: JobRecord[];
  version: number;
}

export interface ToastMessage {
  id: number;
  title: string;
  detail: string;
  tone?: "success" | "warning" | "info";
}
