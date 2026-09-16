import { describe, expect, it } from "vitest";
import type { ModelDownloadCatalogEntry } from "../../native";
import { findModelDownloadEntry } from "../downloadMatching";
import { catalogFixture } from "./fixtures";

function downloadEntry(modelId: string, displayName = modelId): ModelDownloadCatalogEntry {
  return {
    modelId,
    displayName,
    immutableRevision: "immutable-revision",
    totalBytes: 1_024,
    artifactCount: 1,
    licenseId: "Apache-2.0",
    licenseUrl: "https://example.test/license",
    licenseSha256: "a".repeat(64),
    licenseScope: "Fixture scope",
    codeRevision: "code-revision",
    weightRevision: "weight-revision",
    available: true,
    downloadOnlyReason: "Fixture package",
  };
}

describe("catalog download matching", () => {
  const sdxl = downloadEntry("local/sdxl-base-1.0", "Stable Diffusion XL Base 1.0");
  const flux = downloadEntry("local/flux.2-klein-4b-fp8", "FLUX.2 Klein 4B FP8 bundle");

  it("prefers the exact catalog identity", () => {
    const item = catalogFixture({ sourceId: "LOCAL/SDXL-BASE-1.0", tags: ["pinned-download"] });
    expect(findModelDownloadEntry(item, [sdxl, flux])).toBe(sdxl);
  });

  it("maps the cataloged SDXL LoRA to its containing managed package", () => {
    const item = catalogFixture({ sourceId: "local/sdxl-offset-lora-1.0", artifactType: "lora", tags: ["pinned-download"] });
    expect(findModelDownloadEntry(item, [sdxl, flux])).toBe(sdxl);
  });

  it("accepts one explicit package tag or runtime identity", () => {
    const tagged = catalogFixture({ sourceId: "publisher/model", tags: ["download-model:local/flux.2-klein-4b-fp8"] });
    const runtimeTagged = catalogFixture({ sourceId: "publisher/runtime-model", runtimes: ["package=local/sdxl-base-1.0"] });
    expect(findModelDownloadEntry(tagged, [sdxl, flux])).toBe(flux);
    expect(findModelDownloadEntry(runtimeTagged, [sdxl, flux])).toBe(sdxl);
  });

  it("does not fuzzy-match cloud, ambiguous, or similarly named catalog rows", () => {
    const cloud = catalogFixture({ sourceId: sdxl.modelId, boundaries: ["cloud"] });
    const ambiguous = catalogFixture({ sourceId: "publisher/model", tags: [
      "download-model:local/sdxl-base-1.0",
      "download-model:local/flux.2-klein-4b-fp8",
    ] });
    const similarName = catalogFixture({ sourceId: "publisher/sdxl-ish", name: sdxl.displayName });
    expect(findModelDownloadEntry(cloud, [sdxl, flux])).toBeNull();
    expect(findModelDownloadEntry(ambiguous, [sdxl, flux])).toBeNull();
    expect(findModelDownloadEntry(similarName, [sdxl, flux])).toBeNull();
  });
});
