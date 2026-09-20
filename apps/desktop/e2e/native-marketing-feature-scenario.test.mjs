import assert from "node:assert/strict";
import test from "node:test";

import { assertSoulxHydratedPackage, assertSoulxNativeReadiness, soulxModelContract } from "./native-marketing-feature-scenario.mjs";

function readyInput() {
  const fingerprint = "a".repeat(64);
  const revision = "soulx-9bc03de0+pro-59119b6c+wav2vec-22aad52d+py3106+cu128";
  return {
    catalog: [{
      modelId: soulxModelContract.modelId,
      displayName: soulxModelContract.catalogDisplayName,
      immutableRevision: revision,
      totalBytes: 10_464_991_863,
      artifactCount: 76,
      available: true,
    }],
    statuses: [{
      modelId: soulxModelContract.modelId,
      phase: "ready",
      downloadedBytes: 10_464_991_863,
      totalBytes: 10_464_991_863,
      verifiedArtifacts: 76,
      artifactCount: 76,
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
  assert.equal(receipt.totalBytes, 10_464_991_863);
  assert.equal(receipt.selectedForPortraitAnimation, true);
  assert.equal(receipt.selectedForLipSync, true);
  assert.equal(receipt.runtimeStatusCount, 1);
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

test("SoulX setup accepts a complete quarantined cache without claiming activation", () => {
  const input = readyInput();
  input.statuses[0].phase = "downloadedQuarantined";
  input.statuses[0].activationBlocked = true;
  input.statuses[0].runtimeRevision = null;
  input.statuses[0].installFingerprint = null;
  const hydrated = assertSoulxHydratedPackage(input);
  assert.equal(hydrated.status.phase, "downloadedQuarantined");
  assert.equal(hydrated.status.downloadedBytes, hydrated.packageEntry.totalBytes);
});

test("SoulX setup refuses missing cached bytes instead of allowing a network fetch", () => {
  const input = readyInput();
  input.statuses[0].downloadedBytes -= 1;
  assert.throws(() => assertSoulxHydratedPackage(input), /complete hydrated package/);
});
