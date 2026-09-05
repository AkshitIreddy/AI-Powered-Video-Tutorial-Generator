import { describe, expect, it, vi } from "vitest";
import { resolveEditorWaveformNative, type EditorMediaAsset } from "..";

const asset: EditorMediaAsset = {
  id: "voice",
  name: "Voice",
  kind: "audio",
  status: "ready",
  durationFrames: 60,
  hash: "a".repeat(64),
  provenance: { origin: "user-import", createdAt: "2026-09-05T00:00:00Z" },
  metadata: { exportEligible: true },
};

describe("native editor waveform bridge", () => {
  it("validates a CAS waveform receipt and converts canonical ticks to frames", async () => {
    const invoke = vi.fn(async (request) => ({
      projectId: request.projectId,
      artifactHash: request.artifactHash,
      profile: request.profile,
      waveformHash: "b".repeat(64),
      waveformPath: "C:/project/objects/sha256/bb/waveform",
      mediaType: "image/png" as const,
      width: request.profile.width,
      height: request.profile.height,
      durationTicks: 480_000,
    }));
    await expect(resolveEditorWaveformNative(asset, { numerator: 30, denominator: 1 }, { projectId: "project", projectDirectory: "project-dir" }, invoke, (path) => `asset://${path}`, { width: 1024, height: 64 })).resolves.toEqual({
      artifactHash: "a".repeat(64), waveformHash: "b".repeat(64), url: "asset://C:/project/objects/sha256/bb/waveform", width: 1024, height: 64, durationFrames: 60,
    });
  });

  it("rejects a waveform receipt for another source", async () => {
    const invoke = vi.fn(async () => ({ projectId: "project", artifactHash: "c".repeat(64), profile: { width: 2048, height: 72 }, waveformHash: "b".repeat(64), waveformPath: "waveform", mediaType: "image/png" as const, width: 2048, height: 72, durationTicks: 240_000 }));
    await expect(resolveEditorWaveformNative(asset, { numerator: 30, denominator: 1 }, { projectId: "project", projectDirectory: "project-dir" }, invoke, String)).rejects.toThrow(/invalid receipt/i);
  });
});
