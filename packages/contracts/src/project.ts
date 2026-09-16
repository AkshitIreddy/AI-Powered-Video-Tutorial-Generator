import type { EntityId, IsoDateTime, Sha256 } from "./common.js";
import type { Artifact, ExportSpec, GenerationRun, JobEvent, JobRun, ModelDescriptor, PluginManifest, PricingRule, ProviderDescriptor, QualityGate, TaskAttempt, TaskRun, UsageRecord } from "./execution.js";
import type { AssetProvenance, ConsentRecord } from "./media.js";
import type { ResearchBundle } from "./research.js";
import type { RenderManifest, StoryboardSnapshot } from "./storyboard.js";

export interface Section { id: EntityId; lessonId: EntityId; title: string; position: number; objectiveIds: EntityId[]; sceneIds: EntityId[]; notes?: string }
export interface Lesson { id: EntityId; moduleId: EntityId; title: string; position: number; locale: string; sectionIds: EntityId[]; objectiveIds: EntityId[]; estimatedDurationSeconds?: number }
export interface CourseModule { id: EntityId; courseId: EntityId; title: string; position: number; lessonIds: EntityId[]; description?: string }
export interface Course { id: EntityId; projectId: EntityId; title: string; description: string; locale: string; moduleIds: EntityId[]; learnerProfileId: EntityId; tags?: string[] }
export type ProjectModelMedium = "writing" | "research" | "images" | "motion" | "voice" | "transcription" | "presenter" | "portraitAnimation" | "lipSync";
export type ProjectModelCapability = "llm.structured" | "research.web" | "image.generate" | "motion.generate" | "audio.tts" | "audio.transcribe" | "presenter.generate" | "portrait.animate" | "lipsync.generate";
export interface ProjectModelRouteSnapshot {
  medium: ProjectModelMedium; capability: ProjectModelCapability; providerId: EntityId; modelId: string; modelRevision?: string; installFingerprint?: Sha256;
  voiceId?: string; presenterProfileId?: EntityId; boundary: "local" | "cloud";
  retention: "local_only" | "zero_data_retention" | "configurable" | "provider_default" | "unknown"; regions: string[];
  fallbackConsent: boolean;
}
export interface ProjectModelProfileSnapshot {
  schemaVersion: 1; profileId: EntityId; profileName: string; capturedAt: IsoDateTime; sourceSetupUpdatedAt?: IsoDateTime; routes: ProjectModelRouteSnapshot[];
}
export interface ProjectSettings {
  groundingMode: "creative" | "grounded" | "strict"; quality: "draft" | "standard" | "high" | "maximum";
  executionMode: "cloud" | "local" | "hybrid"; captionsEnabled: boolean; musicEnabled: boolean; presenterMode: "none" | "auto" | "always";
  repairLimit: number; privacyClassification: "public" | "internal" | "private" | "restricted"; crossProviderCritique?: boolean; modelProfileSnapshot?: ProjectModelProfileSnapshot;
}
export interface Project {
  id: EntityId; schemaVersion: "2.0.0"; name: string; description?: string; status: "draft" | "active" | "archived" | "read-only" | "migration-required" | "corrupt";
  createdAt: IsoDateTime; updatedAt: IsoDateTime; headRevisionId: EntityId; courseIds: EntityId[]; settings: ProjectSettings; defaultThemeId?: EntityId; projectRootHint?: string;
}
export interface RevisionChange {
  operation: "create" | "update" | "delete" | "restore" | "approve" | "lock" | "unlock"; entity: import("./common.js").EntityRef;
  beforeHash: Sha256 | null; afterHash: Sha256 | null; invalidatedTaskKinds: string[];
}
export interface ProjectRevision {
  id: EntityId; projectId: EntityId; parentRevisionIds: EntityId[]; number: number; kind: "manual" | "generation" | "regeneration" | "restore" | "migration" | "approval" | "import";
  message: string; author: "user" | "system" | "provider" | "migration"; createdAt: IsoDateTime; rootHash: Sha256; changes: RevisionChange[];
  approvalStatus: "draft" | "proposed" | "approved" | "rejected" | "superseded"; snapshotName?: string;
}
export interface ProjectManifest {
  format: "alystria-project"; schemaVersion: "2.0.0"; projectId: EntityId; databasePath: string; objectsPath: string; sourcesPath: string;
  stagingPath: string; exportsPath: string; createdAt: IsoDateTime; minimumAppVersion: string; readOnlyReason?: string;
}
export interface ProjectBundle {
  manifest: ProjectManifest; project: Project; courses: Course[]; modules: CourseModule[]; lessons: Lesson[]; sections: Section[]; revisions: ProjectRevision[];
  research: ResearchBundle; storyboards: StoryboardSnapshot[]; renderManifests: RenderManifest[]; artifacts: Artifact[]; provenance: AssetProvenance[]; consents: ConsentRecord[];
  providers: ProviderDescriptor[]; models: ModelDescriptor[]; pricing: PricingRule[]; usage: UsageRecord[]; generationRuns: GenerationRun[]; jobs: JobRun[];
  tasks: TaskRun[]; attempts: TaskAttempt[]; events: JobEvent[]; qualityGates: QualityGate[]; exports: ExportSpec[]; plugins: PluginManifest[];
}
