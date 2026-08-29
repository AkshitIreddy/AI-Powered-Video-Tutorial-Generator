import type {
  ModelProfile,
  ProviderApproval,
  ProviderCapability,
  ProviderSecretRef,
  TutorialRoutingPolicy,
} from "./native";

type RouteMedium = "writing" | "research" | "images" | "motion" | "voice" | "transcription" | "presenter";

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
};

const baselineRequiredMedia: RouteMedium[] = ["writing", "images", "voice"];

const providerPolicies: Record<string, ProviderPolicyDescriptor> = {
  "local-runtime": local(["llm.text", "llm.structured", "image.generate", "image.edit", "audio.tts", "audio.transcribe", "audio.align", "presenter.generate"]),
  "openai-compatible-local": local(["llm.text", "llm.structured"]),
  openai: cloud("configurable", ["llm.text", "llm.structured", "research.web", "image.generate", "image.edit", "audio.tts", "audio.transcribe"]),
  anthropic: cloud("configurable", ["llm.text", "llm.structured", "research.web"]),
  gemini: cloud("configurable", ["llm.text", "llm.structured", "research.web", "image.generate", "image.edit", "motion.generate", "audio.tts", "audio.transcribe"]),
  "nvidia-nim": cloud("provider_default", ["llm.text", "llm.structured", "vlm.chat", "retrieval.embed", "image.generate"]),
  "black-forest-labs": cloud("provider_default", ["image.generate", "image.edit"]),
  recraft: cloud("provider_default", ["image.generate", "image.edit"]),
  runway: cloud("provider_default", ["motion.generate"]),
  elevenlabs: cloud("provider_default", ["audio.tts", "audio.transcribe"]),
  "azure-speech": cloud("configurable", ["audio.tts", "audio.transcribe", "presenter.generate"]),
  "google-cloud-speech": cloud("configurable", ["audio.tts", "audio.transcribe", "audio.align"]),
  heygen: cloud("provider_default", ["presenter.generate"]),
  tavus: cloud("provider_default", ["presenter.generate"]),
};

export interface ProviderRoutingReview {
  profile: ModelProfile;
  policy: TutorialRoutingPolicy | null;
  privacy: TutorialRoutingPolicy["privacyMode"];
  approvedProviderIds: string[];
  errors: string[];
  warnings: string[];
  routeRows: Array<{ medium: string; providerId: string; modelId: string; boundary: "local" | "cloud" }>;
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
}): ProviderRoutingReview {
  const errors: string[] = [];
  const warnings: string[] = [];
  const routes: TutorialRoutingPolicy["routes"] = [];
  const routeRows: ProviderRoutingReview["routeRows"] = [];
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
    if (routedCapabilities.has(capability)) {
      warnings.push(`${labelForMedium(medium)} shares an existing ${capability} route and remains a profile-only preference.`);
      continue;
    }
    routedCapabilities.add(capability);
    routes.push({ capability, providerIds: [selection.providerId], model: selection.modelId, voice: medium === "voice" ? selection.modelId : null });
    routeRows.push({ medium: labelForMedium(medium), providerId: selection.providerId, modelId: selection.modelId, boundary: descriptor.boundary });
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
  if (!input.approvalChecked) {
    errors.push("Review and approve the named providers, retention boundary, and hard budget.");
  }

  const approvals: ProviderApproval[] = selectedProviders.map(([providerId, capabilities]) => {
    const descriptor = providerPolicies[providerId]!;
    const credential = input.secretRefs[providerId];
    if (descriptor.credential && credential?.availability !== "present") {
      errors.push(`${providerId} needs a credential in the OS vault before this profile can be approved.`);
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
    };
  });

  if (!routes.some((route) => route.capability === "image.generate")) errors.push("The profile must include an image generation route.");
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
  return {
    profile: input.profile,
    policy,
    privacy,
    approvedProviderIds: policy ? approvals.map((approval) => approval.providerId) : [],
    errors: uniqueErrors,
    warnings: [...new Set(warnings)],
    routeRows,
  };
}

function local(capabilities: ProviderCapability[]): ProviderPolicyDescriptor {
  return { boundary: "local", retention: "local_only", regions: ["local"], capabilities: new Set(capabilities), credential: false };
}

function cloud(retention: ProviderPolicyDescriptor["retention"], capabilities: ProviderCapability[]): ProviderPolicyDescriptor {
  return { boundary: "cloud", retention, regions: ["provider-managed"], capabilities: new Set(capabilities), credential: true };
}

function isDisabledModel(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return !normalized || normalized.startsWith("off") || normalized.startsWith("choose ");
}

function labelForMedium(medium: RouteMedium): string {
  return ({ writing: "Writing", research: "Research", images: "Images", motion: "Motion", voice: "Narration", transcription: "Transcription", presenter: "Presenter" } satisfies Record<RouteMedium, string>)[medium];
}
