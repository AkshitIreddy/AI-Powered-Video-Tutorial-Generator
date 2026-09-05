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
    portraitAnimation: { providerId: "local-runtime", modelId: "off by default" },
    lipSync: { providerId: "local-runtime", modelId: "off by default" },
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

  it("keeps image generation optional for authored layouts and bundled visuals", () => {
    const review = buildProviderRoutingReview({
      profile: {
        ...profile,
        routes: {
          ...profile.routes,
          images: { providerId: "local-runtime", modelId: "off by default" },
        },
      },
      secretRefs: secrets,
      dataClassification: "project",
      hardLimitMinorUnits: 250,
      approvalChecked: true,
      hasPrivateSources: false,
      groundingMode: "creative",
    });

    expect(review.errors).toEqual([]);
    expect(review.policy?.routes.map((route) => route.capability)).not.toContain("image.generate");
    expect(review.profileSnapshot?.routes.map((route) => route.medium)).not.toContain("images");
  });

  it("requires a safe Account ID for the exact Cloudflare image route", () => {
    const cloudflareProfile: ModelProfile = {
      ...profile,
      routes: {
        ...profile.routes,
        images: {
          providerId: "cloudflare-workers-ai",
          modelId: "@cf/black-forest-labs/flux-1-schnell",
        },
      },
    };
    const withoutAccount = buildProviderRoutingReview({
      profile: cloudflareProfile,
      secretRefs: { ...secrets, "cloudflare-workers-ai": secret("cloudflare-workers-ai") },
      dataClassification: "project",
      hardLimitMinorUnits: 250,
      approvalChecked: true,
      hasPrivateSources: false,
      groundingMode: "grounded",
    });
    expect(withoutAccount.policy).toBeNull();
    expect(withoutAccount.errors).toContain(
      "Cloudflare Workers AI needs the Account ID from the Workers AI dashboard.",
    );

    const withAccount = buildProviderRoutingReview({
      profile: cloudflareProfile,
      secretRefs: { ...secrets, "cloudflare-workers-ai": secret("cloudflare-workers-ai") },
      providerAccountIds: {
        "cloudflare-workers-ai": "0123456789abcdef0123456789abcdef",
      },
      dataClassification: "project",
      hardLimitMinorUnits: 250,
      approvalChecked: true,
      hasPrivateSources: false,
      groundingMode: "grounded",
    });
    expect(withAccount.errors).toEqual([]);
    expect(withAccount.policy?.approvals.find(
      (approval) => approval.providerId === "cloudflare-workers-ai",
    )?.accountId).toBe("0123456789abcdef0123456789abcdef");
  });

  it("rejects unreviewed Cloudflare model IDs", () => {
    const review = buildProviderRoutingReview({
      profile: {
        ...profile,
        routes: {
          ...profile.routes,
          images: { providerId: "cloudflare-workers-ai", modelId: "@cf/vendor/other" },
        },
      },
      secretRefs: { ...secrets, "cloudflare-workers-ai": secret("cloudflare-workers-ai") },
      providerAccountIds: {
        "cloudflare-workers-ai": "0123456789abcdef0123456789abcdef",
      },
      dataClassification: "project",
      hardLimitMinorUnits: 250,
      approvalChecked: true,
      hasPrivateSources: false,
      groundingMode: "grounded",
    });
    expect(review.policy).toBeNull();
    expect(review.errors).toContain(
      "Cloudflare Workers AI currently supports only the reviewed FLUX.1 Schnell image route.",
    );
  });

  it.each([
    ["groq", "openai/gpt-oss-20b"],
    ["mistral", "mistral-small-2603"],
    ["openrouter", "z-ai/glm-5.2:free"],
  ])("builds the exact reviewed %s structured-writing route", (providerId, modelId) => {
    const review = buildProviderRoutingReview({
      profile: {
        ...profile,
        routes: {
          ...profile.routes,
          writing: { providerId, modelId },
        },
      },
      secretRefs: { ...secrets, [providerId]: secret(providerId) },
      dataClassification: "project",
      hardLimitMinorUnits: 250,
      approvalChecked: true,
      hasPrivateSources: false,
      groundingMode: "grounded",
    });
    expect(review.errors).toEqual([]);
    expect(review.policy?.routes.find((route) => route.capability === "llm.structured")).toMatchObject({
      providerIds: [providerId],
      model: modelId,
    });
  });

  it("rejects user-entered model aliases for model-scoped structured clouds", () => {
    for (const providerId of ["groq", "mistral", "openrouter"]) {
      const review = buildProviderRoutingReview({
        profile: {
          ...profile,
          routes: {
            ...profile.routes,
            writing: { providerId, modelId: "latest" },
          },
        },
        secretRefs: { ...secrets, [providerId]: secret(providerId) },
        dataClassification: "project",
        hardLimitMinorUnits: 250,
        approvalChecked: true,
        hasPrivateSources: false,
        groundingMode: "grounded",
      });
      expect(review.policy).toBeNull();
      expect(review.errors.join(" | ")).toContain(`${providerId} structured writing currently supports only the reviewed`);
    }
  });

  it("adds optional CC0 stock search and NVIDIA visual review to a public profile", () => {
    const review = buildProviderRoutingReview({
      profile: {
        ...profile,
        routes: {
          ...profile.routes,
          stock: { providerId: "openverse", modelId: "licensed-media" },
          visualReview: { providerId: "nvidia-nim", modelId: "nvidia/nemotron-nano-12b-v2-vl" },
        },
      },
      secretRefs: { ...secrets, "nvidia-nim": secret("nvidia-nim") },
      dataClassification: "public",
      hardLimitMinorUnits: 250,
      approvalChecked: true,
      hasPrivateSources: false,
      groundingMode: "grounded",
      reviewedAt: "2026-09-05T12:00:00.000Z",
    });

    expect(review.errors).toEqual([]);
    expect(review.policy?.routes).toEqual(expect.arrayContaining([
      expect.objectContaining({ capability: "media.licensed.search", providerIds: ["openverse"], model: "licensed-media" }),
      expect.objectContaining({ capability: "vlm.chat", providerIds: ["nvidia-nim"], model: "nvidia/nemotron-nano-12b-v2-vl" }),
    ]));
    expect(review.policy?.approvals.find((approval) => approval.providerId === "openverse")?.credentialRef).toBeNull();
    expect(review.profileSnapshot?.routes).toEqual(expect.arrayContaining([
      expect.objectContaining({ medium: "stock", capability: "media.licensed.search", providerId: "openverse" }),
      expect.objectContaining({ medium: "visualReview", capability: "vlm.chat", providerId: "nvidia-nim" }),
    ]));
  });

  it("requires a Pexels API key when the optional keyed stock route is selected", () => {
    const review = buildProviderRoutingReview({
      profile: {
        ...profile,
        routes: { ...profile.routes, stock: { providerId: "pexels", modelId: "licensed-media" } },
      },
      secretRefs: secrets,
      dataClassification: "public",
      hardLimitMinorUnits: 250,
      approvalChecked: true,
      hasPrivateSources: false,
      groundingMode: "grounded",
    });
    expect(review.policy).toBeNull();
    expect(review.errors).toContain("pexels needs a credential in the OS vault before this profile can be approved.");
  });

  it.each([
    ["stock", "openverse", "latest", "openverse stock media currently supports only the reviewed licensed-media route."],
    ["visualReview", "nvidia-nim", "latest", "nvidia-nim visual review currently supports only the reviewed nvidia/nemotron-nano-12b-v2-vl route."],
  ] as const)("rejects unreviewed %s route model IDs", (medium, providerId, modelId, expectedError) => {
    const review = buildProviderRoutingReview({
      profile: {
        ...profile,
        routes: { ...profile.routes, [medium]: { providerId, modelId } },
      },
      secretRefs: { ...secrets, [providerId]: secret(providerId) },
      dataClassification: "public",
      hardLimitMinorUnits: 250,
      approvalChecked: true,
      hasPrivateSources: false,
      groundingMode: "grounded",
    });
    expect(review.policy).toBeNull();
    expect(review.errors).toContain(expectedError);
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

  it("routes portrait animation and lip-sync independently and snapshots exact local installs", () => {
    const installFingerprint = "a".repeat(64);
    const localProfile: ModelProfile = {
      ...profile,
      routes: {
        ...profile.routes,
        portraitAnimation: {
          providerId: "local-runtime",
          modelId: "local/liveportrait",
          modelRevision: "liveportrait-hf-82a4fa67",
          installFingerprint,
        },
        lipSync: {
          providerId: "local-runtime",
          modelId: "local/musetalk-1.5",
          modelRevision: "musetalk-hf-3ef28bc5+code-0a89dec4",
          installFingerprint,
          presenterProfileId: "presenter.ava",
        },
      },
    };
    const review = buildProviderRoutingReview({
      profile: localProfile,
      secretRefs: secrets,
      dataClassification: "project",
      hardLimitMinorUnits: 250,
      approvalChecked: true,
      hasPrivateSources: false,
      groundingMode: "grounded",
      reviewedAt: "2026-08-29T12:00:00.000Z",
      setupUpdatedAt: "2026-08-29T11:00:00.000Z",
    });

    expect(review.errors).toEqual([]);
    expect(review.policy?.routes.slice(-2).map((route) => route.capability)).toEqual(["portrait.animate", "lipsync.generate"]);
    expect(review.profileSnapshot).toEqual(expect.objectContaining({
      schemaVersion: 1,
      profileId: localProfile.id,
      capturedAt: "2026-08-29T12:00:00.000Z",
      sourceSetupUpdatedAt: "2026-08-29T11:00:00.000Z",
    }));
    expect(review.profileSnapshot?.routes.slice(-2)).toEqual([
      expect.objectContaining({ medium: "portraitAnimation", capability: "portrait.animate", modelRevision: "liveportrait-hf-82a4fa67", installFingerprint }),
      expect.objectContaining({ medium: "lipSync", capability: "lipsync.generate", presenterProfileId: "presenter.ava", installFingerprint }),
    ]);
  });

  it("fails closed when a local route is only a label rather than a verified install", () => {
    const localProfile: ModelProfile = {
      ...profile,
      routes: { ...profile.routes, lipSync: { providerId: "local-runtime", modelId: "local/musetalk-1.5" } },
    };
    const review = buildProviderRoutingReview({
      profile: localProfile,
      secretRefs: secrets,
      dataClassification: "project",
      hardLimitMinorUnits: 250,
      approvalChecked: true,
      hasPrivateSources: false,
      groundingMode: "grounded",
    });

    expect(review.policy).toBeNull();
    expect(review.profileSnapshot).toBeNull();
    expect(review.errors).toEqual(expect.arrayContaining([
      "Lip-sync needs an exact local model revision before project selection.",
      "Lip-sync needs a verified local install fingerprint before project selection.",
    ]));
  });

  it("keeps the pinned local speech model separate from its installed voice", () => {
    const localVoiceProfile: ModelProfile = {
      ...profile,
      routes: {
        ...profile.routes,
        voice: {
          providerId: "local-runtime",
          modelId: "System.Speech.Synthesis",
          modelRevision: "windows-11-10.0.26200",
          installFingerprint: "7".repeat(64),
          voiceId: "Microsoft Zira Desktop",
        },
      },
    };
    const review = buildProviderRoutingReview({
      profile: localVoiceProfile,
      secretRefs: secrets,
      dataClassification: "public",
      hardLimitMinorUnits: 250,
      approvalChecked: true,
      hasPrivateSources: false,
      groundingMode: "creative",
      reviewedAt: "2026-08-29T12:00:00.000Z",
    });

    expect(review.errors).toEqual([]);
    expect(review.policy?.routes.find((route) => route.capability === "audio.tts")).toEqual(
      expect.objectContaining({ model: "System.Speech.Synthesis", voice: "Microsoft Zira Desktop" }),
    );
  });

  it("blocks a known starter-presenter and local-voice mismatch", () => {
    const localProfile: ModelProfile = {
      ...profile,
      routes: {
        ...profile.routes,
        voice: {
          providerId: "local-runtime",
          modelId: "System.Speech.Synthesis",
          modelRevision: "windows-11-10.0.26200",
          installFingerprint: "7".repeat(64),
          voiceId: "Microsoft Zira Desktop",
        },
        lipSync: {
          providerId: "local-runtime",
          modelId: "local/musetalk-1.5",
          modelRevision: "musetalk-1.5-pinned",
          installFingerprint: "8".repeat(64),
          presenterProfileId: "presenter-portrait.mathematics-arjun-v1",
        },
      },
    };
    const mismatched = buildProviderRoutingReview({
      profile: localProfile,
      secretRefs: secrets,
      dataClassification: "public",
      hardLimitMinorUnits: 250,
      approvalChecked: true,
      hasPrivateSources: false,
      groundingMode: "creative",
      reviewedAt: "2026-08-29T12:00:00.000Z",
    });
    expect(mismatched.errors).toContain("Arjun · mathematics needs a compatible narration voice; choose Microsoft David Desktop instead of Microsoft Zira Desktop.");

    const matched = buildProviderRoutingReview({
      profile: {
        ...localProfile,
        routes: { ...localProfile.routes, voice: { ...localProfile.routes.voice!, voiceId: "Microsoft David Desktop" } },
      },
      secretRefs: secrets,
      dataClassification: "public",
      hardLimitMinorUnits: 250,
      approvalChecked: true,
      hasPrivateSources: false,
      groundingMode: "creative",
      reviewedAt: "2026-08-29T12:00:00.000Z",
    });
    expect(matched.errors).not.toContain(expect.stringMatching(/compatible narration voice/i));
  });

  it("guards Maya against a masculine local voice and surfaces a cloud override", () => {
    const mayaProfile: ModelProfile = {
      ...profile,
      routes: {
        ...profile.routes,
        voice: {
          providerId: "local-runtime",
          modelId: "System.Speech.Synthesis",
          modelRevision: "windows-11-10.0.26200",
          installFingerprint: "7".repeat(64),
          voiceId: "Microsoft David Desktop",
        },
        lipSync: {
          providerId: "local-runtime",
          modelId: "local/musetalk-1.5",
          modelRevision: "musetalk-1.5-pinned",
          installFingerprint: "8".repeat(64),
          presenterProfileId: "presenter-portrait.educator-maya-v2",
        },
      },
    };
    const localReview = buildProviderRoutingReview({
      profile: mayaProfile,
      secretRefs: secrets,
      dataClassification: "public",
      hardLimitMinorUnits: 250,
      approvalChecked: true,
      hasPrivateSources: false,
      groundingMode: "creative",
      reviewedAt: "2026-08-29T12:00:00.000Z",
    });
    expect(localReview.errors).toContain("Maya · mathematics educator needs a compatible narration voice; choose Microsoft Zira Desktop instead of Microsoft David Desktop.");

    const cloudReview = buildProviderRoutingReview({
      profile: {
        ...mayaProfile,
        routes: {
          ...mayaProfile.routes,
          voice: { providerId: "elevenlabs", modelId: "eleven_multilingual_v2", voiceId: "custom-voice" },
        },
      },
      secretRefs: secrets,
      dataClassification: "public",
      hardLimitMinorUnits: 250,
      approvalChecked: true,
      hasPrivateSources: false,
      groundingMode: "creative",
      reviewedAt: "2026-08-29T12:00:00.000Z",
    });
    expect(cloudReview.warnings.join(" | ")).toMatch(/curated ElevenLabs pairing/);
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
