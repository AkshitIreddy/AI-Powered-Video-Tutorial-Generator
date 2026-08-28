import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import commonSchema from "../schema/common.schema.json" with { type: "json" };
import executionSchema from "../schema/execution.schema.json" with { type: "json" };
import mediaSchema from "../schema/media.schema.json" with { type: "json" };
import projectSchema from "../schema/project.schema.json" with { type: "json" };
import researchSchema from "../schema/research.schema.json" with { type: "json" };
import storyboardSchema from "../schema/storyboard.schema.json" with { type: "json" };
import type { Diagnostic, JsonValue } from "./common.js";
import type { Artifact, ExportSpec, JobRun, ModelDescriptor, PluginManifest, ProviderDescriptor, QualityGate, TaskAttempt, TaskRun } from "./execution.js";
import { SCHEMA_IDS } from "./generated/schemaRegistry.js";
import type { AssetProvenance, ConsentRecord, NarrationSpec } from "./media.js";
import type { ProjectBundle, ProjectManifest, ProjectRevision } from "./project.js";
import type { AtomicClaim, ResearchBundle, SourceVersion } from "./research.js";
import type { RenderManifest, Scene, StoryboardSnapshot } from "./storyboard.js";

export const schemas = Object.freeze({ commonSchema, researchSchema, mediaSchema, storyboardSchema, executionSchema, projectSchema });

export interface ValidationIssue {
  instancePath: string;
  schemaPath: string;
  keyword: string;
  message: string;
  params: JsonValue;
}

export type ValidationResult<T> =
  | { valid: true; value: T; issues: readonly [] }
  | { valid: false; issues: readonly ValidationIssue[] };

function createAjv(): Ajv2020 {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    // Conditional `required` clauses intentionally reference properties declared
    // by their closed parent object. Ajv's strictRequired check does not follow
    // that parent relationship, so keep every other strict check while allowing it.
    strictRequired: false,
    allowUnionTypes: true,
    validateFormats: true,
  });
  addFormats(ajv);
  ajv.addSchema(commonSchema);
  ajv.addSchema(researchSchema);
  ajv.addSchema(mediaSchema);
  ajv.addSchema(storyboardSchema);
  ajv.addSchema(executionSchema);
  ajv.addSchema(projectSchema);
  return ajv;
}

export const contractAjv = createAjv();

function definitionUri(schemaId: string, definition: string): string {
  return `${schemaId}#/$defs/${definition}`;
}

function requiredValidator<T>(uri: string): ValidateFunction<T> {
  const validator = contractAjv.getSchema<T>(uri);
  if (!validator) throw new Error(`Contract schema was not registered: ${uri}`);
  return validator;
}

const projectBundleValidator = requiredValidator<ProjectBundle>(SCHEMA_IDS.project);
const projectManifestValidator = requiredValidator<ProjectManifest>(definitionUri(SCHEMA_IDS.project, "ProjectManifest"));
const researchBundleValidator = requiredValidator<ResearchBundle>(definitionUri(SCHEMA_IDS.research, "ResearchBundle"));
const storyboardValidator = requiredValidator<StoryboardSnapshot>(definitionUri(SCHEMA_IDS.storyboard, "StoryboardSnapshot"));
const sceneValidator = requiredValidator<Scene>(definitionUri(SCHEMA_IDS.storyboard, "Scene"));
const pluginValidator = requiredValidator<PluginManifest>(definitionUri(SCHEMA_IDS.execution, "PluginManifest"));
const artifactValidator = requiredValidator<Artifact>(definitionUri(SCHEMA_IDS.execution, "Artifact"));
const providerValidator = requiredValidator<ProviderDescriptor>(definitionUri(SCHEMA_IDS.execution, "ProviderDescriptor"));
const modelValidator = requiredValidator<ModelDescriptor>(definitionUri(SCHEMA_IDS.execution, "ModelDescriptor"));
const jobValidator = requiredValidator<JobRun>(definitionUri(SCHEMA_IDS.execution, "JobRun"));
const taskValidator = requiredValidator<TaskRun>(definitionUri(SCHEMA_IDS.execution, "TaskRun"));
const attemptValidator = requiredValidator<TaskAttempt>(definitionUri(SCHEMA_IDS.execution, "TaskAttempt"));
const qualityGateValidator = requiredValidator<QualityGate>(definitionUri(SCHEMA_IDS.execution, "QualityGate"));
const exportValidator = requiredValidator<ExportSpec>(definitionUri(SCHEMA_IDS.execution, "ExportSpec"));
const provenanceValidator = requiredValidator<AssetProvenance>(definitionUri(SCHEMA_IDS.media, "AssetProvenance"));
const consentValidator = requiredValidator<ConsentRecord>(definitionUri(SCHEMA_IDS.media, "ConsentRecord"));
const narrationValidator = requiredValidator<NarrationSpec>(definitionUri(SCHEMA_IDS.media, "NarrationSpec"));
const revisionValidator = requiredValidator<ProjectRevision>(definitionUri(SCHEMA_IDS.project, "ProjectRevision"));
const sourceValidator = requiredValidator<SourceVersion>(definitionUri(SCHEMA_IDS.research, "SourceVersion"));
const claimValidator = requiredValidator<AtomicClaim>(definitionUri(SCHEMA_IDS.research, "AtomicClaim"));
const renderManifestValidator = requiredValidator<RenderManifest>(definitionUri(SCHEMA_IDS.storyboard, "RenderManifest"));

function toIssues(errors: ErrorObject[] | null | undefined): ValidationIssue[] {
  return (errors ?? []).map((error) => ({
    instancePath: error.instancePath,
    schemaPath: error.schemaPath,
    keyword: error.keyword,
    message: error.message ?? "Schema validation failed",
    params: error.params as JsonValue,
  }));
}

function validate<T>(validator: ValidateFunction<T>, value: unknown): ValidationResult<T> {
  if (validator(value)) return { valid: true, value, issues: [] };
  return { valid: false, issues: toIssues(validator.errors) };
}

export function validateProjectBundle(value: unknown): ValidationResult<ProjectBundle> { return validate(projectBundleValidator, value); }
export function validateProjectManifest(value: unknown): ValidationResult<ProjectManifest> { return validate(projectManifestValidator, value); }
export function validateResearchBundle(value: unknown): ValidationResult<ResearchBundle> { return validate(researchBundleValidator, value); }
export function validateStoryboard(value: unknown): ValidationResult<StoryboardSnapshot> { return validate(storyboardValidator, value); }
export function validateScene(value: unknown): ValidationResult<Scene> { return validate(sceneValidator, value); }
export function validatePluginManifest(value: unknown): ValidationResult<PluginManifest> { return validate(pluginValidator, value); }
export function validateArtifact(value: unknown): ValidationResult<Artifact> { return validate(artifactValidator, value); }
export function validateProviderDescriptor(value: unknown): ValidationResult<ProviderDescriptor> { return validate(providerValidator, value); }
export function validateModelDescriptor(value: unknown): ValidationResult<ModelDescriptor> { return validate(modelValidator, value); }
export function validateJobRun(value: unknown): ValidationResult<JobRun> { return validate(jobValidator, value); }
export function validateTaskRun(value: unknown): ValidationResult<TaskRun> { return validate(taskValidator, value); }
export function validateTaskAttempt(value: unknown): ValidationResult<TaskAttempt> { return validate(attemptValidator, value); }
export function validateQualityGate(value: unknown): ValidationResult<QualityGate> { return validate(qualityGateValidator, value); }
export function validateExportSpec(value: unknown): ValidationResult<ExportSpec> { return validate(exportValidator, value); }
export function validateAssetProvenance(value: unknown): ValidationResult<AssetProvenance> { return validate(provenanceValidator, value); }
export function validateConsentRecord(value: unknown): ValidationResult<ConsentRecord> { return validate(consentValidator, value); }
export function validateNarrationSpec(value: unknown): ValidationResult<NarrationSpec> { return validate(narrationValidator, value); }
export function validateProjectRevision(value: unknown): ValidationResult<ProjectRevision> { return validate(revisionValidator, value); }
export function validateSourceVersion(value: unknown): ValidationResult<SourceVersion> { return validate(sourceValidator, value); }
export function validateAtomicClaim(value: unknown): ValidationResult<AtomicClaim> { return validate(claimValidator, value); }
export function validateRenderManifest(value: unknown): ValidationResult<RenderManifest> { return validate(renderManifestValidator, value); }

/** Validate any public or plugin-defined contract registered with the shared Ajv instance. */
export function validateContract<T>(schemaUri: string, value: unknown): ValidationResult<T> {
  return validate(requiredValidator<T>(schemaUri), value);
}

export function isProjectBundle(value: unknown): value is ProjectBundle { return projectBundleValidator(value); }
export function isScene(value: unknown): value is Scene { return sceneValidator(value); }
export function isPluginManifest(value: unknown): value is PluginManifest { return pluginValidator(value); }

/**
 * Relational checks that JSON Schema cannot express. These diagnostics are stable
 * API values, suitable for a project doctor, import gate, or migration preview.
 */
export function inspectProjectBundle(bundle: ProjectBundle): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const idSets = {
    courses: new Set(bundle.courses.map((item) => item.id)), modules: new Set(bundle.modules.map((item) => item.id)),
    lessons: new Set(bundle.lessons.map((item) => item.id)), sections: new Set(bundle.sections.map((item) => item.id)),
    revisions: new Set(bundle.revisions.map((item) => item.id)), scenes: new Set(bundle.storyboards.flatMap((item) => item.scenes.map((scene) => scene.id))),
    sources: new Set(bundle.research.sources.map((item) => item.id)), evidence: new Set(bundle.research.evidence.map((item) => item.id)),
    claims: new Set(bundle.research.claims.map((item) => item.id)), supports: new Set(bundle.research.supports.map((item) => item.id)),
    artifacts: new Set(bundle.artifacts.map((item) => item.id)), provenance: new Set(bundle.provenance.map((item) => item.id)),
    consents: new Set(bundle.consents.map((item) => item.id)), providers: new Set(bundle.providers.map((item) => item.id)),
    models: new Set(bundle.models.map((item) => item.id)), usage: new Set(bundle.usage.map((item) => item.id)), generations: new Set(bundle.generationRuns.map((item) => item.id)),
    jobs: new Set(bundle.jobs.map((item) => item.id)), tasks: new Set(bundle.tasks.map((item) => item.id)), attempts: new Set(bundle.attempts.map((item) => item.id)),
  };

  const reportMissing = (exists: Set<string>, id: string, path: string, kind: string): void => {
    if (!exists.has(id)) diagnostics.push({ code: "contract.missing-reference", severity: "error", message: `Missing ${kind} reference: ${id}`, path });
  };
  const reportDuplicates = (label: string, ids: string[]): void => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) diagnostics.push({ code: "contract.duplicate-id", severity: "error", message: `Duplicate ${label} id: ${id}`, path: `/${label}` });
      seen.add(id);
    }
  };

  if (bundle.manifest.projectId !== bundle.project.id) diagnostics.push({ code: "contract.project-id-mismatch", severity: "fatal", message: "Manifest and project IDs differ", path: "/manifest/projectId" });
  reportMissing(idSets.revisions, bundle.project.headRevisionId, "/project/headRevisionId", "revision");
  bundle.project.courseIds.forEach((id, index) => reportMissing(idSets.courses, id, `/project/courseIds/${index}`, "course"));
  bundle.courses.forEach((course, index) => {
    if (course.projectId !== bundle.project.id) diagnostics.push({ code: "contract.wrong-parent", severity: "error", message: `Course ${course.id} belongs to another project`, path: `/courses/${index}/projectId` });
    course.moduleIds.forEach((id, itemIndex) => reportMissing(idSets.modules, id, `/courses/${index}/moduleIds/${itemIndex}`, "module"));
  });
  bundle.modules.forEach((module, index) => {
    reportMissing(idSets.courses, module.courseId, `/modules/${index}/courseId`, "course");
    module.lessonIds.forEach((id, itemIndex) => reportMissing(idSets.lessons, id, `/modules/${index}/lessonIds/${itemIndex}`, "lesson"));
  });
  bundle.lessons.forEach((lesson, index) => {
    reportMissing(idSets.modules, lesson.moduleId, `/lessons/${index}/moduleId`, "module");
    lesson.sectionIds.forEach((id, itemIndex) => reportMissing(idSets.sections, id, `/lessons/${index}/sectionIds/${itemIndex}`, "section"));
  });
  bundle.sections.forEach((section, index) => {
    reportMissing(idSets.lessons, section.lessonId, `/sections/${index}/lessonId`, "lesson");
    section.sceneIds.forEach((id, itemIndex) => reportMissing(idSets.scenes, id, `/sections/${index}/sceneIds/${itemIndex}`, "scene"));
  });
  bundle.research.evidence.forEach((evidence, index) => reportMissing(idSets.sources, evidence.sourceVersionId, `/research/evidence/${index}/sourceVersionId`, "source version"));
  bundle.research.supports.forEach((support, index) => {
    reportMissing(idSets.claims, support.claimId, `/research/supports/${index}/claimId`, "claim");
    reportMissing(idSets.evidence, support.evidenceChunkId, `/research/supports/${index}/evidenceChunkId`, "evidence chunk");
  });
  bundle.storyboards.forEach((storyboard, storyboardIndex) => storyboard.scenes.forEach((scene, sceneIndex) => {
    const base = `/storyboards/${storyboardIndex}/scenes/${sceneIndex}`;
    reportMissing(idSets.sections, scene.sectionId, `${base}/sectionId`, "section");
    reportMissing(idSets.revisions, scene.revisionId, `${base}/revisionId`, "revision");
    scene.claimIds.forEach((id, index) => reportMissing(idSets.claims, id, `${base}/claimIds/${index}`, "claim"));
    scene.citationSupportIds.forEach((id, index) => reportMissing(idSets.supports, id, `${base}/citationSupportIds/${index}`, "claim support"));
    scene.artifactIds.forEach((id, index) => reportMissing(idSets.artifacts, id, `${base}/artifactIds/${index}`, "artifact"));
    if (scene.timing.minimumTicks > scene.timing.maximumTicks) diagnostics.push({ code: "contract.invalid-timing-range", severity: "error", message: "Scene minimum duration exceeds maximum duration", path: `${base}/timing` });
    if (scene.timing.preferredTicks !== undefined && (scene.timing.preferredTicks < scene.timing.minimumTicks || scene.timing.preferredTicks > scene.timing.maximumTicks)) diagnostics.push({ code: "contract.invalid-preferred-timing", severity: "error", message: "Preferred duration is outside the allowed range", path: `${base}/timing/preferredTicks` });
    scene.captions.forEach((track, trackIndex) => track.cues.forEach((cue, cueIndex) => {
      if (cue.endTick <= cue.startTick) diagnostics.push({ code: "contract.invalid-caption-range", severity: "error", message: "Caption cue must end after it starts", path: `${base}/captions/${trackIndex}/cues/${cueIndex}` });
    }));
    if ((scene.visual.kind === "presenter" || scene.visual.kind === "presenter-with-slide") && scene.visual.presenter.mode === "real-person") {
      const consentId = scene.visual.presenter.consentRecordId;
      if (!consentId) diagnostics.push({ code: "contract.presenter-consent-required", severity: "fatal", message: "A real-person presenter requires a consent record", path: `${base}/visual/presenter/consentRecordId` });
      else reportMissing(idSets.consents, consentId, `${base}/visual/presenter/consentRecordId`, "consent");
    }
  }));
  if (bundle.project.settings.groundingMode === "strict") {
    bundle.research.claims.forEach((claim, index) => {
      if (claim.verifiability === "externally-verifiable" && claim.supportStatus !== "supported") diagnostics.push({ code: "contract.strict-claim-unsupported", severity: claim.importance === "critical" ? "fatal" : "error", message: `Strict-mode claim is not fully supported: ${claim.id}`, path: `/research/claims/${index}/supportStatus` });
    });
  }
  bundle.artifacts.forEach((artifact, index) => {
    if (artifact.provenanceId) reportMissing(idSets.provenance, artifact.provenanceId, `/artifacts/${index}/provenanceId`, "provenance");
  });
  bundle.provenance.forEach((provenance, index) => {
    reportMissing(idSets.artifacts, provenance.assetId, `/provenance/${index}/assetId`, "artifact");
    if (provenance.providerId) reportMissing(idSets.providers, provenance.providerId, `/provenance/${index}/providerId`, "provider");
    if (provenance.modelId) reportMissing(idSets.models, provenance.modelId, `/provenance/${index}/modelId`, "model");
    provenance.ingredientAssetIds?.forEach((id, itemIndex) => reportMissing(idSets.artifacts, id, `/provenance/${index}/ingredientAssetIds/${itemIndex}`, "artifact"));
    provenance.consentRecordIds?.forEach((id, itemIndex) => reportMissing(idSets.consents, id, `/provenance/${index}/consentRecordIds/${itemIndex}`, "consent"));
  });
  bundle.consents.forEach((consent, index) => reportMissing(idSets.artifacts, consent.proofArtifactId, `/consents/${index}/proofArtifactId`, "artifact"));
  bundle.models.forEach((model, index) => reportMissing(idSets.providers, model.providerId, `/models/${index}/providerId`, "provider"));
  bundle.pricing.forEach((pricing, index) => {
    reportMissing(idSets.providers, pricing.providerId, `/pricing/${index}/providerId`, "provider");
    reportMissing(idSets.models, pricing.modelId, `/pricing/${index}/modelId`, "model");
  });
  bundle.usage.forEach((usage, index) => {
    reportMissing(idSets.attempts, usage.taskAttemptId, `/usage/${index}/taskAttemptId`, "task attempt");
    reportMissing(idSets.providers, usage.providerId, `/usage/${index}/providerId`, "provider");
    reportMissing(idSets.models, usage.modelId, `/usage/${index}/modelId`, "model");
  });
  bundle.generationRuns.forEach((run, index) => {
    if (run.projectId !== bundle.project.id) diagnostics.push({ code: "contract.wrong-parent", severity: "error", message: `Generation run ${run.id} belongs to another project`, path: `/generationRuns/${index}/projectId` });
    reportMissing(idSets.revisions, run.revisionId, `/generationRuns/${index}/revisionId`, "revision");
    run.taskIds.forEach((id, itemIndex) => reportMissing(idSets.tasks, id, `/generationRuns/${index}/taskIds/${itemIndex}`, "task"));
  });
  bundle.jobs.forEach((job, index) => {
    if (job.projectId !== bundle.project.id) diagnostics.push({ code: "contract.wrong-parent", severity: "error", message: `Job ${job.id} belongs to another project`, path: `/jobs/${index}/projectId` });
    if (job.generationRunId) reportMissing(idSets.generations, job.generationRunId, `/jobs/${index}/generationRunId`, "generation run");
    job.taskIds.forEach((id, itemIndex) => reportMissing(idSets.tasks, id, `/jobs/${index}/taskIds/${itemIndex}`, "task"));
    if (job.etaMinimumSeconds !== undefined && job.etaMaximumSeconds !== undefined && job.etaMinimumSeconds > job.etaMaximumSeconds) diagnostics.push({ code: "contract.invalid-eta-range", severity: "error", message: "Job minimum ETA exceeds maximum ETA", path: `/jobs/${index}` });
  });
  bundle.tasks.forEach((task, index) => {
    reportMissing(idSets.jobs, task.jobId, `/tasks/${index}/jobId`, "job");
    task.dependencyTaskIds.forEach((id, itemIndex) => reportMissing(idSets.tasks, id, `/tasks/${index}/dependencyTaskIds/${itemIndex}`, "task"));
    task.attemptIds.forEach((id, itemIndex) => reportMissing(idSets.attempts, id, `/tasks/${index}/attemptIds/${itemIndex}`, "attempt"));
    task.inputArtifactIds.forEach((id, itemIndex) => reportMissing(idSets.artifacts, id, `/tasks/${index}/inputArtifactIds/${itemIndex}`, "artifact"));
    task.outputArtifactIds?.forEach((id, itemIndex) => reportMissing(idSets.artifacts, id, `/tasks/${index}/outputArtifactIds/${itemIndex}`, "artifact"));
  });
  bundle.attempts.forEach((attempt, index) => {
    reportMissing(idSets.tasks, attempt.taskId, `/attempts/${index}/taskId`, "task");
    attempt.usageIds.forEach((id, itemIndex) => reportMissing(idSets.usage, id, `/attempts/${index}/usageIds/${itemIndex}`, "usage record"));
  });
  bundle.events.forEach((event, index) => {
    reportMissing(idSets.jobs, event.jobId, `/events/${index}/jobId`, "job");
    if (event.taskId) reportMissing(idSets.tasks, event.taskId, `/events/${index}/taskId`, "task");
  });
  bundle.renderManifests.forEach((manifest, index) => {
    if (manifest.projectId !== bundle.project.id) diagnostics.push({ code: "contract.wrong-parent", severity: "error", message: `Render manifest ${manifest.id} belongs to another project`, path: `/renderManifests/${index}/projectId` });
    reportMissing(idSets.revisions, manifest.revisionId, `/renderManifests/${index}/revisionId`, "revision");
    manifest.compiledScenes.forEach((scene, sceneIndex) => {
      reportMissing(idSets.scenes, scene.sourceSceneId, `/renderManifests/${index}/compiledScenes/${sceneIndex}/sourceSceneId`, "scene");
      reportMissing(idSets.revisions, scene.sourceRevisionId, `/renderManifests/${index}/compiledScenes/${sceneIndex}/sourceRevisionId`, "revision");
      scene.artifactIds.forEach((id, itemIndex) => reportMissing(idSets.artifacts, id, `/renderManifests/${index}/compiledScenes/${sceneIndex}/artifactIds/${itemIndex}`, "artifact"));
    });
  });
  bundle.exports.forEach((spec, index) => {
    if (spec.projectId !== bundle.project.id) diagnostics.push({ code: "contract.wrong-parent", severity: "error", message: `Export ${spec.id} belongs to another project`, path: `/exports/${index}/projectId` });
    reportMissing(idSets.revisions, spec.revisionId, `/exports/${index}/revisionId`, "revision");
  });
  reportDuplicates("courses", bundle.courses.map((item) => item.id)); reportDuplicates("modules", bundle.modules.map((item) => item.id));
  reportDuplicates("lessons", bundle.lessons.map((item) => item.id)); reportDuplicates("sections", bundle.sections.map((item) => item.id));
  reportDuplicates("revisions", bundle.revisions.map((item) => item.id)); reportDuplicates("artifacts", bundle.artifacts.map((item) => item.id));
  reportDuplicates("generationRuns", bundle.generationRuns.map((item) => item.id)); reportDuplicates("jobs", bundle.jobs.map((item) => item.id));
  reportDuplicates("tasks", bundle.tasks.map((item) => item.id)); reportDuplicates("attempts", bundle.attempts.map((item) => item.id)); reportDuplicates("usage", bundle.usage.map((item) => item.id));
  return diagnostics;
}

export function assertValidProjectBundle(value: unknown, semantic = true): asserts value is ProjectBundle {
  const result = validateProjectBundle(value);
  if (!result.valid) throw new ContractValidationError("Project bundle does not satisfy the canonical schema", result.issues);
  if (semantic) {
    const diagnostics = inspectProjectBundle(result.value).filter((item) => item.severity === "error" || item.severity === "fatal");
    if (diagnostics.length > 0) throw new ContractValidationError("Project bundle has invalid references or invariants", diagnostics);
  }
}

export class ContractValidationError extends Error {
  public readonly issues: readonly ValidationIssue[] | readonly Diagnostic[];
  public constructor(message: string, issues: readonly ValidationIssue[] | readonly Diagnostic[]) {
    super(message); this.name = "ContractValidationError"; this.issues = issues;
  }
}
