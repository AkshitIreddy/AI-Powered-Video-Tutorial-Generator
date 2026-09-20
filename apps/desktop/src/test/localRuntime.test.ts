import { describe, expect, it } from "vitest";
import {
  COMFYUI_RUNTIME_PACKAGE_ID,
  COMFYUI_RUNTIME_VERSION,
  comfyuiVersionFromStatuses,
  packRequiresComfyui,
  shouldPromptForRuntime,
} from "../localRuntime";
import type { ModelDownloadStatus } from "../native";

function status(overrides: Partial<ModelDownloadStatus> = {}): ModelDownloadStatus {
  return {
    modelId: COMFYUI_RUNTIME_PACKAGE_ID,
    immutableRevision: "comfyui-8f40b43e0204d5b9780f3e9618e140e929e80594",
    phase: "ready",
    downloadedBytes: 1_803_412_624,
    totalBytes: 1_803_412_624,
    verifiedArtifacts: 1,
    artifactCount: 1,
    licenseId: "GPL-3.0",
    licenseUrl: "https://example.invalid/license",
    licenseSha256: "a".repeat(64),
    licenseAcceptedAt: "2026-09-20T00:00:00.000Z",
    detail: "Runtime ready.",
    activationBlocked: false,
    installFingerprint: "b".repeat(64),
    runtimeRevision: "comfyui-8f40b43e0204d5b9780f3e9618e140e929e80594",
    updatedAt: "2026-09-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("local runtime presence", () => {
  it("reports ComfyUI only from its verified dedicated runtime receipt", () => {
    expect(comfyuiVersionFromStatuses([status()])).toBe(COMFYUI_RUNTIME_VERSION);
    expect(comfyuiVersionFromStatuses([status({ phase: "inUse" })])).toBe(COMFYUI_RUNTIME_VERSION);
    expect(comfyuiVersionFromStatuses([])).toBeNull();
    expect(comfyuiVersionFromStatuses([status({ phase: "downloading" })])).toBeNull();
    expect(comfyuiVersionFromStatuses([status({ activationBlocked: true })])).toBeNull();
    expect(comfyuiVersionFromStatuses([status({ installFingerprint: "short" })])).toBeNull();
    expect(comfyuiVersionFromStatuses([status({ runtimeRevision: null })])).toBeNull();
    expect(comfyuiVersionFromStatuses([status({ modelId: "local/sdxl-base-1.0" })])).toBeNull();
  });

  it("prompts for every managed image pack while the runtime is missing", () => {
    expect(shouldPromptForRuntime("local/sdxl-base-1.0", false)).toBe(true);
    expect(shouldPromptForRuntime("local/flux.2-klein-4b-fp8", false)).toBe(true);
    expect(shouldPromptForRuntime("local/z-image-turbo-int8", false)).toBe(true);
    expect(shouldPromptForRuntime("local/flux.2-klein-4b-fp8", true)).toBe(false);
    expect(shouldPromptForRuntime(COMFYUI_RUNTIME_PACKAGE_ID, false)).toBe(false);
    expect(shouldPromptForRuntime("local/musetalk-1.5", false)).toBe(false);
  });

  it("knows which packs depend on ComfyUI", () => {
    expect(packRequiresComfyui("local/sdxl-base-1.0")).toBe(true);
    expect(packRequiresComfyui("LOCAL\\FLUX.2-KLEIN-4B-FP8 ")).toBe(true);
    expect(packRequiresComfyui("local/musetalk-1.5")).toBe(false);
  });
});
