import { describe, expect, it } from "vitest";
import { buildProviderRoutingReview } from "../providerRouting";
import type { ModelProfile, ProviderSecretRef } from "../native";

const profile: ModelProfile = {
  id: "real-cloud",
  name: "Real cloud",
  description: "Explicit test routing",
  routes: {
    writing: { providerId: "openai", modelId: "gpt-5.4" },
    research: { providerId: "openai", modelId: "gpt-5.4" },
    images: { providerId: "openai", modelId: "gpt-image-2" },
    voice: { providerId: "elevenlabs", modelId: "eleven_multilingual_v2" },
    transcription: { providerId: "openai", modelId: "whisper-1" },
    presenter: { providerId: "local-runtime", modelId: "off by default" },
  },
};

const secrets: Record<string, ProviderSecretRef> = {
  openai: secret("openai"),
  elevenlabs: secret("elevenlabs"),
};

describe("provider routing review", () => {
  it("builds one closed project policy from an explicitly approved profile", () => {
    const review = buildProviderRoutingReview({
      profile,
      secretRefs: secrets,
      dataClassification: "project",
      hardLimitMinorUnits: 250,
      approvalChecked: true,
      hasPrivateSources: false,
      groundingMode: "grounded",
      reviewedAt: "2026-08-29T12:00:00.000Z",
    });

    expect(review.errors).toEqual([]);
    expect(review.privacy).toBe("cloud");
    expect(review.approvedProviderIds).toEqual(["openai", "elevenlabs"]);
    expect(review.policy?.budget.hardLimitMicros).toBe(2_500_000);
    expect(review.policy?.routes.map((route) => route.capability)).toEqual([
      "llm.structured",
      "research.web",
      "image.generate",
      "audio.tts",
      "audio.transcribe",
    ]);
    expect(review.policy?.approvals.every((approval) => approval.privacyApproved)).toBe(true);
  });

  it("fails closed before consent or when a required credential is absent", () => {
    const review = buildProviderRoutingReview({
      profile,
      secretRefs: { openai: secret("openai") },
      dataClassification: "project",
      hardLimitMinorUnits: 100,
      approvalChecked: false,
      hasPrivateSources: false,
      groundingMode: "strict",
    });

    expect(review.policy).toBeNull();
    expect(review.errors).toContain("Review and approve the named providers, retention boundary, and hard budget.");
    expect(review.errors).toContain("elevenlabs needs a credential in the OS vault before this profile can be approved.");
  });

  it("blocks private sources and project content from cloud-preview-only routing", () => {
    const nimProfile: ModelProfile = {
      ...profile,
      routes: { ...profile.routes, writing: { providerId: "nvidia-nim", modelId: "openai/gpt-oss-20b" } },
    };
    const review = buildProviderRoutingReview({
      profile: nimProfile,
      secretRefs: { ...secrets, "nvidia-nim": secret("nvidia-nim") },
      dataClassification: "project",
      hardLimitMinorUnits: 100,
      approvalChecked: true,
      hasPrivateSources: true,
      groundingMode: "creative",
    });

    expect(review.policy).toBeNull();
    expect(review.errors).toContain("Private source files cannot enter this cloud profile. Use an all-local profile or create the project without those files.");
    expect(review.errors).toContain("NVIDIA hosted preview accepts only public or synthetic project content.");
  });
});

function secret(providerId: string): ProviderSecretRef {
  return {
    reference: `keyring://alystria/${providerId}/api_key`,
    providerId,
    credentialKind: "api_key",
    availability: "present",
    updatedAt: "2026-08-29T12:00:00.000Z",
  };
}
