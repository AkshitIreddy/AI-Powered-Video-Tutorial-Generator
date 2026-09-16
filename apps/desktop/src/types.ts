export type GlobalArea = "home" | "projects" | "templates" | "library" | "providers" | "diagnostics";
export type Workspace = "plan" | "storyboard" | "studio" | "review" | "export";
export type StudioMode = "guided" | "studio";
export type ProjectStatus = "Planning" | "Ready to review" | "Rendering" | "Complete";
export type JobStatus = "running" | "queued" | "complete" | "attention";
export type SceneKind = "title" | "definition" | "diagram" | "whiteboard" | "worked-example" | "comparison" | "code" | "live-code" | "recap";
export type TutorialMode = "visual-explanation" | "whiteboard-lesson" | "live-coding" | "presenter-slides" | "worked-derivation" | "hybrid-teaching";

export interface Scene {
  visualAssetId?: string;
  visualArtifactHash?: string;
  /** Unmodified generated storyboard content; never filled from visual specimens. */
  authored?: import("@alystria/scenes").AuthoredStoryboardScene;
  id: string;
  index: number;
  title: string;
  kind: SceneKind;
  duration: number;
  narration: string;
  objective: string;
  status: "approved" | "draft" | "attention";
  visual: "thread" | "split" | "formula" | "whiteboard" | "code" | "live-code" | "summary";
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

export type StudioAssetKind = "presenter" | "background" | "element" | "font" | "music" | "sfx";

/**
 * A portable rights/provenance record. Uploaded bytes stay in the project CAS;
 * this snapshot stores only the immutable identity needed by export checks.
 */
export interface StudioAssetReference {
  id: string;
  kind: StudioAssetKind;
  label: string;
  source: "starter-pack" | "user-upload" | "generated" | "licensed-media";
  filename?: string;
  mediaType?: string;
  byteSize?: number;
  sha256?: string;
  creator: string;
  license: string;
  attribution: string;
  sourceUrl?: string;
  rightsStatus: "cleared" | "review";
}

export interface CanvasCustomization {
  fontPairId: "editorial" | "humanist" | "technical" | "cinematic" | "custom";
  displayFont: string;
  bodyFont: string;
  typeScale: number;
  lineHeight: "compact" | "balanced" | "airy";
  fonts: {
    displayAssetId: string | null;
    bodyAssetId: string | null;
  };
  paletteId: "precision" | "midnight" | "field-notes" | "signal" | "custom";
  colors: {
    paper: string;
    ink: string;
    accent: string;
    evidence: string;
  };
  backgroundMode: "paper" | "grid" | "gradient" | "image";
  backgroundAssetId: string | null;
  materialStrength: number;
  density: "compact" | "balanced" | "spacious";
  contrast: "standard" | "high";
  reducedMotion: boolean;
  sceneTreatment: "edge-to-edge" | "card" | "editorial-frame";
  cornerRadius: number;
  shadowStrength: number;
  captions: {
    position: "auto" | "top" | "lower-third";
    style: "soft-panel" | "solid-panel" | "outline";
    size: number;
    safeInset: number;
    textColor: string;
    panelColor: string;
    maxLines: 1 | 2 | 3;
  };
  presenter: {
    assetId: string | null;
    placement: "off" | "picture-in-picture" | "split" | "full-frame";
    side: "left" | "right";
    scale: number;
    crop: "contain" | "cover" | "portrait";
    frame: "none" | "soft" | "keyline";
    idleAnimation?: boolean;
    blink?: boolean;
    breathing?: boolean;
    restMouth?: "closed";
    voiceDirection?: string;
    preferredVoiceId?: string | null;
  };
  audio: {
    musicAssetId: string | null;
    sfxAssetId: string | null;
    musicLevel: number;
    sfxLevel: number;
    narrationDucking: number;
  };
  assets: StudioAssetReference[];
}

export interface CreativeConfiguration {
  slide: {
    mode: "designed" | "illustrated";
    layoutSystem: "editorial-grid" | "teaching-cards" | "cinematic" | "custom";
    density: "focused" | "balanced" | "dense";
    alignmentGuides: boolean;
    safeAreas: boolean;
    visualReviewModel: string;
    patchLimit: number;
    imageModel: string;
    prompt: string;
    loras: string[];
    controlAdapter: string;
    referenceStrength: number;
    seed: number;
    inpaintEnabled: boolean;
    upscaleModel: string;
  };
  presenter: {
    workflow: "guided" | "advanced" | "graph";
    baseModel: string;
    style: string;
    prompt: string;
    negativePrompt: string;
    loras: string[];
    seed: number;
    controlAdapter: string;
    referenceImageEnabled: boolean;
    faceDetailer: boolean;
    inpaintEnabled: boolean;
    upscaleModel: string;
    provenanceRequired: boolean;
  };
}

export interface PresenterSelection {
  schemaVersion: 1;
  mode: "off" | "auto" | "on";
  presenters: Array<{ presenterId: string; portraitAssetId: string; voiceId?: string }>;
  sceneAssignments: Array<{ sceneId: string; presenterId: string }>;
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
  /** Stable authored structure selected when the project was created. */
  templateId?: string;
  /** Primary generation language; individual scenes may deliberately mix modes. */
  tutorialMode?: TutorialMode;
  scenes: Scene[];
  sources: SourceRecord[];
  /** Closed product fixture selected from an explicit flagship tutorial brief. */
  canonicalFixtureId?: "fixture.karatsuba.undergraduate.en";
  /** Portable, export-safe visual/audio choices. Asset bytes are stored separately. */
  customization?: CanvasCustomization;
  /** Explicit cast and scene speakers; omitted only for legacy single-presenter projects. */
  presenterSelection?: PresenterSelection;
  /** Reproducible slide and presenter generation choices. */
  creative?: CreativeConfiguration;
  sceneCandidates?: unknown[];
  sceneEditCandidates?: unknown[];
  /** Media promoted before this durable authored edit must not be reviewed as current. */
  mediaInvalidatedAt?: string;
  renderedFrameReview?: unknown;
  payload?: unknown;
  /** Desktop project identity; safe to persist because it contains no credentials. */
  editorDocument?: import("./editor/types").EditorProject;
  reviewNotes?: string;
  nativeProjectId?: string;
  nativeProjectDirectory?: string;
  nativeHeadRevisionId?: string;
  nativeRevisionNumber?: number;
  /** Durable generation identity, distinct from individual stage job IDs. */
  nativeGenerationId?: string;
  nativeArchivePath?: string;
  /** Approved no-secret provider boundary; retained across ordinary snapshot saves. */
  providerRoutingPolicy?: unknown;
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
  operation?: "regenerate_scene" | "regenerate_authored_scene" | "search_visual_candidates" | "render_scene" | "repair_qa" | "export_master" | "visual_review" | "presenter_generate" | "editor_timeline_export";
  result?: Record<string, unknown> | null;
}

export interface AppSnapshot {
  projects: ProjectRecord[];
  recentProjectId: string | null;
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
