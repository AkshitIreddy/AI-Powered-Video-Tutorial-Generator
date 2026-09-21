import { describe, expect, it } from "vitest";
import { alystriaCatalogItems, catalogHardwareFromDiagnostics, cloudflareCatalogItem, pinnedLocalImageCatalogItems, soulxFlashHeadCatalogItem, stockAndReviewCloudCatalogItems, structuredCloudCatalogItems } from "../../appCatalog";
import type { DiagnosticReport } from "../../native";
import { evaluateCatalogCompatibility } from "../compatibility";
import { contextFixture } from "./fixtures";

describe("desktop catalog hardware bridge", () => {
  it("does not turn browser-preview zeroes into measured memory", () => {
    const report = {
      generatedAt: "2026-09-05T00:00:00.000Z",
      overall: "info",
      checks: [],
      system: {
        os: "browser preview",
        osVersion: null,
        architecture: "preview",
        cpu: "Not probed",
        logicalCpuCount: 1,
        totalMemoryBytes: 0,
        availableMemoryBytes: 0,
        gpu: [],
      },
    } satisfies DiagnosticReport;

    const hardware = catalogHardwareFromDiagnostics(report);
    expect(hardware.systemRamBytes).toBeNull();
    expect(hardware.systemRamFreeBytes).toBeNull();
    expect(hardware.dedicatedVramBytes).toBeNull();
  });
});

describe("desktop curated cloud routes", () => {
  it("publishes only the exact reviewed Cloudflare image operation", () => {
    expect(alystriaCatalogItems).toContain(cloudflareCatalogItem);
    expect(cloudflareCatalogItem.identity).toMatchObject({
      providerId: "cloudflare-workers-ai",
      sourceId: "@cf/black-forest-labs/flux-1-schnell",
    });
    expect(cloudflareCatalogItem.classification.capabilities).toEqual(["image.generate"]);
    expect(cloudflareCatalogItem.execution.boundaries).toEqual(["cloud"]);
    expect(cloudflareCatalogItem.execution.endpoint?.operationIds).toEqual([
      "POST /client/v4/accounts/{account_id}/ai/run/@cf/black-forest-labs/flux-1-schnell",
    ]);
    expect(cloudflareCatalogItem.execution.endpoint?.openAiCompatible).toBe(false);
    expect(cloudflareCatalogItem.license.identifier).toBe("Apache-2.0");
  });

  it("limits OpenAI-compatible structured writing to reviewed hosts and models", () => {
    expect(structuredCloudCatalogItems.map((item) => ({
      providerId: item.identity.providerId,
      sourceId: item.identity.sourceId,
      baseUrl: item.execution.endpoint?.baseUrl,
      capabilities: item.classification.capabilities,
    }))).toEqual([
      {
        providerId: "gemini",
        sourceId: "gemini-3.8-flash",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        capabilities: ["llm.text", "llm.structured", "research.web"],
      },
      {
        providerId: "groq",
        sourceId: "openai/gpt-oss-20b",
        baseUrl: "https://api.groq.com/openai/v1",
        capabilities: ["llm.text", "llm.structured"],
      },
      {
        providerId: "groq",
        sourceId: "openai/gpt-oss-120b",
        baseUrl: "https://api.groq.com/openai/v1",
        capabilities: ["llm.text", "llm.structured"],
      },
      {
        providerId: "mistral",
        sourceId: "mistral-small-2603",
        baseUrl: "https://api.mistral.ai/v1",
        capabilities: ["llm.text", "llm.structured"],
      },
      {
        providerId: "openrouter",
        sourceId: "z-ai/glm-5.2:free",
        baseUrl: "https://openrouter.ai/api/v1",
        capabilities: ["llm.text", "llm.structured"],
      },
    ]);
  });

  it("publishes only production-backed stock and visual-review routes", () => {
    expect(stockAndReviewCloudCatalogItems.map((item) => ({
      providerId: item.identity.providerId,
      sourceId: item.identity.sourceId,
      revision: item.identity.revision,
      capabilities: item.classification.capabilities,
      operationIds: item.execution.endpoint?.operationIds,
    }))).toEqual([
      {
        providerId: "gemini",
        sourceId: "gemini-3.7-flash",
        revision: "gemini-api-2026-09-08",
        capabilities: ["vlm.chat"],
        operationIds: ["POST /v1beta/models/gemini-3.7-flash:generateContent"],
      },
      {
        providerId: "openverse",
        sourceId: "licensed-media",
        revision: "openverse-api-v1-cc0",
        capabilities: ["media.licensed.search"],
        operationIds: ["GET /v1/images/?q={query}&page_size<=20&license=cc0"],
      },
      {
        providerId: "pexels",
        sourceId: "licensed-media",
        revision: "pexels-api-v1",
        capabilities: ["media.licensed.search"],
        operationIds: ["GET /v1/search?query={query}&per_page<=20"],
      },
      {
        providerId: "nvidia-nim",
        sourceId: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
        revision: "nvidia-api-model-2026-09-05",
        capabilities: ["vlm.chat"],
        operationIds: ["POST /v1/chat/completions"],
      },
      {
        providerId: "nvidia-nim",
        sourceId: "nvidia/nemotron-nano-12b-v2-vl",
        revision: "nvidia-api-model-2026-09-05",
        capabilities: ["vlm.chat"],
        operationIds: ["POST /v1/chat/completions"],
      },
    ]);
    expect(stockAndReviewCloudCatalogItems[0]?.availability).toBe("gated");
    expect(stockAndReviewCloudCatalogItems[1]?.availability).toBe("available");
    expect(stockAndReviewCloudCatalogItems[2]?.availability).toBe("gated");
    expect(stockAndReviewCloudCatalogItems[3]?.availability).toBe("gated");
    expect(stockAndReviewCloudCatalogItems[4]?.availability).toBe("unavailable");
    expect(stockAndReviewCloudCatalogItems[4]?.classification.tags).toContain("deprecated");
  });
});

describe("pinned local image downloads", () => {
  it("publishes exact immutable bundles without claiming a measured 12 GB fit", () => {
    const expected = {
      "local/sdxl-base-1.0": {
        revision: "462165984030d82259a11f4367a4eed129e94a7b",
        sha256: "31e35c80fc4829d14f90153f4c74cd59c90b779f6afe05a74cd6120b893f7e5b",
        bytes: 6_938_078_334,
      },
      "local/sdxl-offset-lora-1.0": {
        revision: "462165984030d82259a11f4367a4eed129e94a7b",
        sha256: "4852686128f953d0277d0793e2f0335352f96a919c9c16a09787d77f55cbdf6f",
        bytes: 49_553_604,
      },
      "local/flux.2-klein-4b-fp8": {
        revision: "5b4408e59397a4a37ccb46afe426d8ed86379441",
        sha256: "97ed34fe0567e436200f2faee3939b88f2b5d99f8af2a4dc16532c4245c0ccb6",
        bytes: 8_255_049_810,
      },
      "local/z-image-turbo-int8": {
        revision: "08d04455279082882deaabc8d0d09fc914c071e1",
        sha256: "be517ebd47c912a5626a588e1aeea43e6be4a43c0cdcd2b48a2a780d9f358635",
        bytes: 10_015_721_877,
      },
    } as const;

    expect(pinnedLocalImageCatalogItems).toHaveLength(4);
    for (const item of pinnedLocalImageCatalogItems) {
      const identity = expected[item.identity.sourceId as keyof typeof expected];
      expect(identity).toBeDefined();
      expect(item.identity.revision).toBe(identity.revision);
      expect(item.identity.immutableHash).toBe(identity.sha256);
      expect(item.trust.sha256).toBe(identity.sha256);
      expect(item.requirements.downloadBytes).toBe(identity.bytes);
      expect(item.requirements.estimatedVramBytes).toBeNull();
      expect(item.availability).toBe("downloadable");
      expect(item.localInstall).toBeNull();
      expect(item.execution.runtimes).toContain("comfyui");
    }
  });

  it("offers the verified presenter engine without claiming it is already installed", () => {
    expect(alystriaCatalogItems).toContain(soulxFlashHeadCatalogItem);
    expect(soulxFlashHeadCatalogItem.identity.sourceId).toBe("local/soulx-flashhead-pro");
    expect(soulxFlashHeadCatalogItem.identity.revision).toContain("+pro-59119b6c");
    expect(soulxFlashHeadCatalogItem.identity.immutableHash).toMatch(/^[a-f0-9]{64}$/);
    expect(soulxFlashHeadCatalogItem.localInstall).toBeNull();
    expect(soulxFlashHeadCatalogItem.requirements.estimatedVramBytes).toBe(12 * 1024 ** 3);
    expect(soulxFlashHeadCatalogItem.requirements.estimatedRamBytes).toBe(12 * 1024 ** 3);
  });

  it("uses the bounded SoulX host-memory measurement without bypassing real capacity failures", () => {
    const report = {
      generatedAt: "2026-09-21T00:00:00.000Z",
      overall: "pass",
      checks: [],
      system: {
        os: "Windows 11",
        osVersion: "11",
        architecture: "x64",
        cpu: "Reference CPU",
        logicalCpuCount: 16,
        totalMemoryBytes: 32 * 1024 ** 3,
        availableMemoryBytes: 18 * 1024 ** 3,
        gpu: [{
          name: "NVIDIA RTX 4080 Laptop GPU",
          driverVersion: "reference-driver",
          dedicatedMemoryBytes: 12 * 1024 ** 3,
        }],
      },
    } satisfies DiagnosticReport;
    const receipt = {
      catalogRevision: soulxFlashHeadCatalogItem.identity.revision!,
      nativeRevision: "verified-native-runtime",
      installFingerprint: "b".repeat(64),
    };
    const context = contextFixture({
      capability: "presenter.generate",
      allowedBoundaries: ["local"],
      hardware: catalogHardwareFromDiagnostics(report),
      verifiedManagedPackages: { [soulxFlashHeadCatalogItem.identity.sourceId]: receipt },
    });

    expect(evaluateCatalogCompatibility(soulxFlashHeadCatalogItem, context)).toMatchObject({
      level: "ready",
      canSelect: true,
    });

    const constrained = evaluateCatalogCompatibility(soulxFlashHeadCatalogItem, {
      ...context,
      hardware: { ...context.hardware, systemRamFreeBytes: 8 * 1024 ** 3 },
    });
    expect(constrained.level).toBe("blocked");
    expect(constrained.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "resource-exceeded" }),
    ]));
  });

  it("pins every multi-file Comfy bundle to the stable runtime and exact component hashes", () => {
    for (const sourceId of ["local/flux.2-klein-4b-fp8", "local/z-image-turbo-int8"]) {
      const item = pinnedLocalImageCatalogItems.find((candidate) => candidate.identity.sourceId === sourceId);
      expect(item).toBeDefined();
      const artifacts = item?.requirements.requiredArtifacts.map((artifact) => artifact.identifier) ?? [];
      expect(artifacts).toContain("Comfy-Org/ComfyUI@8f40b43e0204d5b9780f3e9618e140e929e80594");
      expect(artifacts.filter((identifier) => identifier.includes("sha256:"))).toHaveLength(3);
    }
  });

  it("allows the vetted LoRA only with an SDXL 1.0 base family", () => {
    const lora = pinnedLocalImageCatalogItems.find((item) => item.identity.sourceId === "local/sdxl-offset-lora-1.0");
    expect(lora).toBeDefined();
    expect(lora?.classification.artifactType).toBe("lora");
    expect(lora?.compatibility.compatibleBaseFamilies).toEqual(["sdxl-1.0"]);

    const matching = evaluateCatalogCompatibility(lora!, contextFixture({ selectedBaseFamily: "SDXL 1.0" }));
    const mismatched = evaluateCatalogCompatibility(lora!, contextFixture({ selectedBaseFamily: "flux.2-klein-4b" }));
    expect(matching.reasons.some((reason) => reason.code === "base-family-mismatch")).toBe(false);
    expect(mismatched.level).toBe("blocked");
    expect(mismatched.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "base-family-mismatch", severity: "error" }),
    ]));
  });
});
