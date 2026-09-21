import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertSoulxManagedStart,
  assertMusicSearchJobReceipt,
  assertSoulxNativeReadiness,
  migrateLegacyMarketingRoutingPolicy,
  preserveCaptionFreeTutorialExport,
  preflightSoulxHydratedCache,
  returnFromNativeEditorIfOpen,
  soulxInstallContract,
  soulxModelContract,
  waitForPresenterAnimationReview,
} from "./native-marketing-feature-scenario.mjs";
import { buildMarketingPresenterRoutingPolicy } from "./native-marketing-demo-edit.mjs";

function readyInput() {
  const fingerprint = "a".repeat(64);
  const revision = soulxInstallContract.immutableRevision;
  return {
    catalog: [{
      modelId: soulxModelContract.modelId,
      displayName: soulxModelContract.catalogDisplayName,
      immutableRevision: revision,
      totalBytes: soulxInstallContract.totalBytes,
      artifactCount: soulxInstallContract.artifactCount,
      available: true,
    }],
    statuses: [{
      modelId: soulxModelContract.modelId,
      immutableRevision: revision,
      phase: "ready",
      downloadedBytes: soulxInstallContract.totalBytes,
      totalBytes: soulxInstallContract.totalBytes,
      verifiedArtifacts: soulxInstallContract.artifactCount,
      artifactCount: soulxInstallContract.artifactCount,
      activationBlocked: false,
      runtimeRevision: revision,
      installFingerprint: fingerprint,
    }],
    setup: {
      selectedModelIds: [soulxModelContract.modelId],
      lipSyncModelId: soulxModelContract.modelId,
      portraitAnimationModelId: soulxModelContract.modelId,
    },
    runtimeStatuses: [{
      portraitArtifactHash: null,
      modelId: soulxModelContract.engineId,
      modelRevision: revision,
      installFingerprint: fingerprint,
      configured: true,
      reason: "Verified primary SoulX runtime.",
    }],
  };
}

test("music evidence separates one user search from every durable Openverse HTTP query", () => {
  const receipt = assertMusicSearchJobReceipt({
    job_id: "job-music-1",
    state: "SUCCEEDED",
    parameters_json: JSON.stringify({ topic: "Rayleigh scattering", mood: "curious", alternatives: 3 }),
    result_json: JSON.stringify({
      operation: "search_music_candidates",
      providerId: "openverse",
      topic: "Rayleigh scattering",
      mood: "curious",
      queriesAttempted: ["Rayleigh scattering", "curious", "instrumental"],
      candidateIds: ["music-a", "music-b"],
    }),
  }, { topic: "Rayleigh scattering", mood: "curious", acceptedCandidateId: "music-b" });
  assert.equal(receipt.searchOperationCount, 1);
  assert.equal(receipt.httpQueryCount, 3);
  assert.deepEqual(receipt.queriesAttempted, ["Rayleigh scattering", "curious", "instrumental"]);
});

test("workspace navigation exits the real full-screen editor before clicking Plan", async () => {
  const calls = [];
  const editor = {
    async isVisible() { calls.push("editor-visible"); return true; },
    getByRole(role, options) {
      assert.equal(role, "button");
      assert.match(String(options.name), /Return to scene/u);
      return { async click() { calls.push("return-click"); } };
    },
    async waitFor(options) { calls.push(`editor-${options.state}-${options.timeout}`); },
  };
  const page = {
    getByRole(role, options) {
      assert.equal(role, "dialog");
      assert.equal(options.name, "Integrated advanced video editor");
      return editor;
    },
  };
  const result = await returnFromNativeEditorIfOpen(page, 45_000);
  assert.deepEqual(result, { editorWasOpen: true, returnedThroughUi: true });
  assert.deepEqual(calls, ["editor-visible", "return-click", "editor-hidden-45000"]);
});

test("presenter preview fails immediately on the actionable native warning toast", async () => {
  let waits = 0;
  const failure = {
    async isVisible() { return true; },
    async innerText() { return "Animation preview unavailable\nInvalid worker method: is not allow-listed"; },
  };
  const page = {
    locator(selector) {
      assert.equal(selector, ".toast.warning");
      return {
        filter(options) {
          assert.equal(options.hasText, "Animation preview unavailable");
          return { last() { return failure; } };
        },
      };
    },
    async waitForTimeout() { waits += 1; },
  };
  await assert.rejects(() => waitForPresenterAnimationReview({
    page,
    review: { async isVisible() { return false; } },
    timeoutMs: 20_000,
  }), /Animation preview unavailable Invalid worker method: is not allow-listed/u);
  assert.equal(waits, 0);
});

test("presenter preview keeps waiting while a real native job is still running", async () => {
  let reviewChecks = 0;
  let waits = 0;
  const page = {
    locator() {
      return { filter() { return { last() { return { async isVisible() { return false; } }; } }; } };
    },
    async waitForTimeout() { waits += 1; },
  };
  await waitForPresenterAnimationReview({
    page,
    review: { async isVisible() { reviewChecks += 1; return reviewChecks === 3; } },
    timeoutMs: 20_000,
    pollMs: 1,
  });
  assert.equal(waits, 2);
});

test("legacy resume policy migrates through one native validated policy revision without changing the timeline", async () => {
  const identity = { projectId: "project-1", projectDirectory: "E:\\isolated\\project-1" };
  const timelineContract = {
    timing: { durationFrames: 30, scenes: [{ startFrame: 0, endFrame: 30 }] },
    presenters: [{ name: "emma.mp4", startFrame: 0, endFrame: 30 }],
    presenterTransform: { x: 550, y: 110, scaleX: 0.68, scaleY: 0.68 },
    captions: ["Exact teaching caption"],
  };
  const clip = (kind, extra = {}) => ({ kind, timelineRange: { startFrame: 0, durationFrames: 30 }, ...extra });
  const editorDocument = { tracks: [
    { kind: "slides", clips: [clip("slides")] },
    { kind: "presenter", clips: [clip("presenter", { name: "emma.mp4", transform: timelineContract.presenterTransform, audio: { muted: true } })] },
    { kind: "captions", hidden: false, clips: [clip("captions", { text: "Exact teaching caption" })] },
    { kind: "narration", clips: [clip("narration")] },
    { kind: "music", clips: [] },
  ] };
  const validPolicy = buildMarketingPresenterRoutingPolicy(soulxModelContract.modelId);
  const legacyPolicy = { ...validPolicy, approvals: [] };
  const before = { projectId: identity.projectId, headRevisionId: "rev-7", revisionNumber: 7, snapshot: { editorDocument, providerRoutingPolicy: legacyPolicy } };
  let after = before;
  const calls = [];
  const invokeNative = async (_page, command, input) => {
    calls.push(command);
    if (command === "project_snapshot_get") return after;
    assert.equal(command, "provider_routing_policy_save");
    assert.equal(input.expectedHeadRevisionId, "rev-7");
    assert.deepEqual(input.policy, validPolicy);
    after = { ...before, headRevisionId: "rev-8", revisionNumber: 8, snapshot: { ...before.snapshot, providerRoutingPolicy: input.policy } };
    return { policy: input.policy, headRevisionId: "rev-8", revisionNumber: 8 };
  };
  const receipt = await migrateLegacyMarketingRoutingPolicy({ page: {}, invokeNative, identity, timelineContract });
  assert.deepEqual(calls, ["project_snapshot_get", "provider_routing_policy_save", "project_snapshot_get"]);
  assert.equal(receipt.operation, "provider_routing_policy_save");
  assert.equal(receipt.nativePolicyParserAccepted, true);
  assert.equal(receipt.timelineUnchanged, true);
  assert.equal(receipt.revisionNumber, 8);
});

test("SoulX readiness mirrors the native download, setup, and presenter-status DTOs", () => {
  const receipt = assertSoulxNativeReadiness(readyInput());
  assert.equal(receipt.displayName, "SoulX-FlashHead Pro 1.3B");
  assert.equal(receipt.totalBytes, soulxInstallContract.totalBytes);
  assert.equal(receipt.selectedForPortraitAnimation, true);
  assert.equal(receipt.selectedForLipSync, true);
  assert.equal(receipt.runtimeStatusCount, 1);
});

test("preserves the first caption-free native export before the feature render can overwrite it", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "alystria-clean-native-export-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, "project", "exports", "timeline.webm");
  await mkdir(path.dirname(sourcePath), { recursive: true });
  const original = Buffer.from("first-real-caption-free-native-render");
  await writeFile(sourcePath, original);
  const receipt = await preserveCaptionFreeTutorialExport({
    tutorial: {
      actualNativeEditorRender: true,
      captionsBurnedIn: false,
      captionsPreservedInProject: true,
      outputPath: sourcePath,
      outputSha256: sha256(original),
      probe: { durationSeconds: 22.18, video: { codec_name: "vp9" }, audio: { codec_name: "opus" } },
    },
    runRoot: path.join(root, "evidence"),
  });
  await writeFile(sourcePath, "later music and caption render");
  assert.equal(receipt.captionsBurnedIn, false);
  assert.equal(receipt.captionsPreservedInProject, true);
  assert.equal(receipt.outputSha256, sha256(original));
  assert.deepEqual(await readFile(receipt.outputPath), original);
});

test("refuses to relabel a captioned native export as clean", async () => {
  await assert.rejects(() => preserveCaptionFreeTutorialExport({
    tutorial: { actualNativeEditorRender: true, captionsBurnedIn: true },
    runRoot: "unused",
  }), /not a verified caption-free render/);
});

test("SoulX readiness rejects an installed package whose primary runtime identity differs", () => {
  const input = readyInput();
  input.runtimeStatuses[0].installFingerprint = "b".repeat(64);
  assert.throws(() => assertSoulxNativeReadiness(input), /matching configured primary route/);
});

test("SoulX readiness never treats a completed download as selected setup", () => {
  const input = readyInput();
  input.setup.lipSyncModelId = "local/musetalk-1.5";
  assert.throws(() => assertSoulxNativeReadiness(input), /not selected for both presenter motion and lip-sync/);
});

test("SoulX setup permits initial manifest-only status after exact offline cache verification", async (context) => {
  const fixture = await createHydratedCacheFixture(context);
  const cachePreflight = await preflightSoulxHydratedCache(fixture.preflightInput);
  const start = assertSoulxManagedStart({
    catalog: [fixture.catalog],
    statuses: [{
      modelId: soulxModelContract.modelId,
      immutableRevision: fixture.catalog.immutableRevision,
      phase: "manifestRequired",
      downloadedBytes: 0,
      totalBytes: fixture.totalBytes,
      verifiedArtifacts: 0,
      artifactCount: fixture.artifactCount,
      activationBlocked: true,
    }],
    cachePreflight,
  });
  assert.equal(start.requiresNativeDownloadStart, true);
  assert.equal(cachePreflight.verifiedOfflineCache, true);
  assert.equal(cachePreflight.artifactCount, 2);
});

test("SoulX cache preflight rejects one missing file before native Download can be clicked", async (context) => {
  const fixture = await createHydratedCacheFixture(context);
  await rm(fixture.artifactPaths[1]);
  await assert.rejects(() => preflightSoulxHydratedCache(fixture.preflightInput), /missing or has the wrong byte count/);
});

test("SoulX setup accepts a complete native status without restarting Download", () => {
  const input = readyInput();
  input.statuses[0].phase = "downloadedQuarantined";
  input.statuses[0].activationBlocked = true;
  input.statuses[0].runtimeRevision = null;
  input.statuses[0].installFingerprint = null;
  const start = assertSoulxManagedStart({
    catalog: input.catalog,
    statuses: input.statuses,
    cachePreflight: reviewedCacheReceipt(),
  });
  assert.equal(start.status.phase, "downloadedQuarantined");
  assert.equal(start.requiresNativeDownloadStart, false);
  assert.equal(start.startMode, "already-complete");
});

test("SoulX setup retries an exact fully cached failed install through native UI", () => {
  const input = readyInput();
  Object.assign(input.statuses[0], {
    phase: "failed",
    activationBlocked: true,
    runtimeRevision: null,
    installFingerprint: null,
    licenseAcceptedAt: "2026-09-21T12:34:56.000Z",
    detail: "Portable SoulX installation failed after all cached artifacts were verified.",
  });
  const start = assertSoulxManagedStart({
    catalog: input.catalog,
    statuses: input.statuses,
    cachePreflight: reviewedCacheReceipt(),
  });
  assert.equal(start.requiresNativeDownloadStart, true);
  assert.equal(start.startMode, "retry-failed-install");
});

test("SoulX setup refuses a failed status without the persisted accepted-license receipt", () => {
  const input = readyInput();
  Object.assign(input.statuses[0], {
    phase: "failed",
    activationBlocked: true,
    runtimeRevision: null,
    installFingerprint: null,
    licenseAcceptedAt: null,
    detail: "Portable installation failed.",
  });
  assert.throws(() => assertSoulxManagedStart({
    catalog: input.catalog,
    statuses: input.statuses,
    cachePreflight: reviewedCacheReceipt(),
  }), /incomplete or unverified cache state/);
});

test("SoulX setup refuses partial native status even when the offline cache is verified", () => {
  const input = readyInput();
  input.statuses[0].phase = "downloading";
  input.statuses[0].downloadedBytes -= 1;
  assert.throws(() => assertSoulxManagedStart({
    catalog: input.catalog,
    statuses: input.statuses,
    cachePreflight: reviewedCacheReceipt(),
  }), /incomplete or unverified cache state/);
});

function reviewedCacheReceipt() {
  return {
    evidenceClass: "source-manifest-and-file-verified-soulx-cache",
    verifiedOfflineCache: true,
    modelId: soulxModelContract.modelId,
    immutableRevision: soulxInstallContract.immutableRevision,
    artifactCount: soulxInstallContract.artifactCount,
    totalBytes: soulxInstallContract.totalBytes,
  };
}

async function createHydratedCacheFixture(context) {
  const root = await mkdtemp(path.join(tmpdir(), "alystria-soulx-cache-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const artifacts = [
    { relativePath: "archives/runtime.zip", bytes: 3, sha256: sha256(Buffer.from("zip")) },
    { relativePath: "models/weights.bin", bytes: 4, sha256: sha256(Buffer.from("data")) },
  ];
  const manifest = {
    schemaVersion: 1,
    modelId: soulxModelContract.modelId,
    displayName: soulxModelContract.catalogDisplayName,
    immutableRevision: "fixture-revision",
    artifacts,
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  const manifestSha256 = sha256(manifestBytes);
  const manifestPath = path.join(root, "manifest.json");
  await writeFile(manifestPath, manifestBytes);
  const modelsRoot = path.join(root, "Models");
  const cacheRoot = path.join(modelsRoot, "download-quarantine", "local--soulx-flashhead-pro", manifest.immutableRevision);
  const artifactPaths = artifacts.map((artifact) => path.join(cacheRoot, "files", ...artifact.relativePath.split("/")));
  await Promise.all(artifactPaths.map((artifactPath) => mkdir(path.dirname(artifactPath), { recursive: true })));
  await Promise.all([
    writeFile(artifactPaths[0], "zip"),
    writeFile(artifactPaths[1], "data"),
  ]);
  const totalBytes = artifacts.reduce((sum, artifact) => sum + artifact.bytes, 0);
  await writeFile(path.join(cacheRoot, "root-cache-preparation.json"), JSON.stringify({
    manifestSha256,
    state: "cache-prepared-not-installed",
    artifactCount: artifacts.length,
    bytes: totalBytes,
    files: artifacts.map((artifact) => ({ file: artifact.relativePath, source: "verified-cache" })),
  }));
  return {
    artifactCount: artifacts.length,
    totalBytes,
    artifactPaths,
    catalog: {
      modelId: soulxModelContract.modelId,
      displayName: soulxModelContract.catalogDisplayName,
      immutableRevision: manifest.immutableRevision,
      totalBytes,
      artifactCount: artifacts.length,
      available: true,
    },
    preflightInput: {
      modelsRoot,
      manifestPath,
      expectedManifestSha256: manifestSha256,
      expectedIdentity: {
        immutableRevision: manifest.immutableRevision,
        artifactCount: artifacts.length,
        totalBytes,
      },
    },
  };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
