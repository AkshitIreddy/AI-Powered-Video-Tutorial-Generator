import { describe, expect, it } from "vitest";
import { BUILT_IN_SCENE_KINDS, ContractValidationError, assertValidProjectBundle, inspectProjectBundle, validateExportSpec, validatePluginManifest, validateProjectBundle, validateResearchBundle, validateScene } from "../src/index.js";
import { HASH_A, HASH_B, sceneFor, validProjectBundle } from "./fixtures.js";

describe("canonical schema registry", () => {
  it("accepts a complete, cross-domain project bundle", () => {
    const fixture = validProjectBundle();
    expect(validateProjectBundle(fixture)).toEqual({ valid: true, value: fixture, issues: [] });
    expect(inspectProjectBundle(fixture)).toEqual([]);
    expect(() => assertValidProjectBundle(fixture)).not.toThrow();
  });

  it("rejects unknown properties at closed object boundaries", () => {
    const fixture = { ...validProjectBundle(), cloudAccountId: "forbidden" };
    const result = validateProjectBundle(fixture);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.issues.some((issue) => issue.keyword === "additionalProperties")).toBe(true);
  });

  it("rejects malformed source locators and hashes", () => {
    const research = structuredClone(validProjectBundle().research) as Record<string, unknown>;
    const sources = research.sources as Record<string, unknown>[];
    sources[0] = { ...sources[0], contentHash: "not-a-sha", locator: { kind: "file" } };
    const result = validateResearchBundle(research);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.issues.map((issue) => issue.instancePath)).toEqual(expect.arrayContaining(["/sources/0/contentHash", "/sources/0/locator"]));
  });

  it("persists exact local portrait/lip-sync profile identities", () => {
    const fixture = validProjectBundle();
    const snapshot = fixture.project.settings.modelProfileSnapshot!;
    expect(snapshot.routes[0]).toEqual(expect.objectContaining({
      capability: "lipsync.generate",
      modelRevision: "musetalk-hf-3ef28bc5+code-0a89dec4",
      installFingerprint: HASH_B,
      boundary: "local",
      fallbackConsent: false,
    }));
    expect(validateProjectBundle(fixture).valid).toBe(true);

    const invalid = structuredClone(fixture);
    delete invalid.project.settings.modelProfileSnapshot!.routes[0]!.installFingerprint;
    expect(validateProjectBundle(invalid).valid).toBe(false);
  });

  it.each(["cancelling", "cancelled", "corrupt", "repairing", "removing", "removed"] as const)("accepts explicit model lifecycle state %s", (status) => {
    const fixture = validProjectBundle();
    fixture.models[0] = { ...fixture.models[0]!, capability: "lip-sync", status };
    fixture.providers[0]!.capabilities[0] = { ...fixture.providers[0]!.capabilities[0]!, kind: "lip-sync" };
    expect(validateProjectBundle(fixture).valid).toBe(true);
  });
});

describe("scene discriminants", () => {
  it.each(BUILT_IN_SCENE_KINDS)("validates built-in scene kind %s", (kind) => {
    expect(validateScene(sceneFor(kind)).valid).toBe(true);
  });

  it("rejects executable or unknown visual payloads", () => {
    const scene = { ...sceneFor(), visual: { kind: "react-component", source: "process.exit()" } };
    expect(validateScene(scene).valid).toBe(false);
  });
});

describe("caption delivery export contract", () => {
  const exportSpec = {
    id: "export.master", projectId: "project.karatsuba", revisionId: "revision.one", target: "landscape",
    dimensions: { width: 1920, height: 1080 }, frameRate: { numerator: 30, denominator: 1 },
    videoCodec: "vp9", audioCodec: "opus", quality: "standard", captionDeliveryMode: "sidecar",
    sidecars: ["vtt", "srt", "transcript", "provenance"], colorSpace: "rec709-sdr",
  };

  it.each(["sidecar", "embedded", "burned", "both"] as const)("accepts %s delivery", (captionDeliveryMode) => {
    expect(validateExportSpec({ ...exportSpec, captionDeliveryMode }).valid).toBe(true);
  });

  it("rejects legacy and ambiguous caption values in persisted 2.0 records", () => {
    const legacy = structuredClone(exportSpec) as Record<string, unknown>;
    delete legacy.captionDeliveryMode;
    legacy.captions = "burned-in";
    expect(validateExportSpec(legacy).valid).toBe(false);
  });

  it("requires both YouTube-ready caption sidecars for every delivery mode", () => {
    expect(validateExportSpec({ ...exportSpec, sidecars: ["vtt", "transcript"] }).valid).toBe(false);
    expect(validateExportSpec({ ...exportSpec, sidecars: ["srt", "transcript"] }).valid).toBe(false);
  });
});

describe("semantic project inspection", () => {
  it("detects broken hierarchy and artifact references", () => {
    const bundle = validProjectBundle();
    bundle.courses[0]!.moduleIds = ["module.missing"];
    bundle.storyboards[0]!.scenes[0]!.artifactIds = ["artifact.missing"];
    const diagnostics = inspectProjectBundle(bundle);
    expect(diagnostics.filter((item) => item.code === "contract.missing-reference")).toHaveLength(2);
    expect(() => assertValidProjectBundle(bundle)).toThrow(ContractValidationError);
  });

  it("blocks unsupported externally-verifiable claims in strict mode", () => {
    const bundle = validProjectBundle();
    bundle.research.claims[0]!.supportStatus = "partially-supported";
    expect(inspectProjectBundle(bundle)).toContainEqual(expect.objectContaining({ code: "contract.strict-claim-unsupported", severity: "fatal" }));
  });

  it("requires immutable consent for real-person presenters", () => {
    const bundle = validProjectBundle();
    bundle.storyboards[0]!.scenes[0]!.visual = {
      kind: "presenter", presenter: { mode: "real-person", usage: "hook", direction: "Direct to camera", disclosure: "visible-and-credits" }, layout: "full",
    };
    expect(inspectProjectBundle(bundle)).toContainEqual(expect.objectContaining({ code: "contract.presenter-consent-required", severity: "fatal" }));
  });

  it("detects invalid timing and caption ranges", () => {
    const bundle = validProjectBundle();
    const scene = bundle.storyboards[0]!.scenes[0]!;
    scene.timing = { mode: "fixed", minimumTicks: 100, maximumTicks: 20, preferredTicks: 200, overflow: "block" };
    scene.captions[0]!.cues[0]!.endTick = 0;
    expect(inspectProjectBundle(bundle).map((item) => item.code)).toEqual(expect.arrayContaining(["contract.invalid-timing-range", "contract.invalid-preferred-timing", "contract.invalid-caption-range"]));
  });

  it("validates durable job, task, attempt, and event relationships", () => {
    const bundle = validProjectBundle();
    bundle.jobs.push({ id: "job.render", projectId: bundle.project.id, kind: "render", state: "RUNNING", taskIds: ["task.render"], createdAt: "2026-08-28T00:00:00.000Z", progress: 0.4, etaMinimumSeconds: 12, etaMaximumSeconds: 30, cancellationRequested: false, diagnostics: [] });
    bundle.tasks.push({ id: "task.render", jobId: "job.render", kind: "render-scene", taskKey: HASH_A, implementationVersion: "2", state: "RUNNING", parameters: { sceneId: "scene.title" }, inputArtifactIds: ["artifact.image"], dependencyTaskIds: [], attemptIds: ["attempt.render.1"], createdAt: "2026-08-28T00:00:00.000Z", startedAt: "2026-08-28T00:00:01.000Z", progress: 0.4, maxAttempts: 3 });
    bundle.attempts.push({ id: "attempt.render.1", taskId: "task.render", number: 1, state: "RUNNING", stagingPath: "staging/attempt.render.1", leaseOwner: "pipeline.fixture", leaseExpiresAt: "2026-08-28T00:05:00.000Z", idempotencyKey: HASH_A, createdAt: "2026-08-28T00:00:00.000Z", startedAt: "2026-08-28T00:00:01.000Z", usageIds: [], diagnostics: [] });
    bundle.events.push({ id: "event.render.1", jobId: "job.render", taskId: "task.render", sequence: 1, kind: "progress", occurredAt: "2026-08-28T00:00:10.000Z", payload: { progress: 0.4 } });
    expect(validateProjectBundle(bundle).valid).toBe(true);
    expect(inspectProjectBundle(bundle)).toEqual([]);

    bundle.tasks[0]!.jobId = "job.missing";
    expect(inspectProjectBundle(bundle)).toContainEqual(expect.objectContaining({ code: "contract.missing-reference", path: "/tasks/0/jobId" }));
  });
});

describe("plugin manifests", () => {
  const validPlugin = {
    manifestVersion: 1, id: "studio.alystria.fixture", name: "Fixture", version: "1.0.0", description: "Fixture plugin", publisher: "Alystria",
    entrypoint: "dist/plugin.wasm", runtime: "wasm-wasi", permissions: [{ capability: "read-artifact", scope: ["image/*"], required: true, reason: "Render images" }],
    contributes: { sceneKinds: ["fixture.custom"] }, integrity: HASH_A, licenseExpression: "MIT",
  };

  it("accepts a capability-scoped plugin", () => expect(validatePluginManifest(validPlugin).valid).toBe(true));

  it("rejects traversal and undeclared manifest fields", () => {
    expect(validatePluginManifest({ ...validPlugin, entrypoint: "../escape.exe", postInstall: "curl bad.example" }).valid).toBe(false);
  });
});
