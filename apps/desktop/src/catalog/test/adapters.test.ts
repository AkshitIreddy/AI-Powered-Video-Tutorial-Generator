import { describe, expect, it } from "vitest";
import {
  adaptCivitaiModel,
  adaptCloudEndpoint,
  adaptCuratedEntry,
  adaptHuggingFaceModel,
  adaptLocalManifest,
  adaptNvidiaCatalogEntry,
} from "../adapters";

describe("federated catalog adapters", () => {
  it("normalizes Hugging Face discovery metadata without claiming verification", () => {
    const item = adaptHuggingFaceModel({
      id: "black-forest-labs/FLUX.1-dev",
      author: "black-forest-labs",
      sha: "revision-sha",
      pipeline_tag: "text-to-image",
      library_name: "diffusers",
      tags: ["diffusers", "lora", "safetensors"],
      downloads: 1000,
      cardData: { license: "other", base_model: "flux.1" },
      siblings: [{ rfilename: "model.safetensors", size: 10_000 }],
    }, "2026-09-02T00:00:00.000Z");
    expect(item.identity.source).toBe("hugging-face");
    expect(item.classification.capabilities).toContain("image.generate");
    expect(item.classification.artifactType).toBe("lora");
    expect(item.classification.baseFamilies).toEqual(["flux.1"]);
    expect(item.trust.publisherVerifiedBySource).toBeNull();
    expect(item.license.status).toBe("custom");
  });

  it("keeps Civitai version identity, AIR, scans, and usage permissions", () => {
    const item = adaptCivitaiModel({
      id: 4,
      name: "Portrait adapter",
      type: "LORA",
      creator: { username: "artist" },
      allowNoCredit: false,
      allowCommercialUse: ["Image"],
      allowDerivatives: true,
      stats: { downloadCount: 42, thumbsUpCount: 7 },
    }, {
      id: 8,
      modelId: 4,
      name: "v1",
      baseModel: "SDXL 1.0",
      air: "urn:air:sdxl:lora:civitai:4@8",
      status: "Published",
      files: [{ name: "portrait.safetensors", primary: true, sizeKB: 1024, pickleScanResult: "Success", virusScanResult: "Success", hashes: { SHA256: "hash" } }],
    }, "2026-09-02T00:00:00.000Z");
    expect(item.identity.source).toBe("civitai");
    expect(item.identity.sourceId).toContain("4");
    expect(item.classification.artifactType).toBe("lora");
    expect(item.trust.safetensors).toBe(true);
    expect(item.trust.virusScan).toBe("passed");
    expect(item.license.attributionRequired).toBe(true);
  });

  it("keeps NIM and NGC as distinct sources and marks entitlement gates", () => {
    const item = adaptNvidiaCatalogEntry({
      catalog: "nim",
      id: "nvidia/example",
      name: "Example NIM",
      publisher: "NVIDIA",
      capabilities: ["llm.text"],
      hostedApi: true,
      downloadable: false,
      entitlement: "required",
      sourceUrl: "https://build.nvidia.com/example",
      retrievedAt: "2026-09-02T00:00:00.000Z",
    });
    expect(item.identity.source).toBe("nvidia-nim");
    expect(item.execution.boundaries).toEqual(["cloud"]);
    expect(item.availability).toBe("gated");
    expect(item.trust.termsAccepted).toBe(false);
  });

  it("normalizes curated, local, and generic cloud entries through one schema", () => {
    const license = {
      identifier: "apache-2.0", name: "Apache 2.0", url: null, commercialUse: "allowed" as const,
      attributionRequired: true, derivativesAllowed: true, hostingAllowed: true, status: "known" as const, notes: [],
    };
    const curated = adaptCuratedEntry({
      id: "recipe", providerId: "alystria", publisher: "Alystria", name: "Recipe", revision: "1",
      capabilities: ["image.generate"], artifactType: "workflow", modalities: ["image"], boundaries: ["local"],
      license, description: "Curated", sourceUrl: "https://example.invalid/recipe", retrievedAt: "2026-09-02T00:00:00.000Z",
    });
    const local = adaptLocalManifest({
      id: "local/model", name: "Local", capabilities: ["llm.text"], artifactType: "model", modalities: ["text"],
      runtimes: ["llama.cpp"], install: { path: "E:\\models\\local", fingerprint: "sha", installedAt: null, lastVerifiedAt: null, status: "verified" },
      license, retrievedAt: "2026-09-02T00:00:00.000Z",
    });
    const cloud = adaptCloudEndpoint({
      id: "cloud/model", providerId: "cloud-provider", publisher: "Cloud Vendor", name: "Hosted",
      capabilities: ["llm.text"], modalities: ["text"], operationIds: ["chat"], endpointBaseUrl: "https://api.example.invalid",
      credentialConfigured: false, reachable: null, retrievedAt: "2026-09-02T00:00:00.000Z",
    });
    expect([curated, local, cloud].map((item) => item.schemaVersion)).toEqual([1, 1, 1]);
    expect(local.availability).toBe("installed");
    expect(cloud.execution.endpoint?.operationIds).toEqual(["chat"]);
    expect(cloud.identity.providerId).toBe("cloud-provider");
  });
});
