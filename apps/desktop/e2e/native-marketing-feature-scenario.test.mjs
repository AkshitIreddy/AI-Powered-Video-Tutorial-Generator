import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertSoulxManagedStart,
  assertSoulxNativeReadiness,
  preserveCaptionFreeTutorialExport,
  preflightSoulxHydratedCache,
  soulxInstallContract,
  soulxModelContract,
} from "./native-marketing-feature-scenario.mjs";

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
