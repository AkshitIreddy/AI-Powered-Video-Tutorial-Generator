import type {
  ModelProfile,
  ProjectModelProfileSnapshot,
  ProviderApproval,
  ProviderCapability,
  ProviderSecretRef,
  TutorialRoutingPolicy,
} from "./native";

export type RouteMedium = "writing" | "research" | "images" | "motion" | "voice" | "transcription" | "presenter" | "portraitAnimation" | "lipSync" | "stock" | "visualReview";

interface ProviderPolicyDescriptor {
  boundary: "local" | "cloud";
  retention: "local_only" | "configurable" | "provider_default";
  regions: string[];
  capabilities: ReadonlySet<ProviderCapability>;
  credential: boolean;
}

const mediumCapabilities: Record<RouteMedium, ProviderCapability> = {
  writing: "llm.structured",
  research: "research.web",
  images: "image.generate",
  motion: "motion.generate",
  voice: "audio.tts",
  transcription: "audio.transcribe",
  presenter: "presenter.generate",
  portraitAnimation: "portrait.animate",
  lipSync: "lipsync.generate",
  stock: "media.licensed.search",
  visualReview: "vlm.chat",
};

const baselineRequiredMedia: RouteMedium[] = ["writing", "voice"];

const curatedStarterPresenterVoices: Record<string, {
  readonly label: string;
  readonly recommendedWindowsVoiceId: string;
  readonly incompatibleWindowsVoiceIds: readonly string[];
  readonly recommendedElevenLabsVoiceId?: string;
}> = {
  "presenter-portrait.educator-maya-v2": {
    label: "Maya · mathematics educator",
    recommendedWindowsVoiceId: "Microsoft Zira Desktop",
    incompatibleWindowsVoiceIds: ["Microsoft David Desktop"],
    recommendedElevenLabsVoiceId: "Xb7hH8MSUJpSbSDYk0k2",
  },
  "presenter-portrait.mathematics-arjun-v1": {
    label: "Arjun · mathematics",
    recommendedWindowsVoiceId: "Microsoft David Desktop",
    incompatibleWindowsVoiceIds: ["Microsoft Zira Desktop"],
  },
  "presenter-portrait.anime-hana-v1": {
    label: "Hana · anime science tutor",
    recommendedWindowsVoiceId: "Microsoft Zira Desktop",
    incompatibleWindowsVoiceIds: ["Microsoft David Desktop"],
    recommendedElevenLabsVoiceId: "Xb7hH8MSUJpSbSDYk0k2",
  },
  "presenter-portrait.anime-kenji-v1": {
    label: "Kenji · anime coding mentor",
    recommendedWindowsVoiceId: "Microsoft David Desktop",
    incompatibleWindowsVoiceIds: ["Microsoft Zira Desktop"],
    recommendedElevenLabsVoiceId: "nPczCjzI2devNBz1zQrb",
  },
  "presenter-portrait.cartoon-camille-v1": {
    label: "Camille · cartoon physics maker",
    recommendedWindowsVoiceId: "Microsoft Zira Desktop",
    incompatibleWindowsVoiceIds: ["Microsoft David Desktop"],
    recommendedElevenLabsVoiceId: "Xb7hH8MSUJpSbSDYk0k2",
  },
  "presenter-portrait.cartoon-elias-v1": {
    label: "Elias · cartoon design historian",
    recommendedWindowsVoiceId: "Microsoft David Desktop",
    incompatibleWindowsVoiceIds: ["Microsoft Zira Desktop"],
    recommendedElevenLabsVoiceId: "onwK4e9ZLuTAKqWW03F9",
  },
};

const providerPolicies: Record<string, ProviderPolicyDescriptor> = {
  "local-runtime": local(["llm.text", "llm.structured", "image.generate", "image.edit", "audio.tts", "audio.transcribe", "audio.align", "presenter.generate", "portrait.animate", "lipsync.generate"]),
  "openai-compatible-local": local(["llm.text", "llm.structured"]),
  openai: cloud("configurable", ["llm.text", "llm.structured", "research.web", "image.generate", "image.edit", "audio.tts", "audio.transcribe"]),
  anthropic: cloud("configurable", ["llm.text", "llm.structured", "research.web"]),
  groq: cloud("provider_default", ["llm.text", "llm.structured"]),
  mistral: cloud("provider_default", ["llm.text", "llm.structured"]),
  openrouter: cloud("provider_default", ["llm.text", "llm.structured"]),
  openverse: cloud("provider_default", ["media.licensed.search"], false),
  pexels: cloud("provider_default", ["media.licensed.search"]),
  gemini: cloud("configurable", ["llm.text", "llm.structured", "research.web", "image.generate", "image.edit", "motion.generate", "audio.tts", "audio.transcribe"]),
  "nvidia-nim": cloud("provider_default", ["llm.text", "llm.structured", "vlm.chat", "retrieval.embed", "image.generate", "audio.tts"]),
  "cloudflare-workers-ai": cloud("configurable", ["image.generate"]),
  "black-forest-labs": cloud("provider_default", ["image.generate", "image.edit"]),
  recraft: cloud("provider_default", ["image.generate", "image.edit"]),
  runway: cloud("provider_default", ["motion.generate"]),
  elevenlabs: cloud("provider_default", ["audio.tts", "audio.transcribe"]),
  "azure-speech": cloud("configurable", ["audio.tts", "audio.transcribe"]),
  "google-cloud-speech": cloud("configurable", ["audio.tts", "audio.transcribe"]),
  heygen: cloud("provider_default", ["presenter.generate"]),
  tavus: cloud("provider_default", ["presenter.generate"]),
};

const reviewedStructuredCloudModels: Readonly<Record<string, string>> = {
  groq: "openai/gpt-oss-20b",
  mistral: "mistral-small-2603",
  openrouter: "z-ai/glm-5.2:free",
};

const reviewedOptionalRouteModels: Readonly<Record<string, Readonly<Partial<Record<ProviderCapability, string>>>>> = {
  openverse: { "media.licensed.search": "licensed-media" },
  pexels: { "media.licensed.search": "licensed-media" },
  "nvidia-nim": { "vlm.chat": "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning" },
};

export interface ProviderRoutingReview {
  profile: ModelProfile;
  policy: TutorialRoutingPolicy | null;
  privacy: TutorialRoutingPolicy["privacyMode"];
  approvedProviderIds: string[];
  errors: string[];
  warnings: string[];
  profileSnapshot: ProjectModelProfileSnapshot | null;
  routeRows: Array<{ medium: string; capability: ProviderCapability; providerId: string; modelId: string; boundary: "local" | "cloud" }>;
}

export function buildProviderRoutingReview(input: {
  profile: ModelProfile;
  secretRefs: Record<string, ProviderSecretRef>;
  dataClassification: "public" | "project";
  hardLimitMinorUnits: number;
  approvalChecked: boolean;
  hasPrivateSources: boolean;
  groundingMode: "creative" | "grounded" | "strict";
  reviewedAt?: string;
  setupUpdatedAt?: string;
  providerAccountIds?: Readonly<Record<string, string>>;
}): ProviderRoutingReview {
  const errors: string[] = [];
  const warnings: string[] = [];
  const routes: TutorialRoutingPolicy["routes"] = [];
  const routeRows: ProviderRoutingReview["routeRows"] = [];
  const snapshotRoutes: ProjectModelProfileSnapshot["routes"] = [];
  const approvalCapabilities = new Map<string, Set<ProviderCapability>>();
  const routedCapabilities = new Set<ProviderCapability>();
  const requiredMedia = input.groundingMode === "creative" ? baselineRequiredMedia : [...baselineRequiredMedia, "research" as const];

  for (const [medium, capability] of Object.entries(mediumCapabilities) as Array<[RouteMedium, ProviderCapability]>) {
    const selection = input.profile.routes[medium];
    if (!selection || isDisabledModel(selection.modelId)) {
      if (requiredMedia.includes(medium)) errors.push(`${labelForMedium(medium)} needs an explicit provider and model.`);
      continue;
    }
    const descriptor = providerPolicies[selection.providerId];
    if (!descriptor) {
      errors.push(`${labelForMedium(medium)} uses ${selection.providerId}, which has no launch routing policy.`);
      continue;
    }
    if (!descriptor.capabilities.has(capability)) {
      errors.push(`${selection.providerId} cannot provide ${labelForMedium(medium).toLowerCase()}.`);
      continue;
    }
    if (
      selection.providerId === "cloudflare-workers-ai"
      && selection.modelId !== "@cf/black-forest-labs/flux-1-schnell"
    ) {
      errors.push("Cloudflare Workers AI currently supports only the reviewed FLUX.1 Schnell image route.");
      continue;
    }
    const reviewedStructuredModel = reviewedStructuredCloudModels[selection.providerId];
    if (reviewedStructuredModel && selection.modelId !== reviewedStructuredModel) {
      errors.push(`${selection.providerId} structured writing currently supports only the reviewed ${reviewedStructuredModel} route.`);
      continue;
    }
    const reviewedOptionalModel = reviewedOptionalRouteModels[selection.providerId]?.[capability];
    if (reviewedOptionalModel && selection.modelId !== reviewedOptionalModel) {
      errors.push(`${selection.providerId} ${labelForMedium(medium).toLowerCase()} currently supports only the reviewed ${reviewedOptionalModel} route.`);
      continue;
    }
    const modelRevision = selection.modelRevision?.trim() || undefined;
    const installFingerprint = selection.installFingerprint?.trim() || undefined;
    if (descriptor.boundary === "local") {
      if (!modelRevision) errors.push(`${labelForMedium(medium)} needs an exact local model revision before project selection.`);
      if (!installFingerprint || !/^[a-f0-9]{64}$/.test(installFingerprint)) errors.push(`${labelForMedium(medium)} needs a verified local install fingerprint before project selection.`);
    }
    if (routedCapabilities.has(capability)) {
      warnings.push(`${labelForMedium(medium)} shares an existing ${capability} route and remains a profile-only preference.`);
      continue;
    }
    routedCapabilities.add(capability);
    routes.push({
      capability,
      providerIds: [selection.providerId],
      model: selection.modelId,
      voice: medium === "voice" ? selection.voiceId?.trim() || selection.modelId : null,
    });
    routeRows.push({ medium: labelForMedium(medium), capability, providerId: selection.providerId, modelId: selection.modelId, boundary: descriptor.boundary });
    snapshotRoutes.push({
      medium,
      capability,
      providerId: selection.providerId,
      modelId: selection.modelId,
      ...(modelRevision ? { modelRevision } : {}),
      ...(installFingerprint ? { installFingerprint } : {}),
      ...(selection.voiceId?.trim() ? { voiceId: selection.voiceId.trim() } : {}),
      ...(selection.presenterProfileId?.trim() ? { presenterProfileId: selection.presenterProfileId.trim() } : {}),
      boundary: descriptor.boundary,
      retention: descriptor.retention,
      regions: [...descriptor.regions],
      fallbackConsent: false,
    });
    const capabilities = approvalCapabilities.get(selection.providerId) ?? new Set<ProviderCapability>();
    capabilities.add(capability);
    approvalCapabilities.set(selection.providerId, capabilities);
  }

  const selectedProviders = [...approvalCapabilities];
  const hasCloud = selectedProviders.some(([id]) => providerPolicies[id]?.boundary === "cloud");
  const hasLocal = selectedProviders.some(([id]) => providerPolicies[id]?.boundary === "local");
  const privacy: TutorialRoutingPolicy["privacyMode"] = hasCloud ? (hasLocal ? "hybrid" : "cloud") : "local";

  if (input.hasPrivateSources && hasCloud) {
    errors.push("Private source files cannot enter this cloud profile. Use an all-local profile or create the project without those files.");
  }
  if (input.dataClassification === "project" && selectedProviders.some(([id]) => id === "nvidia-nim")) {
    errors.push("NVIDIA hosted preview accepts only public or synthetic project content.");
  }
  const selectedPresenterProfileId = [
    input.profile.routes.lipSync,
    input.profile.routes.portraitAnimation,
    input.profile.routes.presenter,
  ].find((route) => route && !isDisabledModel(route.modelId) && route.presenterProfileId)?.presenterProfileId;
  const curatedPairing = selectedPresenterProfileId ? curatedStarterPresenterVoices[selectedPresenterProfileId] : undefined;
  const narrationRoute = input.profile.routes.voice;
  if (
    curatedPairing
    && narrationRoute?.providerId === "local-runtime"
    && narrationRoute.modelId === "System.Speech.Synthesis"
    && narrationRoute.voiceId
    && curatedPairing.incompatibleWindowsVoiceIds.some((voiceId) => voiceId.localeCompare(narrationRoute.voiceId!, undefined, { sensitivity: "accent" }) === 0)
  ) {
    errors.push(`${curatedPairing.label} needs a compatible narration voice; choose ${curatedPairing.recommendedWindowsVoiceId} instead of ${narrationRoute.voiceId}.`);
  }
  if (
    curatedPairing?.recommendedElevenLabsVoiceId
    && narrationRoute?.providerId === "elevenlabs"
    && narrationRoute.voiceId?.trim()
    && narrationRoute.voiceId.trim() !== curatedPairing.recommendedElevenLabsVoiceId
  ) {
    warnings.push(`${curatedPairing.label} has a curated ElevenLabs pairing (${curatedPairing.recommendedElevenLabsVoiceId}); the selected override remains available for creative control.`);
  }
  if (!input.approvalChecked) {
    errors.push("Review and approve the named providers, retention boundary, and hard budget.");
  }

  const approvals: ProviderApproval[] = selectedProviders.map(([providerId, capabilities]) => {
    const descriptor = providerPolicies[providerId]!;
    const credential = input.secretRefs[providerId];
    if (descriptor.credential && credential?.availability !== "present") {
      errors.push(`${providerId} needs a credential in the OS vault before this profile can be approved.`);
    }
    const accountId = input.providerAccountIds?.[providerId]?.trim() || null;
    if (
      providerId === "cloudflare-workers-ai"
      && (accountId === null || !/^[A-Za-z0-9_-]{1,64}$/.test(accountId))
    ) {
      errors.push("Cloudflare Workers AI needs the Account ID from the Workers AI dashboard.");
    }
    return {
      providerId,
      capabilities: [...capabilities],
      credentialRef: descriptor.credential && credential?.availability === "present" ? credential.reference : null,
      boundary: descriptor.boundary,
      retention: descriptor.retention,
      regions: [...descriptor.regions],
      dataClasses: [input.dataClassification],
      privacyApproved: input.approvalChecked,
      retentionApproved: input.approvalChecked,
      regionApproved: input.approvalChecked,
      budgetApproved: input.approvalChecked,
      termsApproved: input.approvalChecked && providerId === "nvidia-nim",
      modelAccessCheckedAt: providerId === "nvidia-nim" && input.approvalChecked ? (input.reviewedAt ?? new Date().toISOString()) : null,
      ...(providerId === "cloudflare-workers-ai"
        ? { accountId }
        : {}),
    };
  });

  if (!routes.some((route) => route.capability === "audio.tts")) errors.push("The profile must include a narration route.");

  const uniqueErrors = [...new Set(errors)];
  const policy: TutorialRoutingPolicy | null = uniqueErrors.length ? null : {
    version: 1,
    privacyMode: privacy,
    dataClassification: input.dataClassification,
    budget: {
      currency: "USD",
      hardLimitMicros: input.hardLimitMinorUnits * 10_000,
      requireKnownPricing: true,
      approved: true,
    },
    approvals,
    routes,
  };
  const profileSnapshot: ProjectModelProfileSnapshot | null = policy ? {
    schemaVersion: 1,
    profileId: input.profile.id,
    profileName: input.profile.name,
    capturedAt: input.reviewedAt ?? new Date().toISOString(),
    ...(input.setupUpdatedAt ? { sourceSetupUpdatedAt: input.setupUpdatedAt } : {}),
    routes: snapshotRoutes,
  } : null;
  return {
    profile: input.profile,
    policy,
    privacy,
    approvedProviderIds: policy ? approvals.map((approval) => approval.providerId) : [],
    errors: uniqueErrors,
    warnings: [...new Set(warnings)],
    profileSnapshot,
    routeRows,
  };
}

function local(capabilities: ProviderCapability[]): ProviderPolicyDescriptor {
  return { boundary: "local", retention: "local_only", regions: ["local"], capabilities: new Set(capabilities), credential: false };
}

function cloud(retention: ProviderPolicyDescriptor["retention"], capabilities: ProviderCapability[], credential = true): ProviderPolicyDescriptor {
  return { boundary: "cloud", retention, regions: ["provider-managed"], capabilities: new Set(capabilities), credential };
}

function isDisabledModel(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return !normalized || normalized.startsWith("off") || normalized.startsWith("choose ");
}

function labelForMedium(medium: RouteMedium): string {
  return ({ writing: "Writing", research: "Research", images: "Images", motion: "Motion", voice: "Narration", transcription: "Transcription", presenter: "Presenter", portraitAnimation: "Portrait animation", lipSync: "Lip-sync", stock: "Stock media", visualReview: "Visual review" } satisfies Record<RouteMedium, string>)[medium];
}
