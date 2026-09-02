import { adaptCuratedEntry, type CatalogCapability, type CatalogItem, type HardwareSnapshot } from "./catalog";
import type { DiagnosticReport } from "./native";

const GIB = 1024 ** 3;

interface RecipeCandidate {
  id: string;
  name: string;
  description: string;
  capabilities: readonly CatalogCapability[];
  runtime: string;
  vramGb: number | null;
  tags: readonly string[];
}

const recipeCandidates: readonly RecipeCandidate[] = [
  { id: "qwen3.5-9b-gguf", name: "Qwen3.5 9B GGUF", description: "Writing, structured output and visual-review candidate for a llama.cpp CUDA endpoint.", capabilities: ["llm.text", "llm.structured", "vlm.review"], runtime: "llama.cpp", vramGb: 8, tags: ["writing", "vision", "gguf"] },
  { id: "gemma-3-4b-it", name: "Gemma 3 4B IT", description: "Compact multimodal writing and review fallback; license review remains mandatory.", capabilities: ["llm.text", "llm.structured", "vlm.review"], runtime: "llama.cpp", vramGb: 5, tags: ["writing", "vision"] },
  { id: "phi-4-mini-instruct", name: "Phi-4 Mini Instruct", description: "Small writing and code-structure candidate.", capabilities: ["llm.text", "llm.structured"], runtime: "llama.cpp", vramGb: 4, tags: ["writing", "code"] },
  { id: "qwen2.5-coder-7b", name: "Qwen2.5 Coder 7B", description: "Specialist route for code explanations and trace generation.", capabilities: ["llm.text", "llm.structured"], runtime: "llama.cpp", vramGb: 7, tags: ["code", "tutorial"] },
  { id: "qwen3-embedding-0.6b", name: "Qwen3 Embedding 0.6B", description: "Small local retrieval-index worker.", capabilities: ["retrieval.embed"], runtime: "transformers", vramGb: 2, tags: ["embedding", "retrieval"] },
  { id: "bge-m3", name: "BGE-M3", description: "Multilingual dense and sparse retrieval candidate.", capabilities: ["retrieval.embed"], runtime: "transformers", vramGb: 3, tags: ["embedding", "multilingual"] },
  { id: "bge-reranker-v2-m3", name: "BGE Reranker v2 M3", description: "Local evidence-ranking companion for retrieval workflows.", capabilities: ["retrieval.embed"], runtime: "transformers", vramGb: 3, tags: ["reranker", "retrieval"] },
  { id: "flux2-klein-4b", name: "FLUX.2 Klein 4B", description: "Local illustration, editing and masked-repair workflow candidate.", capabilities: ["image.generate", "image.edit", "image.inpaint", "image.reference"], runtime: "comfyui", vramGb: 12, tags: ["image", "flux", "inpaint"] },
  { id: "qwen3-tts-0.6b", name: "Qwen3 TTS 0.6B", description: "Local multilingual narration candidate.", capabilities: ["audio.tts"], runtime: "python", vramGb: 4, tags: ["voice", "tts"] },
  { id: "kokoro", name: "Kokoro", description: "Small CPU-first draft narration route.", capabilities: ["audio.tts"], runtime: "onnxruntime", vramGb: null, tags: ["voice", "cpu"] },
  { id: "piper-voice-pack", name: "Piper Voice Pack", description: "Legacy draft voice route with per-voice rights review.", capabilities: ["audio.tts"], runtime: "onnxruntime", vramGb: null, tags: ["voice", "legacy"] },
  { id: "whisper-large-v3-turbo", name: "Whisper Large v3 Turbo", description: "Local transcription and timestamp candidate.", capabilities: ["audio.transcribe", "audio.align"], runtime: "faster-whisper", vramGb: 6, tags: ["asr", "captions"] },
  { id: "montreal-forced-aligner", name: "Montreal Forced Aligner", description: "Language-pack-aware narration and caption alignment route.", capabilities: ["audio.align"], runtime: "mfa", vramGb: null, tags: ["alignment", "captions"] },
  { id: "liveportrait", name: "LivePortrait", description: "Pose and expression animation companion; not audio lip-sync.", capabilities: ["portrait.animate"], runtime: "python", vramGb: 8, tags: ["presenter", "animation"] },
  { id: "stableavatar", name: "StableAvatar", description: "Talking-head research route requiring hardware qualification.", capabilities: ["presenter.generate", "portrait.animate"], runtime: "python", vramGb: 12, tags: ["presenter", "research"] },
  { id: "wav2lip-baseline", name: "Wav2Lip Baseline", description: "Legacy local lip-sync comparison route with rights review.", capabilities: ["lipsync.generate"], runtime: "python", vramGb: 4, tags: ["lipsync", "legacy"] },
  { id: "echomimicv3-flash", name: "EchoMimicV3 Flash", description: "Expressive talking-head benchmark target for selective presenter shots.", capabilities: ["presenter.generate", "portrait.animate", "lipsync.generate"], runtime: "python", vramGb: 12, tags: ["presenter", "lipsync"] },
  { id: "musetalk-1.5", name: "MuseTalk 1.5", description: "Face-region lip-sync benchmark route for short presenter shots.", capabilities: ["lipsync.generate"], runtime: "python", vramGb: 8, tags: ["lipsync", "fast"] },
  { id: "latentsync-1.5", name: "LatentSync 1.5", description: "Diffusion lip-sync quality-comparison route.", capabilities: ["lipsync.generate"], runtime: "python", vramGb: 12, tags: ["lipsync", "diffusion"] },
];

export const alystriaCatalogItems: readonly CatalogItem[] = recipeCandidates.map((candidate) => adaptCuratedEntry({
  id: `local/${candidate.id}`,
  providerId: "local",
  publisher: "Upstream publisher pending manifest sync",
  name: candidate.name,
  revision: "unpinned",
  capabilities: candidate.capabilities,
  artifactType: "workflow",
  modalities: modalities(candidate.capabilities),
  tags: candidate.tags,
  boundaries: ["local"],
  runtimes: [candidate.runtime],
  requirements: {
    estimatedVramBytes: candidate.vramGb === null ? null : candidate.vramGb * GIB,
    estimatedRamBytes: candidate.vramGb === null ? 4 * GIB : Math.max(8, candidate.vramGb) * GIB,
  },
  license: {
    identifier: null,
    name: "Resolve from immutable upstream revision",
    url: null,
    commercialUse: "unknown",
    attributionRequired: null,
    derivativesAllowed: null,
    hostingAllowed: null,
    status: "unknown",
    notes: ["This is an Alystria recipe candidate, not an installed model. Sync and review the exact upstream license before use."],
  },
  description: candidate.description,
  sourceUrl: `https://huggingface.co/models?search=${encodeURIComponent(candidate.name)}`,
  testedRecipeIds: [],
  publisherVerifiedBySource: null,
  retrievedAt: "2026-09-02T00:00:00.000Z",
}));

export function catalogHardwareFromDiagnostics(report: DiagnosticReport | null): HardwareSnapshot {
  const primary = report?.system.gpu[0];
  const gpuName = primary?.name ?? "";
  return {
    operatingSystem: "windows",
    gpuVendor: /nvidia/iu.test(gpuName) ? "nvidia" : /amd|radeon/iu.test(gpuName) ? "amd" : /intel/iu.test(gpuName) ? "intel" : gpuName ? "unknown" : "none",
    gpuNames: report?.system.gpu.map((gpu) => gpu.name) ?? [],
    dedicatedVramBytes: primary?.dedicatedMemoryBytes ?? null,
    dedicatedVramFreeBytes: null,
    dxgiBudgetBytes: null,
    dxgiCurrentUsageBytes: null,
    systemRamBytes: report?.system.totalMemoryBytes ?? 0,
    systemRamFreeBytes: report?.system.availableMemoryBytes ?? 0,
    driverVersion: primary?.driverVersion ?? null,
    installedRuntimes: {},
    providerConnectionIds: [],
    capturedAt: report?.generatedAt ?? new Date().toISOString(),
  };
}

function modalities(capabilities: readonly CatalogCapability[]): ("text" | "image" | "audio" | "video" | "multimodal")[] {
  const values = new Set<"text" | "image" | "audio" | "video" | "multimodal">();
  for (const capability of capabilities) {
    if (capability.startsWith("llm") || capability.startsWith("research") || capability.startsWith("retrieval")) values.add("text");
    if (capability.startsWith("image")) values.add("image");
    if (capability.startsWith("audio")) values.add("audio");
    if (capability.startsWith("video") || capability.startsWith("presenter") || capability.startsWith("portrait") || capability.startsWith("lipsync")) values.add("video");
    if (capability === "vlm.review") values.add("multimodal");
  }
  return [...values];
}
