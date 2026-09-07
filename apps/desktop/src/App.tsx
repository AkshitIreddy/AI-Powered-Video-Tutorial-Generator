import {
  Activity,
  AlignLeft,
  Archive,
  ArrowLeft,
  ArrowRight,
  AudioLines,
  BadgeCheck,
  BookOpen,
  Braces,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleDollarSign,
  CircleHelp,
  Clock3,
  Cloud,
  Cpu,
  Download,
  Eye,
  FileCheck2,
  FileText,
  Film,
  FolderClock,
  Gauge,
  Globe2,
  HardDrive,
  History,
  Home,
  Image,
  KeyRound,
  Languages,
  Layers3,
  Library,
  Link2,
  Lock,
  Menu,
  MessageSquareText,
  Mic2,
  MonitorPlay,
  Moon,
  MoreHorizontal,
  Network,
  PackageCheck,
  PanelRightClose,
  Pause,
  Pencil,
  Play,
  PlayCircle,
  Plus,
  Presentation,
  Redo2,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  SquareStack,
  Star,
  TableProperties,
  TextCursorInput,
  TimerReset,
  Undo2,
  Upload,
  UserRoundCheck,
  Video,
  WandSparkles,
  Wind,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import appMark from "./assets/ai-video-tutorial-generator-mark.svg";
import { LessonLab } from "./LessonLab";
import { TemplateArt } from "./TemplateArt";
import academicEvidenceBackground from "./assets/backgrounds/academic-evidence-paper-v1.png";
import modernSignalBackground from "./assets/backgrounds/modern-tech-signal-v1.png";
import playfulPaperBackground from "./assets/backgrounds/playful-paper-cut-v1.png";
import explainHardIdeaTemplate from "./assets/templates/explain-hard-idea-v1.webp";
import traceAlgorithmTemplate from "./assets/templates/trace-algorithm-v1.webp";
import evidenceHistoryTemplate from "./assets/templates/evidence-history-v1.webp";
import workedDerivationTemplate from "./assets/templates/worked-derivation-v1.webp";
import productWalkthroughTemplate from "./assets/templates/product-walkthrough-v1.webp";
import youngLearnerTemplate from "./assets/templates/young-learner-story-v1.webp";
import academicAmara from "./assets/presenters/academic-amara-v1.webp";
import documentaryMalik from "./assets/presenters/documentary-malik-v1.webp";
import mathematicsArjun from "./assets/presenters/mathematics-arjun-v1.webp";
import modernMinji from "./assets/presenters/modern-tech-minji-v1.webp";
import playfulLucia from "./assets/presenters/playful-lucia-v1.webp";
import scienceZara from "./assets/presenters/science-zara-v1.webp";
import animeAstrid from "./assets/presenters/anime-astrid-v1.webp";
import animatedTheo from "./assets/presenters/animated-feature-theo-v1.webp";
import broadcastElena from "./assets/presenters/broadcast-elena-v1.webp";
import cartoonOliver from "./assets/presenters/cartoon-oliver-v1.webp";
import charcoalMarta from "./assets/presenters/charcoal-marta-v1.webp";
import clayNora from "./assets/presenters/clay-nora-v1.webp";
import graphicLuca from "./assets/presenters/graphic-novel-luca-v1.webp";
import holographicSelene from "./assets/presenters/holographic-selene-v1.webp";
import inkRoman from "./assets/presenters/ink-roman-v1.webp";
import oilHelena from "./assets/presenters/oil-painting-helena-v1.webp";
import papercutCelia from "./assets/presenters/papercut-celia-v1.webp";
import retroFelix from "./assets/presenters/retro-orbit-felix-v1.webp";
import vectorAvery from "./assets/presenters/vector-avery-v1.webp";
import watercolorElisabeth from "./assets/presenters/watercolor-elisabeth-v1.webp";
import educatorMaya from "./assets/presenters/educator-maya-v2.webp";
import animeHana from "./assets/presenters/anime-hana-v1.webp";
import animeKenji from "./assets/presenters/anime-kenji-v1.webp";
import cartoonCamille from "./assets/presenters/cartoon-camille-v1.webp";
import cartoonElias from "./assets/presenters/cartoon-elias-v1.webp";
import softwareDaniel from "./assets/presenters/software-daniel-v1.webp";
import sciencePriya from "./assets/presenters/science-priya-v1.webp";
import languageSofia from "./assets/presenters/language-sofia-v1.webp";
import historyMarcus from "./assets/presenters/history-marcus-v1.webp";
import youngLearnersLily from "./assets/presenters/young-learners-lily-v1.webp";
import { completeExampleProject, defaultSnapshot, templates } from "./data";
import { persistReviewedGenerationApproval, type FrozenGenerationReview } from "./generationApproval";
import {
  createGuidedTourReplaySteps,
  guidedTourCompletionKey,
  GuidedTour,
  OnboardingDialog,
  useOnboardingController,
  type AccountProfileConfiguration,
  type GuidedTourStep,
  type OnboardingCatalog,
  type OnboardingSetupState,
  type PersistedOnboardingState,
} from "./onboarding";
import {
  appBootstrap,
  catalogDiscover,
  desktopShutdown,
  desktopEnvironment,
  diagnosticsRun,
  editorBindingsGet,
  editorWaveformGet,
  editorTimelineExport,
  generationApprove,
  generationStart,
  jobCancel,
  jobRetry,
  jobStatus,
  localModelSetupGet,
  localModelSetupSave,
  localModelDownloadCatalog,
  localModelDownloadStart,
  localModelDownloadStatus,
  masterExport,
  projectCreate,
  projectAssetImport,
  projectAssetResolve,
  projectCustomizationSave,
  projectExportArchive,
  projectOpen,
  projectHistoryRedo,
  projectHistoryUndo,
  projectSnapshotGet,
  projectSnapshotSave,
  providerSecretDelete,
  providerRoutingPolicySave,
  providerSecretSet,
  providerSecretStatus,
  qaRepair,
  sceneRegenerate,
  sceneCandidateAccept,
  searchVisualCandidates,
  sceneRender,
  sourceImport,
  type BootstrapInfo,
  type CatalogDiscoveryResponse,
  type AssetPermission,
  type DiagnosticReport,
  type GroundingMode,
  type JobReceipt,
  type LocalModelSetup,
  type ModelDownloadCatalogEntry,
  type ModelDownloadStatus,
  type MasterExportRequest,
  type ModelProfile,
  type ProjectAssetImportReceipt,
  type ProviderSecretRef,
  type TutorialRoutingPolicy,
  type QualityPreset,
  type SourceImportReceipt,
} from "./native";
import { buildProviderRoutingReview } from "./providerRouting";
import { CreativeInspector } from "./creative/CreativeInspector";
import { DEFAULT_CREATIVE_CONFIGURATION } from "./creative/defaults";
import {
  CatalogIntegrationExample,
  ProviderMark,
  adaptCivitaiModel,
  adaptCloudEndpoint,
  adaptHuggingFaceModel,
  adaptNvidiaCatalogEntry,
  defaultCatalogSources,
  stageCatalogWritingModel,
  type CatalogCapability,
  type CatalogItem,
  type CloudCatalogEndpoint,
  type RawCivitaiModel,
  type RawCivitaiModelVersion,
  type RawHuggingFaceModel,
  type RawNvidiaCatalogEntry,
} from "./catalog";
import { alystriaCatalogItems, catalogHardwareFromDiagnostics } from "./appCatalog";
import { AdvancedVideoEditor, BrowserMediaImportController, createEditorProjectFromAlystriaProject, editorTimelineExportResult, exportEditorTimelineNative, mergeAlystriaMediaBindings, prepareEditorProjectForPersistence, type EditorProject } from "./editor";
import { importNativeEditorMedia, resolveNativeEditorMedia } from "./nativeEditorMedia";
import { resolveEditorWaveformNative, type EditorMediaAsset } from "./editor";
import { VisualCandidateReview } from "./VisualCandidateReview";
import { RenderedFrameReviewPanel } from "./RenderedFrameReviewPanel";
import { StockImageSearch } from "./StockImageSearch";
import type { StockProvider } from "./stockSearchRoutes";
import { visualCandidates, type VisualCandidate } from "./visualCandidates";
import { BundledAssetLibrary } from "./BundledAssetLibrary";
import { presenterCollection } from "./presenterCollection";
import { BUILT_IN_STARTER_KIT } from "@alystria/themes";
import { watchRuntimeBootstrap } from "./runtimeBootstrap";
import { bundledAssets, importBundledAsset, type BundledAsset } from "./bundledAssets";
import {
  canonicalFixtureIdFromTopic,
  hydrateDurableProject,
  isDurableNativeJob,
  normalizeAppSnapshot,
  projectTitleFromTopic,
} from "./project-utils";
import { SharedScenePreview } from "./ScenePreview";
import type {
  AppSnapshot,
  CanvasCustomization,
  CreativeConfiguration,
  GlobalArea,
  JobRecord,
  ProjectRecord,
  Scene,
  StudioAssetKind,
  StudioAssetReference,
  StudioMode,
  ToastMessage,
  TutorialMode,
  Workspace,
} from "./types";
import { usePersistentState } from "./usePersistentState";
import { EditorDocumentSaveQueue, createEditorCloseHandler, mergeGeneralProjectSnapshot, type EditorSaveStatus } from "./editorSaveLifecycle";

interface RuntimeState {
  environment: ReturnType<typeof desktopEnvironment>;
  bootstrap: BootstrapInfo | null;
  loading: boolean;
  error: string | null;
}

interface NativeJobLink {
  projectId: string;
  projectDirectory: string;
  jobId: string;
}

interface TutorialCreationSettings {
  grounding: GroundingMode;
  quality: QualityPreset;
  sourceFiles: File[];
  routingPolicy: TutorialRoutingPolicy;
  approvedProviderIds: string[];
  privacy: TutorialRoutingPolicy["privacyMode"];
  hardLimitMinorUnits: number;
}

const ONBOARDING_STORAGE_KEY = "alystria-onboarding-v1";

function persistedOnboardingState(): PersistedOnboardingState | null {
  try {
    const value = localStorage.getItem(ONBOARDING_STORAGE_KEY);
    return value ? JSON.parse(value) as PersistedOnboardingState : null;
  } catch {
    return null;
  }
}

type CaptionDeliveryMode = MasterExportRequest["captionDeliveryMode"];
type CodecPreference = "h264-hardware" | "hevc-hardware" | "av1";
type ExportRequestSettings = Pick<MasterExportRequest, "aspect" | "resolution" | "fps" | "captionDeliveryMode" | "transcript" | "bibliography"> & {
  codecPreference: CodecPreference;
};

const globalNav: Array<{ id: GlobalArea; label: string; icon: LucideIcon }> = [
  { id: "home", label: "Home", icon: Home },
  { id: "projects", label: "Projects", icon: FolderClock },
  { id: "templates", label: "Templates", icon: SquareStack },
  { id: "library", label: "Library", icon: Library },
  { id: "providers", label: "Models & providers", icon: Cpu },
  { id: "diagnostics", label: "Settings & diagnostics", icon: Settings2 },
];

const projectNav: Array<{ id: Workspace; label: string; icon: LucideIcon }> = [
  { id: "plan", label: "Plan", icon: BookOpen },
  { id: "storyboard", label: "Storyboard", icon: Layers3 },
  { id: "studio", label: "Studio", icon: MonitorPlay },
  { id: "review", label: "Review", icon: BadgeCheck },
  { id: "export", label: "Export", icon: Download },
];

const CAPTION_DELIVERY_OPTIONS: Array<{
  id: CaptionDeliveryMode;
  label: string;
  eyebrow: string;
  detail: string;
  icon: LucideIcon;
}> = [
  { id: "sidecar", label: "Sidecar files", eyebrow: "Recommended", detail: "Clean video + UTF-8 YouTube SRT + WebVTT", icon: FileText },
  { id: "embedded", label: "Selectable track", eyebrow: "Soft captions", detail: "Clean video + player-controlled track + sidecars", icon: MonitorPlay },
  { id: "burned", label: "Open captions", eyebrow: "Always visible", detail: "Captions in the picture + sidecars", icon: TextCursorInput },
  { id: "both", label: "Open + selectable", eyebrow: "Maximum compatibility", detail: "Burned and soft tracks + sidecars", icon: Layers3 },
];

const PRODUCT_NAME = "AI Video Tutorial Generator";

const providerConfigs = [
  { id: "local", name: "Local models", icon: HardDrive, detail: "Qwen · Whisper · Kokoro", tone: "teal", local: true },
  { id: "openai", name: "OpenAI", icon: Sparkles, detail: "Language · images · speech", tone: "indigo" },
  { id: "anthropic", name: "Anthropic", icon: MessageSquareText, detail: "Language and structured review", tone: "amber" },
  { id: "groq", name: "Groq", icon: Zap, detail: "GPT-OSS 20B or 120B structured writing", tone: "amber" },
  { id: "mistral", name: "Mistral AI", icon: Wind, detail: "Mistral Small 4 structured writing", tone: "indigo" },
  { id: "openrouter", name: "OpenRouter", icon: Network, detail: "Vetted free structured-output route", tone: "teal" },
  { id: "cohere", name: "Cohere", icon: Layers3, detail: "Command · Embed · Rerank", tone: "teal" },
  { id: "gemini", name: "Google AI", icon: Globe2, detail: "Gemini language and structured output", tone: "neutral" },
  { id: "nvidia-nim", name: "NVIDIA NIM (dev/test)", icon: Cpu, detail: "One key · public/synthetic hosted previews · internal evaluation only; outputs cannot be published or used in production", tone: "teal" },
  { id: "cloudflare-workers-ai", name: "Cloudflare Workers AI", icon: Cloud, detail: "Exact FLUX.1 Schnell image route · Account ID required", tone: "amber" },
  { id: "black-forest-labs", name: "Black Forest Labs", icon: Image, detail: "FLUX image generation and editing", tone: "neutral" },
  { id: "recraft", name: "Recraft", icon: Sparkles, detail: "Illustration and design assets", tone: "indigo" },
  { id: "elevenlabs", name: "ElevenLabs", icon: Mic2, detail: "Voices and narration", tone: "neutral" },
  { id: "azure-speech", name: "Azure Speech", icon: AudioLines, detail: "Speech and transcription", tone: "neutral" },
  { id: "google-cloud-speech", name: "Google Cloud Speech", icon: Languages, detail: "Speech and transcription", tone: "neutral" },
  { id: "runway", name: "Runway", icon: Video, detail: "Selective generated motion", tone: "neutral" },
  { id: "heygen", name: "HeyGen", icon: UserRoundCheck, detail: "Consent-gated presenter clips", tone: "amber" },
  { id: "tavus", name: "Tavus", icon: Presentation, detail: "Consent-gated presenter clips", tone: "amber" },
] satisfies Array<{ id: string; name: string; icon: LucideIcon; detail: string; tone: string; local?: boolean }>;

const localModelOptions = [
  { id: "local/qwen3.5-9b-gguf", name: "Qwen3.5 9B", medium: "Writing & vision", detail: "CUDA 12 llama.cpp · headless endpoint · benchmark before enable" },
  { id: "local/gemma-3-4b-it", name: "Gemma 3 4B IT", medium: "Writing & vision", detail: "Compact fallback · license review required" },
  { id: "local/phi-4-mini-instruct", name: "Phi-4 mini", medium: "Writing & code", detail: "Small MIT candidate · pin before enable" },
  { id: "local/qwen2.5-coder-7b", name: "Qwen2.5 Coder 7B", medium: "Code tutorials", detail: "Specialist candidate · load instead of main LLM" },
  { id: "local/qwen3-embedding-0.6b", name: "Qwen3 Embedding 0.6B", medium: "Research retrieval", detail: "Small local index worker" },
  { id: "local/bge-m3", name: "BGE-M3", medium: "Multilingual retrieval", detail: "Dense / sparse candidate" },
  { id: "local/bge-reranker-v2-m3", name: "BGE reranker v2-m3", medium: "Research ranking", detail: "Small local reranker candidate" },
  { id: "local/qwen3-reranker-0.6b", name: "Qwen3 Reranker 0.6B", medium: "Research ranking", detail: "Alternative local reranker" },
  { id: "local/flux.2-klein-4b-fp8", name: "FLUX.2 Klein 4B", medium: "Illustration", detail: "Optional 12 GB benchmark" },
  { id: "local/Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice", name: "Qwen3 TTS 0.6B", medium: "Narration", detail: "English / Spanish candidate" },
  { id: "local/kokoro", name: "Kokoro", medium: "Draft narration", detail: "Small CPU-first draft voice" },
  { id: "local/piper-voice-pack", name: "Piper voice pack", medium: "Legacy draft voice", detail: "Optional only · per-voice rights review" },
  { id: "local/whisper-large-v3-turbo", name: "Whisper large-v3-turbo", medium: "Transcription", detail: "Local ASR & timing candidate" },
  { id: "local/montreal-forced-aligner", name: "Montreal Forced Aligner", medium: "Caption alignment", detail: "Language-pack and license review" },
  { id: "local/liveportrait", name: "LivePortrait", medium: "Pose, gaze & expression", detail: "Measured at 2.7 GB peak VRAM on this PC" },
  { id: "local/longcat-avatar-1.5", name: "LongCat Video Avatar 1.5", medium: "Unified presenter generation", detail: "Large opt-in quality route · roughly 32 GB installed" },
  { id: "local/stableavatar", name: "StableAvatar", medium: "Talking-head research", detail: "Offload candidate · benchmark before enable" },
  { id: "local/wav2lip-baseline", name: "Wav2Lip baseline", medium: "Lip-sync fallback", detail: "Legacy baseline · rights review required" },
] as const;

const lipSyncModelOptions = [
  { id: "local/musetalk-1.5", name: "MuseTalk 1.5", detail: "Narration-accurate mouth pass · measured below 8 GB VRAM", tag: "Measured local choice" },
  { id: "local/latentsync-1.5", name: "LatentSync 1.5", detail: "Slower diffusion comparison · version 1.5 only", tag: "Quality comparison" },
  { id: "local/nvidia-lipsync-private", name: "NVIDIA LipSync", detail: "Private-access local NIM sidecar; hosted NIM key does not unlock it", tag: "Separate access" },
] as const;

const portraitAnimationModelOptions = [
  { id: "local/liveportrait", name: "LivePortrait", detail: "Native gaze, blink, expression, head and shoulder motion", tag: "Best local default" },
  { id: "local/longcat-avatar-1.5", name: "LongCat Video Avatar 1.5", detail: "Unified audio-driven avatar · 13.6B INT8 · large install", tag: "High-compute option" },
  { id: "local/echomimicv3-flash", name: "EchoMimicV3 Flash", detail: "Committed about 46 GB RAM and never reached frame one here", tag: "Blocked on this PC" },
  { id: "local/hunyuan-video-avatar", name: "HunyuanVideo-Avatar", detail: "Official runtime requires at least 24 GB VRAM", tag: "Cloud / larger GPU" },
  { id: "local/infinitetalk", name: "InfiniteTalk", detail: "Older 30-step 14B route superseded by LongCat 1.5", tag: "Legacy comparison" },
] as const;

const profileMediums = [
  ["writing", "Writing & review"],
  ["research", "Research"],
  ["images", "Images"],
  ["stock", "Stock photos"],
  ["visualReview", "Image review"],
  ["motion", "Motion"],
  ["voice", "Narration"],
  ["transcription", "Transcription"],
  ["presenter", "Presenter"],
  ["portraitAnimation", "Portrait animation"],
  ["lipSync", "Lip-sync"],
] as const;

const profileProviderOptions = [
  ["local-runtime", "Local runtime"],
  ["openai", "OpenAI"],
  ["anthropic", "Anthropic"],
  ["groq", "Groq"],
  ["mistral", "Mistral AI"],
  ["openrouter", "OpenRouter"],
  ["cohere", "Cohere"],
  ["gemini", "Google Gemini"],
  ["nvidia-nim", "NVIDIA NIM (public/synthetic preview)"],
  ["cloudflare-workers-ai", "Cloudflare Workers AI"],
  ["elevenlabs", "ElevenLabs"],
  ["azure-speech", "Azure Speech"],
  ["google-cloud-speech", "Google Cloud Speech"],
  ["runway", "Runway"],
  ["heygen", "HeyGen"],
  ["tavus", "Tavus"],
  ["black-forest-labs", "Black Forest Labs"],
  ["recraft", "Recraft"],
  ["openverse", "Openverse licensed media"],
  ["pexels", "Pexels licensed media"],
  ["openai-compatible-local", "LM Studio / llama.cpp local endpoint"],
] as const;
const profileProviderIds = profileProviderOptions.map(([id]) => id);

const SOURCE_FILE_ACCEPT = ".pdf,.docx,.pptx,.epub,.md,.markdown,.txt,.csv,.json";
const MAX_SOURCE_FILE_BYTES = 8 * 1024 * 1024;
const MAX_STUDIO_ASSET_BYTES = 24 * 1024 * 1024;

const DEFAULT_CANVAS_CUSTOMIZATION: CanvasCustomization = {
  fontPairId: "editorial",
  displayFont: "Bricolage Grotesque",
  bodyFont: "Atkinson Hyperlegible Next",
  typeScale: 100,
  lineHeight: "balanced",
  fonts: { displayAssetId: null, bodyAssetId: null },
  paletteId: "precision",
  colors: { paper: "#F7F8FC", ink: "#151827", accent: "#5658E8", evidence: "#168F88" },
  backgroundMode: "paper",
  backgroundAssetId: null,
  materialStrength: 28,
  density: "balanced",
  contrast: "standard",
  reducedMotion: false,
  sceneTreatment: "edge-to-edge",
  cornerRadius: 14,
  shadowStrength: 24,
  captions: {
    position: "auto",
    style: "soft-panel",
    size: 100,
    safeInset: 8,
    textColor: "#FFFFFF",
    panelColor: "#151827",
    maxLines: 2,
  },
  presenter: {
    assetId: null,
    placement: "off",
    side: "right",
    scale: 72,
    crop: "portrait",
    frame: "soft",
    idleAnimation: true,
    blink: true,
    breathing: true,
    restMouth: "closed",
    voiceDirection: "Neutral adult teaching voice · clear, conversational, medium pace",
    preferredVoiceId: null,
  },
  audio: {
    musicAssetId: null,
    sfxAssetId: null,
    musicLevel: 12,
    sfxLevel: 28,
    narrationDucking: 72,
  },
  assets: [
    starterAsset("presenter-portrait.educator-maya-v2", "presenter", "Maya · mathematics educator", `${PRODUCT_NAME} image generation`, "LicenseRef-USER-OWNED", "15d33bfa90ec87899c949eb8a79aa9ddc83659e960769843f5bab2933de4ee02", 99766, "image/webp"),
    starterAsset("presenter-portrait.software-daniel-v1", "presenter", "Daniel · software instructor", `${PRODUCT_NAME} image generation`, "LicenseRef-USER-OWNED", "1d255bf5667329819cb7783d799a32adf2185efe643436e1e3e2d7651bc597ce", 32826, "image/webp"),
    starterAsset("presenter-portrait.science-priya-v1", "presenter", "Priya · science educator", `${PRODUCT_NAME} image generation`, "LicenseRef-USER-OWNED", "19721ae4c93b76b372eb9d4cf1b26974b345e9677f26a638c465cafdd1185ea3", 36586, "image/webp"),
    starterAsset("presenter-portrait.language-sofia-v1", "presenter", "Sofia · language tutor", `${PRODUCT_NAME} image generation`, "LicenseRef-USER-OWNED", "75c5d75b054a3a5bcbfc21bb9ba3c333f9159fd2920a3013ec26fd9ef54fbea1", 44438, "image/webp"),
    starterAsset("presenter-portrait.history-marcus-v1", "presenter", "Marcus · history lecturer", `${PRODUCT_NAME} image generation`, "LicenseRef-USER-OWNED", "cfc35183bfc070e357fd17b65e951466846e346e056d9cd38b831bbb4e49f5dc", 42600, "image/webp"),
    starterAsset("presenter-portrait.young-learners-lily-v1", "presenter", "Lily · young-learner creator", `${PRODUCT_NAME} image generation`, "LicenseRef-USER-OWNED", "0fd052fc986e361881c9e3c6f336e8b4b09629189dc1fb0be1a65abc65939042", 50634, "image/webp"),
    starterAsset("presenter-portrait.academic-amara-v1", "presenter", "Amara · academic", `${PRODUCT_NAME} image generation`, "LicenseRef-USER-OWNED", "97067bcbeea43e043089692aa3b920ac5bd77cdd9cdb21b78ddc1f50af5221b5", 32206, "image/webp"),
    starterAsset("presenter-portrait.modern-tech-minji-v1", "presenter", "Minji · modern tech", `${PRODUCT_NAME} image generation`, "LicenseRef-USER-OWNED", "2cc8d2f36c307de9c5c5833908e98736885328671a95a56b6f6e81068e66ae64", 18782, "image/webp"),
    starterAsset("presenter-portrait.documentary-malik-v1", "presenter", "Malik · documentary", `${PRODUCT_NAME} image generation`, "LicenseRef-USER-OWNED", "ce6131d0b34c2ef033e60d4acf6f8356c21cc053787389eef1f6d95e84ed80dd", 39650, "image/webp"),
    starterAsset("presenter-portrait.playful-lucia-v1", "presenter", "Lucia · playful", `${PRODUCT_NAME} image generation`, "LicenseRef-USER-OWNED", "00c1eb046d9782f0446fb73635372cd5b4237752a89a4f72d3d142fde9b4ccb2", 41080, "image/webp"),
    starterAsset("presenter-portrait.science-zara-v1", "presenter", "Zara · science", `${PRODUCT_NAME} image generation`, "MIT", "f9526f5e1996d4ee0ec7e2461399264a8309a2cee3d08e9fcf1daf0fc915e250", 34824, "image/webp"),
    starterAsset("presenter-portrait.mathematics-arjun-v1", "presenter", "Arjun · mathematics", `${PRODUCT_NAME} image generation`, "MIT", "c12e626dfefce0a8e7c153fb0ec192f127a7feeb49f8ba21c1a620ef6f54d30e", 30902, "image/webp"),
    starterAsset("presenter-portrait.broadcast-elena-v1", "presenter", "Elena · news anchor", `${PRODUCT_NAME} image generation`, "LicenseRef-USER-OWNED"),
    starterAsset("presenter-portrait.anime-astrid-v1", "presenter", "Astrid · anime editorial", `${PRODUCT_NAME} image generation`, "LicenseRef-USER-OWNED"),
    starterAsset("presenter-portrait.graphic-luca-v1", "presenter", "Luca · graphic novel", `${PRODUCT_NAME} image generation`, "LicenseRef-USER-OWNED"),
    starterAsset("presenter-portrait.clay-nora-v1", "presenter", "Nora · tactile clay", `${PRODUCT_NAME} image generation`, "LicenseRef-USER-OWNED"),
    starterAsset("presenter-portrait.watercolor-elisabeth-v1", "presenter", "Elisabeth · watercolor", `${PRODUCT_NAME} image generation`, "LicenseRef-USER-OWNED"),
    starterAsset("presenter-portrait.animated-theo-v1", "presenter", "Theo · stylized 3D", `${PRODUCT_NAME} image generation`, "LicenseRef-USER-OWNED"),
    starterAsset("presenter-portrait.retro-felix-v1", "presenter", "Felix · retro orbit", `${PRODUCT_NAME} image generation`, "LicenseRef-USER-OWNED"),
    starterAsset("presenter-portrait.holographic-selene-v1", "presenter", "Selene · holographic", `${PRODUCT_NAME} image generation`, "LicenseRef-USER-OWNED"),
    starterAsset("presenter-portrait.papercut-celia-v1", "presenter", "Celia · paper cut", `${PRODUCT_NAME} image generation`, "LicenseRef-USER-OWNED"),
    starterAsset("presenter-portrait.ink-roman-v1", "presenter", "Roman · ink editorial", `${PRODUCT_NAME} image generation`, "LicenseRef-USER-OWNED"),
    starterAsset("presenter-portrait.oil-helena-v1", "presenter", "Helena · oil portrait", `${PRODUCT_NAME} image generation`, "LicenseRef-USER-OWNED"),
    starterAsset("presenter-portrait.vector-avery-v1", "presenter", "Avery · vector editorial", `${PRODUCT_NAME} image generation`, "LicenseRef-USER-OWNED"),
    starterAsset("presenter-portrait.cartoon-oliver-v1", "presenter", "Oliver · drawn classroom", `${PRODUCT_NAME} image generation`, "LicenseRef-USER-OWNED"),
    starterAsset("presenter-portrait.charcoal-marta-v1", "presenter", "Marta · charcoal", `${PRODUCT_NAME} image generation`, "LicenseRef-USER-OWNED"),
    starterAsset("presenter-portrait.anime-hana-v1", "presenter", "Hana · anime mathematics tutor", `${PRODUCT_NAME} image generation`, "LicenseRef-USER-OWNED", "26d63abe834a25eaa6be5c9d771c0568e53f161235ae103cf3bdbce2d96312e8", 109414, "image/webp"),
    starterAsset("presenter-portrait.anime-kenji-v1", "presenter", "Kenji · anime coding mentor", `${PRODUCT_NAME} image generation`, "LicenseRef-USER-OWNED", "52746b517c6d01a6397a5e6e3d9ec34e48575a8752b6d968cb2a2189ef125f92", 124942, "image/webp"),
    starterAsset("presenter-portrait.cartoon-camille-v1", "presenter", "Camille · cartoon physics maker", `${PRODUCT_NAME} image generation`, "LicenseRef-USER-OWNED", "22af5557ee1b924e3d33a61a15ef5c2e5f112522ec2389b862194b61382c2a19", 315578, "image/webp"),
    starterAsset("presenter-portrait.cartoon-elias-v1", "presenter", "Elias · cartoon design historian", `${PRODUCT_NAME} image generation`, "LicenseRef-USER-OWNED", "fa43c1c968f97a6d164981b6229e24661d6fa429fabdb49955c7f80c8413551d", 201138, "image/webp"),
    starterAsset("background.academic-evidence-paper-v1", "background", "Academic evidence paper", `${PRODUCT_NAME} image generation`, "LicenseRef-USER-OWNED", "1ba1306b0eb2dc4af7d0c04b7e7785ed27febf2a12922c91110770c13dc155ca", 2001277, "image/png"),
    starterAsset("background.modern-tech-signal-v1", "background", "Modern signal", `${PRODUCT_NAME} image generation`, "LicenseRef-USER-OWNED", "49e8abe6ba85052c6f74c022b468ebd983460600912f3e77b4b0fd301fc3a66d", 1268644, "image/png"),
    starterAsset("background.playful-paper-cut-v1", "background", "Playful paper cut", `${PRODUCT_NAME} image generation`, "LicenseRef-USER-OWNED", "52f98ff2927c5f73d4518e25d70a9d93e42044e4b3363bcccd06a2f0a5471806", 1892657, "image/png"),
    starterAsset("music-none", "music", "No music", PRODUCT_NAME, "MIT"),
    starterAsset("starter.audio.music.focus-loop", "music", "Focus loop", PRODUCT_NAME, "MIT", "4552ed81a04c045d5a135ef312fccf470a69041b2da9569d339b0ecf308114f5", 3456044, "audio/wav"),
    starterAsset("starter.audio.music.inquiry-loop", "music", "Inquiry loop", PRODUCT_NAME, "MIT", "a9fc0088c9a10624bacde27be451ce1865d28986b92189daae4126c5fd29a00d", 3456044, "audio/wav"),
    starterAsset("starter.audio.sfx.emphasis-a", "sfx", "Quiet teaching cue", PRODUCT_NAME, "MIT", "19d1dc64015c1b527b44fdc74e30f8becc976a6ea39e6644f11fee0564d26c29", 161324, "audio/wav"),
    starterAsset("starter.audio.sfx.emphasis-b", "sfx", "Technical emphasis", PRODUCT_NAME, "MIT", "92774860b29adf231e3c8c5b7da7e0cd6e222ba6fc711358496404244f0ec50b", 161324, "audio/wav"),
    starterAsset("sfx-none", "sfx", "No sound cues", PRODUCT_NAME, "MIT"),
  ],
};

const FONT_PAIRS: Array<Pick<CanvasCustomization, "fontPairId" | "displayFont" | "bodyFont"> & { name: string; note: string }> = [
  { fontPairId: "editorial", name: "Precision editorial", displayFont: "Bricolage Grotesque", bodyFont: "Atkinson Hyperlegible Next", note: "Distinctive titles, highly legible teaching copy" },
  { fontPairId: "humanist", name: "Humanist classroom", displayFont: "Atkinson Hyperlegible Next", bodyFont: "Atkinson Hyperlegible Next", note: "Quiet, accessible, and multilingual" },
  { fontPairId: "technical", name: "Technical notebook", displayFont: "JetBrains Mono", bodyFont: "Atkinson Hyperlegible Next", note: "Code-forward structure with calm prose" },
  { fontPairId: "cinematic", name: "Cinematic lecture", displayFont: "Bricolage Grotesque", bodyFont: "Bricolage Grotesque", note: "Large, concise statements and slower pacing" },
];

const PALETTE_PRESETS: Array<{ id: CanvasCustomization["paletteId"]; name: string; colors: CanvasCustomization["colors"] }> = [
  { id: "precision", name: "Precision paper", colors: { paper: "#F7F8FC", ink: "#151827", accent: "#5658E8", evidence: "#168F88" } },
  { id: "midnight", name: "Midnight lab", colors: { paper: "#111522", ink: "#F4F5FB", accent: "#8C8EFF", evidence: "#43C2B8" } },
  { id: "field-notes", name: "Field notes", colors: { paper: "#F4F0E5", ink: "#27291F", accent: "#416C57", evidence: "#A8602F" } },
  { id: "signal", name: "Signal room", colors: { paper: "#F5F6FA", ink: "#121725", accent: "#D14862", evidence: "#176E97" } },
];

interface PresenterPersona {
  readonly src: string;
  readonly focalPoint: string;
  readonly voiceDirection?: string;
  readonly elevenLabsVoiceId?: string;
  readonly idleReady?: boolean;
}

const STARTER_PRESENTER_PREVIEWS: Record<string, PresenterPersona> = {
  "presenter-portrait.educator-maya-v2": { src: educatorMaya, focalPoint: "50% 20%", voiceDirection: "Warm, assured adult mathematics educator · clear medium pace", elevenLabsVoiceId: "Xb7hH8MSUJpSbSDYk0k2", idleReady: true },
  "presenter-portrait.software-daniel-v1": { src: softwareDaniel, focalPoint: "50% 20%" },
  "presenter-portrait.science-priya-v1": { src: sciencePriya, focalPoint: "50% 20%" },
  "presenter-portrait.language-sofia-v1": { src: languageSofia, focalPoint: "50% 20%" },
  "presenter-portrait.history-marcus-v1": { src: historyMarcus, focalPoint: "50% 20%" },
  "presenter-portrait.young-learners-lily-v1": { src: youngLearnersLily, focalPoint: "50% 20%" },
  "presenter-portrait.academic-amara-v1": { src: academicAmara, focalPoint: "50% 22%" },
  "presenter-portrait.modern-tech-minji-v1": { src: modernMinji, focalPoint: "50% 20%" },
  "presenter-portrait.documentary-malik-v1": { src: documentaryMalik, focalPoint: "50% 20%" },
  "presenter-portrait.playful-lucia-v1": { src: playfulLucia, focalPoint: "50% 18%" },
  "presenter-portrait.science-zara-v1": { src: scienceZara, focalPoint: "50% 20%" },
  "presenter-portrait.mathematics-arjun-v1": { src: mathematicsArjun, focalPoint: "50% 20%" },
  "presenter-portrait.broadcast-elena-v1": { src: broadcastElena, focalPoint: "50% 20%" },
  "presenter-portrait.anime-astrid-v1": { src: animeAstrid, focalPoint: "50% 20%" },
  "presenter-portrait.graphic-luca-v1": { src: graphicLuca, focalPoint: "50% 20%" },
  "presenter-portrait.clay-nora-v1": { src: clayNora, focalPoint: "50% 20%" },
  "presenter-portrait.watercolor-elisabeth-v1": { src: watercolorElisabeth, focalPoint: "50% 20%" },
  "presenter-portrait.animated-theo-v1": { src: animatedTheo, focalPoint: "50% 20%" },
  "presenter-portrait.retro-felix-v1": { src: retroFelix, focalPoint: "50% 20%" },
  "presenter-portrait.holographic-selene-v1": { src: holographicSelene, focalPoint: "50% 20%" },
  "presenter-portrait.papercut-celia-v1": { src: papercutCelia, focalPoint: "50% 20%" },
  "presenter-portrait.ink-roman-v1": { src: inkRoman, focalPoint: "50% 20%" },
  "presenter-portrait.oil-helena-v1": { src: oilHelena, focalPoint: "50% 20%" },
  "presenter-portrait.vector-avery-v1": { src: vectorAvery, focalPoint: "50% 20%" },
  "presenter-portrait.cartoon-oliver-v1": { src: cartoonOliver, focalPoint: "50% 20%" },
  "presenter-portrait.charcoal-marta-v1": { src: charcoalMarta, focalPoint: "50% 20%" },
  "presenter-portrait.anime-hana-v1": { src: animeHana, focalPoint: "50% 19%", voiceDirection: "Warm adult science tutor · patient, bright, never childlike", idleReady: true },
  "presenter-portrait.anime-kenji-v1": { src: animeKenji, focalPoint: "50% 19%", voiceDirection: "Calm adult coding mentor · precise, conversational, lightly energetic", idleReady: true },
  "presenter-portrait.cartoon-camille-v1": { src: cartoonCamille, focalPoint: "50% 18%", voiceDirection: "Energetic adult physics maker · curious and articulate", idleReady: true },
  "presenter-portrait.cartoon-elias-v1": { src: cartoonElias, focalPoint: "50% 18%", voiceDirection: "Friendly adult design historian · measured and story-led", idleReady: true },
};

function presenterVoiceMatch(assetId: string | null, label?: string): Pick<CanvasCustomization["presenter"], "voiceDirection" | "preferredVoiceId"> {
  const persona = assetId ? STARTER_PRESENTER_PREVIEWS[assetId] : undefined;
  if (persona?.voiceDirection) return { voiceDirection: persona.voiceDirection, preferredVoiceId: persona.elevenLabsVoiceId ?? null };
  const role = (label ?? "").toLocaleLowerCase("en-US");
  if (/software|coding|tech|engineer/.test(role)) return { voiceDirection: "Adult technical educator · precise, calm, conversational", preferredVoiceId: null };
  if (/young-learner|playful|story/.test(role)) return { voiceDirection: "Warm adult primary educator · animated but never childlike", preferredVoiceId: null };
  if (/history|documentary|lecturer/.test(role)) return { voiceDirection: "Adult lecturer · measured, grounded, story-led", preferredVoiceId: null };
  if (/science|mathematics|academic/.test(role)) return { voiceDirection: "Adult subject educator · warm, assured, medium pace", preferredVoiceId: null };
  return { voiceDirection: "Neutral adult teaching voice · clear, conversational, medium pace", preferredVoiceId: null };
}

const STARTER_BACKGROUND_PREVIEWS: Record<string, string> = {
  "background.academic-evidence-paper-v1": academicEvidenceBackground,
  "background.modern-tech-signal-v1": modernSignalBackground,
  "background.playful-paper-cut-v1": playfulPaperBackground,
};

const TEMPLATE_PREVIEWS: Record<string, string> = {
  "explain-hard-idea": explainHardIdeaTemplate,
  "trace-algorithm": traceAlgorithmTemplate,
  "evidence-history": evidenceHistoryTemplate,
  "worked-derivation": workedDerivationTemplate,
  "product-walkthrough": productWalkthroughTemplate,
  "young-learner-story": youngLearnerTemplate,
};

const ONBOARDING_CATALOG: OnboardingCatalog = {
  goals: [
    { id: "tutorial", label: "Tutorial or explainer", description: "Turn a difficult idea into a structured narrated lesson." },
    { id: "course", label: "Course chapter", description: "Build a source-grounded sequence with consistent visual language." },
    { id: "presenter", label: "Presenter-led video", description: "Combine a selected or generated presenter with designed slides." },
    { id: "illustrated", label: "Illustrated story", description: "Use art-led scenes with editable text and review passes." },
    { id: "edit", label: "Edit imported video", description: "Bring existing media into the timeline and use assisted editing." },
  ],
  runtimes: [
    { id: "hybrid", label: "Choose per task", description: "Keep private work local and select cloud models only when useful.", recommended: true },
    { id: "local", label: "Local first", description: "Prefer installed models and keep supported generation on this computer." },
    { id: "cloud", label: "Cloud/API first", description: "Prefer explicitly connected providers with project-level approval." },
  ],
  providers: providerConfigs.map((provider) => ({
    id: provider.id,
    name: provider.name.replace(" (dev/test)", ""),
    description: provider.detail,
    connected: provider.local === true,
    requiresCredential: provider.local !== true,
    icon: <ProviderMark providerId={provider.id === "nvidia-nim" ? "nvidia" : provider.id} compact />,
  })),
  models: [
    ...localModelOptions.slice(0, 13).map((model) => ({
      id: model.id,
      name: model.name,
      providerId: "local",
      medium: /narration|tts|voice/i.test(model.medium) ? "speech" as const : /transcription/i.test(model.medium) ? "transcription" as const : /illustration/i.test(model.medium) ? "image" as const : "language" as const,
      description: model.detail,
      compatible: true,
      required: /qwen3\.5-9b|kokoro|whisper-large-v3-turbo/i.test(model.id),
      requirementReason: /qwen3\.5-9b/i.test(model.id) ? "Core writing and visual review" : /kokoro/i.test(model.id) ? "Core draft narration" : /whisper/i.test(model.id) ? "Core transcription and timing" : undefined,
      downloadBytes: /qwen3\.5-9b/i.test(model.id) ? 6.4 * 1024 ** 3 : /kokoro/i.test(model.id) ? 350 * 1024 ** 2 : /whisper/i.test(model.id) ? 1.6 * 1024 ** 3 : undefined,
      sizeConfidence: "estimated" as const,
    })),
    ...portraitAnimationModelOptions.slice(0, 3).map((model) => ({
      id: model.id,
      name: model.name,
      providerId: "local",
      medium: "presenter" as const,
      description: model.detail,
      compatible: model.id !== "local/echomimicv3-flash",
      required: model.id === "local/liveportrait",
      requirementReason: model.id === "local/liveportrait" ? "Core presenter pose, gaze, expression and blink stage" : undefined,
      downloadBytes: model.id === "local/liveportrait" ? 1 * 1024 ** 3 : model.id === "local/longcat-avatar-1.5" ? 32 * 1024 ** 3 : 26 * 1024 ** 3,
      sizeConfidence: "estimated" as const,
    })),
    ...lipSyncModelOptions.slice(0, 3).map((model) => ({ id: model.id, name: model.name, providerId: "local", medium: "lip-sync" as const, description: model.detail, compatible: true, required: model.id === "local/musetalk-1.5", requirementReason: model.id === "local/musetalk-1.5" ? "Core presenter lip-sync fallback" : undefined, downloadBytes: model.id === "local/musetalk-1.5" ? 4.7 * 1024 ** 3 : undefined, sizeConfidence: "estimated" as const })),
  ],
  portraits: DEFAULT_CANVAS_CUSTOMIZATION.assets
    .filter((asset) => asset.kind === "presenter" && presenterCollection.has(asset.id))
    .flatMap((asset) => {
      const preview = STARTER_PRESENTER_PREVIEWS[asset.id];
      if (!preview) return [];
      const [label, style = "Presenter"] = asset.label.split(" · ");
      return [{ id: asset.id, src: preview.src, alt: `${style} portrait of the fictional presenter ${label}`, label: label ?? asset.label, style, attribution: asset.attribution }];
    }),
};

const GUIDED_TOUR_STEPS: readonly GuidedTourStep[] = [
  {
    id: "create",
    target: ".new-project-button",
    title: "Create a real tutorial project",
    description: "Open the project setup, choose the learner and duration, review the exact model routes, then create the learning plan. This tour waits until the project exists in your workspace.",
    placement: "right",
    allowTargetInteraction: true,
    completion: { type: "external", key: "project-created", label: "Create the project in the setup window to continue.", completedLabel: "Project created and opened.", autoAdvance: true },
  },
  {
    id: "source",
    target: "[data-tour-target='source-import']",
    title: "Ground the lesson in your source",
    description: "Add a local document to the project. It is validated and recorded with provenance before it can support the tutorial.",
    placement: "bottom",
    allowTargetInteraction: true,
    completion: { type: "external", key: "source-added", label: "Choose Add source and finish importing a file.", completedLabel: "Source recorded in this project.", autoAdvance: true },
  },
  {
    id: "approve-plan",
    target: "[data-tour-target='approve-plan']",
    title: "Approve the plan before generation",
    description: "Review the objectives, sequence, script, sources, provider boundary, and budget. Approval advances the durable generation job; the tour waits for that receipt.",
    placement: "bottom",
    allowTargetInteraction: true,
    completion: { type: "external", key: "plan-approved", label: "Approve the learning plan to continue generation.", completedLabel: "Plan approved and generation completed.", autoAdvance: true },
  },
  {
    id: "edit-scene",
    target: "[data-tour-target='scene-narration']",
    title: "Shape the explanation directly",
    description: "The generated result stays editable. Revise a sentence in the narration; the project snapshot records your change and keeps its revision history.",
    placement: "left",
    allowTargetInteraction: true,
    completion: { type: "target-event", event: "input", label: "Edit the highlighted narration, then continue.", completedLabel: "Narration changed in the project snapshot." },
  },
  {
    id: "render-scene",
    target: "[data-tour-target='render-scene']",
    title: "Render one scene for review",
    description: "Start the selected scene render. The work appears in Jobs only after you request it, and the tour waits for the new render receipt.",
    placement: "bottom",
    allowTargetInteraction: true,
    completion: { type: "external", key: "scene-rendered", label: "Start the highlighted scene render.", completedLabel: "Scene render recorded in Jobs.", autoAdvance: true },
  },
  {
    id: "export",
    target: "[data-tour-target='export-master']",
    title: "Submit the final master",
    description: "Choose the frame, captions, transcript, and bibliography, then submit the master. Completion comes from the export job receipt, not from visiting this screen.",
    placement: "left",
    allowTargetInteraction: true,
    completion: { type: "external", key: "export-submitted", label: "Submit the highlighted master render when the settings are ready.", completedLabel: "Master export recorded in Jobs.", autoAdvance: true },
  },
];

const guidedTourSceneEditKey = (projectId: string) => `alystria-guided-tour-v1:scene-edited:${projectId}`;

interface GuidedTourEvidenceBaseline {
  projectIds: Set<string>;
  sourceCountByProjectId: Map<string, number>;
  jobIds: Set<string>;
}

function starterAsset(id: string, kind: StudioAssetKind, label: string, creator: string, license: string, sha256?: string, byteSize?: number, mediaType?: string): StudioAssetReference {
  const canonical = BUILT_IN_STARTER_KIT.assets.find((asset) => asset.id === id);
  sha256 ??= canonical?.source.contentHash;
  byteSize ??= canonical?.source.byteSize;
  mediaType ??= canonical?.technical.mediaType;
  return { id, kind, label, source: "starter-pack", creator, license, attribution: `${label} — ${creator}`, rightsStatus: "cleared", ...(sha256 ? { sha256 } : {}), ...(byteSize ? { byteSize } : {}), ...(mediaType ? { mediaType } : {}) };
}

function canvasCustomization(project: ProjectRecord): CanvasCustomization {
  const saved = project.customization;
  if (!saved) return structuredClone(DEFAULT_CANVAS_CUSTOMIZATION);
  return {
    ...DEFAULT_CANVAS_CUSTOMIZATION,
    ...saved,
    colors: { ...DEFAULT_CANVAS_CUSTOMIZATION.colors, ...saved.colors },
    fonts: { ...DEFAULT_CANVAS_CUSTOMIZATION.fonts, ...saved.fonts },
    captions: { ...DEFAULT_CANVAS_CUSTOMIZATION.captions, ...saved.captions },
    presenter: { ...DEFAULT_CANVAS_CUSTOMIZATION.presenter, ...saved.presenter },
    audio: { ...DEFAULT_CANVAS_CUSTOMIZATION.audio, ...saved.audio },
    assets: saved.assets?.length ? saved.assets : DEFAULT_CANVAS_CUSTOMIZATION.assets,
  };
}

function LogoMark() {
  return (
    <span className="logo-mark" aria-hidden="true">
      <img src={appMark} alt="" />
    </span>
  );
}

function App() {
  const [preferences] = usePersistentState<AlystriaPreferences>("alystria-preferences-v1", DEFAULT_ALYSTRIA_PREFERENCES);
  useEffect(() => {
    document.documentElement.dataset.reduceMotion = String(preferences.reducedMotion);
    document.documentElement.dataset.highContrast = String(preferences.highContrast);
    document.documentElement.dataset.denseEditor = String(preferences.denseEditor);
  }, [preferences.reducedMotion, preferences.highContrast, preferences.denseEditor]);
  const [snapshot, setSnapshot, resetSnapshot] = usePersistentState<AppSnapshot>("alystria-studio-v2", defaultSnapshot, normalizeAppSnapshot);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const [runtime, setRuntime] = useState<RuntimeState>({ environment: desktopEnvironment(), bootstrap: null, loading: true, error: null });
  const [diagnosticReport, setDiagnosticReport] = useState<DiagnosticReport | null>(null);
  const [detectedConnections, setDetectedConnections] = useState<string[]>([]);
  const [attachedModelIds, setAttachedModelIds] = useState<string[]>([]);
  const [initialOnboarding] = useState(persistedOnboardingState);
  const persistOnboarding = useCallback((state: PersistedOnboardingState) => {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(state));
  }, []);
  const onboardingSetup = useMemo<OnboardingSetupState>(() => {
    const primaryGpu = diagnosticReport?.system.gpu[0];
    return {
      detectedRuntime: runtime.environment === "native" ? "local" : "hybrid",
      runtimeConfigured: runtime.bootstrap?.worker.state === "ready",
      privacyConfigured: false,
      connectedProviderIds: detectedConnections,
      attachedModelIds,
      existingProfile: initialOnboarding?.configuration.profile ?? null,
      hardwareInspected: diagnosticReport !== null,
      hardware: diagnosticReport ? {
        cpuLabel: diagnosticReport.system.cpu,
        memoryGb: Math.round(diagnosticReport.system.totalMemoryBytes / 1024 ** 3),
        gpuLabel: primaryGpu?.name ?? "No NVIDIA GPU reported",
        ...(primaryGpu?.dedicatedMemoryBytes ? { vramGb: Math.round(primaryGpu.dedicatedMemoryBytes / 1024 ** 3) } : {}),
        localGenerationSupported: Boolean(primaryGpu?.dedicatedMemoryBytes && primaryGpu.dedicatedMemoryBytes >= 4 * 1024 ** 3),
        warnings: diagnosticReport.checks.filter((check) => check.level === "warning" || check.level === "failure").map((check) => check.summary),
      } : null,
    };
  }, [attachedModelIds, detectedConnections, diagnosticReport, initialOnboarding, runtime.bootstrap?.worker.state, runtime.environment]);
  const onboarding = useOnboardingController({
    persistedState: initialOnboarding,
    setupState: onboardingSetup,
    onPersist: persistOnboarding,
  });
  useEffect(() => {
    let active = true;
    void Promise.all([
      localModelSetupGet(),
      Promise.all(providerConfigs.filter((provider) => !provider.local).map(async (provider) => [provider.id, await providerSecretStatus({ providerId: provider.id, credentialKind: "api_key" })] as const)),
    ]).then(([setup, refs]) => {
      if (!active) return;
      setAttachedModelIds(setup.selectedModelIds);
      setDetectedConnections(refs.filter(([, reference]) => reference.availability === "present").map(([providerId]) => providerId));
    }).catch(() => {
      if (active) { setAttachedModelIds([]); setDetectedConnections([]); }
    });
    return () => { active = false; };
  }, [runtime.environment]);
  const [nativeJobs, setNativeJobs] = useState<Record<string, NativeJobLink>>(() => nativeJobLinks(snapshot.jobs));
  const [area, setArea] = useState<GlobalArea>("home");
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [activeProjectId, setActiveProjectId] = useState(snapshot.recentProjectId);
  const [activeSceneId, setActiveSceneId] = useState("scene-insight");
  const [jobsOpen, setJobsOpen] = useState(false);
  const [newTutorialOpen, setNewTutorialOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [regenScene, setRegenScene] = useState<Scene | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [commandOpen, setCommandOpen] = useState(false);
  const [guidedTourOpen, setGuidedTourOpen] = useState(false);
  const [guidedTourIndex, setGuidedTourIndex] = useState(0);
  const [guidedTourSteps, setGuidedTourSteps] = useState<readonly GuidedTourStep[]>(GUIDED_TOUR_STEPS);
  const [guidedTourCompletedStepIds, setGuidedTourCompletedStepIds] = useState<string[]>([]);
  const [approvingProjectIds, setApprovingProjectIds] = useState<string[]>([]);
  const [editorSaveStates, setEditorSaveStates] = useState<Record<string, EditorSaveStatus>>({});
  const guidedTourBaseline = useRef<GuidedTourEvidenceBaseline>({ projectIds: new Set(), sourceCountByProjectId: new Map(), jobIds: new Set() });
  const previousOnboardingStatus = useRef(initialOnboarding?.status ?? "not-started");
  const toastCounter = useRef(0);
  const snapshotSaveSequence = useRef(Promise.resolve());
  const snapshotAutosaveTimers = useRef(new Map<string, number>());
  const snapshotSaveFailures = useRef(new Map<string, { version: number; error: unknown }>());
  const approvalInFlightProjects = useRef(new Set<string>());
  const durableVersionByProject = useRef(new Map<string, number>());
  const editorDocumentSaves = useRef<EditorDocumentSaveQueue | null>(null);
  const persistGeneralProjectEditsRef = useRef<(project: ProjectRecord, version: number) => Promise<void>>(async () => undefined);
  const flushPendingDurableChangesRef = useRef<() => Promise<void>>(async () => undefined);
  const customizationSaves = useRef(new Map<string, {
    projectId: string;
    projectDirectory: string;
    expectedHeadRevisionId: string;
    latest: CanvasCustomization;
    version: number;
    persistedVersion: number;
    saving: boolean;
    timer?: number;
    flushPromise?: Promise<void>;
    lastFailure?: { version: number; error: unknown };
  }>());

  const activeProject = snapshot.projects.find((project) => project.id === activeProjectId) ?? snapshot.projects[0] ?? null;
  const activeScene = activeProject?.scenes.find((scene) => scene.id === activeSceneId) ?? activeProject?.scenes[0] ?? null;

  const rememberGuidedTourCompletion = useCallback((key: string) => {
    setGuidedTourCompletedStepIds((current) => current.includes(key) ? current : [...current, key]);
  }, []);

  const completedTourEvidence = useMemo(() => {
    const completed: string[] = [];
    if (snapshot.projects.length > 0) completed.push("project-created");
    if (activeProject?.sources.length) completed.push("source-added");
    const activeProjectJobs = activeProject
      ? snapshot.jobs.filter((job) => job.projectId
        ? job.projectId === activeProject.nativeProjectId
        : snapshot.projects.length === 1)
      : [];
    const generationJob = activeProject?.nativeGenerationId
      ? activeProjectJobs.find((job) => job.id === activeProject.nativeGenerationId)
      : undefined;
    if (generationJob?.status === "complete") completed.push("plan-approved");
    if (activeProject && (activeProject.editorDocument || localStorage.getItem(guidedTourSceneEditKey(activeProject.id)) === "completed")) completed.push("edit-scene");
    if (activeProjectJobs.some((job) => job.operation === "render_scene")) completed.push("scene-rendered");
    if (activeProjectJobs.some((job) => job.operation === "export_master")) completed.push("export-submitted");
    return completed;
  }, [activeProject, snapshot.jobs, snapshot.projects.length]);

  const startGuidedTour = useCallback((replay = false) => {
    guidedTourBaseline.current = {
      projectIds: new Set(snapshot.projects.map((project) => project.id)),
      sourceCountByProjectId: new Map(snapshot.projects.map((project) => [project.id, project.sources.length])),
      jobIds: new Set(snapshot.jobs.map((job) => job.id)),
    };
    setGuidedTourCompletedStepIds(completedTourEvidence);
    const replaySteps = replay ? createGuidedTourReplaySteps(GUIDED_TOUR_STEPS, completedTourEvidence) : GUIDED_TOUR_STEPS;
    const fullRefresher = replay && GUIDED_TOUR_STEPS.every((step) => completedTourEvidence.includes(guidedTourCompletionKey(step)));
    setGuidedTourSteps(fullRefresher
      ? replaySteps.map((step) => step.completion ? { ...step, completion: { ...step.completion, autoAdvance: false } } : step)
      : replaySteps);
    setGuidedTourIndex(0);
    setGuidedTourOpen(true);
  }, [completedTourEvidence, snapshot.jobs, snapshot.projects]);

  useEffect(() => {
    if (!guidedTourOpen) return;
    const baseline = guidedTourBaseline.current;
    if (snapshot.projects.some((project) => !baseline.projectIds.has(project.id))) rememberGuidedTourCompletion("project-created");
    if (activeProject && activeProject.sources.length > (baseline.sourceCountByProjectId.get(activeProject.id) ?? 0)) rememberGuidedTourCompletion("source-added");
    const generationJob = activeProject?.nativeGenerationId
      ? snapshot.jobs.find((job) => job.id === activeProject.nativeGenerationId)
      : undefined;
    if (generationJob?.status === "complete") rememberGuidedTourCompletion("plan-approved");
    const newJobs = snapshot.jobs.filter((job) => !baseline.jobIds.has(job.id) && (
      !activeProject
        ? false
        : job.projectId
          ? job.projectId === activeProject.nativeProjectId
          : snapshot.projects.length === 1
    ));
    if (newJobs.some((job) => job.operation === "render_scene")) rememberGuidedTourCompletion("scene-rendered");
    if (newJobs.some((job) => job.operation === "export_master")) rememberGuidedTourCompletion("export-submitted");
  }, [activeProject, guidedTourOpen, rememberGuidedTourCompletion, snapshot.jobs, snapshot.projects]);

  const handleGuidedTourStepEnter = useCallback((step: GuidedTourStep) => {
    setJobsOpen(false);
    if (step.id === "create") {
      setArea("home");
      setWorkspace(null);
      return;
    }
    if (step.id === "source") {
      setWorkspace("plan");
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLButtonElement>("[data-tour-route='plan-sources']")?.click();
      });
      return;
    }
    if (step.id === "approve-plan") {
      setWorkspace("plan");
      return;
    }
    if (step.id === "edit-scene" || step.id === "render-scene") {
      setWorkspace("studio");
      return;
    }
    if (step.id === "export") setWorkspace("export");
  }, []);

  const notify = useCallback((title: string, detail: string, tone: ToastMessage["tone"] = "success") => {
    const id = ++toastCounter.current;
    setToasts((items) => [...items, { id, title, detail, tone }]);
    window.setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 3800);
  }, []);

  const enqueueSnapshotSave = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const running = snapshotSaveSequence.current.then(operation, operation);
    snapshotSaveSequence.current = running.then(() => undefined, () => undefined);
    return running;
  }, []);

  if (!editorDocumentSaves.current) {
    editorDocumentSaves.current = new EditorDocumentSaveQueue({
      load: (identity) => projectSnapshotGet(identity),
      save: (input) => enqueueSnapshotSave(() => projectSnapshotSave({ ...input, message: "Saved advanced editor timeline" })),
      validate: prepareEditorProjectForPersistence,
      onStatus: (projectKey, status) => setEditorSaveStates((current) => ({ ...current, [projectKey]: status })),
      onSaved: (projectKey, receipt) => setSnapshot((current) => ({
        ...current,
        projects: current.projects.map((project) => project.id === projectKey
          ? { ...project, nativeHeadRevisionId: receipt.headRevisionId, nativeRevisionNumber: receipt.revisionNumber }
          : project),
      })),
    });
  }

  const queueEditorDocumentSave = useCallback((projectKey: string, document: EditorProject) => {
    const prepared = prepareEditorProjectForPersistence(document);
    const project = snapshotRef.current.projects.find((item) => item.id === projectKey);
    setSnapshot((current) => ({
      ...current,
      projects: current.projects.map((item) => item.id === projectKey
        ? { ...item, editorDocument: prepared, updatedAt: "just now" }
        : item),
    }));
    if (runtime.environment === "native" && project?.nativeProjectId && project.nativeProjectDirectory) {
      editorDocumentSaves.current!.queue({
        projectKey,
        projectId: project.nativeProjectId,
        projectDirectory: project.nativeProjectDirectory,
      }, prepared);
    } else {
      setEditorSaveStates((current) => ({ ...current, [projectKey]: { phase: "saved", detail: "Timeline saved in this browser" } }));
    }
  }, [runtime.environment, setSnapshot]);

  const flushEditorDocument = useCallback(async (projectKey: string) => {
    await editorDocumentSaves.current?.flush(projectKey);
  }, []);

  const openProject = async (projectId: string, nextWorkspace: Workspace = "plan") => {
    const project = snapshot.projects.find((item) => item.id === projectId);
    if (runtime.environment === "native") {
      try {
        await flushPendingDurableChangesRef.current();
      } catch (error) {
        notify("Changes are not saved", `${errorMessage(error)} The current workspace remains open so you can retry.`, "warning");
        return;
      }
    }
    if (project?.nativeProjectDirectory && runtime.environment === "native") {
      try {
        const handle = await projectOpen({ projectDirectory: project.nativeProjectDirectory, allowReadOnly: true });
        const durable = await projectSnapshotGet({ projectId: handle.manifest.projectId, projectDirectory: handle.projectDirectory });
        snapshotSaveFailures.current.delete(projectId);
        setSnapshot((current) => ({
          ...current,
          projects: current.projects.map((item) => {
            if (item.id !== projectId) return item;
            if ((item.nativeRevisionNumber ?? 0) > durable.revisionNumber) return item;
            const hydrated = hydrateDurableProject(item, durable.snapshot, {
              nativeProjectId: handle.manifest.projectId,
              nativeProjectDirectory: handle.projectDirectory,
              nativeHeadRevisionId: durable.headRevisionId,
              nativeRevisionNumber: durable.revisionNumber,
            });
            const pendingDocument = editorDocumentSaves.current?.pendingDocument(projectId);
            return pendingDocument ? { ...hydrated, editorDocument: pendingDocument } : hydrated;
          }),
        }));
      } catch (error) {
        notify("Project folder needs attention", errorMessage(error), "warning");
      }
    }
    setActiveProjectId(projectId);
    setSnapshot((current) => ({ ...current, recentProjectId: projectId }));
    setWorkspace(nextWorkspace);
    setMobileNavOpen(false);
  };

  const navigateGlobal = (next: GlobalArea) => {
    setArea(next);
    setWorkspace(null);
    setMobileNavOpen(false);
  };

  const setMode = (mode: StudioMode) => {
    setSnapshot((current) => ({ ...current, studioMode: mode }));
    notify(`${mode === "guided" ? "Guided" : "Studio"} mode`, mode === "guided" ? "Advanced production controls are tucked away." : "Provider, timing, and dependency controls are now visible.", "info");
  };

  const updateScene = (projectId: string, sceneId: string, update: Partial<Scene>) => {
    setSnapshot((current) => ({
      ...current,
      projects: current.projects.map((project) =>
        project.id === projectId
          ? { ...project, scenes: project.scenes.map((scene) => (scene.id === sceneId ? { ...scene, ...update, status: update.status ?? (Object.entries(update).some(([key, value]) => ["title", "narration", "objective", "duration", "kind"].includes(key) && scene[key as keyof Scene] !== value) ? "draft" : scene.status) } : scene)), updatedAt: "just now" }
          : project,
      ),
      version: current.version + 1,
    }));
  };

  const flushProjectCustomization = async (
    projectKey: string,
    propagateFailure = false,
    frozenTarget?: { version: number; customization: CanvasCustomization },
  ): Promise<void> => {
    const entry = customizationSaves.current.get(projectKey);
    if (!entry) return;
    if (entry.timer) {
      window.clearTimeout(entry.timer);
      delete entry.timer;
    }
    if (entry.saving && entry.flushPromise) {
      try { await entry.flushPromise; } catch (error) { if (propagateFailure) throw error; }
      const requestedVersion = frozenTarget?.version ?? entry.version;
      if (propagateFailure && entry.lastFailure?.version === requestedVersion) throw entry.lastFailure.error;
      if (entry.persistedVersion < requestedVersion) await flushProjectCustomization(projectKey, propagateFailure, frozenTarget);
      return;
    }
    const target = frozenTarget ?? { version: entry.version, customization: structuredClone(entry.latest) };
    if (entry.persistedVersion >= target.version) {
      if (propagateFailure && entry.lastFailure?.version === target.version) throw entry.lastFailure.error;
      return;
    }
    entry.saving = true;
    const operation = enqueueSnapshotSave(async () => {
      let conflictRetries = 0;
      while (true) {
        const expectedHead = entry.expectedHeadRevisionId;
        try {
          const saved = await projectCustomizationSave({
            projectId: entry.projectId,
            projectDirectory: entry.projectDirectory,
            expectedHeadRevisionId: expectedHead,
            customization: target.customization,
            message: "Updated visual bible customization",
          });
          if (entry.expectedHeadRevisionId === expectedHead) entry.expectedHeadRevisionId = saved.headRevisionId;
          entry.persistedVersion = Math.max(entry.persistedVersion, target.version);
          if (entry.lastFailure?.version === target.version) delete entry.lastFailure;
          setSnapshot((current) => ({
            ...current,
            projects: current.projects.map((project) => project.id === projectKey && project.nativeHeadRevisionId === expectedHead
              ? { ...project, nativeHeadRevisionId: saved.headRevisionId, nativeRevisionNumber: saved.revisionNumber }
              : project),
          }));
          return;
        } catch (error) {
          if (!errorMessage(error).includes("REVISION_CONFLICT") || conflictRetries >= 2) throw error;
          conflictRetries += 1;
          const current = await projectSnapshotGet({ projectId: entry.projectId, projectDirectory: entry.projectDirectory });
          entry.expectedHeadRevisionId = current.headRevisionId;
          setSnapshot((snapshotState) => ({
            ...snapshotState,
            projects: snapshotState.projects.map((project) => project.id === projectKey
              ? { ...project, nativeHeadRevisionId: current.headRevisionId, nativeRevisionNumber: current.revisionNumber }
              : project),
          }));
        }
      }
    });
    entry.flushPromise = operation;
    try {
      await operation;
    } catch (error) {
      entry.lastFailure = { version: target.version, error };
      notify("Visual bible needs attention", `${errorMessage(error)} Your choices remain in this app session and can be saved again after the project is refreshed.`, "warning");
      if (propagateFailure) throw error;
    } finally {
      entry.saving = false;
      if (entry.flushPromise === operation) delete entry.flushPromise;
      if (entry.persistedVersion < entry.version && !approvalInFlightProjects.current.has(projectKey) && entry.lastFailure?.version !== entry.version) {
        entry.timer = window.setTimeout(() => { void flushProjectCustomization(projectKey); }, 500);
      }
    }
  };

  const updateProjectCustomization = (project: ProjectRecord, customization: CanvasCustomization, receipt?: ProjectAssetImportReceipt) => {
    setSnapshot((current) => ({
      ...current,
      projects: current.projects.map((item) => item.id === project.id
        ? {
          ...item,
          customization,
          updatedAt: "just now",
          ...(receipt ? { nativeHeadRevisionId: receipt.headRevisionId, nativeRevisionNumber: receipt.revisionNumber } : {}),
        }
        : item),
    }));
    const nativeProjectId = project.nativeProjectId;
    const nativeProjectDirectory = project.nativeProjectDirectory;
    const expectedHeadRevisionId = receipt?.headRevisionId ?? project.nativeHeadRevisionId;
    if (!nativeProjectId || !nativeProjectDirectory || !expectedHeadRevisionId) return;
    const existing = customizationSaves.current.get(project.id);
    if (existing?.timer) window.clearTimeout(existing.timer);
    const next = existing ?? {
      projectId: nativeProjectId,
      projectDirectory: nativeProjectDirectory,
      expectedHeadRevisionId,
      latest: customization,
      version: 0,
      persistedVersion: 0,
      saving: false,
    };
    next.projectId = nativeProjectId;
    next.projectDirectory = nativeProjectDirectory;
    if (receipt || !existing) next.expectedHeadRevisionId = expectedHeadRevisionId;
    next.latest = structuredClone(customization);
    next.version += 1;
    if (next.lastFailure && next.lastFailure.version < next.version) delete next.lastFailure;
    if (!approvalInFlightProjects.current.has(project.id)) {
      next.timer = window.setTimeout(() => { void flushProjectCustomization(project.id); }, 500);
    }
    customizationSaves.current.set(project.id, next);
  };

  const persistGeneralProjectEdits = async (project: ProjectRecord, version: number): Promise<void> => {
    if (!project.nativeProjectId || !project.nativeProjectDirectory) return;
    const captured = projectSnapshotDocument(project);
    await enqueueSnapshotSave(async () => {
      let conflictRetries = 0;
      while (true) {
        const durable = await projectSnapshotGet({ projectId: project.nativeProjectId!, projectDirectory: project.nativeProjectDirectory! });
        try {
          const saved = await projectSnapshotSave({
            projectId: project.nativeProjectId!,
            projectDirectory: project.nativeProjectDirectory!,
            expectedHeadRevisionId: durable.headRevisionId,
            snapshot: mergeGeneralProjectSnapshot(durable.snapshot, captured),
            message: "Saved scene and script edits",
          });
          snapshotSaveFailures.current.delete(project.id);
          durableVersionByProject.current.set(project.id, version);
          setSnapshot((current) => ({
            ...current,
            projects: current.projects.map((item) => item.id === project.id
              ? { ...item, nativeHeadRevisionId: saved.headRevisionId, nativeRevisionNumber: saved.revisionNumber }
              : item),
          }));
          return;
        } catch (error) {
          if (!errorMessage(error).includes("REVISION_CONFLICT") || conflictRetries >= 2) {
            snapshotSaveFailures.current.set(project.id, { version, error });
            throw error;
          }
          conflictRetries += 1;
        }
      }
    });
  };

  const flushPendingDurableChanges = async (): Promise<void> => {
    const pendingGeneralProjectIds = new Set([
      ...snapshotAutosaveTimers.current.keys(),
      ...snapshotSaveFailures.current.keys(),
    ]);
    for (const projectKey of pendingGeneralProjectIds) {
      const timer = snapshotAutosaveTimers.current.get(projectKey);
      if (timer) window.clearTimeout(timer);
      snapshotAutosaveTimers.current.delete(projectKey);
      const project = snapshotRef.current.projects.find((item) => item.id === projectKey);
      if (project) await persistGeneralProjectEdits(project, snapshotRef.current.version);
    }
    for (const [projectKey, entry] of customizationSaves.current) {
      if (entry.persistedVersion < entry.version) await flushProjectCustomization(projectKey, true);
    }
    await editorDocumentSaves.current?.flushAll();
    await snapshotSaveSequence.current;
  };
  persistGeneralProjectEditsRef.current = persistGeneralProjectEdits;
  flushPendingDurableChangesRef.current = flushPendingDurableChanges;

  const useBundledAsset = async (asset: BundledAsset) => {
    const project = snapshot.projects.find((item) => item.id === snapshot.recentProjectId) ?? snapshot.projects[0];
    if (!project) throw new Error("Create or open a tutorial first, then choose an included asset.");
    const identity = nativeProjectLink(project);
    let receipt: ProjectAssetImportReceipt | undefined;
    if (runtime.environment === "native" && identity) {
      await snapshotSaveSequence.current;
      await flushProjectCustomization(project.id);
      const head = await projectSnapshotGet(identity);
      receipt = (await importBundledAsset(asset, { ...identity, expectedHeadRevisionId: head.headRevisionId })).receipt;
    }
    const id = receipt?.artifact.id ?? `bundled-${asset.id}`;
    const reference: StudioAssetReference = { id, kind: "background", label: asset.label, source: "generated", filename: asset.filename, mediaType: "image/png", byteSize: asset.byteSize, sha256: asset.sha256, creator: "AI Video Tutorial Generator included image library", license: "Included generated asset · project use and export allowed", attribution: "Built-in artwork · generated and visually reviewed 2026-09-05", rightsStatus: "cleared" };
    const customization = canvasCustomization(project);
    const next: CanvasCustomization = { ...customization, assets: [...customization.assets.filter((item) => item.id !== id), reference] };

    if (asset.kind === "background") {
      next.backgroundAssetId = id;
      next.backgroundMode = "image";
      const dark = asset.id === "slide-ink" || asset.id === "slide-chapter";
      next.paletteId = dark ? "midnight" : "precision";
      next.colors = dark ? { paper: "#101725", ink: "#F5F1E8", accent: "#BDA5F3", evidence: "#70D2C4" } : { paper: "#F7F6F1", ink: "#252334", accent: "#6C50B6", evidence: "#13766D" };
    }
    updateProjectCustomization(project, next, receipt);
    notify("Teaching artwork added", `${asset.label} is available in ${project.title} and its advanced editor.`, "success");
  };

  const updateProjectCreative = (projectId: string, creative: CreativeConfiguration) => {
    setSnapshot((current) => ({
      ...current,
      projects: current.projects.map((project) => project.id === projectId ? { ...project, creative, updatedAt: "just now" } : project),
      version: current.version + 1,
    }));
  };

  const addJob = (job: JobRecord) => setSnapshot((current) => ({ ...current, jobs: [job, ...current.jobs.filter((item) => item.id !== job.id)] }));

  useEffect(() => watchRuntimeBootstrap(
    (bootstrap) => setRuntime((current) => ({ ...current, bootstrap, loading: false, error: null })),
    (error) => setRuntime((current) => ({ ...current, loading: false, error: errorMessage(error) })),
  ), []);

  useEffect(() => {
    let active = true;
    void diagnosticsRun().then((report) => {
      if (active) setDiagnosticReport(report);
    }).catch(() => {
      if (active) setDiagnosticReport(null);
    });
    return () => { active = false; };
  }, [runtime.environment]);

  useEffect(() => {
    const previous = previousOnboardingStatus.current;
    if (previous !== "completed" && onboarding.state.status === "completed" && localStorage.getItem("alystria-guided-tour-v1") !== "completed") {
      startGuidedTour();
    }
    previousOnboardingStatus.current = onboarding.state.status;
  }, [onboarding.state.status, startGuidedTour]);

  useEffect(() => {
    const autosaveTimers = snapshotAutosaveTimers.current;
    const customizationEntries = customizationSaves.current;
    const editorQueue = editorDocumentSaves.current;
    return () => {
      for (const entry of customizationEntries.values()) {
        if (entry.timer) window.clearTimeout(entry.timer);
      }
      for (const timer of autosaveTimers.values()) window.clearTimeout(timer);
      editorQueue?.dispose();
    };
  }, []);

  useEffect(() => {
    if (runtime.environment !== "native") return;
    let active = true;
    let unlisten: (() => void) | undefined;
    const handleClose = createEditorCloseHandler({
      flush: () => flushPendingDurableChangesRef.current(),
      shutdown: async () => { if (active) await desktopShutdown(); },
      onError: (error) => { if (active) notify("Changes are not saved", `${errorMessage(error)} The app remains open so you can retry.`, "warning"); },
    });
    void getCurrentWindow().onCloseRequested(handleClose).then((stopListening) => {
      if (active) unlisten = stopListening;
      else stopListening();
    }).catch((error: unknown) => {
      if (active) notify("Safe close needs attention", errorMessage(error), "warning");
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [runtime.environment, notify]);

  useEffect(() => {
    setNativeJobs(nativeJobLinks(snapshot.jobs));
  }, [snapshot.jobs]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((open) => !open);
      }
      if (event.key === "Escape") {
        setCommandOpen(false);
        setRegenScene(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const nativeJobPollKey = JSON.stringify(nativeJobs);
  const refreshedJobStates = useRef(new Set<string>());
  useEffect(() => {
    if (runtime.environment !== "native") return;
    const links = JSON.parse(nativeJobPollKey) as Record<string, NativeJobLink>;
    if (!Object.keys(links).length) return;
    let active = true;
    let busy = false;
    const refresh = async () => {
      if (busy) return;
      busy = true;
      try {
        const entries = await Promise.all(Object.entries(links).map(async ([id, input]) => {
          try { return [id, await jobStatus(input)] as const; } catch { return null; }
        }));
        if (!active) return;
        setSnapshot((current) => ({ ...current, jobs: current.jobs.map((job) => {
          const receipt = entries.find((entry) => entry?.[0] === job.id)?.[1];
          return receipt ? receiptJob(receipt, job.title, job.detail, nativeJobProject(job) ?? undefined) : job;
        }) }));
        for (const entry of entries) {
          if (!entry) continue;
          const [id, receipt] = entry;
          if (!["SUCCEEDED", "BLOCKED"].includes(receipt.state)) continue;
          const key = `${id}:${receipt.state}`;
          if (refreshedJobStates.current.has(key)) continue;
          const link = links[id]!;
          try {
            const durable = await projectSnapshotGet(link);
            if (!active) return;
            setSnapshot((current) => ({ ...current, projects: current.projects.map((project) => {
              if (project.nativeProjectId !== link.projectId) return project;
              if ((project.nativeRevisionNumber ?? 0) > durable.revisionNumber) return project;
              const hydrated = hydrateDurableProject(project, durable.snapshot, { nativeProjectId: link.projectId, nativeProjectDirectory: link.projectDirectory, nativeHeadRevisionId: durable.headRevisionId, nativeRevisionNumber: durable.revisionNumber });
              const pendingDocument = editorDocumentSaves.current?.pendingDocument(project.id);
              return pendingDocument ? { ...hydrated, editorDocument: pendingDocument } : hydrated;
            }) }));
            refreshedJobStates.current.add(key);
          } catch { /* A failed refresh stays retryable on the next poll. */ }
        }
      } finally { busy = false; }
    };
    void refresh();
    const interval = window.setInterval(() => { void refresh(); }, 5_000);
    return () => { active = false; window.clearInterval(interval); };
  }, [nativeJobPollKey, runtime.environment, setSnapshot]);

  useEffect(() => {
    if (snapshot.version === 0) return;
    const project = snapshot.projects.find((item) => item.id === activeProjectId);
    if (!project?.nativeProjectId || !project.nativeProjectDirectory || !project.nativeHeadRevisionId) return;
    if (approvalInFlightProjects.current.has(project.id)) return;
    const autosaveTimers = snapshotAutosaveTimers.current;
    const savedVersion = durableVersionByProject.current.get(project.id);
    if (savedVersion === undefined) {
      durableVersionByProject.current.set(project.id, snapshot.version);
      return;
    }
    if (savedVersion === snapshot.version) return;
    const existingTimer = autosaveTimers.get(project.id);
    if (existingTimer) window.clearTimeout(existingTimer);
    const timer = window.setTimeout(() => {
      autosaveTimers.delete(project.id);
      if (approvalInFlightProjects.current.has(project.id)) return;
      void persistGeneralProjectEditsRef.current(project, snapshot.version).catch((error: unknown) => {
        notify("Project edits need attention", errorMessage(error), "warning");
      });
    }, Math.max(500, preferences.autosaveSeconds * 1000));
    autosaveTimers.set(project.id, timer);
    return () => {
      window.clearTimeout(timer);
      if (autosaveTimers.get(project.id) === timer) autosaveTimers.delete(project.id);
    };
  }, [activeProjectId, approvingProjectIds, snapshot.projects, snapshot.version, preferences.autosaveSeconds, notify]);

  const createTutorial = async (project: ProjectRecord, settings: TutorialCreationSettings) => {
    const bootstrap = runtime.bootstrap ?? await appBootstrap();
    const initialSnapshot = projectSnapshotDocument({
      ...project,
      locale: project.locale,
    }, {
      brief: {
        topic: project.topic,
        audience: project.audience,
        durationSeconds: project.duration * 60,
        locale: localeCode(project.locale),
      },
      groundingMode: settings.grounding,
    });
    const handle = await projectCreate({
      parentDirectory: bootstrap.paths.projects,
      directoryName: projectDirectoryName(project.title),
      title: project.title,
      locale: localeCode(project.locale),
      groundingMode: settings.grounding,
      initialSnapshot,
    });
    const initialized = await projectSnapshotGet({
      projectId: handle.manifest.projectId,
      projectDirectory: handle.projectDirectory,
    });
    let createdProject: ProjectRecord = {
      ...project,
      id: handle.manifest.projectId,
      nativeProjectId: handle.manifest.projectId,
      nativeProjectDirectory: handle.projectDirectory,
      nativeHeadRevisionId: initialized.headRevisionId,
      nativeRevisionNumber: initialized.revisionNumber,
    };
    for (const file of settings.sourceFiles) {
      const receipt = await importSelectedFile(createdProject, file);
      createdProject = appendImportedSource(createdProject, receipt);
    }
    const routingReceipt = await providerRoutingPolicySave({
      projectId: handle.manifest.projectId,
      projectDirectory: handle.projectDirectory,
      expectedHeadRevisionId: createdProject.nativeHeadRevisionId!,
      policy: settings.routingPolicy,
      message: `Approved ${settings.routingPolicy.privacyMode} provider routing for tutorial creation`,
    });
    createdProject = {
      ...createdProject,
      nativeHeadRevisionId: routingReceipt.headRevisionId,
      ...(routingReceipt.revisionNumber !== undefined ? { nativeRevisionNumber: routingReceipt.revisionNumber } : {}),
      privacy: settings.privacy === "local" ? "Local only" : "Approved cloud",
      // The policy contains only explicit route identities and opaque keyring
      // references. Keep it in later snapshots so normal scene/design saves
      // cannot silently erase the approved provider boundary.
      providerRoutingPolicy: settings.routingPolicy,
    };
    const receipt = await generationStart({
      projectId: handle.manifest.projectId,
      projectDirectory: handle.projectDirectory,
      snapshotId: createdProject.nativeHeadRevisionId ?? null,
      scope: { kind: "project" },
      quality: settings.quality,
      privacy: settings.privacy,
      budget: { currency: "USD", hardLimitMinorUnits: settings.hardLimitMinorUnits, requireKnownPricing: true },
      approvedProviderIds: settings.approvedProviderIds,
      preservationLocks: [],
    });
    createdProject = { ...createdProject, nativeGenerationId: receipt.jobId };
    setNativeJobs((current) => ({
      ...current,
      [receipt.jobId]: { projectId: handle.manifest.projectId, projectDirectory: handle.projectDirectory, jobId: receipt.jobId },
    }));
    setSnapshot((current) => ({
      ...current,
      projects: [createdProject, ...current.projects],
      recentProjectId: createdProject.id,
      jobs: [receiptJob(receipt, "Creating learning plan", createdProject.title, { projectId: handle.manifest.projectId, projectDirectory: handle.projectDirectory }), ...current.jobs],
    }));
    setNewTutorialOpen(false);
    setActiveProjectId(createdProject.id);
    setActiveSceneId(createdProject.scenes[0]?.id ?? "");
    setWorkspace("plan");
    setJobsOpen(true);
    notify("Project and routing approved", `${createdProject.title} is stored under ${bootstrap.paths.projects} with the reviewed ${settings.privacy} provider policy.`, receipt.state === "BLOCKED" || receipt.state === "FAILED" ? "warning" : "success");
  };

  const importSources = async (projectId: string, files: File[]) => {
    if (files.length === 0) return [];
    let project = snapshot.projects.find((item) => item.id === projectId);
    if (!project?.nativeProjectId || !project.nativeProjectDirectory) {
      throw new Error("Open or create a local project before importing source files.");
    }
    if (!project.nativeHeadRevisionId) {
      const loaded = await projectSnapshotGet({
        projectId: project.nativeProjectId,
        projectDirectory: project.nativeProjectDirectory,
      });
      project = { ...project, nativeHeadRevisionId: loaded.headRevisionId, nativeRevisionNumber: loaded.revisionNumber };
    }
    const receipts: SourceImportReceipt[] = [];
    for (const file of files) {
      const receipt = await importSelectedFile(project, file);
      receipts.push(receipt);
      project = appendImportedSource(project, receipt);
      const nextProject = project;
      setSnapshot((current) => ({
        ...current,
        projects: current.projects.map((item) => item.id === projectId ? nextProject : item),
      }));
    }
    return receipts;
  };

  const exportArchive = async (projectId: string) => {
    const project = snapshot.projects.find((item) => item.id === projectId);
    if (!project?.nativeProjectId || !project.nativeProjectDirectory) {
      throw new Error(`This project is not linked to a local ${PRODUCT_NAME} folder.`);
    }
    const receipt = await projectExportArchive({
      projectId: project.nativeProjectId,
      projectDirectory: project.nativeProjectDirectory,
    });
    setSnapshot((current) => ({
      ...current,
      projects: current.projects.map((item) => item.id === projectId ? { ...item, nativeArchivePath: receipt.path } : item),
    }));
    return receipt.path;
  };

  const cancelJob = async (id: string) => {
    const nativeJob = nativeJobs[id];
    if (!nativeJob) {
      setSnapshot((current) => ({ ...current, jobs: current.jobs.filter((job) => job.id !== id) }));
      notify("Demo job cancelled", "No accepted artifact was changed.", "warning");
      return;
    }
    try {
      const receipt = await jobCancel(nativeJob);
      setSnapshot((current) => ({ ...current, jobs: current.jobs.map((job) => job.id === id ? receiptJob(receipt, job.title, job.detail, nativeJobProject(job) ?? undefined) : job) }));
      notify("Job cancellation requested", receipt.message, "warning");
    } catch (error) {
      notify("Could not cancel job", errorMessage(error), "warning");
    }
  };

  const retryNativeJob = async (id: string) => {
    const nativeJob = nativeJobs[id];
    if (!nativeJob) return;
    try {
      const receipt = await jobRetry(nativeJob);
      setSnapshot((current) => ({ ...current, jobs: current.jobs.map((job) => job.id === id ? receiptJob(receipt, job.title, job.detail, nativeJobProject(job) ?? undefined) : job) }));
      notify("Job retry requested", receipt.message, "info");
    } catch (error) {
      notify("Could not retry job", errorMessage(error), "warning");
    }
  };

  const approveProjectGeneration = async (projectId: string) => {
    if (runtime.environment === "browser-demo") {
      notify("Learning plan approved", "Browser demo approval is reflected in the storyboard.", "success");
      setWorkspace("storyboard");
      return;
    }
    const project = snapshot.projects.find((item) => item.id === projectId);
    const identity = project ? nativeProjectLink(project) : null;
    const jobId = project?.nativeGenerationId;
    if (!identity || !jobId) {
      notify("Generation is not ready for approval", "Open a tutorial with a saved generation job before approving its storyboard.", "warning");
      return;
    }
    if (approvalInFlightProjects.current.has(projectId)) return;
    const reviewedVersion = snapshot.version;
    const customizationEntry = customizationSaves.current.get(projectId);
    const frozenCustomizationTarget = customizationEntry && customizationEntry.persistedVersion < customizationEntry.version
      ? { version: customizationEntry.version, customization: structuredClone(customizationEntry.latest) }
      : undefined;
    if (customizationEntry?.timer) {
      window.clearTimeout(customizationEntry.timer);
      delete customizationEntry.timer;
    }
    const snapshotFailureBeforeClick = snapshotSaveFailures.current.get(projectId);
    const review: FrozenGenerationReview = {
      projectId: identity.projectId,
      projectDirectory: identity.projectDirectory,
      generationId: jobId,
      jobId,
      scenes: structuredClone(project.scenes.map(({ id, title, narration, objective, duration }) => ({ id, title, narration, objective, duration }))),
    };
    approvalInFlightProjects.current.add(projectId);
    const scheduledAutosave = snapshotAutosaveTimers.current.get(projectId);
    if (scheduledAutosave) {
      window.clearTimeout(scheduledAutosave);
      snapshotAutosaveTimers.current.delete(projectId);
    }
    setApprovingProjectIds((current) => current.includes(projectId) ? current : [...current, projectId]);
    try {
      const { saved, receipt } = await persistReviewedGenerationApproval(review, {
        awaitPendingSaves: async () => {
          await snapshotSaveSequence.current;
          const queuedFailure = snapshotSaveFailures.current.get(projectId);
          if (queuedFailure && queuedFailure !== snapshotFailureBeforeClick) throw queuedFailure.error;
          await flushProjectCustomization(projectId, true, frozenCustomizationTarget);
          await snapshotSaveSequence.current;
        },
        getSnapshot: () => projectSnapshotGet(identity),
        saveSnapshot: ({ expectedHeadRevisionId, snapshot: reviewedSnapshot }) => enqueueSnapshotSave(() => projectSnapshotSave({
          ...identity,
          expectedHeadRevisionId,
          snapshot: reviewedSnapshot,
          message: "Saved the exact reviewed storyboard before approval",
        })),
        approve: ({ expectedHeadRevisionId }) => generationApprove({ ...identity, jobId, expectedHeadRevisionId }),
      });
      snapshotSaveFailures.current.delete(projectId);
      durableVersionByProject.current.set(projectId, reviewedVersion);
      setSnapshot((current) => ({
        ...current,
        projects: current.projects.map((item) => item.id === projectId ? { ...item, nativeHeadRevisionId: saved.headRevisionId, nativeRevisionNumber: saved.revisionNumber } : item),
        jobs: current.jobs.map((job) => job.id === jobId ? receiptJob(receipt, job.title, job.detail, nativeJobProject(job) ?? undefined) : job),
      }));
      setWorkspace(receipt.state === "SUCCEEDED" ? "review" : "storyboard");
      setJobsOpen(receipt.state !== "SUCCEEDED");
      notify(
        receipt.state === "SUCCEEDED" ? "Tutorial generation completed" : "Storyboard approved",
        receipt.message,
        receipt.state === "FAILED" || receipt.state === "BLOCKED" ? "warning" : "success",
      );
    } catch (error) {
      notify("Could not approve generation", errorMessage(error), "warning");
    } finally {
      approvalInFlightProjects.current.delete(projectId);
      setApprovingProjectIds((current) => current.filter((id) => id !== projectId));
      const pendingCustomization = customizationSaves.current.get(projectId);
      if (pendingCustomization && pendingCustomization.persistedVersion < pendingCustomization.version && pendingCustomization.lastFailure?.version !== pendingCustomization.version) {
        pendingCustomization.timer = window.setTimeout(() => { void flushProjectCustomization(projectId); }, 0);
      }
    }
  };

  const baseGenerationJobId = (project: ProjectRecord) => snapshot.jobs.find((job) =>
    job.projectId === project.nativeProjectId && !job.operation && nativeJobs[job.id],
  )?.id ?? project.nativeGenerationId;

  const addNativeControlJob = (project: ProjectRecord, receipt: JobReceipt, title: string, detail: string) => {
    const link = nativeProjectLink(project);
    if (!link) return;
    setNativeJobs((current) => ({
      ...current,
      [receipt.jobId]: { ...link, jobId: receipt.jobId },
    }));
    addJob(receiptJob(receipt, title, detail, link));
    setJobsOpen(true);
  };

  const refreshProjectAfterControl = async (project: ProjectRecord, receipt: JobReceipt) => {
    const nextHead = receipt.result?.headRevisionId;
    if (!project.nativeProjectId || !project.nativeProjectDirectory || typeof nextHead !== "string") return;
    const nativeProjectId = project.nativeProjectId;
    const nativeProjectDirectory = project.nativeProjectDirectory;
    const durable = await projectSnapshotGet({
      projectId: nativeProjectId,
      projectDirectory: nativeProjectDirectory,
    });
    setSnapshot((current) => ({
      ...current,
      projects: current.projects.map((item) => item.id === project.id
        ? hydrateDurableProject(item, durable.snapshot, {
          nativeProjectId,
          nativeProjectDirectory,
          nativeHeadRevisionId: durable.headRevisionId,
          nativeRevisionNumber: durable.revisionNumber,
        })
        : item),
    }));
  };

  const navigateHistory = async (direction: "undo" | "redo") => {
    const project = snapshot.projects.find((item) => item.id === activeProjectId);
    if (!project?.nativeProjectId || !project.nativeProjectDirectory || !project.nativeHeadRevisionId) {
      notify(
        runtime.environment === "browser-demo" ? "Browser demo history" : "History unavailable",
        runtime.environment === "browser-demo" ? "Open a browser-created demo project to simulate revision restore." : "Open or create a native project before using durable history.",
        "info",
      );
      return;
    }
    const nativeProjectId = project.nativeProjectId;
    const nativeProjectDirectory = project.nativeProjectDirectory;
    try {
      await snapshotSaveSequence.current;
      const action = {
        projectId: nativeProjectId,
        projectDirectory: nativeProjectDirectory,
        expectedHeadRevisionId: project.nativeHeadRevisionId,
      };
      const restored = direction === "undo" ? await projectHistoryUndo(action) : await projectHistoryRedo(action);
      setSnapshot((current) => ({
        ...current,
        projects: current.projects.map((item) => item.id === project.id
          ? hydrateDurableProject(item, restored.snapshot, {
            nativeProjectId,
            nativeProjectDirectory,
            nativeHeadRevisionId: restored.headRevisionId,
            nativeRevisionNumber: restored.revisionNumber,
          })
          : item),
      }));
      notify(
        direction === "undo" ? "Revision restored" : "Revision reapplied",
        `${runtime.environment === "browser-demo" ? "Browser demo only · " : ""}Created revision ${restored.revisionNumber}; no history was deleted.`,
        "success",
      );
    } catch (error) {
      notify(`Could not ${direction}`, errorMessage(error), "warning");
    }
  };

  const renderNativeScene = async (scene: Scene) => {
    const project = snapshot.projects.find((item) => item.id === activeProjectId)!;
    const link = nativeProjectLink(project);
    if (!link || !project.nativeHeadRevisionId) {
      if (runtime.environment === "browser-demo") {
        const demo: JobReceipt = { jobId: `demo-${Date.now()}`, state: "SUCCEEDED", acceptedAt: new Date().toISOString(), message: "Browser demo only: scene render simulated; no media file was created.", retryable: false, operation: "render_scene", result: { demoOnly: true } };
        addJob(receiptJob(demo, `Scene ${scene.index} preview`, scene.title));
        setJobsOpen(true);
        notify("Browser demo only", demo.message, "info");
      } else notify("Scene render unavailable", "Open or create a native project first.", "warning");
      return;
    }
    try {
      await snapshotSaveSequence.current;
      const baseJobId = baseGenerationJobId(project);
      const receipt = await sceneRender({
        ...link,
        baseRevisionId: project.nativeHeadRevisionId,
        ...(baseJobId ? { baseJobId } : {}),
        sceneId: scene.id,
        aspect: "16:9",
        resolution: "1080p",
        fps: 30,
      });
      addNativeControlJob(project, receipt, `Scene ${scene.index} preview`, scene.title);
      notify(receipt.state === "SUCCEEDED" ? "Scene rendered" : ["FAILED", "BLOCKED", "CANCELLED", "STALE"].includes(receipt.state) ? "Scene render needs attention" : "Scene render queued", receipt.message, receipt.state === "SUCCEEDED" ? "success" : ["FAILED", "BLOCKED", "CANCELLED", "STALE"].includes(receipt.state) ? "warning" : "info");
    } catch (error) {
      notify("Scene render unavailable", errorMessage(error), "warning");
    }
  };

  const repairSelectedQa = async () => {
    const project = snapshot.projects.find((item) => item.id === activeProjectId)!;
    const link = nativeProjectLink(project);
    const baseJobId = baseGenerationJobId(project);
    const findingIds = project.nativeRepairableFindingIds ?? [];
    if (!link || !project.nativeHeadRevisionId || !baseJobId || findingIds.length === 0) {
      notify(runtime.environment === "browser-demo" ? "Browser demo only" : "QA repair unavailable", runtime.environment === "browser-demo" ? "The repair gesture is simulated in browser preview; no candidate is persisted." : "A completed durable generation with selected repairable findings is required.", "info");
      return;
    }
    try {
      const receipt = await qaRepair({ ...link, baseRevisionId: project.nativeHeadRevisionId, baseJobId, findingIds });
      addNativeControlJob(project, receipt, "Selected QA repair", "Bounded to two attempts");
      await refreshProjectAfterControl(project, receipt);
      notify(receipt.state === "SUCCEEDED" ? "Repair candidate ready" : ["FAILED", "BLOCKED", "CANCELLED", "STALE"].includes(receipt.state) ? "QA repair needs attention" : "QA repair queued", receipt.message, receipt.state === "SUCCEEDED" ? "success" : ["FAILED", "BLOCKED", "CANCELLED", "STALE"].includes(receipt.state) ? "warning" : "info");
    } catch (error) {
      notify("QA repair blocked", errorMessage(error), "warning");
    }
  };

  const exportNativeMaster = async (settings: ExportRequestSettings) => {
    const project = snapshot.projects.find((item) => item.id === activeProjectId)!;
    const link = nativeProjectLink(project);
    const baseJobId = baseGenerationJobId(project);
    const { codecPreference } = settings;
    const codecLabel = codecPreferenceLabel(codecPreference);
    if (runtime.environment === "browser-demo") {
      const demo: JobReceipt = { jobId: `demo-${Date.now()}`, state: "SUCCEEDED", acceptedAt: new Date().toISOString(), message: `UI contract only: ${settings.fps} fps ${codecLabel} export simulated; no media file was created.`, retryable: false, operation: "export_master", result: { demoOnly: true, path: null, requestedFps: settings.fps, requestedCodec: codecPreference, codecForwarded: false } };
      addJob(receiptJob(demo, `${project.title} · ${settings.resolution}`, `${settings.aspect} · ${settings.fps} fps · ${codecLabel} requested`));
      setJobsOpen(true);
      notify("UI contract only", demo.message, "info");
      return demo;
    }
    if (!link || !project.nativeHeadRevisionId || !baseJobId) {
      throw new Error("A completed durable generation and current project revision are required for master export.");
    }
    const receipt = await masterExport({ ...link, baseRevisionId: project.nativeHeadRevisionId, baseJobId, ...settings });
    const annotatedReceipt: JobReceipt = {
      ...receipt,
      result: { ...(receipt.result ?? {}), requestedFps: settings.fps, requestedCodec: codecPreference, codecForwarded: runtime.environment === "native" },
    };
    addNativeControlJob(project, annotatedReceipt, `${project.title} · ${settings.resolution}`, `${settings.aspect} · ${settings.fps} fps · ${codecLabel} requested`);
    return annotatedReceipt;
  };

  return (
    <div className={`app-shell ${mobileNavOpen ? "nav-open" : ""}`}>
      <a href="#main-content" className="skip-link">Skip to workspace</a>
      <Sidebar
        area={area}
        workspace={workspace}
        project={activeProject}
        mobileNavOpen={mobileNavOpen}
        profile={onboarding.state.configuration.profile}
        onGlobal={navigateGlobal}
        onWorkspace={(next) => { setWorkspace(next); setMobileNavOpen(false); }}
        onNew={() => { setSelectedTemplateId(null); setNewTutorialOpen(true); setMobileNavOpen(false); }}
        onProfile={() => { onboarding.setOpen(true); onboarding.goTo("profile"); }}
      />

      <div className="app-stage">
        <Topbar
          project={workspace && activeProject ? activeProject : null}
          workspace={workspace}
          mode={snapshot.studioMode}
          jobs={snapshot.jobs}
          runtime={runtime}
          onMode={setMode}
          onJobs={() => setJobsOpen((open) => !open)}
          onMenu={() => setMobileNavOpen((open) => !open)}
          onCommand={() => setCommandOpen(true)}
          onBack={() => navigateGlobal("projects")}
        />
        <main id="main-content" className={workspace === "studio" ? "main-content studio-main" : "main-content"}>
          {workspace && activeProject && activeScene ? (
            <ProjectWorkspace
              workspace={workspace}
              project={activeProject}
              activeScene={activeScene}
              mode={snapshot.studioMode}
              version={snapshot.version}
              jobs={snapshot.jobs}
              environment={runtime.environment}
              onWorkspace={setWorkspace}
              onScene={(scene) => { setActiveSceneId(scene.id); if (workspace !== "studio") setWorkspace("studio"); }}
              onSelectScene={setActiveSceneId}
              onSceneUpdate={(sceneId, update) => updateScene(activeProject.id, sceneId, update)}
              onProjectCustomization={(customization, receipt) => updateProjectCustomization(activeProject, customization, receipt)}
              onProjectCreative={(creative) => updateProjectCreative(activeProject.id, creative)}
              onProjectEdit={(update, options) => setSnapshot((current) => ({ ...current, projects: current.projects.map((item) => item.id === activeProject.id ? { ...item, ...update, updatedAt: "just now" } : item), version: current.version + (options?.alreadyDurable ? 0 : 1) }))}
              onEditorDocumentChange={(document) => queueEditorDocumentSave(activeProject.id, document)}
              onFlushEditorDocument={() => flushEditorDocument(activeProject.id)}
              {...(editorSaveStates[activeProject.id] ? { editorSaveStatus: editorSaveStates[activeProject.id] } : {})}
              onRegenerate={setRegenScene}
              onNotify={notify}
              onAddJob={addJob}
              onImportSources={(files) => importSources(activeProject.id, files)}
              onExportArchive={() => exportArchive(activeProject.id)}
              onApproveGeneration={() => { void approveProjectGeneration(activeProject.id); }}
              approvalPending={approvingProjectIds.includes(activeProject.id)}
              onUndo={() => { void navigateHistory("undo"); }}
              onRedo={() => { void navigateHistory("redo"); }}
              onRenderScene={(scene) => { void renderNativeScene(scene); }}
              onRepairQa={() => { void repairSelectedQa(); }}
              onExportMaster={exportNativeMaster}
            />
          ) : (
            <GlobalWorkspace
              area={area}
              snapshot={snapshot}
              runtime={runtime}
              diagnosticReport={diagnosticReport}
              onArea={navigateGlobal}
              onOpenProject={openProject}
              onNew={() => { setSelectedTemplateId(null); setNewTutorialOpen(true); }}
              onUseTemplate={(templateId) => { setSelectedTemplateId(templateId); setNewTutorialOpen(true); }}
              onNotify={notify}
              onImportSources={(files) => snapshot.recentProjectId ? importSources(snapshot.recentProjectId, files) : Promise.resolve([])}
              onReset={() => { resetSnapshot(); notify("Workspace view reset", "Recent tutorial links and the visible job list were cleared. Saved project folders and provider settings remain on disk.", "info"); }}
              onReplayOnboarding={onboarding.replay}
              onReplayTour={() => startGuidedTour(true)}
              onUseBundledAsset={useBundledAsset}
            />
          )}
        </main>
      </div>

      <JobsDrawer open={jobsOpen} jobs={snapshot.jobs} nativeJobIds={new Set(Object.keys(nativeJobs))} onClose={() => setJobsOpen(false)} onCancel={(id) => { void cancelJob(id); }} onRetry={(id) => { void retryNativeJob(id); }} />

      {newTutorialOpen && <NewTutorialWizard environment={runtime.environment} templateId={selectedTemplateId} onClose={() => setNewTutorialOpen(false)} onCreate={createTutorial} />}

      {regenScene && activeProject && <RegenerationSheet scene={regenScene} onClose={() => setRegenScene(null)} onRun={(instruction, preserve, alternatives) => {
        const scene = regenScene;
        const projectLink = nativeProjectLink(activeProject);
        const start = async () => {
          if (projectLink && activeProject.nativeHeadRevisionId) {
            await snapshotSaveSequence.current;
            const baseJobId = baseGenerationJobId(activeProject);
            const receipt = await sceneRegenerate({
              ...projectLink,
              baseRevisionId: activeProject.nativeHeadRevisionId,
              ...(baseJobId ? { baseJobId } : {}),
              sceneId: scene.id,
              instruction,
              preservationLocks: preserve ? ["narration", "citations", "learningobjective"] : ["learningobjective"],
              alternatives,
            });
            addNativeControlJob(activeProject, receipt, `Regenerating scene ${scene.index}`, instruction || `Refine ${scene.title}`);
            await refreshProjectAfterControl(activeProject, receipt);
            notify(receipt.state === "SUCCEEDED" ? "Candidate ready to review" : ["FAILED", "BLOCKED", "CANCELLED", "STALE"].includes(receipt.state) ? "Candidate needs attention" : "Candidate generation queued", receipt.message, receipt.state === "SUCCEEDED" ? "success" : ["FAILED", "BLOCKED", "CANCELLED", "STALE"].includes(receipt.state) ? "warning" : "info");
          } else {
            addJob({ id: `demo-${Date.now()}`, title: `Regenerating scene ${scene.index}`, detail: "Browser demo only · candidate simulation; accepted scene unchanged", status: "complete", progress: 100, operation: "regenerate_scene", result: { demoOnly: true } });
            setJobsOpen(true);
            notify("Browser demo only", "Candidate simulation completed; no native revision or artifact was created.", "info");
          }
        };
        void start().catch((error: unknown) => notify("Candidate could not start", errorMessage(error), "warning"));
        setRegenScene(null);
      }} />}

      {commandOpen && <CommandPalette projects={snapshot.projects} onClose={() => setCommandOpen(false)} onNavigate={(next) => { navigateGlobal(next); setCommandOpen(false); }} onOpen={(id) => { openProject(id); setCommandOpen(false); }} />}

      <OnboardingDialog controller={onboarding} setupState={onboardingSetup} catalog={ONBOARDING_CATALOG} productName={PRODUCT_NAME} brandMarkSrc={appMark} />
      <GuidedTour
        open={guidedTourOpen && !onboarding.isOpen && !newTutorialOpen && !regenScene && !commandOpen}
        steps={guidedTourSteps}
        activeIndex={guidedTourIndex}
        onActiveIndexChange={setGuidedTourIndex}
        onExit={() => setGuidedTourOpen(false)}
        onComplete={() => { localStorage.setItem("alystria-guided-tour-v1", "completed"); setGuidedTourOpen(false); }}
        completedStepIds={guidedTourCompletedStepIds}
        onStepComplete={(step) => {
          const key = guidedTourCompletionKey(step);
          rememberGuidedTourCompletion(key);
          if (key === "edit-scene" && activeProject) {
            localStorage.setItem(guidedTourSceneEditKey(activeProject.id), "completed");
          }
        }}
        onStepEnter={handleGuidedTourStepEnter}
        reducedMotion={window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false}
      />

      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((toast) => <Toast key={toast.id} toast={toast} onClose={() => setToasts((items) => items.filter((item) => item.id !== toast.id))} />)}
      </div>
    </div>
  );
}

function Sidebar({ area, workspace, project, mobileNavOpen, profile, onGlobal, onWorkspace, onNew, onProfile }: {
  area: GlobalArea;
  workspace: Workspace | null;
  project: ProjectRecord | null;
  mobileNavOpen: boolean;
  profile: AccountProfileConfiguration;
  onGlobal: (area: GlobalArea) => void;
  onWorkspace: (workspace: Workspace) => void;
  onNew: () => void;
  onProfile: () => void;
}) {
  const portrait = profile.portraitAssetId ? STARTER_PRESENTER_PREVIEWS[profile.portraitAssetId] : null;
  const displayName = profile.displayName.trim() || "Creator";
  const initials = displayName.split(/\s+/u).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "A";
  return (
    <aside className={`sidebar ${mobileNavOpen ? "mobile-open" : ""}`} aria-label="Primary navigation">
      <div className="brand-lockup"><LogoMark /><span><strong>{PRODUCT_NAME}</strong><small>Tutorial creation studio</small></span></div>
      <button className="new-project-button" aria-label="New tutorial" onClick={onNew}><Plus size={17} /> <span>New tutorial</span></button>
      {workspace && project ? (
        <>
          <button className="project-switcher" onClick={() => onGlobal("projects")}>
            <span className="project-glyph"><Braces size={16} /></span>
            <span><small>Current project</small><strong>{project.title}</strong></span>
            <ChevronDown size={15} />
          </button>
          <nav className="nav-list project-nav" aria-label="Project workspace">
            <p className="nav-caption">Build</p>
            {projectNav.map(({ id, label, icon: Icon }, index) => (
              <button key={id} aria-label={label} className={workspace === id ? "active" : ""} onClick={() => onWorkspace(id)} aria-current={workspace === id ? "page" : undefined}>
                <span className="nav-index">{index + 1}</span><Icon size={17} /><span>{label}</span>
                {id === "review" && project.scenes.some((scene) => scene.status === "attention") && <span className="nav-badge amber">{project.scenes.filter((scene) => scene.status === "attention").length}</span>}
              </button>
            ))}
          </nav>
          <div className="sidebar-thread" aria-hidden="true"><i /><i /><i /><i /><i /></div>
          <button className="all-projects-link" onClick={() => onGlobal("projects")}><ArrowLeft size={15} /> <span>All projects</span></button>
        </>
      ) : (
        <nav className="nav-list" aria-label={`${PRODUCT_NAME} areas`}>
          {globalNav.map(({ id, label, icon: Icon }) => (
            <button key={id} aria-label={label} className={area === id ? "active" : ""} onClick={() => onGlobal(id)} aria-current={area === id ? "page" : undefined}>
              <Icon size={18} /><span>{label}</span>

            </button>
          ))}
        </nav>
      )}
      <div className="sidebar-bottom">
        <div className="local-status"><span><HardDrive size={14} /> Local workspace</span><small>Saved on this computer</small></div>
        <button className="profile-button" aria-label="Open profile settings" onClick={onProfile}><span>{portrait ? <img src={portrait.src} alt="" width="35" height="35" /> : initials}</span><span className="profile-copy"><strong>{displayName}</strong><small>Local workspace</small></span><MoreHorizontal size={16} /></button>
      </div>
    </aside>
  );
}

function Topbar({ project, workspace, mode, jobs, runtime, onMode, onJobs, onMenu, onCommand, onBack }: {
  project: ProjectRecord | null;
  workspace: Workspace | null;
  mode: StudioMode;
  jobs: JobRecord[];
  runtime: RuntimeState;
  onMode: (mode: StudioMode) => void;
  onJobs: () => void;
  onMenu: () => void;
  onCommand: () => void;
  onBack: () => void;
}) {
  const running = jobs.filter((job) => job.status === "running" || job.status === "queued").length;
  return (
    <header className="topbar">
      <button className="icon-button mobile-menu" onClick={onMenu} aria-label="Toggle navigation"><Menu size={19} /></button>
      <div className="breadcrumbs">
        {project ? <><button onClick={onBack}>Projects</button><ChevronRight size={14} /><strong>{project.title}</strong><span className="crumb-workspace">/ {workspace}</span></> : <><span className="eyebrow-dot" /><strong>Private local workspace</strong></>}
      </div>
      <div className="topbar-actions">
        <RuntimeBadge runtime={runtime} />
        {project && <div className="mode-switch" role="group" aria-label="Interface mode">
          <button className={mode === "guided" ? "active" : ""} onClick={() => onMode("guided")}>Guided</button>
          <button className={mode === "studio" ? "active" : ""} onClick={() => onMode("studio")}>Studio</button>
        </div>}
        <button className="command-trigger" onClick={onCommand}><Search size={15} /><span>Search or run</span><kbd>Ctrl K</kbd></button>
        <button className={`jobs-button ${running ? "is-running" : ""}`} onClick={onJobs}><Activity size={17} /><span>Jobs</span>{running > 0 && <b>{running}</b>}</button>
      </div>
    </header>
  );
}

function GlobalWorkspace({ area, snapshot, runtime, diagnosticReport, onArea, onOpenProject, onNew, onUseTemplate, onNotify, onImportSources, onReset, onReplayOnboarding, onReplayTour, onUseBundledAsset }: {
  area: GlobalArea;
  snapshot: AppSnapshot;
  runtime: RuntimeState;
  diagnosticReport: DiagnosticReport | null;
  onArea: (area: GlobalArea) => void;
  onOpenProject: (projectId: string, workspace?: Workspace) => void;
  onNew: () => void;
  onUseTemplate: (templateId: string) => void;
  onNotify: (title: string, detail: string, tone?: ToastMessage["tone"]) => void;
  onImportSources: (files: File[]) => Promise<SourceImportReceipt[]>;
  onReset: () => void;
  onReplayOnboarding: () => void;
  onReplayTour: () => void;
  onUseBundledAsset: (asset: BundledAsset) => Promise<void>;
}) {
  switch (area) {
    case "home": return <HomeView snapshot={snapshot} runtime={runtime} onOpen={onOpenProject} onNew={onNew} onArea={onArea} />;
    case "projects": return <ProjectsView projects={snapshot.projects} onOpen={onOpenProject} onNew={onNew} />;
    case "templates": return <TemplatesView onUse={onUseTemplate} />;
    case "library": return <LibraryView project={snapshot.projects.find((project) => project.id === snapshot.recentProjectId) ?? snapshot.projects[0] ?? null} onNotify={onNotify} onImportSources={onImportSources} onUseBundledAsset={onUseBundledAsset} />;
    case "providers": return <ProvidersView environment={runtime.environment} diagnosticReport={diagnosticReport} onNotify={onNotify} />;
    case "diagnostics": return <DiagnosticsView runtime={runtime} onNotify={onNotify} onReset={onReset} onReplayOnboarding={onReplayOnboarding} onReplayTour={onReplayTour} />;
  }
}

function HomeView({ snapshot, runtime, onOpen, onNew, onArea }: {
  snapshot: AppSnapshot;
  runtime: RuntimeState;
  onOpen: (id: string, workspace?: Workspace) => void;
  onNew: () => void;
  onArea: (area: GlobalArea) => void;
}) {
  const featured = snapshot.projects.find((project) => project.id === snapshot.recentProjectId) ?? snapshot.projects[0] ?? null;
  return (
    <div className="page home-page">
      <div className="workbench-heading"><div><span className="section-kicker">A place for your next explanation</span><h1>Your teaching workbench.</h1></div><span className="workbench-local"><HardDrive size={14} /> Yours, from idea to export</span></div>
      <section className="workbench-intro">
        <div className="workbench-invitation"><span className="workbench-note">MAKE SOMETHING CLICK</span><h2>Big ideas.<br />Little <em>aha!</em> moments.</h2><p>Turn what you know into something someone else can understand. Start with a question, shape the story, and make it move.</p><button className="primary-button" onClick={onNew}><Plus size={18} /> Create a tutorial <ArrowRight size={17} /></button><span className="workbench-caption">Your sources. Your voice. Every scene editable.</span></div>
        <LessonLab />
      </section>
      <section className="workbench-paths" aria-label="Ways to teach"><div><span className="section-kicker">Find the right way in</span><h2>How will you make it clear?</h2></div><div className="workbench-path-grid">{[
        { icon: Presentation, name: "Show the idea", detail: "Visual stories, examples & comparisons", tone: "violet" },
        { icon: TextCursorInput, name: "Work it out", detail: "Whiteboard steps & mathematical reasoning", tone: "mint" },
        { icon: Braces, name: "Walk through code", detail: "Algorithms, traces & meaningful changes", tone: "peach" },
      ].map(({ icon: Icon, name, detail, tone }) => <button className={`workbench-path ${tone}`} key={name} onClick={() => onArea("templates")}><span><Icon size={24} /></span><div><strong>{name}</strong><small>{detail}</small></div><ArrowRight size={17} /></button>)}</div></section>
      {featured ? <section className="continue-section">
        <div className="section-heading"><div><span className="section-kicker">Pick up where you left off</span><h2>{featured.title}</h2></div><button className="text-button" onClick={() => onOpen(featured.id)}>Open project <ArrowRight size={15} /></button></div>
        <button className="continue-card" onClick={() => onOpen(featured.id, "storyboard")}>
          <div className="continue-preview">{featured.scenes[0] ? <SceneArtwork scene={featured.scenes[0]} project={featured} compact /> : <Film size={32} />}<div className="preview-time">{featured.duration} min target</div></div>
          <div className="continue-details"><div className="project-status-line"><StatusPill status={featured.status} /><span>{featured.updatedAt}</span></div><h3>{featured.scenes.find((scene) => scene.status !== "approved")?.title ?? "Review your teaching sequence"}</h3><p>{featured.description}</p><div className="continue-metrics"><span><Layers3 size={15} /> {featured.scenes.length} scenes</span><span><Link2 size={15} /> {featured.sources.length} sources</span><span><Languages size={15} /> {featured.locale}</span></div><ProgressBar value={featured.progress} /><small>{featured.progress}% project progress</small></div>
        </button>
      </section> : <section className="workbench-empty"><span className="workbench-empty__icon"><FolderClock size={25} /></span><div><h3>Your workbench is ready</h3><p>Your tutorials will appear here. Start with an idea or choose a teaching template.</p></div><button className="text-button" onClick={() => onArea("templates")}>Explore templates <ArrowRight size={16} /></button></section>}

      <section className="home-grid">
        <div className="home-panel recent-panel">
          <div className="panel-heading"><div><span className="section-kicker">Recent projects</span><h3>On your workbench</h3></div><button className="icon-button" onClick={() => onArea("projects")} aria-label="View all projects"><ArrowRight size={17} /></button></div>
          <div className="mini-project-list">{snapshot.projects.length ? snapshot.projects.slice(0, 3).map((project) => <button key={project.id} onClick={() => onOpen(project.id)}><span className={`mini-project-art art-${project.id}`}><Film size={19} /></span><span><strong>{project.title}</strong><small>{project.locale} · {project.duration} min · {project.updatedAt}</small></span><span className="mini-progress">{project.progress}%</span></button>) : <p className="empty-list-copy">Projects you create will appear here.</p>}</div>
        </div>
        <div className="home-panel readiness-panel">
          <div className="panel-heading"><div><span className="section-kicker">Studio readiness</span><h3>Everything stays in view</h3></div><ShieldCheck className="teal" size={23} /></div>
          <div className="readiness-list">
            <span><CheckCircle2 /> {runtime.environment === "native" ? "Native project storage" : "Browser demo storage"} <b>{runtime.bootstrap ? "Ready" : "Checking"}</b></span>
            <span>{runtime.environment === "native" && runtime.bootstrap?.worker.state === "ready" ? <CheckCircle2 /> : <CircleAlert />} Generation worker <b className={runtime.environment === "native" && runtime.bootstrap?.worker.state === "ready" ? "" : "amber-text"}>{runtime.environment === "native" ? workerLabel(runtime.bootstrap?.worker) : "Desktop app only"}</b></span>
            <span><CircleAlert /> Voice provider <b className="amber-text">Optional</b></span>
          </div>
          <button className="text-button" onClick={() => onArea("diagnostics")}>Open diagnostics <ArrowRight size={15} /></button>
        </div>
      </section>
    </div>
  );
}

function ProjectsView({ projects, onOpen, onNew }: { projects: ProjectRecord[]; onOpen: (id: string) => void; onNew: () => void }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All");
  const filtered = projects.filter((project) => (filter === "All" || project.status === filter) && `${project.title} ${project.topic}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="page projects-page">
      <PageTitle kicker="Local workbench" title="Projects" description="Each tutorial is a private folder with its own sources, history, artifacts, and exports." action={<button className="primary-button" onClick={onNew}><Plus size={17} /> New tutorial</button>} />
      <div className="toolbar"><label className="search-field"><Search size={16} /><input aria-label="Search projects" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search projects" /></label><div className="filter-pills">{["All", "Planning", "Ready to review", "Complete"].map((item) => <button key={item} onClick={() => setFilter(item)} className={filter === item ? "active" : ""}>{item}</button>)}</div><button className="icon-button"><SlidersHorizontal size={17} /></button></div>
      {filtered.length ? <div className="project-grid">{filtered.map((project) => <ProjectCard key={project.id} project={project} onOpen={() => onOpen(project.id)} />)}<button className="project-card new-card" onClick={onNew}><span><Plus size={24} /></span><strong>Start with a difficult idea</strong><small>Build a grounded learning plan first.</small></button></div> : <EmptyState icon={Search} title={projects.length ? "No projects match" : "Your first tutorial starts here"} detail={projects.length ? "Try a different phrase or clear the current status filter." : "Create a tutorial to keep its sources, scenes, and edits together."} action={projects.length ? <button className="secondary-button" onClick={() => { setQuery(""); setFilter("All"); }}>Clear filters</button> : <button className="primary-button" onClick={onNew}><Plus size={16} /> New tutorial</button>} />}
    </div>
  );
}

function ProjectCard({ project, onOpen }: { project: ProjectRecord; onOpen: () => void }) {
  return <button className="project-card" onClick={onOpen}>
    <div className={`project-card-art art-${project.id}`}><span className="project-card-label">{project.theme}</span>{project.scenes[0] ? <SceneArtwork scene={project.scenes[0]} project={project} compact /> : <Film size={32} />}</div>
    <div className="project-card-body"><div className="project-card-meta"><StatusPill status={project.status} /><span>{project.updatedAt}</span></div><h3>{project.title}</h3><p>{project.description}</p><div className="project-card-footer"><span>{project.scenes.length} scenes · {project.duration} min</span><span>{project.progress}%</span></div><ProgressBar value={project.progress} /></div>
  </button>;
}

function TemplatesView({ onUse }: { onUse: (templateId: string) => void }) {
  const [category, setCategory] = useState("All");
  const shown = category === "All" ? templates : templates.filter((template) => template.category === category);
  return <div className="page">
    <PageTitle kicker="Starting structures" title="Templates" description="Editorially designed learning arcs—not prompt presets. Every structure adapts to your audience and evidence." />
    <div className="template-banner"><div><span className="section-kicker"><Star size={14} /> Featured learning arc</span><h2>Build intuition, then earn the formula.</h2><p>A purpose-built sequence for technical concepts: misconception, visual model, derivation, worked example, and transfer check.</p><button className="light-button" onClick={() => onUse("explain-hard-idea")}>Use this structure <ArrowRight size={15} /></button></div><ConceptDiagram /></div>
    <div className="toolbar template-toolbar"><div className="filter-pills">{["All", "Concept", "Code", "Humanities", "Mathematics", "Software", "Illustrated"].map((item) => <button key={item} className={category === item ? "active" : ""} onClick={() => setCategory(item)}>{item}</button>)}</div></div>
    <div className="template-grid">{shown.map((template) => <article className={`template-card template-${template.color}`} key={template.id}><div className="template-visual"><TemplateArt id={template.id} /><span>{template.category}</span></div><div><small>{template.scenes} suggested scenes</small><h3>{template.name}</h3><p>{template.description}</p><button className="text-button" onClick={() => onUse(template.id)}>Use template <ArrowRight size={15} /></button></div></article>)}</div>
  </div>;
}

function LibraryView({ project, onNotify, onImportSources, onUseBundledAsset }: { project: ProjectRecord | null; onNotify: (title: string, detail: string, tone?: ToastMessage["tone"]) => void; onImportSources: (files: File[]) => Promise<SourceImportReceipt[]>; onUseBundledAsset: (asset: BundledAsset) => Promise<void> }) {
  const [tab, setTab] = useState("Included assets");
  return <div className="page">
    <PageTitle kicker="Ready to teach" title="Library" description="Slide backgrounds and supporting illustrations are ready offline. Add sources or generate more artwork when you need it." />
    <div className="subtabs">{["Included assets", "Project sources"].map((item) => <button className={tab === item ? "active" : ""} onClick={() => setTab(item)} key={item}>{item}</button>)}</div>
    {tab === "Included assets" ? <><p className="inspector-note">{project ? `Choosing an asset adds it to ${project.title}.` : "Browse or download the included collection now. Create a tutorial to use an asset in the editor."}</p><BundledAssetLibrary {...(project ? { onUse: onUseBundledAsset } : {})} /></> : project ? <div className="library-list"><div className="library-list-head"><strong>{project.sources.length} source records</strong><SourceImportControl label="Add source files" onImport={onImportSources} onNotify={onNotify} /></div>{project.sources.length ? project.sources.map((source) => <article className="library-source-record" key={source.id}><span className={`source-icon ${source.kind}`}><FileText size={18} /></span><div><strong>{source.title}</strong><p>{source.origin}{source.byteSize ? ` · ${formatBytes(source.byteSize)}` : ""}</p><small>{source.license} · {source.status}</small></div></article>) : <EmptyState icon={FileText} title="Add evidence for this tutorial" detail="Import your notes, reference documents, or reading material. Their source and rights records stay with the project." />}</div> : <EmptyState icon={Library} title="Open a tutorial to add sources" detail="Your included teaching collection is available in the first tab." />}
  </div>;
}
function catalogItemsFromDiscovery(response: CatalogDiscoveryResponse): CatalogItem[] {
  if (response.source === "hugging-face") {
    return response.items.flatMap((item) => isRecord(item) && typeof item.id === "string"
      ? [adaptHuggingFaceModel(item as unknown as RawHuggingFaceModel, response.retrievedAt)]
      : []);
  }
  if (response.source === "civitai") {
    return response.items.flatMap((item) => {
      if (!isRecord(item) || typeof item.id !== "number") return [];
      const model = item as unknown as RawCivitaiModel & { modelVersions?: RawCivitaiModelVersion[] };
      return (model.modelVersions ?? []).slice(0, 2).flatMap((version) => version && typeof version.id === "number"
        ? [adaptCivitaiModel(model, version, response.retrievedAt)]
        : []);
    });
  }
  if (response.source === "cohere") {
    return response.items.flatMap((item) => {
      if (!isRecord(item)) return [];
      const name = typeof item.name === "string" ? item.name : typeof item.id === "string" ? item.id : null;
      if (!name) return [];
      const endpoints = Array.isArray(item.endpoints) ? item.endpoints.filter((value): value is string => typeof value === "string") : [];
      const capabilities: CatalogCapability[] = endpoints.some((endpoint) => /embed/i.test(endpoint)) ? ["retrieval.embed"] : endpoints.some((endpoint) => /chat/i.test(endpoint)) ? ["llm.text", "llm.structured"] : [];
      const raw: CloudCatalogEndpoint = {
        id: `cohere/${name}`,
        providerId: "cohere",
        publisher: "Cohere",
        name,
        revision: null,
        capabilities,
        modalities: ["text"],
        operationIds: endpoints,
        endpointBaseUrl: "https://api.cohere.com",
        openAiCompatible: false,
        tags: ["cohere", "live-endpoint"],
        credentialConfigured: true,
        reachable: true,
        description: "Model reported by Cohere's authenticated model catalog. Availability and deprecation state remain provider-controlled.",
        documentationUrl: "https://docs.cohere.com/reference/list-models",
        sourceUrl: "https://dashboard.cohere.com/playground/chat",
        retrievedAt: response.retrievedAt,
      };
      return [adaptCloudEndpoint(raw)];
    });
  }
  return response.items.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== "string") return [];
    const id = item.id;
    const capabilities: CatalogCapability[] = [];
    const raw: RawNvidiaCatalogEntry = {
      catalog: "nim",
      id,
      name: id.split("/").at(-1) ?? id,
      publisher: typeof item.owned_by === "string" ? item.owned_by : id.split("/")[0] ?? "NVIDIA API catalog",
      revision: typeof item.root === "string" ? item.root : null,
      description: "Model reported by the connected NVIDIA NIM /v1/models endpoint. Inspect the model documentation and entitlement before routing work.",
      capabilities,
      modalities: capabilities.some((capability) => capability.startsWith("image") || capability === "vlm.review") ? ["multimodal"] : ["text"],
      tags: ["nvidia-nim", "live-endpoint"],
      hostedApi: true,
      downloadable: false,
      operationIds: ["GET /v1/models"],
      endpointBaseUrl: "https://integrate.api.nvidia.com",
      openAiCompatible: true,
      entitlement: "unknown",
      sourceUrl: `https://build.nvidia.com/${encodeURIComponent(id)}`,
      documentationUrl: "https://docs.api.nvidia.com/nim/",
      publisherVerifiedBySource: true,
      retrievedAt: response.retrievedAt,
    };
    return [adaptNvidiaCatalogEntry(raw)];
  });
}


function mergeCatalogItems(existing: readonly CatalogItem[], incoming: readonly CatalogItem[]): CatalogItem[] {
  const merged = new Map(existing.map((item) => [`${item.identity.source}:${item.identity.sourceId}@${item.identity.revision ?? "latest"}`, item]));
  for (const item of incoming) merged.set(`${item.identity.source}:${item.identity.sourceId}@${item.identity.revision ?? "latest"}`, item);
  return [...merged.values()];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

type SyncableCatalogSource = "hugging-face" | "civitai" | "nvidia-nim" | "cohere";

function ProvidersView({ environment, diagnosticReport, onNotify }: { environment: RuntimeState["environment"]; diagnosticReport: DiagnosticReport | null; onNotify: (title: string, detail: string, tone?: ToastMessage["tone"]) => void }) {
  const [mode, setMode] = useState("Hybrid");
  const [secretRefs, setSecretRefs] = useState<Record<string, ProviderSecretRef>>({});
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [secret, setSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [setup, setSetup] = useState<LocalModelSetup | null>(null);
  const [setupLoading, setSetupLoading] = useState(true);
  const [setupSaving, setSetupSaving] = useState(false);
  const [downloadCatalog, setDownloadCatalog] = useState<ModelDownloadCatalogEntry[]>([]);
  const [downloadStatuses, setDownloadStatuses] = useState<ModelDownloadStatus[]>([]);
  const [licenseAccepted, setLicenseAccepted] = useState(false);
  const [downloadStarting, setDownloadStarting] = useState(false);
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>(() => [...alystriaCatalogItems]);
  const [catalogCursors, setCatalogCursors] = useState<Partial<Record<SyncableCatalogSource, string | null>>>({});
  const [catalogSyncing, setCatalogSyncing] = useState<SyncableCatalogSource | null>(null);
  const [catalogSyncedCounts, setCatalogSyncedCounts] = useState<Partial<Record<SyncableCatalogSource, number>>>({});
  const providers = providerConfigs;
  const catalogHardware = useMemo(() => catalogHardwareFromDiagnostics(diagnosticReport), [diagnosticReport]);

  useEffect(() => {
    let active = true;
    void Promise.all(providerConfigs.filter((provider) => !provider.local).map(async (provider) => [provider.id, await providerSecretStatus({ providerId: provider.id, credentialKind: "api_key" })] as const))
      .then((entries) => { if (active) setSecretRefs(Object.fromEntries(entries)); })
      .catch(() => {
        if (active) setSecretRefs(Object.fromEntries(providerConfigs.filter((provider) => !provider.local).map((provider) => [provider.id, { reference: "", providerId: provider.id, credentialKind: "api_key", availability: "keyringUnavailable", updatedAt: null } satisfies ProviderSecretRef])));
      });
    return () => { active = false; };
  }, [environment]);

  useEffect(() => {
    let active = true;
    void localModelSetupGet().then((value) => { if (active) setSetup(value); }).catch((error: unknown) => {
      if (active) onNotify("Local model setup needs attention", errorMessage(error), "warning");
    }).finally(() => { if (active) setSetupLoading(false); });
    return () => { active = false; };
  }, [environment, onNotify]);

  useEffect(() => {
    let active = true;
    const refresh = () => Promise.all([localModelDownloadCatalog(), localModelDownloadStatus()]).then(([catalog, statuses]) => {
      if (active) { setDownloadCatalog(catalog); setDownloadStatuses(statuses); }
    }).catch((error: unknown) => { if (active) onNotify("Model download status needs attention", errorMessage(error), "warning"); });
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 2000);
    return () => { active = false; window.clearInterval(timer); };
  }, [environment, onNotify]);

  const mutateSetup = (update: (current: LocalModelSetup) => LocalModelSetup) => setSetup((current) => current ? update(current) : current);
  const activeProfile = setup?.profiles.find((profile) => profile.id === setup.activeProfileId) ?? setup?.profiles[0] ?? null;
  const catalogHardwareWithConnections = useMemo(() => ({
    ...catalogHardware,
    providerConnectionIds: [...new Set([
      ...catalogHardware.providerConnectionIds,
      ...Object.entries(secretRefs).filter(([, reference]) => reference.availability === "present").map(([providerId]) => providerId),
    ])],
  }), [catalogHardware, secretRefs]);
  const updateProfile = (profileId: string, update: (profile: ModelProfile) => ModelProfile) => mutateSetup((current) => ({ ...current, profiles: current.profiles.map((profile) => profile.id === profileId ? update(profile) : profile) }));
  const createProfile = () => {
    if (!setup || !activeProfile) return;
    const index = setup.profiles.length + 1;
    const id = `custom-profile-${index}`;
    const clone: ModelProfile = { ...structuredClone(activeProfile), id, name: `My profile ${index}`, description: "An explicit, switchable provider and model preference." };
    mutateSetup((current) => ({ ...current, activeProfileId: id, profiles: [...current.profiles, clone] }));
  };
  const removeProfile = () => {
    if (!setup || !activeProfile || setup.profiles.length <= 1) return;
    const next = setup.profiles.find((profile) => profile.id !== activeProfile.id)!;
    mutateSetup((current) => ({ ...current, activeProfileId: next.id, profiles: current.profiles.filter((profile) => profile.id !== activeProfile.id) }));
  };
  const toggleLocalModel = (modelId: string, selected: boolean) => mutateSetup((current) => {
    const next = new Set(current.selectedModelIds);
    if (selected) next.add(modelId); else next.delete(modelId);
    return {
      ...current,
      selectedModelIds: [...next],
      lipSyncModelId: current.lipSyncModelId === modelId && !selected ? null : current.lipSyncModelId,
      portraitAnimationModelId: current.portraitAnimationModelId === modelId && !selected ? null : current.portraitAnimationModelId ?? null,
    };
  });
  const selectLipSync = (modelId: string) => mutateSetup((current) => ({ ...current, lipSyncModelId: modelId, selectedModelIds: [...new Set([...current.selectedModelIds, modelId])] }));
  const selectPortraitAnimation = (modelId: string) => mutateSetup((current) => ({ ...current, portraitAnimationModelId: modelId, selectedModelIds: [...new Set([...current.selectedModelIds, modelId])] }));
  const selectedDownload = downloadCatalog.find((entry) => entry.modelId === setup?.lipSyncModelId) ?? null;
  const selectedDownloadStatus = downloadStatuses.find((status) => status.modelId === selectedDownload?.modelId) ?? null;
  const beginModelDownload = async () => {
    if (!selectedDownload || !licenseAccepted) return;
    setDownloadStarting(true);
    try {
      const status = await localModelDownloadStart({ modelId: selectedDownload.modelId, licenseSha256: selectedDownload.licenseSha256, licenseAccepted: true });
      setDownloadStatuses((current) => [...current.filter((item) => item.modelId !== status.modelId), status]);
      onNotify(status.downloadedBytes > 0 ? "Model download resumed" : "Model download started", "Artifacts are entering the hash-verified quarantine. This does not activate a model or use the GPU.", "success");
    } catch (error) { onNotify("Model download did not start", errorMessage(error), "warning"); }
    finally { setDownloadStarting(false); }
  };
  const saveSetup = async () => {
    if (!setup) return;
    setSetupSaving(true);
    try {
      const saved = await localModelSetupSave({ activeProfileId: setup.activeProfileId, selectedModelIds: setup.selectedModelIds, lipSyncModelId: setup.lipSyncModelId, portraitAnimationModelId: setup.portraitAnimationModelId ?? null, existingModelDirectory: setup.existingModelDirectory, profiles: setup.profiles });
      setSetup(saved);
      onNotify("Setup saved locally", "Your model choices and no-secret profiles were saved. A project still asks for cloud, privacy, and budget approval before a provider call.", "success");
    } catch (error) {
      onNotify("Setup was not saved", errorMessage(error), "warning");
    } finally { setSetupSaving(false); }
  };
  const stageWritingProfileModel = (item: CatalogItem) => {
    if (!activeProfile || !profileProviderIds.includes(item.identity.providerId as typeof profileProviderIds[number])) return;
    updateProfile(activeProfile.id, (profile) => stageCatalogWritingModel(profile, item));
    onNotify("Writing choice staged", `${item.identity.name} is staged in ${activeProfile.name}. Use Save setup & active profile below to keep this choice. Project cloud approval is still required.`, "info");
    window.setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>('[aria-label="Writing & review model"]');
      const scroller = input?.closest<HTMLElement>(".main-content");
      if (input && scroller) {
        const target = input.getBoundingClientRect();
        const viewport = scroller.getBoundingClientRect();
        const previousScrollBehavior = scroller.style.scrollBehavior;
        scroller.style.scrollBehavior = "auto";
        scroller.scrollTop += target.top - viewport.top - ((viewport.height - target.height) / 2);
        window.requestAnimationFrame(() => { scroller.style.scrollBehavior = previousScrollBehavior; });
      }
      input?.focus({ preventScroll: true });
    }, 0);
  };
  const saveSecret = async () => {
    if (!editingProvider || !secret.trim()) return;
    setSaving(true);
    try {
      const reference = await providerSecretSet({ providerId: editingProvider, credentialKind: "api_key", secret });
      setSecretRefs((current) => ({ ...current, [editingProvider]: reference }));
      setSecret(""); setEditingProvider(null);
      onNotify(environment === "native" ? "Credential stored in OS vault" : "Browser demo connection updated", environment === "native" ? `Only an opaque reference is visible to ${PRODUCT_NAME} projects.` : "The preview discarded the credential value and retained only session availability.", "success");
    } catch (error) { onNotify("Credential was not stored", errorMessage(error), "warning"); } finally { setSaving(false); }
  };
  const deleteSecret = async (providerId: string) => {
    try {
      const reference = await providerSecretDelete({ providerId, credentialKind: "api_key" });
      setSecretRefs((current) => ({ ...current, [providerId]: reference }));
      onNotify("Credential removed", environment === "native" ? "The OS vault entry was deleted." : "The browser demo availability flag was cleared.", "info");
    } catch (error) { onNotify("Credential could not be removed", errorMessage(error), "warning"); }
  };
  const syncCatalog = async (source: SyncableCatalogSource) => {
    if (catalogSyncing) return;
    setCatalogSyncing(source);
    try {
      const cursor = catalogCursors[source] ?? null;
      const response = await catalogDiscover({ source, limit: 24, ...(cursor ? { cursor } : {}) });
      const discovered = catalogItemsFromDiscovery(response);
      setCatalogItems((current) => mergeCatalogItems(current, discovered));
      setCatalogCursors((current) => ({ ...current, [source]: response.nextCursor }));
      setCatalogSyncedCounts((current) => ({ ...current, [source]: (current[source] ?? 0) + discovered.length }));
      onNotify(`${source === "hugging-face" ? "Hugging Face" : source === "civitai" ? "Civitai" : source === "cohere" ? "Cohere" : "NVIDIA NIM"} catalog synced`, `${discovered.length} provider rows were normalized. Unknown licenses, mutable revisions, and hardware mismatches remain blocked.`, "success");
    } catch (error) {
      onNotify("Catalog sync needs attention", errorMessage(error), "warning");
    } finally {
      setCatalogSyncing(null);
    }
  };

  return <div className="page">
    <PageTitle kicker="Your compute, your choice" title="Models & providers" description={`${PRODUCT_NAME} only routes work to providers you configure and approve. Local mode blocks project-content networking.`} />
    <section className="routing-card"><div><span className="section-kicker">Routing choices explained</span><h3>{mode} routing</h3><p>{mode === "Local" ? "All generation remains on this device. No cloud fallback." : mode === "Cloud" ? "Use only connected cloud providers after cost and privacy approval." : "Keep private sources local; route approved creative tasks to cloud providers. Choose models in a saved profile below."}</p></div><div className="segmented-large" role="group" aria-label="Compare routing modes">{["Local", "Hybrid", "Cloud"].map((item) => <button key={item} className={mode === item ? "active" : ""} onClick={() => setMode(item)}><span>{item === "Local" ? <HardDrive /> : item === "Cloud" ? <Cloud /> : <Network />}</span>{item}</button>)}</div><div className="routing-facts"><span><ShieldCheck /> No silent fallback</span><span><CircleDollarSign /> Hard budgets enabled</span><span><Lock /> Keys in OS vault</span></div></section>
    <section className="federated-catalog-panel" aria-labelledby="federated-catalog-title">
      <div className="federated-catalog-heading federated-catalog-heading--compact"><div><span className="section-kicker">Find and compare models</span><h2 id="federated-catalog-title">Model library</h2><p>Catalog filters, route comparisons, and resource estimates are temporary. Choose a compatible writing model here, then save it in a model profile below.</p></div><span><Cpu size={16} /> {catalogHardware.gpuNames[0] ?? "Hardware probe pending"}</span></div>
      <details className="catalog-source-disclosure"><summary><span><strong>{defaultCatalogSources.length} catalog sources</strong><small>Curated, connected, public, and local indexes</small></span><span>Browse and sync <ChevronDown size={15} aria-hidden="true" /></span></summary><div className="catalog-source-strip" aria-label="Federated catalog sources">{defaultCatalogSources.map((source) => {
        const syncable = (["hugging-face", "civitai", "nvidia-nim", "cohere"] as const).find((candidate) => candidate === source.id);
        const count = syncable ? catalogSyncedCounts[syncable] ?? 0 : 0;
        const hasMore = syncable ? Boolean(catalogCursors[syncable]) : false;
        return <article key={source.id} className={!source.catalogUrl ? "local-source" : ""}><ProviderMark providerId={source.brandAssetId} compact /><strong>{source.label}</strong><small>{count ? `${count} live rows · ` : ""}{source.discovery.replaceAll("-", " ")} · {source.authentication.replaceAll("-", " ")}</small><span>{source.catalogUrl && <a href={source.catalogUrl} target="_blank" rel="noreferrer">Explore</a>}{syncable && <button type="button" disabled={catalogSyncing !== null || ((syncable === "nvidia-nim" || syncable === "cohere") && secretRefs[syncable]?.availability !== "present")} onClick={() => { void syncCatalog(syncable); }}><RefreshCw size={11} className={catalogSyncing === syncable ? "spinning" : ""} />{catalogSyncing === syncable ? "Syncing…" : hasMore ? "Load more" : "Sync"}</button>}</span></article>;
      })}</div></details>
      <CatalogIntegrationExample hardware={catalogHardwareWithConnections} items={catalogItems} onModelInspected={(item) => onNotify("Model inspected", `${item.identity.name} was reviewed here only. Compare routes and estimates here; save models in a profile below.`, "info")} writingProfileProviderIds={profileProviderIds} {...(setup && activeProfile ? { onUseForWritingProfile: stageWritingProfileModel } : {})} />
    </section>
    <div className="provider-heading"><div><span className="section-kicker">Configured capabilities</span><h2>Provider connections</h2></div><span className="environment-note"><ShieldCheck size={15} /> {environment === "native" ? "OS credential vault" : "Browser demo · values discarded"}</span></div>
    <div className="provider-grid">{providers.map(({ id, name, icon: Icon, detail, tone, local }) => {
      const availability = local ? "manager" : secretRefs[id]?.availability ?? "missing";
      const connected = availability === "present";
      return <article className="provider-card" key={name}><span className={`provider-icon ${tone}`}>{local ? <Icon size={22} /> : <ProviderMark providerId={id === "nvidia-nim" ? "nvidia" : id} compact />}</span><div><h3>{name}</h3><p>{detail}</p></div><span className={`provider-state ${connected || local ? "" : "add"}`}>{connected || local ? <Check size={13} /> : null}{local ? "Manager ready" : connected ? "Connected" : availability === "keyringUnavailable" ? "Vault unavailable" : "Add key"}</span>{local && <div className="model-meter"><span><b>On-demand profiles</b><small>Nothing bundled · download and verify before use</small></span><div><i style={{ width: "18%" }} /></div></div>}{!local && <button className="icon-button" aria-label={`${connected ? "Manage" : "Add"} ${name} credential`} onClick={() => { setEditingProvider(id); setSecret(""); }}><KeyRound size={17} /></button>}</article>;
    })}</div>
    {editingProvider && <section className="credential-panel" aria-labelledby="credential-title"><div><span className="section-kicker">Credential broker</span><h3 id="credential-title">Connect {providers.find((provider) => provider.id === editingProvider)?.name}</h3><p>{environment === "native" ? "The value goes directly to the operating-system vault. Project files receive only an opaque reference." : "Browser demo mode exercises the flow but immediately discards the value."}</p></div><label>API key<input autoFocus type="password" autoComplete="off" value={secret} onChange={(event) => setSecret(event.target.value)} /></label><div className="credential-actions">{secretRefs[editingProvider]?.availability === "present" && <button className="secondary-button danger-text" onClick={() => { void deleteSecret(editingProvider); setEditingProvider(null); }}><X size={15} /> Remove</button>}<button className="secondary-button" onClick={() => { setEditingProvider(null); setSecret(""); }}>Cancel</button><button className="primary-button" disabled={!secret.trim() || saving} onClick={() => { void saveSecret(); }}><KeyRound size={15} /> {saving ? "Saving…" : "Store securely"}</button></div></section>}
    <section className="model-setup-panel" aria-labelledby="local-model-setup-title">
      <div className="model-setup-heading"><div><span className="section-kicker">First-run setup</span><h2 id="local-model-setup-title">Local models, without surprise downloads.</h2><p>Pick a small local profile, bring a pre-existing model folder, or stay API-first. Model weights are never bundled or activated until a signed immutable manifest, license acceptance, hash check, and hardware preflight all pass.</p></div><span className="setup-state"><HardDrive size={15} /> {setupLoading ? "Loading setup" : `${setup?.selectedModelIds.length ?? 0} choices saved`}</span></div>
      <div className="local-model-grid" aria-busy={setupLoading}>{localModelOptions.map((model) => { const selected = setup?.selectedModelIds.includes(model.id) ?? false; return <label className={`local-model-choice ${selected ? "selected" : ""}`} key={model.id}><input type="checkbox" checked={selected} disabled={!setup} onChange={(event) => toggleLocalModel(model.id, event.target.checked)} /><span><b>{model.name}</b><small>{model.medium} · {model.detail}</small></span><em>Manifest required</em></label>; })}</div>
      <div className="existing-model-row"><div><b>Use an existing model folder</b><small>The native app proves the folder exists when you save. It records the location but never executes or activates its contents; a later manifest inspection still has to identify every revision, license, file, and hash.</small>{setup?.existingModelDirectory && <span className="folder-record-state"><FolderClock size={13} /> Folder path entered · save to verify it exists</span>}</div><label><span>Existing folder path</span><input value={setup?.existingModelDirectory ?? ""} disabled={!setup} placeholder={environment === "native" ? "E:\\temp\\AI Video Tutorial Generator Models" : "/your/local/model-folder"} onChange={(event) => mutateSetup((current) => ({ ...current, existingModelDirectory: event.target.value || null }))} /></label></div>
      <div className="lipsync-chooser"><div><span className="section-kicker">Presenter motion stage</span><h3>Choose how portraits come alive</h3><p>Motion and lip-sync are separate stages. The measured local default animates pose, gaze, expression, and genuine blinks with LivePortrait, then uses the selected lip-sync model only for narration-accurate mouth motion.</p></div><div className="lipsync-options">{portraitAnimationModelOptions.map((model) => <label className={setup?.portraitAnimationModelId === model.id ? "selected" : ""} key={model.id}><input type="radio" name="portrait-animation-model" checked={setup?.portraitAnimationModelId === model.id} disabled={!setup || model.id === "local/echomimicv3-flash" || model.id === "local/hunyuan-video-avatar"} onChange={() => selectPortraitAnimation(model.id)} /><span><b>{model.name}</b><small>{model.detail}</small></span><em>{model.tag}</em></label>)}</div></div>
      <div className="lipsync-chooser"><div><span className="section-kicker">Narration mouth stage</span><h3>Choose your local lip-sync model</h3><p>This stage follows portrait animation and may be disabled for presenter-free scenes. Choosing a pack saves a preference; downloading remains a separate explicit step and inference stays blocked until activation review.</p></div><div className="lipsync-options">{lipSyncModelOptions.map((model) => <label className={setup?.lipSyncModelId === model.id ? "selected" : ""} key={model.id}><input type="radio" name="lipsync-model" checked={setup?.lipSyncModelId === model.id} disabled={!setup} onChange={() => { selectLipSync(model.id); setLicenseAccepted(false); }} /><span><b>{model.name}</b><small>{model.detail}</small></span><em>{downloadCatalog.some((entry) => entry.modelId === model.id) ? "Download declaration ready" : model.tag}</em></label>)}</div></div>
      <div className="model-download-panel" aria-live="polite">
        {selectedDownload ? <>
          <div className="download-record"><span className="download-record-mark"><PackageCheck size={19} /></span><div><b>{selectedDownload.displayName} · download-only pack</b><small>{formatBytes(selectedDownload.totalBytes)} across {selectedDownload.artifactCount} artifacts · revision <code>{selectedDownload.immutableRevision}</code></small><p>{selectedDownload.downloadOnlyReason}</p></div><span className={`download-phase ${selectedDownloadStatus?.phase ?? "manifestRequired"}`}>{downloadPhaseLabel(selectedDownloadStatus?.phase)}</span></div>
          <div className="download-progress" aria-label={`${selectedDownload.displayName} download progress`}><i style={{ width: `${selectedDownloadStatus?.totalBytes ? Math.min(100, (selectedDownloadStatus.downloadedBytes / selectedDownloadStatus.totalBytes) * 100) : 0}%` }} /></div>
          <div className="download-detail"><span>{selectedDownloadStatus?.detail ?? "Pinned declaration ready for review."}</span><span>{formatBytes(selectedDownloadStatus?.downloadedBytes ?? 0)} / {formatBytes(selectedDownload.totalBytes)} · {selectedDownloadStatus?.verifiedArtifacts ?? 0}/{selectedDownload.artifactCount} hashes verified</span></div>
          <label className="license-accept"><input type="checkbox" checked={licenseAccepted} disabled={selectedDownloadStatus?.phase === "downloadedQuarantined"} onChange={(event) => setLicenseAccepted(event.target.checked)} /><span>I accept <a href={selectedDownload.licenseUrl} target="_blank" rel="noreferrer">{selectedDownload.licenseId}</a> for this exact license hash <code>{selectedDownload.licenseSha256.slice(0, 12)}…</code>.</span></label>
          <div className="model-setup-actions"><button className="secondary-button" disabled={!licenseAccepted || downloadStarting || environment !== "native" || selectedDownloadStatus?.phase === "downloadedQuarantined" || selectedDownloadStatus?.phase === "downloading" || selectedDownloadStatus?.phase === "verifying"} onClick={() => { void beginModelDownload(); }}><Download size={16} /> {downloadStarting ? "Starting…" : selectedDownloadStatus?.downloadedBytes ? "Resume verified download" : "Start verified download"}</button><small>{environment === "native" ? "Download uses no GPU. Completion means hash-verified and quarantined—not installed, active, or ready for inference." : "Open the native app to download; browser preview never fetches model bytes. A completed native download is still quarantined—not installed, active, or ready for inference."}</small></div>
        </> : <div className="download-empty"><ShieldCheck size={18} /><div><b>No immutable download declaration for this choice</b><small>Keep the preference or choose an existing folder. The app will not fetch a mutable repository snapshot or guess a license.</small></div></div>}
      </div>
    </section>
    <section className="profile-panel" aria-labelledby="profile-title">
      <div className="profile-heading"><div><span className="section-kicker">Switchable creation presets</span><h2 id="profile-title">Provider & model profiles</h2><p>Keep several named combinations for each medium and choose one before creation. The profile only records an explicit preference—routes never switch automatically, no key is stored here, and no cloud use occurs until a project approval gate is completed.</p></div><div className="profile-actions"><button className="secondary-button" disabled={!setup} onClick={createProfile}><Plus size={15} /> Add profile</button><button className="secondary-button danger-text" disabled={!setup || setup.profiles.length <= 1} onClick={removeProfile}><X size={15} /> Remove</button></div></div>
      {setup && activeProfile ? <><div className="profile-tabs" role="tablist" aria-label="Provider profiles">{setup.profiles.map((profile) => <button role="tab" aria-selected={setup.activeProfileId === profile.id} className={setup.activeProfileId === profile.id ? "active" : ""} key={profile.id} onClick={() => mutateSetup((current) => ({ ...current, activeProfileId: profile.id }))}>{profile.name}</button>)}</div><div className="profile-editor"><div className="profile-copy-fields"><label>Name<input value={activeProfile.name} onChange={(event) => updateProfile(activeProfile.id, (profile) => ({ ...profile, name: event.target.value }))} /></label><label>Description<input value={activeProfile.description} onChange={(event) => updateProfile(activeProfile.id, (profile) => ({ ...profile, description: event.target.value }))} /></label></div><div className="profile-route-grid">{profileMediums.map(([medium, label]) => {
        const selection = activeProfile.routes[medium] ?? { providerId: "local-runtime", modelId: "choose before generation" };
        const updateSelection = (changes: Partial<typeof selection>) => updateProfile(activeProfile.id, (profile) => ({ ...profile, routes: { ...profile.routes, [medium]: { ...selection, ...changes } } }));
        const presenterBound = medium === "presenter" || medium === "portraitAnimation" || medium === "lipSync";
        return <label className="profile-route-choice" key={medium}><span>{label}{medium === "images" && <small> · optional</small>}</span><div className="profile-route-fields"><select aria-label={`${label} provider`} value={selection.providerId} onChange={(event) => updateSelection({ providerId: event.target.value })}>{profileProviderOptions.map(([id, name]) => <option value={id} key={id}>{name}</option>)}</select><input value={selection.modelId} aria-label={`${label} model`} onChange={(event) => updateSelection({ modelId: event.target.value })} placeholder="Exact model ID" />{medium === "voice" && <input value={selection.voiceId ?? ""} aria-label={`${label} voice ID`} onChange={(event) => updateSelection({ voiceId: event.target.value || null })} placeholder="Voice ID" />}{presenterBound && <input value={selection.presenterProfileId ?? ""} aria-label={`${label} presenter profile ID`} onChange={(event) => updateSelection({ presenterProfileId: event.target.value || null })} placeholder="Presenter profile ID" />}{selection.providerId === "local-runtime" && <><input value={selection.modelRevision ?? ""} aria-label={`${label} model revision`} onChange={(event) => updateSelection({ modelRevision: event.target.value || null })} placeholder="Immutable revision" /><input value={selection.installFingerprint ?? ""} aria-label={`${label} install fingerprint`} onChange={(event) => updateSelection({ installFingerprint: event.target.value || null })} placeholder="Verified SHA-256" /></>}</div>{medium === "images" && <button type="button" className="secondary-button small" onClick={() => updateSelection({ modelId: "off" })}>{selection.modelId.trim().toLowerCase().startsWith("off") ? "Using designed slides · image generation off" : "Use designed slides without image generation"}</button>}</label>;
      })}</div></div></> : <div className="profile-loading">Loading local profiles…</div>}
      <div className="profile-save-row"><span><ShieldCheck size={15} /> Preferences only · credentials stay in the OS vault · project approval remains required</span><button className="primary-button" disabled={!setup || setupSaving} onClick={() => { void saveSetup(); }}>{setupSaving ? <RefreshCw className="spin" size={16} /> : <Check size={16} />}{setupSaving ? "Saving…" : "Save setup & active profile"}</button></div>
    </section>
  </div>;
}

interface AlystriaPreferences {
  modelCacheDirectory: string;
  renderScratchDirectory: string;
  autosaveSeconds: number;
  backupCount: number;
  confirmCloudTransfer: boolean;
  redactLogs: boolean;
  crashReports: boolean;
  reducedMotion: boolean;
  highContrast: boolean;
  denseEditor: boolean;
  defaultCaptionLanguage: string;
  defaultExportFps: number;
  notifyOnCompletion: boolean;
}

const DEFAULT_ALYSTRIA_PREFERENCES: AlystriaPreferences = {
  modelCacheDirectory: "E:\\temp\\AI Video Tutorial Generator Models",
  renderScratchDirectory: "E:\\temp\\AI Video Tutorial Generator Renders",
  autosaveSeconds: 8,
  backupCount: 12,
  confirmCloudTransfer: true,
  redactLogs: true,
  crashReports: false,
  reducedMotion: false,
  highContrast: false,
  denseEditor: false,
  defaultCaptionLanguage: "Match tutorial",
  defaultExportFps: 30,
  notifyOnCompletion: true,
};

function DiagnosticsView({ runtime, onNotify, onReset, onReplayOnboarding, onReplayTour }: { runtime: RuntimeState; onNotify: (title: string, detail: string, tone?: ToastMessage["tone"]) => void; onReset: () => void; onReplayOnboarding: () => void; onReplayTour: () => void }) {
  const [checking, setChecking] = useState(false);
  const [resetPending, setResetPending] = useState(false);
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [preferences, setPreferences] = usePersistentState<AlystriaPreferences>("alystria-preferences-v1", DEFAULT_ALYSTRIA_PREFERENCES);
  const updatePreference = <K extends keyof AlystriaPreferences>(key: K, value: AlystriaPreferences[K]) => setPreferences((current) => ({ ...current, [key]: value }));
  const runChecks = async () => {
    setChecking(true);
    try {
      const result = await diagnosticsRun();
      setReport(result);
      onNotify("Diagnostics complete", `${result.checks.filter((check) => check.level === "pass").length} of ${result.checks.length} checks passed; informational and warning results remain visible.`, result.overall === "failure" || result.overall === "warning" ? "warning" : "success");
    } catch (error) {
      onNotify("Diagnostics failed", errorMessage(error), "warning");
    } finally {
      setChecking(false);
    }
  };
  const rows = report?.checks ?? [
    { id: "project-storage", label: "Project storage", level: runtime.bootstrap ? "pass" : "info", summary: runtime.bootstrap?.paths.projects ?? "Waiting for desktop bootstrap" },
    { id: "pipeline-worker", label: "Pipeline worker", level: runtime.bootstrap?.worker.state === "ready" ? "pass" : "warning", summary: workerLabel(runtime.bootstrap?.worker) },
    { id: "frame-renderer", label: "Frame renderer", level: "info", summary: "Run diagnostics to verify the installed renderer" },
    { id: "power-profile", label: "Power profile", level: "info", summary: "Silent profile respected; no changes requested" },
  ];
  return <div className="page">
    <PageTitle kicker="Settings & diagnostics" title="A healthy studio is predictable." description="Inspect local runtimes, storage, privacy, accessibility, and recovery without changing your Windows power profile." action={<button className="primary-button" onClick={() => { void runChecks(); }} disabled={checking}>{checking ? <RefreshCw className="spin" size={17} /> : <Activity size={17} />}{checking ? " Running checks" : " Run diagnostics"}</button>} />
    <div className="diagnostics-grid">
      <section className="diagnostic-panel wide"><div className="panel-heading"><div><span className="section-kicker">System readiness</span><h3>{runtime.environment === "native" ? "Native toolchain" : "Browser preview"}</h3></div><span className="health-score">{rows.filter((row) => row.level === "pass").length} / {rows.length} passed</span></div><div className="diagnostic-rows">{rows.map((row) => { const Icon = diagnosticIcon(row.id); const ready = row.level === "pass"; return <div key={row.id}><span className="diagnostic-icon"><Icon size={17} /></span><span><strong>{row.label}</strong><small>{row.summary}</small></span><span className={`check-state ${ready ? "ready" : "attention"}`}>{ready ? <Check size={13} /> : <CircleAlert size={13} />}{row.level}</span></div>; })}</div></section>
      <section className="diagnostic-panel"><span className="section-kicker">Privacy boundary</span><div className="privacy-orbit"><Lock size={22} /><i /><i /></div><h3>Local means local.</h3><p>Analytics are off. Private source contents cannot leave this device unless you explicitly reclassify them.</p><button className="text-button" onClick={() => document.getElementById("privacy-controls")?.scrollIntoView({ behavior: preferences.reducedMotion ? "instant" : "smooth", block: "center" })}>Review privacy controls <ArrowRight size={15} /></button></section>
      <section className="diagnostic-panel"><span className="section-kicker">Power & performance</span><div className="power-mode"><Moon size={22} /><span><strong>Silent profile respected</strong><small>Benchmarks are estimation-only</small></span></div><p>{PRODUCT_NAME} won’t change Windows or G-Helper power modes. Use a performance profile only for deliberate benchmark runs.</p><button className="text-button" onClick={() => onNotify("Power profile unchanged", "No benchmark needs boost for functional acceptance.", "info")}>Why this is recommended <ArrowRight size={15} /></button></section>
      <section className="diagnostic-panel wide intricate-settings"><div className="panel-heading"><div><span className="section-kicker">Storage & recovery</span><h3>Keep heavy work away from the system drive</h3></div><HardDrive size={21} /></div><div className="settings-form-grid"><label><span>Model cache</span><input readOnly value={runtime.bootstrap?.paths.models ?? "Open the desktop app to inspect the model directory"} /></label><label><span>Render scratch</span><input readOnly value={runtime.bootstrap?.paths.cache ?? "Open the desktop app to inspect the cache directory"} /></label><label><span>Autosave interval</span><select value={preferences.autosaveSeconds} onChange={(event) => updatePreference("autosaveSeconds", Number(event.target.value))}><option value="3">3 seconds</option><option value="8">8 seconds</option><option value="15">15 seconds</option><option value="30">30 seconds</option></select></label><p className="settings-intro">These are the active desktop locations. Attach existing model folders in Models & providers. Export a portable project archive to make a backup.</p></div></section>
      <section id="privacy-controls" className="diagnostic-panel wide intricate-settings"><div className="panel-heading"><div><span className="section-kicker">Privacy & trust</span><h3>Every external boundary remains deliberate</h3></div><ShieldCheck size={21} /></div><div className="settings-toggle-grid"><div className="settings-policy"><Cloud size={20} /><strong>Cloud use needs project approval</strong><p>A provider connection does not grant permission to transfer private sources.</p></div><div className="settings-policy"><Lock size={20} /><strong>Credentials stay in the OS vault</strong><p>Project files store credential references, never key values.</p></div><div className="settings-policy"><ShieldCheck size={20} /><strong>Crash reports stay local</strong><p>No automatic reporting service is connected.</p></div></div></section>
      <section className="diagnostic-panel wide intricate-settings"><div className="panel-heading"><div><span className="section-kicker">Editor & accessibility</span><h3>Fit the creative surface to the person</h3></div><MonitorPlay size={21} /></div><div className="settings-toggle-grid"><SettingsToggle checked={preferences.reducedMotion} title="Reduce interface motion" detail="Preserve hierarchy and feedback without camera-like transitions." onChange={(value) => updatePreference("reducedMotion", value)} /><SettingsToggle checked={preferences.highContrast} title="High-contrast controls and guides" detail="Increase control boundaries, focus rings and canvas guide contrast." onChange={(value) => updatePreference("highContrast", value)} /><SettingsToggle checked={preferences.denseEditor} title="Dense multitrack editor" detail="Show more tracks and inspector fields on large displays." onChange={(value) => updatePreference("denseEditor", value)} /></div><div className="settings-form-grid"><p className="settings-intro">Captions follow the narration language. Select that language when creating a tutorial.</p><label><span>Default export rate</span><select value={preferences.defaultExportFps} onChange={(event) => updatePreference("defaultExportFps", Number(event.target.value))}><option value="24">24 fps</option><option value="30">30 fps</option><option value="60">60 fps</option></select></label></div></section>
      <section className="diagnostic-panel wide compact-settings"><div><span className="section-kicker">Tutorial & maintenance</span><h3>Replay guidance or clean local UI state</h3></div><div className="setting-actions"><button className="secondary-button" onClick={onReplayOnboarding}><PlayCircle size={16} /> Replay setup</button><button className="secondary-button" onClick={onReplayTour}><Sparkles size={16} /> Replay guided tour</button><button className="secondary-button" onClick={() => onNotify("Export a project backup", "Open a tutorial and choose Export → Export portable .alytutorial to save a verified project archive.", "info")}><Archive size={16} /> How to back up</button><button className="secondary-button danger-text" onClick={() => setResetPending(true)}><RotateCcw size={16} /> Reset workspace view</button>{resetPending && <div className="workspace-reset-confirm" role="alert"><p>Clear recent tutorial links and the visible job list? Saved project folders and provider settings remain on disk.</p><button className="secondary-button" onClick={() => setResetPending(false)}>Keep workspace view</button><button className="secondary-button danger-text" onClick={() => { onReset(); setResetPending(false); }}>Clear workspace view</button></div>}</div></section>
    </div>
  </div>;
}

function SettingsToggle({ checked, title, detail, onChange }: { checked: boolean; title: string; detail: string; onChange: (checked: boolean) => void }) {
  return <label className="settings-toggle"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span><strong>{title}</strong><small>{detail}</small></span><i aria-hidden="true" /></label>;
}

function ProjectWorkspace(props: {
  workspace: Workspace;
  project: ProjectRecord;
  activeScene: Scene;
  mode: StudioMode;
  version: number;
  jobs: JobRecord[];
  environment: RuntimeState["environment"];
  onWorkspace: (workspace: Workspace) => void;
  onScene: (scene: Scene) => void;
  onSelectScene: (sceneId: string) => void;
  onSceneUpdate: (sceneId: string, update: Partial<Scene>) => void;
  onProjectCustomization: (customization: CanvasCustomization, receipt?: ProjectAssetImportReceipt) => void;
  onProjectCreative: (creative: CreativeConfiguration) => void;
  onProjectEdit: (update: Pick<Partial<ProjectRecord>, "scenes" | "sceneCandidates" | "customization" | "editorDocument" | "reviewNotes" | "nativeHeadRevisionId" | "nativeRevisionNumber">, options?: { alreadyDurable?: boolean }) => void;
  onEditorDocumentChange: (document: EditorProject) => void;
  onFlushEditorDocument: () => Promise<void>;
  editorSaveStatus?: EditorSaveStatus;
  onRegenerate: (scene: Scene) => void;
  onNotify: (title: string, detail: string, tone?: ToastMessage["tone"]) => void;
  onAddJob: (job: JobRecord) => void;
  onImportSources: (files: File[]) => Promise<SourceImportReceipt[]>;
  onExportArchive: () => Promise<string>;
  onApproveGeneration: () => void;
  approvalPending: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onRenderScene: (scene: Scene) => void;
  onRepairQa: () => void;
  onExportMaster: (settings: ExportRequestSettings) => Promise<JobReceipt>;
}) {
  if (props.workspace === "plan") return <PlanWorkspace {...props} />;
  if (props.workspace === "storyboard") return <StoryboardWorkspace {...props} />;
  if (props.workspace === "studio") return <StudioWorkspace {...props} />;
  if (props.workspace === "review") return <ReviewWorkspace {...props} />;
  return <ExportWorkspace {...props} />;
}

type ProjectWorkspaceProps = Parameters<typeof ProjectWorkspace>[0];

function ProjectHeader({ project, step, title, description, action }: { project: ProjectRecord; step: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="project-page-header"><div><span className="section-kicker">{step} · {project.locale} · {project.audience}</span><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}

function PlanWorkspace({ project, onNotify, onApproveGeneration, approvalPending, onImportSources, onSceneUpdate, onUndo, onRedo }: ProjectWorkspaceProps) {
  const [tab, setTab] = useState("Learning plan");
  const objectiveScenes = project.scenes.filter((scene) => scene.objective.trim());
  const reviewedSources = project.sources.filter((source) => source.status === "verified").length;
  return <div className="page project-page plan-workspace">
    <ProjectHeader project={project} step="1 · Plan" title="Shape the learning journey" description="Start with the learner. Connect each scene to something they should understand." action={<button className="primary-button" data-tour-target="approve-plan" disabled={approvalPending} aria-busy={approvalPending} onClick={onApproveGeneration}>{approvalPending ? "Saving reviewed plan…" : "Approve learning plan"} {!approvalPending && <ArrowRight size={16} />}</button>} />
    <div className="plan-progress" aria-label="Plan sections">{["Brief", "Sources", "Research", "Learning plan", "Script"].map((item, index) => <button key={item} data-tour-route={item === "Sources" ? "plan-sources" : undefined} className={tab === item ? "active" : ""} onClick={() => setTab(item)}><i>{index + 1}</i><span>{item}</span></button>)}</div>
    <div className="plan-grid"><section className="plan-main-card">
      <div className="card-title-row"><div><span className="section-kicker">{project.title}</span><h2>{tab === "Learning plan" ? "What should the learner take away?" : tab}</h2></div></div>
      {tab === "Learning plan" ? <><div className="learner-strip"><div><UserRoundCheck size={18} /><span><small>Learner</small><strong>{project.audience}</strong></span></div><div><Clock3 size={18} /><span><small>Target</small><strong>{project.duration} minutes</strong></span></div><div><Languages size={18} /><span><small>Language</small><strong>{project.locale}</strong></span></div></div>
        <div className="objective-section"><div className="section-number"><BookOpen size={22} /></div><div><span className="section-kicker">Scene learning objectives</span><div className="objective-list">{objectiveScenes.map((scene) => <div key={scene.id}><span>{scene.index}</span><label className="objective-edit"><small>{scene.title}</small><textarea aria-label={`Objective for ${scene.title}`} rows={2} value={scene.objective} onChange={(event) => onSceneUpdate(scene.id, { objective: event.target.value })} /></label></div>)}</div>{!objectiveScenes.length && <p>Add a scene objective in Studio to begin the learning plan.</p>}</div></div>
        <div className="learning-sequence"><span className="section-kicker">The teaching sequence</span>{project.scenes.map((scene) => <div key={scene.id}><span>{String(scene.index).padStart(2, "0")}</span><strong>{scene.title}</strong><small>{formatTime(scene.duration)}</small></div>)}</div>
      </> : tab === "Brief" ? <div className="brief-document"><span className="section-kicker">The question</span><h3>{project.topic}</h3><p>{project.description}</p><dl><div><dt>Who is learning?</dt><dd>{project.audience}</dd></div><div><dt>Available time</dt><dd>{project.duration} minutes</dd></div><div><dt>Language</dt><dd>{project.locale}</dd></div><div><dt>Privacy</dt><dd>{project.privacy}</dd></div></dl><p>Review and edit the scene objectives and script before approving this plan.</p></div> : tab === "Sources" || tab === "Research" ? <SourceEvidence project={project} research={tab === "Research"} onImportSources={onImportSources} onNotify={onNotify} /> : <ScriptEditor project={project} onNotify={onNotify} onSceneUpdate={onSceneUpdate} onUndo={onUndo} onRedo={onRedo} />}
    </section><aside className="plan-aside"><div className="grounding-card"><div className="grounding-head"><span><ShieldCheck size={17} /> Sources & support</span></div><p>Source review and claim support are separate. Review the rendered lesson before export.</p><div className="grounding-meter"><span><strong>{reviewedSources} / {project.sources.length}</strong><small>source records reviewed</small></span><ProgressBar value={project.sources.length ? reviewedSources / project.sources.length * 100 : 0} /></div><button className="text-button" onClick={() => setTab("Sources")}>Review sources <ArrowRight size={15} /></button></div><div className="teaching-note"><span className="section-kicker">A useful review question</span><h3>Could they explain it back?</h3><p>Give each scene one job. Show an example, let the learner predict the next step, then explain what changed.</p><button className="text-button" onClick={() => setTab("Script")}>Read the full script <ArrowRight size={15} /></button></div></aside></div>
  </div>;
}

function SourceEvidence({ project, research, onImportSources, onNotify }: { project: ProjectRecord; research: boolean; onImportSources: (files: File[]) => Promise<SourceImportReceipt[]>; onNotify: ProjectWorkspaceProps["onNotify"] }) {
  return <div className="source-evidence"><div className="source-table-head"><span>{research ? "Evidence ledger" : "Project sources"}</span><SourceImportControl label="Add source" onImport={onImportSources} onNotify={onNotify} secondary small tourTarget="source-import" /></div>{project.sources.length ? project.sources.map((source) => <article key={source.id}><span className={`source-icon ${source.kind}`}><FileText size={17} /></span><div><strong>{source.title}</strong><small>{source.origin} · {source.license}{source.byteSize ? ` · ${formatBytes(source.byteSize)}` : ""}</small></div><span className="evidence-count">{source.evidence} {research ? "spans" : "claims"}</span><span className={`source-state ${source.status}`}>{source.status === "verified" ? <CheckCircle2 size={14} /> : <CircleAlert size={14} />} {source.status}</span><span aria-hidden="true"><ChevronRight size={16} /></span></article>) : <EmptyState icon={FileText} title="No source files yet" detail="Choose local files to validate in quarantine and preserve in this project’s content-addressed store." />}</div>;
}

function ScriptEditor({ project, onSceneUpdate, onUndo, onRedo }: { project: ProjectRecord; onNotify: ProjectWorkspaceProps["onNotify"]; onSceneUpdate: ProjectWorkspaceProps["onSceneUpdate"]; onUndo?: () => void; onRedo?: () => void }) {
  return <div className="script-editor"><div className="script-toolbar"><span>{project.scenes.reduce((count, scene) => count + scene.narration.split(/\s+/u).filter(Boolean).length, 0)} words · debounced to project history</span><div><button onClick={onUndo} aria-label="Undo durable revision"><Undo2 size={15} /></button><button onClick={onRedo} aria-label="Redo durable revision"><Redo2 size={15} /></button><span className="script-save-status"><Check size={15} /> Edits save automatically</span></div></div>{project.scenes.map((scene) => <div className="script-block" key={scene.id}><span>S{scene.index.toString().padStart(2, "0")}</span><div><strong>{scene.title}</strong><p contentEditable suppressContentEditableWarning onBlur={(event) => onSceneUpdate(scene.id, { narration: event.currentTarget.textContent ?? "" })}>{scene.narration}</p><small>{scene.citations} citations · {scene.duration}s target</small></div></div>)}</div>;
}

function StoryboardWorkspace({ project, onScene, onRegenerate, onWorkspace, onProjectEdit }: ProjectWorkspaceProps) {
  const [view, setView] = useState<"cards" | "list">("cards");
  const approved = project.scenes.filter((scene) => scene.status === "approved").length;
  const addScene = () => {
    const scene: Scene = { id: `scene-${crypto.randomUUID()}`, index: project.scenes.length + 1, title: "New teaching moment", kind: "definition", duration: 20, narration: "", objective: "Describe what the learner should understand.", status: "draft", visual: "thread", citations: 0, locked: false };
    onProjectEdit({ scenes: [...project.scenes, scene] });
    onScene(scene);
  };
  return <div className="page project-page storyboard-workspace">
    <ProjectHeader project={project} step="2 · Storyboard" title="See the teaching sequence" description="Every card joins a learning objective, narration beat, evidence, and visual treatment." action={<div className="header-action-group"><button className="secondary-button" onClick={() => onWorkspace("plan")}><ArrowLeft size={16} /> Learning plan</button><button className="primary-button" onClick={() => onWorkspace("studio")}>Open studio <ArrowRight size={16} /></button></div>} />
    <div className="storyboard-status"><div><span className="status-ring"><strong>{approved}</strong><small>of {project.scenes.length}</small></span><span><strong>{approved} scenes approved</strong><small>{project.scenes.filter((scene) => scene.status === "attention").length} scenes need review · {project.scenes.filter((scene) => scene.status === "draft").length} drafts</small></span></div><div className="storyboard-toolbar"><button onClick={() => onWorkspace("plan")}><AlignLeft size={15} /> Edit learning plan</button><span className="view-toggle"><button className={view === "cards" ? "active" : ""} onClick={() => setView("cards")} aria-label="Card view"><TableProperties size={16} /></button><button className={view === "list" ? "active" : ""} onClick={() => setView("list")} aria-label="List view"><AlignLeft size={16} /></button></span></div></div>
    <div className={`storyboard-list ${view}`}>
      <div className="section-thread-label"><span>Section 01</span><strong>{project.topic}</strong><small>{formatTime(project.scenes.reduce((total, scene) => total + scene.duration, 0))}</small></div>
      {project.scenes.map((scene) => <article className={`storyboard-card status-${scene.status}`} key={scene.id}>
        <div className="scene-order"><span>{String(scene.index).padStart(2, "0")}</span><i /></div>
        <button className="scene-thumbnail" onClick={() => onScene(scene)} aria-label={`Edit ${scene.title}`}><SceneArtwork scene={scene} project={project} compact /><span className="scene-duration">{formatTime(scene.duration)}</span><span className="scene-play"><Play size={15} fill="currentColor" /></span></button>
        <div className="scene-card-copy"><div className="scene-card-top"><span className={`scene-kind kind-${scene.kind}`}>{scene.kind.replace("-", " ")}</span><SceneStatus status={scene.status} /></div><button className="scene-title-button" onClick={() => onScene(scene)}><h3>{scene.title}</h3></button><p>{scene.narration}</p><div className="scene-objective"><span>Teaches</span>{scene.objective}</div><div className="scene-metadata"><span><Link2 size={14} /> {scene.citations} citations</span><span><AudioLines size={14} /> Narration draft</span>{scene.locked && <span><Lock size={13} /> Preserved</span>}</div></div>
        <div className="scene-card-actions"><button className="icon-button" aria-label={`Edit ${scene.title} details`} onClick={() => onScene(scene)}><Pencil size={17} /></button><button className="secondary-button small" onClick={() => onRegenerate(scene)}><RefreshCw size={14} /> Regenerate</button></div>
        {scene.status === "attention" && <div className="review-ribbon"><CircleAlert size={14} /> This scene needs review</div>}
      </article>)}
      <button className="add-scene-card" onClick={addScene}><Plus size={19} /><span><strong>Add a teaching moment</strong><small>Start a scene, then choose its visual treatment in Studio</small></span></button>
    </div>
  </div>;
}

function StudioWorkspace({ project, activeScene, mode, version, environment, jobs, onSelectScene, onSceneUpdate, onProjectCustomization, onProjectCreative, onRegenerate, onUndo, onRedo, onRenderScene, onNotify, onProjectEdit, onEditorDocumentChange, onFlushEditorDocument, editorSaveStatus, onAddJob }: ProjectWorkspaceProps) {
  const [playing, setPlaying] = useState(false);
  const [previewSeconds, setPreviewSeconds] = useState(0);
  const activeIndex = project.scenes.findIndex((scene) => scene.id === activeScene.id);
  const generationJob = project.nativeGenerationId ? jobs.find((job) => job.id === project.nativeGenerationId) : undefined;
  const canEditGeneratedTiming = !project.nativeGenerationId || generationJob?.status === "complete";
  useEffect(() => { setPreviewSeconds(0); setPlaying(false); }, [activeScene.id]);
  useEffect(() => {
    if (!playing) return;
    let previous = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const elapsed = (now - previous) / 1000;
      previous = now;
      setPreviewSeconds((current) => Math.min(activeScene.duration, current + elapsed));
    }, 33);
    return () => window.clearInterval(timer);
  }, [playing, activeScene.duration]);
  useEffect(() => { if (previewSeconds >= activeScene.duration) setPlaying(false); }, [previewSeconds, activeScene.duration]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [returningFromEditor, setReturningFromEditor] = useState(false);
  const [editorProject, setEditorProject] = useState<EditorProject>(() => project.editorDocument ?? createEditorProjectFromAlystriaProject(project, { now: new Date().toISOString() }));
  const [editorImportRights, setEditorImportRights] = useState<"unknown" | "owned" | "licensed" | "publicDomain">("unknown");
  const editorImportController = useRef<BrowserMediaImportController | null>(null);
  if (!editorImportController.current) editorImportController.current = new BrowserMediaImportController(editorProject.frameRate);
  useEffect(() => () => editorImportController.current?.dispose(), []);
  const [inspectorTab, setInspectorTab] = useState("Content");
  const [zoom, setZoom] = useState(72);
  const [assetPreviews, setAssetPreviews] = useState<Record<string, string>>({});
  const assetPreviewsRef = useRef(assetPreviews);
  const projectRef = useRef(project);
  projectRef.current = project;
  const openAdvancedEditor = async () => {
    try {
      const current = projectRef.current;
      const identity = nativeProjectLink(current);
      const generationComplete = jobs.some((job) => job.id === current.nativeGenerationId && job.status === "complete");
      const mediaBindings = environment === "native" && identity && current.nativeGenerationId && generationComplete
        ? await editorBindingsGet({ ...identity, generationId: current.nativeGenerationId }) : undefined;
      const now = new Date().toISOString();
      let document = current.editorDocument
        ? mediaBindings ? mergeAlystriaMediaBindings(current.editorDocument, mediaBindings, now) : current.editorDocument
        : createEditorProjectFromAlystriaProject(current, { now, ...(mediaBindings ? { mediaBindings } : {}) });
      if (current.editorDocument) {
        const derived = createEditorProjectFromAlystriaProject(current, { now });
        const existingIds = new Set(document.assets.map((asset) => asset.id));
        document = { ...document, assets: [...document.assets, ...derived.assets.filter((asset) => asset.hash && !existingIds.has(asset.id))] };
      }
      if (environment === "native" && identity) document = await resolveNativeEditorMedia(document, identity, projectAssetResolve);
      else document = { ...document, assets: document.assets.map((asset) => {
        const included = bundledAssets.find((item) => item.sha256 === asset.hash);
        return included ? { ...asset, status: "ready" as const, uri: included.url, previewUrl: included.url, thumbnailUrl: included.url } : asset;
      }) };
      setEditorProject(document);
      setEditorOpen(true);
    } catch (error) {
      onNotify("Editor media needs attention", errorMessage(error), "warning");
    }
  };
  const importEditorMedia = async (files: readonly File[]) => {
    const identity = nativeProjectLink(projectRef.current);
    if (!identity) throw new Error("Open a saved desktop project before importing media.");
    return importNativeEditorMedia(files, identity, editorImportController.current!, editorImportRights, projectAssetResolve, (update) => {
      projectRef.current = { ...projectRef.current, ...update };
      onProjectEdit(update, { alreadyDurable: true });
    });
  };
  const resolveEditorWaveform = async (asset: EditorMediaAsset) => {
    const identity = nativeProjectLink(projectRef.current);
    if (!identity) throw new Error("Open a desktop project before loading waveforms.");
    return resolveEditorWaveformNative(asset, editorProject.frameRate, identity, editorWaveformGet, convertFileSrc);
  };
  const renderEditorTimeline = async (document: EditorProject) => {
    const identity = nativeProjectLink(projectRef.current);
    if (!identity) throw new Error("Open a saved desktop project before rendering a timeline.");
    const prepared = prepareEditorProjectForPersistence(document);
    onEditorDocumentChange(prepared);
    await onFlushEditorDocument();
    const current = await projectSnapshotGet(identity);
    const submitted = await exportEditorTimelineNative(prepared, { ...identity, expectedHeadRevisionId: current.headRevisionId }, editorTimelineExport, { name: "vp9" });
    let receipt: JobReceipt = { ...submitted, operation: "editor_timeline_export" };
    const link = { ...identity, jobId: receipt.jobId };
    const recordReceipt = (value: JobReceipt) => onAddJob(receiptJob(value, `Timeline · ${project.title}`, value.message, link));
    recordReceipt(receipt);
    while (!["SUCCEEDED", "FAILED", "CANCELLED", "STALE", "BLOCKED"].includes(receipt.state)) {
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
      receipt = await jobStatus(link);
      recordReceipt(receipt);
    }
    const result = editorTimelineExportResult(receipt, identity.projectId);
    if (!result) throw new Error(receipt.message || "Timeline render did not complete.");
    onNotify("Edited video exported", result.outputPath, "success");
    return result;
  };
  const returnToScene = async () => {
    if (returningFromEditor) return;
    setReturningFromEditor(true);
    try {
      await onFlushEditorDocument();
      setEditorOpen(false);
    } catch (error) {
      onNotify("Timeline is not saved", `${errorMessage(error)} The editor remains open so you can retry.`, "warning");
    } finally {
      setReturningFromEditor(false);
    }
  };
  const customization = canvasCustomization(project);
  const creative = project.creative ?? DEFAULT_CREATIVE_CONFIGURATION;
  useEffect(() => { setEditorProject(projectRef.current.editorDocument ?? createEditorProjectFromAlystriaProject(projectRef.current, { now: new Date().toISOString() })); }, [project.id]);
  useEffect(() => { assetPreviewsRef.current = assetPreviews; }, [assetPreviews]);
  useEffect(() => () => Object.values(assetPreviewsRef.current).forEach((url) => URL.revokeObjectURL(url)), []);
  const previewIdentity = useMemo(() => project.nativeProjectId && project.nativeProjectDirectory ? { projectId: project.nativeProjectId, projectDirectory: project.nativeProjectDirectory } : null, [project.nativeProjectId, project.nativeProjectDirectory]);
  const previewAssetKey = JSON.stringify(customization.assets.filter((asset) => asset.source !== "starter-pack" && ["presenter", "background"].includes(asset.kind) && asset.sha256).map((asset) => ({ id: asset.id, hash: asset.sha256 })));
  useEffect(() => {
    let cancelled = false;
    const assets = JSON.parse(previewAssetKey) as Array<{ id: string; hash: string }>;
    void Promise.all(assets.map(async (asset) => {
      const included = bundledAssets.find((item) => item.sha256 === asset.hash);
      if (included) return [asset.id, included.url] as const;
      if (environment !== "native" || !previewIdentity) return null;
      try { const stored = await projectAssetResolve({ ...previewIdentity, artifactHash: asset.hash }); return [asset.id, convertFileSrc(stored.path)] as const; }
      catch { return null; }
    })).then((entries) => { if (!cancelled) setAssetPreviews((previous) => ({ ...previous, ...Object.fromEntries(entries.filter((entry) => entry !== null)) })); });
    return () => { cancelled = true; };
  }, [previewAssetKey, environment, previewIdentity]);
  const selectedPresenter = customization.presenter.assetId ? assetPreviews[customization.presenter.assetId] : undefined;
  const selectedBackground = customization.backgroundAssetId ? assetPreviews[customization.backgroundAssetId] ?? STARTER_BACKGROUND_PREVIEWS[customization.backgroundAssetId] : undefined;
  const canvasStyle = {
    "--project-paper": customization.colors.paper,
    "--project-ink": customization.colors.ink,
    "--project-accent": customization.colors.accent,
    "--project-evidence": customization.colors.evidence,
    "--project-display": `"${customization.displayFont}", sans-serif`,
    "--project-body": `"${customization.bodyFont}", sans-serif`,
    "--project-type-scale": customization.typeScale / 100,
    "--project-corner": `${customization.cornerRadius}px`,
    "--project-shadow": customization.shadowStrength / 100,
  } as React.CSSProperties;
  const [generatingVisual, setGeneratingVisual] = useState(false);
  const candidateImages = visualCandidates(project.sceneCandidates).filter((candidate) => candidate.sceneId === activeScene.id);
  const resolveCandidateImage = useCallback(async (artifactHash: string) => {
    const identity = nativeProjectLink(projectRef.current);
    if (!identity) throw new Error("Open a desktop project to review saved images.");
    const resolved = await projectAssetResolve({ ...identity, artifactHash });
    return convertFileSrc(resolved.path);
  }, []);
  const reloadCandidateProject = async () => {
    const current = projectRef.current;
    const identity = nativeProjectLink(current);
    if (!identity) return;
    const durable = await projectSnapshotGet(identity);
    const next = hydrateDurableProject(current, durable.snapshot, { nativeProjectId: identity.projectId, nativeProjectDirectory: identity.projectDirectory, nativeHeadRevisionId: durable.headRevisionId, nativeRevisionNumber: durable.revisionNumber });
    projectRef.current = next;
    onProjectEdit(next, { alreadyDurable: true });
  };
  const acceptCandidateImage = async (candidate: VisualCandidate) => {
    const identity = nativeProjectLink(projectRef.current);
    if (!identity) throw new Error("Open a desktop project before choosing artwork.");
    const durable = await projectSnapshotGet(identity);
    await sceneCandidateAccept({ ...identity, expectedHeadRevisionId: durable.headRevisionId, candidateId: candidate.id });
    await reloadCandidateProject();
    onNotify("Image selected", "Your choice, source, and usage rights are saved with this tutorial.", "success");
  };
  const generateVisual = async (role: "scene" | "presenter") => {
    if (generatingVisual) return;
    const current = projectRef.current;
    const identity = nativeProjectLink(current);
    if (environment !== "native" || !identity) { onNotify("Open the desktop app", "New images use your connected image provider or an installed local model. Included assets are available in Library.", "info"); return; }
    setGeneratingVisual(true);
    try {
      const durable = await projectSnapshotGet(identity);
      const saved = await projectSnapshotSave({ ...identity, expectedHeadRevisionId: durable.headRevisionId, snapshot: { ...durable.snapshot, creative }, message: "Saved image generation recipe" });
      onProjectEdit({ nativeHeadRevisionId: saved.headRevisionId, nativeRevisionNumber: saved.revisionNumber }, { alreadyDurable: true });
      const imageModel = role === "presenter" ? creative.presenter.baseModel : creative.slide.imageModel;
      const loras = role === "presenter" ? creative.presenter.loras : creative.slide.loras;
      if (loras.some((id) => id !== "local/sdxl-offset-lora-1.0")) throw new Error("Choose the supported official SDXL LoRA in the generation panel before continuing.");
      let receipt = await sceneRegenerate({ ...identity, baseRevisionId: saved.headRevisionId, sceneId: activeScene.id, role, seed: role === "presenter" ? creative.presenter.seed ?? creative.slide.seed : creative.slide.seed, ...(imageModel === "local/sdxl-base-1.0" ? { imageRecipe: { model: "local/sdxl-base-1.0" as const, loras: loras as Array<"local/sdxl-offset-lora-1.0">, negativePrompt: role === "presenter" ? creative.presenter.negativePrompt : "text, watermark, labels, captions" } } : {}), instruction: role === "presenter" ? `${creative.presenter.style}. ${creative.presenter.prompt}` : `${creative.slide.prompt || "Calm text-free educational artwork with room for editable lesson content"}. Lesson context: ${activeScene.title}. ${activeScene.objective}. No text, labels, letters, or watermark.`, preservationLocks: ["narration", "citations", "learningobjective"], alternatives: 1 });
      const link = { ...identity, jobId: receipt.jobId };
      const record = () => onAddJob(receiptJob(receipt, role === "presenter" ? "New teacher portrait" : `Artwork · ${activeScene.title}`, receipt.message, link));
      record();
      while (!["SUCCEEDED", "FAILED", "CANCELLED", "STALE", "BLOCKED"].includes(receipt.state)) {
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
        receipt = await jobStatus(link);
        record();
      }
      await reloadCandidateProject();
      if (receipt.state !== "SUCCEEDED") throw new Error(receipt.message || "Image generation did not complete.");
      onNotify("Image ready to review", "Inspect the candidate below, then choose whether to use it.", "success");
    } catch (error) { onNotify("Image generation needs attention", errorMessage(error), "warning"); }
    finally { setGeneratingVisual(false); }
  };
  const searchStockImages = async (providerId: StockProvider, searchQuery: string) => {
    if (generatingVisual) return;
    const current = projectRef.current;
    const identity = nativeProjectLink(current);
    if (environment !== "native" || !identity) { onNotify("Open the desktop app", "Stock searches use this tutorial's approved photo library and image reviewer.", "info"); return; }
    setGeneratingVisual(true);
    try {
      const durable = await projectSnapshotGet(identity);
      let receipt = await searchVisualCandidates({ ...identity, expectedHeadRevisionId: durable.headRevisionId, sceneId: activeScene.id, instruction: `Choose a clear, relevant photograph for this lesson: ${activeScene.title}. Learning objective: ${activeScene.objective}. Avoid watermarks, misleading content, and unreadable embedded text.`, preservationLocks: ["narration", "citations", "learningobjective"], alternatives: 3, providerId, searchQuery, desiredAspectRatio: "16:9", locale: project.locale });
      const link = { ...identity, jobId: receipt.jobId };
      const record = () => onAddJob(receiptJob(receipt, `Photos · ${activeScene.title}`, receipt.message, link));
      record();
      while (!["SUCCEEDED", "FAILED", "CANCELLED", "STALE", "BLOCKED"].includes(receipt.state)) {
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
        receipt = await jobStatus(link);
        record();
      }
      await reloadCandidateProject();
      if (receipt.state !== "SUCCEEDED") throw new Error(receipt.message || "The photo search did not complete.");
      const readyCount = typeof receipt.result?.readyCount === "number" ? receipt.result.readyCount : 0;
      onNotify(readyCount ? "Photos ready to review" : "No suitable photos found", readyCount ? "Inspect the images and credits below, then choose which to use." : "Try a more concrete search. Your selected scene artwork is unchanged.", readyCount ? "success" : "info");
    } catch (error) { onNotify("Photo search needs attention", errorMessage(error), "warning"); }
    finally { setGeneratingVisual(false); }
  };
  return <div className="studio-workspace">
    <div className="studio-toolbar"><div><span className="scene-crumb">Scene {String(activeScene.index).padStart(2, "0")}</span><strong>{activeScene.title}</strong><SceneStatus status={activeScene.status} /></div><div className="studio-toolbar-center"><button onClick={onUndo} aria-label="Undo durable revision"><Undo2 size={16} /></button><button onClick={onRedo} aria-label="Redo durable revision"><Redo2 size={16} /></button><span className="separator" /><button onClick={() => setZoom(72)}><Square size={14} /> Fit</button><label><input aria-label="Canvas zoom" type="range" min="45" max="110" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />{zoom}%</label></div><div><button className="secondary-button small" onClick={() => { void openAdvancedEditor(); }}><Film size={15} /> Advanced editor</button><button className="secondary-button small" onClick={() => onRegenerate(activeScene)}><WandSparkles size={15} /> New candidate</button><button className="primary-button small" data-tour-target="render-scene" onClick={() => onRenderScene(activeScene)}><Play size={14} /> Render scene</button></div></div>
    <div className="studio-layout">
      <aside className="scene-rail"><div className="scene-rail-head"><span>Scenes</span><small>{project.scenes.length}</small></div><div className="scene-rail-list">{project.scenes.map((scene) => <button className={scene.id === activeScene.id ? "active" : ""} onClick={() => onSelectScene(scene.id)} key={scene.id}><span className="rail-index">{String(scene.index).padStart(2, "0")}</span><span className="rail-thumb"><SceneArtwork scene={scene} project={project} compact /></span><span className="rail-copy"><strong>{scene.title}</strong><small>{formatTime(scene.duration)} · {scene.kind.replace("-", " ")}</small></span><i className={`rail-state ${scene.status}`} /></button>)}</div></aside>
      <section className="canvas-stage"><div className="canvas-surround"><div className="canvas-rulers top" /><div className="canvas-rulers side" /><div className={`preview-canvas canvas-${customization.backgroundMode} treatment-${customization.sceneTreatment} density-${customization.density} contrast-${customization.contrast}`} style={{ ...canvasStyle, width: `${Math.min(92, zoom + 20)}%`, ...(selectedBackground ? { backgroundImage: `url(${selectedBackground})` } : {}) }} data-testid="customized-canvas"><SharedScenePreview scene={activeScene} project={project} tick={Math.round(previewSeconds * 240000)} fallback={<SceneArtwork scene={activeScene} />} />{customization.presenter.placement !== "off" && <div className={`presenter-preview placement-${customization.presenter.placement} side-${customization.presenter.side} frame-${customization.presenter.frame} crop-${customization.presenter.crop}`} style={{ width: `${Math.round(customization.presenter.scale * .42)}%` }} data-testid="presenter-preview">{selectedPresenter ? <img src={selectedPresenter} alt="Uploaded presenter preview" /> : <PresenterPortrait assetId={customization.presenter.assetId} />}</div>}{inspectorTab === "Design" && <CaptionPreview settings={customization.captions} fontFamily={customization.bodyFont} />}<div className="safe-area" style={{ inset: `${customization.captions.safeInset}%` }} aria-hidden="true" /><div className="frame-badge">Scene animation preview · frame {Math.round(previewSeconds * 30)}</div></div></div><div className="playback-bar"><button aria-label="Previous scene" disabled={activeIndex <= 0} onClick={() => onSelectScene(project.scenes[activeIndex - 1]!.id)}><ArrowLeft size={17} /></button><button className="play-toggle" onClick={() => { if (previewSeconds >= activeScene.duration) setPreviewSeconds(0); setPlaying((value) => !value); }} aria-label={playing ? "Pause preview" : "Play preview"}>{playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}</button><button aria-label="Next scene" disabled={activeIndex >= project.scenes.length - 1} onClick={() => onSelectScene(project.scenes[activeIndex + 1]!.id)}><ArrowRight size={17} /></button><span className="timecode">{formatTime(Math.floor(previewSeconds))} <i>/</i> {formatTime(activeScene.duration)}</span><input className="scene-scrubber" aria-label="Scene playhead" type="range" min="0" max={activeScene.duration} step="0.033333" value={previewSeconds} onChange={(event) => { setPlaying(false); setPreviewSeconds(Number(event.target.value)); }} /><small>Animation preview</small></div>
      </section>
      <aside className="inspector"><div className="inspector-tabs">{["Content", "Generate", "Design", "Motion"].map((tab) => <button className={inspectorTab === tab ? "active" : ""} onClick={() => setInspectorTab(tab)} key={tab}>{tab}</button>)}</div>
        {inspectorTab === "Content" ? <div className="inspector-body"><InspectorSection title="Scene identity"><label>Title<input value={activeScene.title} onChange={(event) => onSceneUpdate(activeScene.id, { title: event.target.value })} /></label><label>Scene family<select value={activeScene.kind} onChange={(event) => onSceneUpdate(activeScene.id, { kind: event.target.value as Scene["kind"] })}><option value="title">Title</option><option value="definition">Definition</option><option value="diagram">Diagram</option><option value="worked-example">Worked example</option><option value="comparison">Comparison</option><option value="code">Code trace</option><option value="recap">Recap</option></select></label></InspectorSection><InspectorSection title="Narration"><textarea data-tour-target="scene-narration" aria-label="Scene narration" rows={7} value={activeScene.narration} onChange={(event) => onSceneUpdate(activeScene.id, { narration: event.target.value })} /><div className="field-meta"><span>{activeScene.narration.split(" ").length} words</span><span>~{activeScene.duration}s</span></div><button className="secondary-button full" onClick={() => setInspectorTab("Design")}><Mic2 size={15} /> Presenter & voice direction</button></InspectorSection><InspectorSection title="Evidence"><div className="evidence-chip"><Link2 size={15} /><span><strong>{activeScene.citations} citation references</strong><small>Review claim support in the Sources and Review workspaces.</small></span></div></InspectorSection><InspectorSection title="Your scene review"><button className="secondary-button full" onClick={() => onSceneUpdate(activeScene.id, { status: activeScene.status === "approved" ? "draft" : "approved" })}><CheckCircle2 size={15} />{activeScene.status === "approved" ? "Reopen scene review" : "Mark scene reviewed"}</button><p className="inspector-note">This records your review. Editing the explanation clears this mark; export checks still run separately.</p></InspectorSection>{mode === "studio" && <InspectorSection title="Dependency impact"><p className="inspector-note">Editing narration invalidates alignment, captions, presenter timing, scene render, and final composition.</p></InspectorSection>}</div>
        : inspectorTab === "Generate" ? <div><fieldset className="creative-generation-fields" disabled={generatingVisual}><CreativeInspector configuration={creative} onChange={onProjectCreative} onQueueVisualReview={() => { void generateVisual("scene"); }} onGeneratePresenter={() => { void generateVisual("presenter"); }} /></fieldset><StockImageSearch policy={project.providerRoutingPolicy} sceneId={activeScene.id} suggestedQuery={activeScene.title} busy={generatingVisual} onSearch={searchStockImages} />{generatingVisual && <p role="status" className="inspector-note">Preparing image candidates… You can follow or cancel this task in Jobs.</p>}<VisualCandidateReview candidates={candidateImages} resolve={resolveCandidateImage} onAccept={acceptCandidateImage} /></div>
        : inspectorTab === "Design" ? <DesignInspector project={project} customization={customization} onChange={onProjectCustomization} onNotify={onNotify} onPreviewAsset={(id, url) => setAssetPreviews((current) => ({ ...current, [id]: url }))} /> : <MotionInspector scene={activeScene} canEditTiming={canEditGeneratedTiming} onChange={(update) => onSceneUpdate(activeScene.id, update)} />}
      </aside>
    </div>
    <div className="scene-sequence-panel"><div className="scene-sequence-heading"><strong><Layers3 size={15} /> Teaching sequence</strong><button className="text-button" onClick={() => { void openAdvancedEditor(); }}>Edit tracks & timing <ArrowRight size={14} /></button><small>v{version}</small></div><div className="scene-sequence-clips">{project.scenes.map((scene) => <button className={scene.id === activeScene.id ? "active" : ""} style={{ flexGrow: scene.duration }} key={scene.id} onClick={() => onSelectScene(scene.id)}><span>{String(scene.index).padStart(2, "0")} · {formatTime(scene.duration)}</span><strong>{scene.title}</strong></button>)}</div></div>
    {editorOpen && <div className="integrated-editor-layer" role="dialog" aria-modal="true" aria-label="Integrated advanced video editor"><div className="integrated-editor-layer__bar"><div><span className="section-kicker">Non-destructive finishing room</span><strong>{project.title}</strong>{editorSaveStatus && <span className={`editor-save-status is-${editorSaveStatus.phase}`} role="status" aria-live="polite" style={{ color: editorSaveStatus.phase === "error" ? "#ffb4a8" : "#8495ae", fontSize: 11 }}>{editorSaveStatus.phase === "error" ? `Save failed · ${editorSaveStatus.detail}` : editorSaveStatus.detail}</span>}</div><label className="editor-import-rights">New media rights<select aria-label="Rights for new editor media" value={editorImportRights} onChange={(event) => setEditorImportRights(event.target.value as typeof editorImportRights)}><option value="unknown">Not reviewed · preview only</option><option value="owned">I own the media</option><option value="licensed">Licensed for distribution</option><option value="publicDomain">Public domain</option></select></label><button className="secondary-button small" disabled={returningFromEditor} aria-busy={returningFromEditor} onClick={() => { void returnToScene(); }}><X size={15} /> {returningFromEditor ? "Saving…" : "Return to scene"}</button></div><AdvancedVideoEditor project={editorProject} {...(environment === "native" ? { onImportMedia: importEditorMedia, onRenderTimeline: renderEditorTimeline, onResolveWaveform: resolveEditorWaveform } : {})} onProjectChange={(next) => { setEditorProject(next); onEditorDocumentChange(next); }} onCreateProjectCopy={(copy) => { setEditorProject(copy); onEditorDocumentChange(copy); onNotify("Version copy created", `${copy.name} is saved with this tutorial.`, "success"); }} /></div>}
  </div>;
}

function InspectorSection({ title, children }: { title: string; children: React.ReactNode }) { return <section className="inspector-section"><div className="inspector-section-title"><strong>{title}</strong><ChevronDown size={14} /></div>{children}</section>; }

function DesignInspector({ project, customization, onChange, onNotify, onPreviewAsset }: {
  project: ProjectRecord;
  customization: CanvasCustomization;
  onChange: (next: CanvasCustomization, receipt?: ProjectAssetImportReceipt) => void;
  onNotify: ProjectWorkspaceProps["onNotify"];
  onPreviewAsset: (id: string, url: string) => void;
}) {
  const [section, setSection] = useState<"identity" | "captions" | "media">("identity");
  const [uploadRights, setUploadRights] = useState<"owned" | "licensed" | "review">("review");
  const [uploadLicense, setUploadLicense] = useState("");
  const [uploadAttribution, setUploadAttribution] = useState("");
  const [licensedCommercialUse, setLicensedCommercialUse] = useState<AssetPermission>("unknown");
  const [licensedRedistribution, setLicensedRedistribution] = useState<AssetPermission>("unknown");
  const [licensedModelInput, setLicensedModelInput] = useState<AssetPermission>("unknown");
  const [presenterIdentity, setPresenterIdentity] = useState<"synthetic" | "realPerson">("synthetic");
  const [presenterName, setPresenterName] = useState("My presenter");
  const [syntheticAttested, setSyntheticAttested] = useState(false);
  const [consentSubject, setConsentSubject] = useState("");
  const [consentAttestor, setConsentAttestor] = useState("");
  const [consentAuthority, setConsentAuthority] = useState<"selfConsent" | "parentOrGuardian" | "authorizedRepresentative">("selfConsent");
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [presenterDistributionScope, setPresenterDistributionScope] = useState<"privatePreview" | "publicNonCommercial" | "publicCommercial">("privatePreview");
  const update = (patch: Partial<CanvasCustomization>) => onChange({ ...customization, ...patch });
  const updateCaption = (patch: Partial<CanvasCustomization["captions"]>) => update({ captions: { ...customization.captions, ...patch } });
  const updatePresenter = (patch: Partial<CanvasCustomization["presenter"]>) => update({ presenter: { ...customization.presenter, ...patch } });
  const updateAudio = (patch: Partial<CanvasCustomization["audio"]>) => update({ audio: { ...customization.audio, ...patch } });
  const acceptAsset = async (file: File, kind: StudioAssetKind) => {
    if (file.size > MAX_STUDIO_ASSET_BYTES) {
      onNotify("Asset is too large", `${file.name} is ${formatBytes(file.size)}; studio preview assets must be 24 MiB or smaller.`, "warning");
      return;
    }
    if (kind === "presenter" && uploadRights === "review") {
      onNotify("Clear presenter rights first", "Presenter portraits cannot be sent to a lip-sync model while model-input permission is unknown.", "warning");
      return;
    }
    if (kind === "presenter" && uploadRights === "licensed" && licensedModelInput !== "allowed") {
      onNotify("Model-input permission required", "A licensed portrait can only be animated when its license explicitly allows model input.", "warning");
      return;
    }
    if (uploadRights === "licensed" && (!uploadLicense.trim() || !uploadAttribution.trim())) {
      onNotify("License details are incomplete", "Enter the actual license and required attribution before importing a licensed asset.", "warning");
      return;
    }
    if (kind === "presenter" && presenterIdentity === "synthetic" && !syntheticAttested) {
      onNotify("Synthetic origin attestation required", "Confirm that this presenter is fictional or generated before it can be used for face animation.", "warning");
      return;
    }
    if (kind === "presenter" && presenterIdentity === "realPerson" && (!consentSubject.trim() || !consentAttestor.trim() || !consentAccepted)) {
      onNotify("Presenter consent is incomplete", "Name the subject and attestor, then accept portrait-animation consent and synthetic-media disclosure.", "warning");
      return;
    }
    if (kind === "presenter" && presenterIdentity === "realPerson" && consentAuthority === "selfConsent" && consentSubject.trim().toLocaleLowerCase() !== consentAttestor.trim().toLocaleLowerCase()) {
      onNotify("Self-consent names must match", "Choose parent/guardian or authorized representative when someone else is attesting consent.", "warning");
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const cleared = uploadRights === "owned" || (uploadRights === "licensed" && licensedRedistribution === "allowed" && (kind !== "presenter" || licensedModelInput === "allowed"));
    const nativeKind = kind === "presenter" ? "presenterPortrait" : kind === "background" ? "backgroundImage" : kind === "sfx" ? "soundEffect" : kind;
    let receipt: ProjectAssetImportReceipt | undefined;
    if (project.nativeProjectId && project.nativeProjectDirectory && project.nativeHeadRevisionId) {
      const importAtHead = (expectedHeadRevisionId: string) => projectAssetImport({
        projectId: project.nativeProjectId!,
        projectDirectory: project.nativeProjectDirectory!,
        expectedHeadRevisionId,
        kind: nativeKind,
        filename: file.name,
        mimeType: studioAssetMimeType(file),
        privacy: "project_local",
        rights: {
          status: uploadRights === "owned" ? "owned" : uploadRights === "licensed" ? "licensed" : "unknown",
          creator: uploadRights === "owned" ? "Project owner" : "User supplied",
          license: uploadRights === "owned" ? "User owned" : uploadRights === "licensed" ? uploadLicense.trim() : "Rights review required",
          attribution: uploadRights === "owned" ? "No attribution required" : uploadRights === "licensed" ? uploadAttribution.trim() : "Attribution pending",
          commercialUse: uploadRights === "owned" ? "allowed" : uploadRights === "licensed" ? licensedCommercialUse : "unknown",
          redistribution: uploadRights === "owned" ? "allowed" : uploadRights === "licensed" ? licensedRedistribution : "unknown",
          modelInput: uploadRights === "owned" ? "allowed" : uploadRights === "licensed" ? licensedModelInput : "unknown",
        },
        ...(kind === "presenter" ? {
          presenter: {
            identityType: presenterIdentity,
            displayName: presenterName.trim() || file.name.replace(/\.[^.]+$/u, ""),
            syntheticOriginAttested: presenterIdentity === "synthetic",
            ...(presenterIdentity === "realPerson" ? {
              consent: {
                subjectDisplayName: consentSubject.trim(),
                attestorDisplayName: consentAttestor.trim(),
                authority: consentAuthority,
                grants: ["portraitAnimation" as const, "videoReenactment" as const, ...(presenterDistributionScope === "privatePreview" ? [] : ["publicDistribution" as const]), ...(presenterDistributionScope === "publicCommercial" ? ["commercialDistribution" as const] : [])],
                distributionScope: presenterDistributionScope,
                accepted: consentAccepted,
                disclosureRequired: true,
              },
            } : {}),
            selectAfterImport: true,
          },
        } : {}),
        contentBase64: bytesToBase64(bytes),
      });
      try {
        receipt = await importAtHead(project.nativeHeadRevisionId);
      } catch (error) {
        if (!errorMessage(error).includes("REVISION_CONFLICT")) {
          onNotify("Asset import did not complete", errorMessage(error), "warning");
          return;
        }
        try {
          const current = await projectSnapshotGet({
            projectId: project.nativeProjectId,
            projectDirectory: project.nativeProjectDirectory,
          });
          receipt = await importAtHead(current.headRevisionId);
        } catch (retryError) {
          onNotify("Asset import did not complete", errorMessage(retryError), "warning");
          return;
        }
      }
    }
    const id = receipt?.artifact.id ?? `upload-${kind}-${Date.now()}`;
    const asset: StudioAssetReference = {
      id,
      kind,
      label: file.name.replace(/\.[^.]+$/u, ""),
      source: "user-upload",
      filename: file.name,
      mediaType: studioAssetMimeType(file),
      byteSize: file.size,
      sha256: receipt?.artifact.sha256 ?? sha256,
      creator: uploadRights === "owned" ? "Project owner" : "User supplied",
      license: uploadRights === "owned" ? "User owned" : uploadRights === "licensed" ? uploadLicense.trim() : "Rights review required",
      attribution: uploadRights === "owned" ? "No attribution required" : uploadRights === "licensed" ? uploadAttribution.trim() : "Attribution pending",
      rightsStatus: receipt ? (receipt.provenance.exportEligible ? "cleared" : "review") : cleared ? "cleared" : "review",
    };
    onPreviewAsset(id, URL.createObjectURL(file));
    const assets = [...customization.assets, asset];
    const next: CanvasCustomization = { ...customization, assets };
    if (kind === "presenter") next.presenter = { ...next.presenter, assetId: id, placement: "picture-in-picture" };
    if (kind === "background") { next.backgroundAssetId = id; next.backgroundMode = "image"; }
    if (kind === "font") { next.fontPairId = "custom"; next.displayFont = asset.label; next.fonts = { ...next.fonts, displayAssetId: id }; }
    if (kind === "music") next.audio = { ...next.audio, musicAssetId: id };
    if (kind === "sfx") next.audio = { ...next.audio, sfxAssetId: id };
    onChange(next, receipt);
    const exportReady = receipt ? receipt.provenance.exportEligible : cleared;
    onNotify(exportReady ? "Asset added to visual bible" : "Asset added with an export hold", exportReady ? `${file.name} is copied into the project store and its SHA-256 provenance record is saved.` : `${file.name} can be previewed, but export stays blocked until rights are reviewed.`, exportReady ? "success" : "warning");
  };

  return <div className="inspector-body design-inspector">
    <div className="design-scope"><span><Sparkles size={14} /><strong>Project visual bible</strong></span><small>Changes persist with {project.title} and flow to every responsive target.</small></div>
    <div className="design-section-tabs" role="tablist" aria-label="Design customization sections">
      <button role="tab" aria-selected={section === "identity"} className={section === "identity" ? "active" : ""} onClick={() => setSection("identity")}>Identity</button>
      <button role="tab" aria-selected={section === "captions"} className={section === "captions" ? "active" : ""} onClick={() => setSection("captions")}>Captions</button>
      <button role="tab" aria-selected={section === "media"} className={section === "media" ? "active" : ""} onClick={() => setSection("media")}>Media</button>
    </div>
    {section === "identity" && <>
      <InspectorSection title="Typography system">
        <div className="font-pair-list">{FONT_PAIRS.map((pair) => <button key={pair.fontPairId} className={customization.fontPairId === pair.fontPairId ? "active" : ""} onClick={() => update({ fontPairId: pair.fontPairId, displayFont: pair.displayFont, bodyFont: pair.bodyFont })}><span className={`font-specimen font-${pair.fontPairId}`}>Aa</span><span><strong>{pair.name}</strong><small>{pair.note}</small></span>{customization.fontPairId === pair.fontPairId && <Check size={14} />}</button>)}</div>
        {customization.assets.some((asset) => asset.kind === "font" && asset.source !== "starter-pack") && <><label>Uploaded display font<select value={customization.fonts.displayAssetId ?? ""} onChange={(event) => { const asset = customization.assets.find((item) => item.id === event.target.value); update({ fontPairId: asset ? "custom" : customization.fontPairId, displayFont: asset?.label ?? customization.displayFont, fonts: { ...customization.fonts, displayAssetId: asset?.id ?? null } }); }}><option value="">Use theme display font</option>{customization.assets.filter((asset) => asset.kind === "font" && asset.source !== "starter-pack").map((asset) => <option key={asset.id} value={asset.id}>{asset.label}</option>)}</select></label><label>Uploaded body font<select value={customization.fonts.bodyAssetId ?? ""} onChange={(event) => { const asset = customization.assets.find((item) => item.id === event.target.value); update({ fontPairId: asset ? "custom" : customization.fontPairId, bodyFont: asset?.label ?? customization.bodyFont, fonts: { ...customization.fonts, bodyAssetId: asset?.id ?? null } }); }}><option value="">Use theme body font</option>{customization.assets.filter((asset) => asset.kind === "font" && asset.source !== "starter-pack").map((asset) => <option key={asset.id} value={asset.id}>{asset.label}</option>)}</select></label></>}
        <AssetUpload label="Upload a font file" accept=".woff,.woff2,.ttf,.otf" onFile={(file) => { void acceptAsset(file, "font"); }} />
      </InspectorSection>
      <InspectorSection title="Color language">
        <div className="palette-list">{PALETTE_PRESETS.map((palette) => <button key={palette.id} className={customization.paletteId === palette.id ? "active" : ""} onClick={() => update({ paletteId: palette.id, colors: palette.colors })}><span>{Object.values(palette.colors).map((color) => <i key={color} style={{ background: color }} />)}</span><strong>{palette.name}</strong></button>)}</div>
        <div className="color-field-grid">{(["paper", "ink", "accent", "evidence"] as const).map((key) => <label key={key}><span>{key}</span><input aria-label={`${key} color`} type="color" value={customization.colors[key]} onChange={(event) => update({ paletteId: "custom", colors: { ...customization.colors, [key]: event.target.value } })} /></label>)}</div>
      </InspectorSection>
      <InspectorSection title="Canvas">
        <div className="choice-grid compact">{(["paper", "image"] as const).map((mode) => <button key={mode} className={customization.backgroundMode === mode ? "active" : ""} onClick={() => update({ backgroundMode: mode })}><span className={`material-swatch ${mode}`} />{mode === "paper" ? "Color" : "Image"}</button>)}</div>
        <div className="starter-backgrounds" aria-label="Generated starter backgrounds">{Object.entries(STARTER_BACKGROUND_PREVIEWS).map(([id, src]) => { const asset = customization.assets.find((item) => item.id === id); return <button key={id} className={customization.backgroundAssetId === id ? "active" : ""} onClick={() => update({ backgroundMode: "image", backgroundAssetId: id })}><img src={src} alt="" /><span><strong>{asset?.label}</strong><small>Generated · MIT starter pack</small></span></button>; })}</div>
        {customization.assets.some((asset) => asset.kind === "background" && asset.source !== "starter-pack") && <label>Project background<select value={customization.backgroundAssetId ?? ""} onChange={(event) => update({ backgroundMode: "image", backgroundAssetId: event.target.value || null })}><option value="">Choose a project background</option>{customization.assets.filter((asset) => asset.kind === "background" && asset.source !== "starter-pack").map((asset) => <option key={asset.id} value={asset.id}>{asset.label}</option>)}</select></label>}
        <AssetUpload label="Upload a background" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" onFile={(file) => { void acceptAsset(file, "background"); }} />
      </InspectorSection>
      <InspectorSection title="Frame & motion">
        <div className="range-field"><label><span>Corner radius</span><output>{customization.cornerRadius}px</output></label><input aria-label="Corner radius" type="range" min="0" max="32" value={customization.cornerRadius} onChange={(event) => update({ cornerRadius: Number(event.target.value) })} /></div>
        <label className="mini-toggle"><input type="checkbox" checked={customization.reducedMotion} onChange={(event) => update({ reducedMotion: event.target.checked })} /><span><strong>Reduced motion master</strong><small>Replace non-essential movement with gentle dissolves.</small></span></label>
      </InspectorSection>
    </>}
    {section === "captions" && <>
      <div className="caption-authoring-scope" role="note">
        <Film size={15} />
        <span><strong>Burned-caption style</strong><small>These controls affect only an explicit open-caption export. Sidecar and embedded captions stay clean and use the viewer's font, color, size, and position controls.</small></span>
      </div>
      <InspectorSection title="Burned-caption placement">
        <div className="caption-position-grid">{(["auto", "top", "lower-third"] as const).map((position) => <button key={position} className={customization.captions.position === position ? "active" : ""} onClick={() => updateCaption({ position })}><span className={`caption-position-icon ${position}`}><i /></span>{position.replace("-", " ")}</button>)}</div>
        <p className="inspector-note">Auto avoids faces, formulas, UI callouts, and presenter regions on each target.</p>
        <div className="range-field"><label><span>Safe inset</span><output>{customization.captions.safeInset}%</output></label><input aria-label="Caption safe inset" type="range" min="5" max="18" value={customization.captions.safeInset} onChange={(event) => updateCaption({ safeInset: Number(event.target.value) })} /></div>
      </InspectorSection>
      <InspectorSection title="Burned-caption typography">
        <div className="segmented-control three">{(["soft-panel", "solid-panel", "outline"] as const).map((style) => <button key={style} className={customization.captions.style === style ? "active" : ""} onClick={() => updateCaption({ style })}>{style.replace("-", " ")}</button>)}</div>
        <div className="range-field"><label><span>Caption size</span><output>{customization.captions.size}%</output></label><input aria-label="Caption size" type="range" min="80" max="140" value={customization.captions.size} onChange={(event) => updateCaption({ size: Number(event.target.value) })} /></div>
        <label>Maximum lines<select value={customization.captions.maxLines} onChange={(event) => updateCaption({ maxLines: Number(event.target.value) as 1 | 2 | 3 })}><option value="1">1 line · short-form</option><option value="2">2 lines · recommended</option><option value="3">3 lines · accessibility override</option></select></label>
        <div className="color-field-grid two"><label><span>Text</span><input aria-label="Caption text color" type="color" value={customization.captions.textColor} onChange={(event) => updateCaption({ textColor: event.target.value })} /></label><label><span>Panel</span><input aria-label="Caption panel color" type="color" value={customization.captions.panelColor} onChange={(event) => updateCaption({ panelColor: event.target.value })} /></label></div>
        <div className="caption-quality-note"><ShieldCheck size={15} /><span><strong>Cue guard active for every delivery</strong><small>Timing, semantic line breaks, reading speed, and two-line limits are rechecked for SRT, WebVTT, selectable tracks, and open captions.</small></span></div>
      </InspectorSection>
    </>}
    {section === "media" && <>
      <InspectorSection title="Rights for uploads">
        <div className="rights-selector">{(["owned", "licensed", "review"] as const).map((value) => <button key={value} className={uploadRights === value ? "active" : ""} onClick={() => setUploadRights(value)}>{value === "owned" ? "I own it" : value === "licensed" ? "Licensed" : "Review later"}</button>)}</div>
        {uploadRights === "licensed" && <div className="license-fields"><label>License<input value={uploadLicense} placeholder="e.g. CC BY 4.0 or stock license ID" onChange={(event) => setUploadLicense(event.target.value)} /></label><label>Required attribution<input value={uploadAttribution} placeholder="Creator · source · license" onChange={(event) => setUploadAttribution(event.target.value)} /></label><label>Commercial use<select value={licensedCommercialUse} onChange={(event) => setLicensedCommercialUse(event.target.value as AssetPermission)}><option value="unknown">Unknown · keep export hold</option><option value="notAllowed">Not allowed</option><option value="allowed">Explicitly allowed</option></select></label><label>Redistribution in exported video<select value={licensedRedistribution} onChange={(event) => setLicensedRedistribution(event.target.value as AssetPermission)}><option value="unknown">Unknown · keep export hold</option><option value="notAllowed">Not allowed</option><option value="allowed">Explicitly allowed</option></select></label><label>AI / model input<select value={licensedModelInput} onChange={(event) => setLicensedModelInput(event.target.value as AssetPermission)}><option value="unknown">Unknown · do not send to models</option><option value="notAllowed">Not allowed</option><option value="allowed">Explicitly allowed</option></select></label></div>}
        <p className="inspector-note">Every upload stores its filename, SHA-256, creator, license, attribution, and export status—never just a loose file path.</p>
      </InspectorSection>
      <InspectorSection title="Presenter">
        <div className="presenter-grid">{[...Object.keys(STARTER_PRESENTER_PREVIEWS).filter((id) => presenterCollection.has(id)), ...customization.assets.filter((asset) => asset.kind === "presenter" && asset.source !== "starter-pack").map((asset) => asset.id)].map((id) => { const asset = customization.assets.find((item) => item.id === id); const voiceMatch = presenterVoiceMatch(id, asset?.label); return <button key={id} aria-label={asset?.label ?? id} className={customization.presenter.assetId === id ? "active" : ""} onClick={() => updatePresenter({ assetId: id, placement: "picture-in-picture", ...voiceMatch })}><PresenterPortrait assetId={id} /><span><strong>{asset?.label}</strong><small>{STARTER_PRESENTER_PREVIEWS[id] ? "Front-facing portrait" : "Presenter portrait"}</small></span></button>; })}</div>
        <div className="presenter-upload-identity"><span>Uploaded portrait identity</span><div className="rights-selector two"><button className={presenterIdentity === "synthetic" ? "active" : ""} onClick={() => setPresenterIdentity("synthetic")}>Fictional / generated</button><button className={presenterIdentity === "realPerson" ? "active" : ""} onClick={() => setPresenterIdentity("realPerson")}>Real person</button></div><label>Presenter name<input value={presenterName} onChange={(event) => setPresenterName(event.target.value)} /></label>{presenterIdentity === "synthetic" ? <label className="mini-toggle"><input type="checkbox" checked={syntheticAttested} onChange={(event) => setSyntheticAttested(event.target.checked)} /><span><strong>I attest this identity is fictional or generated</strong><small>Required before local lip-sync or presenter animation.</small></span></label> : <div className="consent-fields"><label>Person shown<input value={consentSubject} onChange={(event) => { setConsentSubject(event.target.value); if (consentAuthority === "selfConsent") setConsentAttestor(event.target.value); }} /></label><label>Consent authority<select value={consentAuthority} onChange={(event) => { const authority = event.target.value as typeof consentAuthority; setConsentAuthority(authority); if (authority === "selfConsent") setConsentAttestor(consentSubject); }}><option value="selfConsent">Self-consent</option><option value="parentOrGuardian">Parent or guardian</option><option value="authorizedRepresentative">Authorized representative</option></select></label><label>Authorized distribution<select value={presenterDistributionScope} onChange={(event) => setPresenterDistributionScope(event.target.value as typeof presenterDistributionScope)}><option value="privatePreview">Private preview only</option><option value="publicNonCommercial">Public, non-commercial</option><option value="publicCommercial">Public and commercial</option></select></label><label>Consent attested by<input value={consentAttestor} readOnly={consentAuthority === "selfConsent"} onChange={(event) => setConsentAttestor(event.target.value)} /></label><label className="mini-toggle"><input type="checkbox" checked={consentAccepted} onChange={(event) => setConsentAccepted(event.target.checked)} /><span><strong>Portrait animation and the selected distribution scope are authorized</strong><small>Synthetic-media disclosure stays required. Revocation remains attached to this profile.</small></span></label></div>}</div>
        <AssetUpload label="Upload your presenter picture" accept="image/png,image/jpeg,image/webp" onFile={(file) => { void acceptAsset(file, "presenter"); }} />
        <label>Presenter layout<select value={customization.presenter.placement} onChange={(event) => updatePresenter({ placement: event.target.value as CanvasCustomization["presenter"]["placement"] })}><option value="off">Off</option><option value="picture-in-picture">Picture in picture</option><option value="split">Split stage</option><option value="full-frame">Full frame</option></select></label>
        <p className="inspector-note"><strong>Rest-mouth guard:</strong> supplied idle portraits use closed lips. Speech animation owns mouth opening only while aligned narration is active.</p>
        <div className="compact-row"><label>Side<select value={customization.presenter.side} onChange={(event) => updatePresenter({ side: event.target.value as "left" | "right" })}><option value="left">Left</option><option value="right">Right</option></select></label><label>Crop<select value={customization.presenter.crop} onChange={(event) => updatePresenter({ crop: event.target.value as CanvasCustomization["presenter"]["crop"] })}><option value="portrait">Portrait safe</option><option value="contain">Contain</option><option value="cover">Fill</option></select></label></div>
      </InspectorSection>
      <InspectorSection title="Music & sound cues">
        <label>Music bed<select value={customization.audio.musicAssetId ?? "music-none"} onChange={(event) => updateAudio({ musicAssetId: event.target.value === "music-none" ? null : event.target.value })}><option value="music-none">No music · recommended</option><option value="starter.audio.music.focus-loop">Focus loop · starter pack</option><option value="starter.audio.music.inquiry-loop">Inquiry loop · starter pack</option>{customization.assets.filter((asset) => asset.kind === "music" && asset.source !== "starter-pack").map((asset) => <option value={asset.id} key={asset.id}>{asset.label} · uploaded</option>)}</select></label>
        <AssetUpload label="Upload music" accept="audio/wav,audio/mpeg,audio/flac,audio/ogg,audio/opus,.wav,.mp3,.flac,.ogg,.opus" onFile={(file) => { void acceptAsset(file, "music"); }} />
        <label>Sound cue<select value={customization.audio.sfxAssetId ?? "sfx-none"} onChange={(event) => updateAudio({ sfxAssetId: event.target.value === "sfx-none" ? null : event.target.value })}><option value="sfx-none">No sound cues · recommended</option><option value="starter.audio.sfx.emphasis-a">Quiet teaching cue</option><option value="starter.audio.sfx.emphasis-b">Technical emphasis</option>{customization.assets.filter((asset) => asset.kind === "sfx" && asset.source !== "starter-pack").map((asset) => <option value={asset.id} key={asset.id}>{asset.label} · uploaded</option>)}</select></label>
        <AssetUpload label="Upload a sound cue" accept="audio/wav,audio/mpeg,audio/flac,audio/ogg,audio/opus,.wav,.mp3,.flac,.ogg,.opus" onFile={(file) => { void acceptAsset(file, "sfx"); }} />
        <div className="range-field"><label><span>Music under narration</span><output>{customization.audio.musicLevel}%</output></label><input aria-label="Music level" type="range" min="0" max="40" value={customization.audio.musicLevel} onChange={(event) => updateAudio({ musicLevel: Number(event.target.value) })} /></div>
        <div className="range-field"><label><span>Automatic ducking</span><output>{customization.audio.narrationDucking}%</output></label><input aria-label="Narration ducking" type="range" min="30" max="90" value={customization.audio.narrationDucking} onChange={(event) => updateAudio({ narrationDucking: Number(event.target.value) })} /></div>
      </InspectorSection>
      <AssetLedger assets={customization.assets} />
    </>}
  </div>;
}

function AssetUpload({ label, accept, onFile }: { label: string; accept: string; onFile: (file: File) => void }) {
  return <label className="asset-upload"><Upload size={14} /><span>{label}</span><input type="file" accept={accept} onChange={(event) => { const file = event.target.files?.[0]; if (file) onFile(file); event.currentTarget.value = ""; }} /></label>;
}

function AssetLedger({ assets }: { assets: StudioAssetReference[] }) {
  const selected = assets.filter((asset) => asset.source !== "starter-pack");
  return <InspectorSection title="Project asset ledger">{selected.length ? <div className="asset-ledger">{selected.map((asset) => <div key={asset.id}><span className={`asset-state ${asset.rightsStatus}`}><FileCheck2 size={14} /></span><span><strong>{asset.label}</strong><small>{asset.kind} · {asset.license}{asset.byteSize ? ` · ${formatBytes(asset.byteSize)}` : ""}</small><code>{asset.sha256?.slice(0, 12)}…</code></span></div>)}</div> : <p className="inspector-note">No custom files yet. Starter-pack assets are already cleared and attributed.</p>}</InspectorSection>;
}

function PresenterPortrait({ assetId }: { assetId: string | null }) {
  const starter = assetId ? STARTER_PRESENTER_PREVIEWS[assetId] : undefined;
  if (starter) return <span className="presenter-portrait generated-portrait" aria-hidden="true"><img src={starter.src} alt="" style={{ objectPosition: starter.focalPoint }} /></span>;
  return <span className="presenter-portrait portrait-mentor" aria-hidden="true"><i className="portrait-halo" /><i className="portrait-head" /><i className="portrait-hair" /><i className="portrait-neck" /><i className="portrait-shirt" /></span>;
}

function CaptionPreview({ settings, fontFamily }: { settings: CanvasCustomization["captions"]; fontFamily: string }) {
  return <div className={`caption-preview position-${settings.position} style-${settings.style}`} style={{ color: settings.textColor, backgroundColor: settings.style === "outline" ? "transparent" : `${settings.panelColor}e8`, fontFamily: `"${fontFamily}", sans-serif`, fontSize: `${Math.round(12 * settings.size / 100)}px`, maxWidth: `calc(100% - ${settings.safeInset * 2}%)` }} data-testid="caption-preview"><span>A clear explanation, <em>one step at a time</em>.</span><small>Caption style sample · {settings.maxLines} line{settings.maxLines === 1 ? "" : "s"} max</small></div>;
}

function MotionInspector({ scene, canEditTiming, onChange }: { scene: Scene; canEditTiming: boolean; onChange: (update: Partial<Scene>) => void }) {
  return <div className="inspector-body"><InspectorSection title="Scene timing"><label>Duration in seconds<input aria-label="Scene duration in seconds" type="number" min="1" max="3600" value={scene.duration} readOnly={!canEditTiming} aria-readonly={!canEditTiming} onChange={(event) => { const value = Number(event.target.value); if (canEditTiming && Number.isFinite(value) && value >= 1 && value <= 3600) onChange({ duration: value }); }} /></label><p className="inspector-note">{canEditTiming ? "Keep enough time for the narration and each visual step. Re-render the scene after a timing change." : "This is the generated plan timing. Review title, narration, and teaching intent now; final timing follows narration and remains editable in the exported timeline."}</p></InspectorSection><div className="guided-callout"><Clock3 size={18} /><strong>Rehearse the explanation.</strong><p>Scrub the preview to inspect the animation. Open the advanced editor for track timing, trimming, and keyframes.</p></div></div>;
}

function ReviewWorkspace({ project, jobs, environment, onWorkspace, onScene, onRepairQa, onProjectEdit }: ProjectWorkspaceProps) {
  const [mediaError, setMediaError] = useState<string | null>(null);
  const media = authoritativeReviewMedia(project, jobs, environment);
  useEffect(() => { setMediaError(null); }, [media?.src]);
  const frameReview = project.renderedFrameReview ?? (project.payload && typeof project.payload === "object" ? (project.payload as Record<string, unknown>).renderedFrameReview : undefined);
  const reviewed = project.scenes.filter((scene) => scene.status === "approved").length;
  const attention = project.scenes.filter((scene) => scene.status === "attention").length;
  const checks = [
    { title: "Scene review", result: `${reviewed} of ${project.scenes.length} approved`, tone: reviewed === project.scenes.length ? "pass" : "warn", icon: Eye },
    { title: "Source records", result: project.sources.length ? `${project.sources.filter((source) => source.status === "verified").length} of ${project.sources.length} reviewed` : "No source records attached", tone: project.sources.length && project.sources.every((source) => source.status === "verified") ? "pass" : "warn", icon: FileCheck2 },
    { title: "Rendered media", result: media ? "Promoted output available" : "Generate an output first", tone: media ? "pass" : "warn", icon: Film },
    { title: "Caption & audio quality", result: "Review the exported media and subtitle files", tone: "warn", icon: AudioLines },
  ];
  const reviewReady = Boolean(media && !mediaError);
  const ReviewBoundaryIcon = mediaError ? CircleAlert : Film;
  const reviewBoundaryTitle = mediaError ? "Generated media could not be loaded" : "No authoritative media yet";
  const reviewBoundaryDetail = mediaError ?? (environment === "native" ? "Render a scene or complete a master export. Review only plays a promoted native artifact." : "The browser UI contract does not create video. Packaged-native acceptance must supply a promoted scene or master render.");
  return <div className="page project-page review-workspace"><ProjectHeader project={project} step="4 · Review" title="Review the whole argument" description="Play the latest promoted render, inspect the evidence behind it, and resolve the checks that can block export." action={<div className="header-action-group"><button className="secondary-button" onClick={() => onWorkspace("studio")}>Back to studio</button><button className="primary-button" disabled={!reviewReady} onClick={() => onWorkspace("export")}>Prepare export <ArrowRight size={16} /></button></div>} />
    <div className="review-layout"><section className="review-player">{reviewReady ? <><div className="review-canvas"><video aria-label="Authoritative generated tutorial media" controls preload="metadata" src={media!.src} onError={() => setMediaError("The promoted media could not be loaded. Re-render it before export.")} style={{ width: "100%", height: "100%", objectFit: "contain", background: "#090b11" }} /></div><div className="review-controls" role="status"><FileCheck2 size={16} /><span style={{ flex: 1 }}>{media!.label}</span><span>{media!.mediaType}</span></div></> : <div className="review-canvas"><div className="empty-state"><span><ReviewBoundaryIcon size={25} /></span><h3 style={{ color: "#f7f8fc" }}>{reviewBoundaryTitle}</h3><p>{reviewBoundaryDetail}</p><button className="secondary-button" onClick={() => onWorkspace("studio")}>Return to Studio</button></div></div>}<div className="review-scene-strip">{project.scenes.map((scene) => <button key={scene.id} onClick={() => onScene(scene)}><span>{scene.index}</span><SceneArtwork scene={scene} project={project} compact /></button>)}</div></section>
      <aside className="review-inspector"><div className="review-score"><div className="score-ring"><strong>{reviewed}</strong><span>reviewed</span></div><div><span className="section-kicker">Review summary</span><h3>{attention ? `${attention} scenes need attention` : "Look at the complete lesson"}</h3><p>Check the explanation, timing, and visible output. Scene approval is your review record.</p></div></div><div className="check-list">{checks.map(({ title, result, tone, icon: Icon }) => <div className="review-check" key={title}><span className={`check-icon ${tone}`}><Icon size={17} /></span><span><strong>{title}</strong><small>{result}</small></span></div>)}</div><RenderedFrameReviewPanel value={frameReview} generationId={project.nativeGenerationId} mediaHash={media?.artifactHash} />{Boolean(project.nativeRepairableFindingIds?.length) && <button className="secondary-button full" onClick={onRepairQa}><WandSparkles size={16} /> Repair flagged review items ({project.nativeRepairableFindingIds?.length})</button>}</aside>
    </div>
    <section className="claims-panel"><div className="panel-heading"><div><span className="section-kicker">Your review record</span><h3>Notes for this tutorial</h3></div><span>{project.title}</span></div><div className="review-notes"><label><span>What needs another pass?</span><textarea aria-label="Review annotation" rows={4} placeholder="Record a scene, time, or explanation to improve…" value={project.reviewNotes ?? ""} onChange={(event) => onProjectEdit({ reviewNotes: event.target.value })} /></label><p>Notes save with this project. Open a scene above to edit its explanation or request a new candidate.</p></div></section>

  </div>;
}

function ExportWorkspace({ project, onWorkspace, onNotify, onExportArchive, onExportMaster }: ProjectWorkspaceProps) {
  const [preferences] = usePersistentState<AlystriaPreferences>("alystria-preferences-v1", DEFAULT_ALYSTRIA_PREFERENCES);
  const [aspect, setAspect] = useState("16:9");
  const [quality, setQuality] = useState("1440p");
  const [fps, setFps] = useState<MasterExportRequest["fps"]>(() => [24, 30, 60].includes(preferences.defaultExportFps) ? preferences.defaultExportFps as MasterExportRequest["fps"] : 30);
  const [codecPreference, setCodecPreference] = useState<CodecPreference>("h264-hardware");
  const [captionDeliveryMode, setCaptionDeliveryMode] = useState<CaptionDeliveryMode>("sidecar");
  const [bibliography, setBibliography] = useState(true);
  const [transcript, setTranscript] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const captionLocale = project.locale === "Spanish" ? "es-ES" : project.locale === "Hindi" ? "hi-IN" : "en-US";
  const moveCaptionDelivery = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const keyOffset = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!keyOffset && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? CAPTION_DELIVERY_OPTIONS.length - 1 : (index + keyOffset + CAPTION_DELIVERY_OPTIONS.length) % CAPTION_DELIVERY_OPTIONS.length;
    setCaptionDeliveryMode(CAPTION_DELIVERY_OPTIONS[nextIndex]!.id);
    const radios = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role='radio']");
    radios?.[nextIndex]?.focus();
  };
  const exportProject = async () => {
    setExporting(true);
    try {
      const receipt = await onExportMaster({ aspect: aspect as "16:9" | "9:16" | "1:1", resolution: quality as "1080p" | "1440p" | "4K", fps, codecPreference, captionDeliveryMode, transcript, bibliography });
      onNotify(receipt.state === "FAILED" || receipt.state === "BLOCKED" ? "Export blocked" : "Export queued", receipt.message, receipt.state === "FAILED" || receipt.state === "BLOCKED" ? "warning" : "info");
    } catch (error) {
      onNotify("Export blocked", errorMessage(error), "warning");
    } finally {
      setExporting(false);
    }
  };
  const archiveProject = async () => {
    setArchiving(true);
    try {
      const path = await onExportArchive();
      onNotify("Portable project archived", path, "success");
    } catch (error) {
      onNotify("Project archive failed", errorMessage(error), "warning");
    } finally {
      setArchiving(false);
    }
  };
  const openCaptions = captionDeliveryMode === "burned" || captionDeliveryMode === "both";
  return <div className="page project-page export-workspace"><ProjectHeader project={project} step="5 · Export" title="Package the finished lesson" description="A clean master with accessible caption files, transcript, sources, and provenance—assembled locally." action={<button className="secondary-button" onClick={() => onWorkspace("review")}><ArrowLeft size={16} /> Review</button>} />
    <div className="export-layout"><section className="export-preview-panel"><div className="export-preview"><SceneArtwork scene={project.scenes[0]!} project={project} /><span className={`export-caption-status ${openCaptions ? "open" : "clean"}`}>{openCaptions ? "Open captions in picture" : "Clean picture · no caption pixels"}</span><span className="export-resolution">{quality} · {aspect}</span></div><div className="export-summary"><span><Film size={17} /><b>{project.duration}:00</b><small>estimated duration</small></span><span><HardDrive size={17} /><b>After render</b><small>measured file size</small></span><span><TimerReset size={17} /><b>At generation</b><small>runtime estimate</small></span></div><div className="export-ready"><PackageCheck size={21} /><div><strong>Export checks run before rendering</strong><p>The app checks the generation, sources, rights, and requested output before starting. Any blocker appears in Jobs.</p></div></div></section>
      <section className="export-settings"><div className="settings-section"><span className="section-kicker">Frame</span><h3>Format and resolution</h3><label>Aspect ratio<div className="format-options">{([['16:9', 'Landscape'], ['9:16', 'Portrait'], ['1:1', 'Square']] as const).map(([ratio, label]) => <button key={ratio} className={aspect === ratio ? "active" : ""} onClick={() => setAspect(ratio)}><i className={`aspect-shape ratio-${ratio.replace(":", "-")}`} /><span><strong>{ratio}</strong><small>{label}</small></span></button>)}</div></label><label>Resolution<select value={quality} onChange={(event) => setQuality(event.target.value)}><option>1080p</option><option>1440p</option><option>4K</option></select></label><div className="setting-row"><label>Frame rate<select aria-label="Frame rate" value={fps} onChange={(event) => setFps(Number(event.target.value) as MasterExportRequest["fps"])}><option value="30">30 fps</option><option value="60">60 fps</option><option value="24">24 fps</option></select></label><label>Codec preference<select aria-label="Codec preference" value={codecPreference} onChange={(event) => setCodecPreference(event.target.value as CodecPreference)}><option value="h264-hardware">H.264 hardware</option><option value="hevc-hardware">HEVC hardware</option><option value="av1">AV1</option></select></label></div><p className="settings-intro" role="note">Frame rate and codec are applied during native export. If the selected encoder is unavailable, the job reports the failure so you can choose another.</p></div>
        <div className="settings-section caption-delivery-section"><span className="section-kicker">Captions</span><h3>Choose how viewers receive captions</h3><p className="settings-intro">Every option includes named UTF-8 <strong>.srt</strong> and <strong>.vtt</strong> files. The recommended clean master is ready for YouTube upload without text baked into the picture.</p><div className="caption-delivery-options" role="radiogroup" aria-label="Caption delivery"><>{CAPTION_DELIVERY_OPTIONS.map(({ id, label, eyebrow, detail, icon: Icon }, index) => <button type="button" role="radio" aria-checked={captionDeliveryMode === id} tabIndex={captionDeliveryMode === id ? 0 : -1} key={id} className={captionDeliveryMode === id ? "active" : ""} onClick={() => setCaptionDeliveryMode(id)} onKeyDown={(event) => moveCaptionDelivery(event, index)}><span className="caption-delivery-icon"><Icon size={17} /></span><span><small>{eyebrow}</small><strong>{label}</strong><em>{detail}</em></span>{captionDeliveryMode === id && <CheckCircle2 size={16} />}</button>)}</></div><div className="caption-file-receipt"><FileCheck2 size={17} /><span><strong>Caption files included</strong><small>{project.title}.{captionLocale}.srt · {project.title}.{captionLocale}.vtt</small></span></div>{openCaptions ? <div className="burned-caption-warning" role="note"><TextCursorInput size={17} /><span><strong>Open captions will become picture pixels.</strong><small>Font, color, size, and placement come from the Studio caption style. They cannot be hidden after export.</small></span><button type="button" onClick={() => onWorkspace("studio")}>Edit open-caption style</button></div> : <p className="caption-player-note"><MonitorPlay size={15} /><span><strong>Appearance stays with the viewer.</strong> Sidecar and selectable captions use YouTube or the video player's font, color, size, and position controls.</span></p>}</div>
        <div className="settings-section"><span className="section-kicker">Accessibility & evidence</span><h3>Export companions</h3><ToggleRow checked={transcript} onChange={setTranscript} title="Accessible transcript" detail="Scene headings and descriptions" /><ToggleRow checked={bibliography} onChange={setBibliography} title="Sources & bibliography" detail="Human-readable + JSON manifest" /><ToggleRow checked={true} onChange={() => {}} title="Provenance manifest" detail="Required · cannot be disabled" locked /></div>
        <div className="export-cost"><ShieldCheck size={18} /><div><strong>Local export · no provider cost</strong><small>Project content stays on this device.</small></div></div><button className="secondary-button full" onClick={() => { void archiveProject(); }} disabled={archiving}>{archiving ? <RefreshCw className="spin" size={17} /> : <Archive size={17} />}{archiving ? "Archiving project…" : "Export portable .alytutorial"}</button>{project.nativeArchivePath && <small className="archive-path"><CheckCircle2 size={13} /> Last archive: {project.nativeArchivePath}</small>}<button className="export-button" data-tour-target="export-master" onClick={() => { void exportProject(); }} disabled={exporting}>{exporting ? <RefreshCw className="spin" size={18} /> : <Download size={18} />}{exporting ? "Submitting render…" : `Render ${quality} master`}<span>{aspect} · {fps} fps · {codecPreferenceLabel(codecPreference)}</span></button>
      </section></div>
  </div>;
}

function ToggleRow({ checked, onChange, title, detail, locked }: { checked: boolean; onChange: (checked: boolean) => void; title: string; detail: string; locked?: boolean }) { return <button className="toggle-row" disabled={locked} onClick={() => onChange(!checked)} aria-pressed={checked}><span className={`switch ${checked ? "on" : ""}`}><i /></span><span><strong>{title}</strong><small>{detail}</small></span>{locked && <Lock size={14} />}</button>; }

function SourceImportControl({ label, onImport, onNotify, secondary = false, small = false, tourTarget }: { label: string; onImport: (files: File[]) => Promise<SourceImportReceipt[]>; onNotify: (title: string, detail: string, tone?: ToastMessage["tone"]) => void; secondary?: boolean; small?: boolean; tourTarget?: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"idle" | "importing">("idle");
  const choose = async (files: File[]) => {
    if (!files.length) return;
    setStatus("importing");
    try {
      const receipts = await onImport(files);
      onNotify("Sources imported", `${receipts.length} file${receipts.length === 1 ? "" : "s"} validated, quarantined, and added to project history.`, "success");
    } catch (error) {
      onNotify("Source import failed", errorMessage(error), "warning");
    } finally {
      setStatus("idle");
      if (inputRef.current) inputRef.current.value = "";
    }
  };
  return <span className="source-import-control"><input ref={inputRef} aria-label={`${label} files`} className="visually-hidden-file" type="file" multiple accept={SOURCE_FILE_ACCEPT} onChange={(event) => { void choose(Array.from(event.target.files ?? [])); }} /><button data-tour-target={tourTarget} className={`${secondary ? "secondary-button" : "primary-button"}${small ? " small" : ""}`} onClick={() => inputRef.current?.click()} disabled={status === "importing"}>{status === "importing" ? <RefreshCw className="spin" size={16} /> : <Upload size={16} />}{status === "importing" ? " Importing…" : ` ${label}`}</button></span>;
}

function SceneArtwork({ scene, compact = false, project }: { scene: Scene; compact?: boolean; project?: ProjectRecord }) {
  const placeholder = <div className={`scene-art scene-art-authored ${compact ? "compact" : ""}`} aria-hidden="true"><small>{scene.kind.replaceAll("-", " ")} · {String(scene.index).padStart(2, "0")}</small><strong>{scene.title}</strong><p>{scene.objective}</p></div>;
  return project ? <SharedScenePreview scene={scene} project={project} fallback={placeholder} /> : placeholder;
}

function ConceptDiagram() { return <svg className="concept-diagram" viewBox="0 0 320 180" role="img" aria-label="A concept map connecting split, expand, reuse, and compare"><path d="M28 82 C56 82,73 51,113 51 S151 116,190 116 S246 84,286 84" /><path d="M54 130 C110 154,176 36,266 42" className="secondary-path" /><g transform="translate(28,82)"><circle r="15" /><text x="24" y="5">split</text></g><g transform="translate(113,51)"><circle r="11" /><text x="18" y="5">expand</text></g><g transform="translate(190,116)"><circle r="13" /><text x="20" y="5">reuse</text></g><g transform="translate(286,84)"><circle r="16" /><text x="-64" y="-24">compare</text></g></svg>; }

const TEMPLATE_SCENE_LABELS: Readonly<Record<string, readonly string[]>> = {
  "explain-hard-idea": ["The question", "What we already know", "Build the visual model", "Name the parts", "Earn the formal idea", "Work one example", "Test the intuition", "Thread it together"],
  "trace-algorithm": ["The input contract", "State before the first step", "Name the invariant", "Trace the happy path", "Inspect each transition", "Catch the edge case", "Read the implementation", "Measure the cost", "Transfer challenge"],
  "evidence-history": ["The driving question", "World before the change", "First pressure", "Primary voice", "Turning point", "Competing interpretation", "Second turning point", "Map the consequences", "Whose experience differs", "Evidence check", "Qualified conclusion"],
  "worked-derivation": ["State the target", "List the knowns", "Choose the transformation", "Derive without a jump", "Check the result", "Work a fresh example", "Name the reusable move"],
  "product-walkthrough": ["Outcome preview", "Orient the interface", "Complete the core task", "Handle a real exception", "Use the advanced control", "Recap and next action"],
  "young-learner-story": ["Meet the question", "Enter the story world", "Spot the pattern", "Try the first move", "See why it works", "Make a prediction", "Correct a misconception", "Try a new example", "Mini challenge", "Bring the idea home"],
};

const TUTORIAL_MODE_LABELS: Readonly<Record<TutorialMode, string>> = {
  "visual-explanation": "Visual explanation",
  "whiteboard-lesson": "Whiteboard lesson",
  "live-coding": "Live coding walkthrough",
  "presenter-slides": "Presenter with slides",
  "worked-derivation": "Worked derivation",
  "hybrid-teaching": "Hybrid board + code + presenter",
};

function createTemplateSceneScaffold(templateId: string, projectId: string, totalMinutes: number, tutorialMode: TutorialMode): Scene[] {
  const labels = TEMPLATE_SCENE_LABELS[templateId] ?? TEMPLATE_SCENE_LABELS["explain-hard-idea"]!;
  const duration = Math.max(12, Math.round((totalMinutes * 60) / labels.length));
  return labels.map((title, index) => {
    const reference = completeExampleProject.scenes[index % completeExampleProject.scenes.length]!;
    const modeTreatment: Pick<Scene, "kind" | "visual"> | undefined = index === 0 || index === labels.length - 1 ? undefined
      : tutorialMode === "whiteboard-lesson" ? { kind: "whiteboard", visual: "whiteboard" }
      : tutorialMode === "live-coding" ? { kind: "live-code", visual: "live-code" }
      : tutorialMode === "worked-derivation" ? { kind: "worked-example", visual: "formula" }
      : tutorialMode === "hybrid-teaching" ? index % 3 === 1 ? { kind: "whiteboard", visual: "whiteboard" } : index % 3 === 2 ? { kind: "live-code", visual: "live-code" } : { kind: "diagram", visual: "split" }
      : undefined;
    return {
      ...reference,
      ...modeTreatment,
      id: `${projectId}-scene-${index + 1}`,
      index: index + 1,
      title,
      duration,
      narration: "",
      objective: "Define the learning objective for this scene.",
      citations: 0,
      status: "draft",
      locked: false,
    };
  });
}

function NewTutorialWizard({ environment, templateId, onClose, onCreate }: { environment: RuntimeState["environment"]; templateId: string | null; onClose: () => void; onCreate: (project: ProjectRecord, settings: TutorialCreationSettings) => Promise<void> }) {
  const [step, setStep] = useState(1);
  const [topic, setTopic] = useState("");
  const [audience, setAudience] = useState("Undergraduate students");
  const [duration, setDuration] = useState("10");
  const [exactDuration, setExactDuration] = useState("3");
  const [locale, setLocale] = useState<ProjectRecord["locale"]>("English");
  const [grounding, setGrounding] = useState("Grounded");
  const [quality, setQuality] = useState("Standard");
  const [tutorialMode, setTutorialMode] = useState<TutorialMode>("visual-explanation");
  const [creating, setCreating] = useState(false);
  const [sourceFiles, setSourceFiles] = useState<File[]>([]);
  const [createError, setCreateError] = useState<string | null>(null);
  const [setup, setSetup] = useState<LocalModelSetup | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [secretRefs, setSecretRefs] = useState<Record<string, ProviderSecretRef>>({});
  const [routingApproval, setRoutingApproval] = useState(false);
  const [routingReviewedAt, setRoutingReviewedAt] = useState<string | null>(null);
  const [dataClassification, setDataClassification] = useState<"public" | "project">("project");
  const [hardLimitMinorUnits, setHardLimitMinorUnits] = useState("100");
  const [routingLoading, setRoutingLoading] = useState(true);
  const [providerAccountIds, setProviderAccountIds] = usePersistentState<Record<string, string>>("alystria-provider-account-ids-v1", {});
  const dialogRef = useRef<HTMLDivElement>(null);
  const sourceInputRef = useRef<HTMLInputElement>(null);
  const selectedTemplate = templates.find((template) => template.id === templateId) ?? templates[0]!;
  useEffect(() => { dialogRef.current?.focus(); }, []);
  useEffect(() => {
    let active = true;
    setRoutingLoading(true);
    void Promise.all([
      localModelSetupGet(),
      Promise.all(providerConfigs.filter((provider) => !provider.local).map(async (provider) => [provider.id, await providerSecretStatus({ providerId: provider.id, credentialKind: "api_key" })] as const)),
    ]).then(([nextSetup, refs]) => {
      if (!active) return;
      setSetup(nextSetup);
      setSelectedProfileId(nextSetup.activeProfileId);
      setSecretRefs(Object.fromEntries(refs));
    }).catch((error: unknown) => {
      if (active) setCreateError(`Provider setup could not be loaded: ${errorMessage(error)}`);
    }).finally(() => { if (active) setRoutingLoading(false); });
    return () => { active = false; };
  }, [environment]);
  const selectedProfile = setup?.profiles.find((profile) => profile.id === selectedProfileId) ?? setup?.profiles[0] ?? null;
  const usesCloudflare = selectedProfile
    ? Object.values(selectedProfile.routes).some((route) => route?.providerId === "cloudflare-workers-ai" && !/^(?:off|none|disabled)\b/i.test(route.modelId.trim()))
    : false;
  const effectiveClassification = sourceFiles.length ? "project" : dataClassification;
  const routingReview = selectedProfile ? buildProviderRoutingReview({
    profile: selectedProfile,
    secretRefs,
    dataClassification: effectiveClassification,
    hardLimitMinorUnits: Math.max(0, Number.parseInt(hardLimitMinorUnits, 10) || 0),
    approvalChecked: routingApproval,
    hasPrivateSources: sourceFiles.length > 0,
    groundingMode: grounding.toLowerCase() as GroundingMode,
    providerAccountIds,
    ...(routingReviewedAt ? { reviewedAt: routingReviewedAt } : {}),
  }) : null;
  const create = async () => {
    if (!routingReview?.policy) {
      setCreateError(routingReview?.errors[0] ?? "Choose and review a provider profile before creating this tutorial.");
      return;
    }
    const durationMinutes = duration === "custom" ? Number(exactDuration) : Number(duration);
    if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 180) {
      setCreateError("Choose a whole-number duration between 1 and 180 minutes.");
      return;
    }
    const id = `project-${Date.now()}`;
    const normalizedTopic = topic.trim() || "A new idea";
    const projectTitle = projectTitleFromTopic(normalizedTopic);
    const canonicalFixtureId = durationMinutes === 12 ? canonicalFixtureIdFromTopic(normalizedTopic) : undefined;
    const selectedPresenterAssetId = [
      selectedProfile?.routes.lipSync,
      selectedProfile?.routes.portraitAnimation,
      selectedProfile?.routes.presenter,
    ].find((route) => route?.providerId === "local-runtime"
      && !/^(?:off|none|disabled)\b/i.test(route.modelId.trim())
      && route.presenterProfileId
      && STARTER_PRESENTER_PREVIEWS[route.presenterProfileId])?.presenterProfileId;
    const presenterCustomization = selectedPresenterAssetId ? {
      ...structuredClone(DEFAULT_CANVAS_CUSTOMIZATION),
      presenter: {
        ...DEFAULT_CANVAS_CUSTOMIZATION.presenter,
        assetId: selectedPresenterAssetId,
        placement: "picture-in-picture" as const,
        ...presenterVoiceMatch(selectedPresenterAssetId, DEFAULT_CANVAS_CUSTOMIZATION.assets.find((asset) => asset.id === selectedPresenterAssetId)?.label),
      },
    } : undefined;
    setCreating(true);
    setCreateError(null);
    try {
      await onCreate(
        { ...completeExampleProject, id, title: projectTitle, topic: normalizedTopic, description: `${selectedTemplate.name}: a ${grounding.toLowerCase()} ${TUTORIAL_MODE_LABELS[tutorialMode].toLowerCase()} for ${audience.toLowerCase()}.`, audience, locale, duration: durationMinutes, progress: 8, status: "Planning", updatedAt: "just now", templateId: selectedTemplate.id, tutorialMode, theme: selectedTemplate.name, scenes: createTemplateSceneScaffold(selectedTemplate.id, id, durationMinutes, tutorialMode), sources: [], ...(canonicalFixtureId ? { canonicalFixtureId } : {}), ...(presenterCustomization ? { customization: presenterCustomization } : {}) },
        {
          grounding: grounding.toLowerCase() as GroundingMode,
          quality: quality.toLowerCase() as QualityPreset,
          sourceFiles,
          routingPolicy: routingReview.policy,
          approvedProviderIds: routingReview.approvedProviderIds,
          privacy: routingReview.privacy,
          hardLimitMinorUnits: Math.max(0, Number.parseInt(hardLimitMinorUnits, 10) || 0),
        },
      );
    } catch (error) {
      setCreateError(errorMessage(error));
      setCreating(false);
    }
  };
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="wizard-modal" role="dialog" aria-modal="true" aria-labelledby="wizard-title" tabIndex={-1} ref={dialogRef}>
    <header><div className="brand-lockup"><LogoMark /><span><strong>New tutorial</strong><small>Build the learning plan first</small></span></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={19} /></button></header>
    <div className="wizard-steps">{["Idea", "Learner", "Grounding", "Review"].map((label, index) => <span key={label} className={step === index + 1 ? "active" : step > index + 1 ? "complete" : ""}><i>{step > index + 1 ? <Check size={12} /> : index + 1}</i>{label}</span>)}</div>
    <div className="wizard-body">
      {step === 1 && <div className="wizard-template-selection"><img src={TEMPLATE_PREVIEWS[selectedTemplate.id]} alt="" /><span><small>Selected learning arc</small><strong>{selectedTemplate.name}</strong><em>{selectedTemplate.scenes} editable scenes · {selectedTemplate.category}</em></span></div>}
      {step === 1 && <div className="wizard-step"><span className="section-kicker">Start with the hard part</span><h2 id="wizard-title">What should become clear?</h2><p>Describe the idea, skill, or question in plain language. You can add documents and URLs after this step.</p><label className="large-input"><WandSparkles size={21} /><textarea autoFocus rows={4} placeholder="e.g. Explain why Karatsuba multiplication needs only three recursive products…" value={topic} onChange={(event) => setTopic(event.target.value)} /></label><div className="prompt-suggestions"><button onClick={() => setTopic("Explain why Karatsuba multiplication needs only three recursive products")}>Karatsuba multiplication</button><button onClick={() => setTopic("Teach binary search through loop invariants and an execution trace")}>Binary search invariants</button><button onClick={() => setTopic("Derive the central limit theorem visually")}>Visual derivation</button></div><div className="source-drop"><Upload size={20} /><span><strong>Add source material</strong><small>{sourceFiles.length ? `${sourceFiles.length} selected · imported privately before generation` : "PDF, DOCX, EPUB, Markdown, or text · 8 MiB each · optional"}</small></span><input ref={sourceInputRef} className="visually-hidden-file" type="file" multiple accept={SOURCE_FILE_ACCEPT} onChange={(event) => setSourceFiles(Array.from(event.target.files ?? []))} /><button onClick={() => sourceInputRef.current?.click()}>{sourceFiles.length ? "Change files" : "Choose files"}</button></div>{sourceFiles.length > 0 && <div className="selected-source-list" aria-label="Selected source files">{sourceFiles.map((file) => <span key={`${file.name}-${file.lastModified}`}><FileCheck2 size={14} /> {file.name} <small>{formatBytes(file.size)}</small></span>)}</div>}</div>}
      {step === 2 && <div className="wizard-step"><span className="section-kicker">Choose the teaching context</span><h2>Who is on the other side?</h2><p>{PRODUCT_NAME} changes prerequisite coverage, vocabulary, pacing, examples, and caption density for the learner.</p><div className="form-grid"><label><span>Audience</span><input value={audience} onChange={(event) => setAudience(event.target.value)} /></label><label><span>Target duration</span><select value={duration} onChange={(event) => setDuration(event.target.value)}><option value="1">About 1 minute (quick draft)</option><option value="3">About 3 minutes (inspection draft)</option><option value="5">About 5 minutes</option><option value="10">About 10 minutes</option><option value="12">About 12 minutes</option><option value="15">About 15 minutes</option><option value="25">About 25 minutes</option><option value="custom">Custom length…</option></select></label>{duration === "custom" && <label><span>Exact duration in minutes</span><input aria-label="Exact duration in minutes" type="number" min="1" max="180" step="1" inputMode="numeric" value={exactDuration} onChange={(event) => setExactDuration(event.target.value)} /><small>Choose any whole number from 1 to 180 minutes.</small></label>}<label><span>Language</span><select value={locale} onChange={(event) => setLocale(event.target.value as ProjectRecord["locale"])}><option>English</option><option>Spanish</option><option>Hindi</option></select></label><label><span>Tutorial method</span><select aria-label="Tutorial method" value={tutorialMode} onChange={(event) => setTutorialMode(event.target.value as TutorialMode)}>{Object.entries(TUTORIAL_MODE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><small>Board strokes and code edits are timed to narration and remain editable.</small></label></div><div className="learner-card"><UserRoundCheck size={22} /><div><strong>{audience}</strong><p>{TUTORIAL_MODE_LABELS[tutorialMode]} · {PRODUCT_NAME} will align every visual action to narration, preserve a static accessible alternative, and surface common misconceptions.</p></div></div></div>}
      {step === 3 && <div className="wizard-step"><span className="section-kicker">Lock the trust boundary</span><h2>How should {PRODUCT_NAME} research?</h2><p>No cloud call happens until its provider, data class, retention policy, and cost are approved.</p><div className="choice-cards">{([
        { name: "Creative", detail: "Use the prompt as the source of truth", icon: Sparkles }, { name: "Grounded", detail: "Connect verifiable claims to reliable evidence", icon: ShieldCheck }, { name: "Strict", detail: "Block every unsupported external claim", icon: Lock },
      ] satisfies Array<{ name: string; detail: string; icon: LucideIcon }>).map(({ name, detail, icon: Icon }) => <button key={name} className={grounding === name ? "active" : ""} onClick={() => setGrounding(name)}><span><Icon size={20} /></span><strong>{name}</strong><small>{detail}</small>{grounding === name && <CheckCircle2 size={17} />}</button>)}</div><div className="privacy-selection"><Lock size={18} /><div><strong>Private sources remain local</strong><p>Imported documents start as Local only. Reclassifying them always requires an explicit decision.</p></div><span className="toggle-on"><i /></span></div></div>}
      {step === 4 && <div className="wizard-step review-step"><span className="section-kicker">Ready to shape the lesson</span><h2>Review the learning brief</h2><div className="brief-preview"><div className="brief-topic"><span>Topic</span><h3>{topic || "Untitled tutorial"}</h3></div><dl><div><dt>Audience</dt><dd>{audience}</dd></div><div><dt>Duration</dt><dd>About {duration === "custom" ? exactDuration : duration} minutes</dd></div><div><dt>Method</dt><dd>{TUTORIAL_MODE_LABELS[tutorialMode]}</dd></div><div><dt>Language</dt><dd>{locale}</dd></div><div><dt>Research</dt><dd>{grounding}</dd></div><div><dt>Sources</dt><dd>{sourceFiles.length ? `${sourceFiles.length} private file${sourceFiles.length === 1 ? "" : "s"}` : "None yet"}</dd></div><div><dt>Privacy</dt><dd>{routingReview?.privacy ?? "Pending review"}</dd></div><div><dt>Storage</dt><dd>{environment === "native" ? "Native project folder" : "Browser demo"}</dd></div></dl></div><div className="quality-choice"><div><strong>Creation quality</strong><small>Quality changes model routing and review depth.</small></div>{["Draft", "Standard", "Maximum"].map((item) => <button key={item} className={quality === item ? "active" : ""} onClick={() => setQuality(item)}>{item}</button>)}</div>
        <section className="routing-review" aria-labelledby="routing-review-title">
          <div className="routing-review-heading"><div><span className="section-kicker">Project provider policy</span><h3 id="routing-review-title">Name every route before work starts.</h3></div><span className={`routing-readiness ${routingReview?.policy ? "ready" : "attention"}`}>{routingLoading ? "Loading" : routingReview?.policy ? <><CheckCircle2 size={13} /> Ready</> : <><CircleAlert size={13} /> Review needed</>}</span></div>
          <div className="routing-review-controls"><label><span>Creation profile</span><select aria-label="Creation profile" value={selectedProfile?.id ?? ""} disabled={routingLoading || !setup} onChange={(event) => { setSelectedProfileId(event.target.value); setRoutingApproval(false); setRoutingReviewedAt(null); }}>{setup?.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label><label><span>Content class</span><select aria-label="Content class" value={effectiveClassification} disabled={sourceFiles.length > 0} onChange={(event) => { setDataClassification(event.target.value as "public" | "project"); setRoutingApproval(false); setRoutingReviewedAt(null); }}><option value="project">Project content</option><option value="public">Public / synthetic</option></select></label><label><span>Hard budget</span><span className="currency-input"><b>$</b><input aria-label="Hard budget in cents" type="number" min="0" max="100000" value={hardLimitMinorUnits} onChange={(event) => { setHardLimitMinorUnits(event.target.value); setRoutingApproval(false); setRoutingReviewedAt(null); }} /><em>cents</em></span></label>{usesCloudflare && <label><span>Cloudflare Account ID</span><input aria-label="Cloudflare Account ID" autoComplete="off" value={providerAccountIds["cloudflare-workers-ai"] ?? ""} onChange={(event) => { setProviderAccountIds((current) => ({ ...current, "cloudflare-workers-ai": event.target.value.trim() })); setRoutingApproval(false); setRoutingReviewedAt(null); }} /><small>Nonsecret account setting. The API token stays in the OS vault.</small></label>}</div>
          {routingReview?.routeRows.length ? <div className="routing-route-list" aria-label="Reviewed provider routes">{routingReview.routeRows.map((route) => <div key={`${route.medium}-${route.providerId}`}><span>{route.medium}</span><strong>{providerDisplayName(route.providerId)}</strong><code>{route.modelId}</code><em className={route.boundary}>{route.boundary}</em></div>)}</div> : <div className="routing-empty">Choose a saved profile with explicit writing, research, image, and narration models.</div>}
          {routingReview?.errors.length ? <div className="routing-errors" role="status">{routingReview.errors.map((error) => <span key={error}><CircleAlert size={13} /> {error}</span>)}</div> : null}
          <label className="routing-consent"><input type="checkbox" checked={routingApproval} onChange={(event) => { setRoutingApproval(event.target.checked); setRoutingReviewedAt(event.target.checked ? new Date().toISOString() : null); }} /><span><strong>Approve this exact routing policy</strong><small>I approve the named providers, current retention and provider-managed region, the content class above, and the hard budget. No unlisted fallback is allowed.{routingReview?.routeRows.some((route) => route.providerId === "nvidia-nim") ? " This includes NVIDIA API Trial Terms and a current per-model access check." : ""}</small></span></label>
        </section>
        <div className="cost-approval"><CircleDollarSign size={20} /><div><strong>Hard creation budget: ${(Math.max(0, Number.parseInt(hardLimitMinorUnits, 10) || 0) / 100).toFixed(2)}</strong><p>The approved project policy is saved as its own durable revision before generation starts.</p></div></div>{createError && <div className="create-error" role="alert"><CircleAlert size={17} /><span><strong>Project creation failed</strong><small>{createError}</small></span></div>}</div>}
    </div>
    <footer><button className="secondary-button" disabled={creating} onClick={step === 1 ? onClose : () => setStep((value) => value - 1)}>{step === 1 ? "Cancel" : <><ArrowLeft size={15} /> Back</>}</button><span>Step {step} of 4</span>{step < 4 ? <button className="primary-button" disabled={step === 1 && !topic.trim()} onClick={() => setStep((value) => value + 1)}>Continue <ArrowRight size={15} /></button> : <button className="primary-button" disabled={creating || !routingReview?.policy} onClick={() => { void create(); }}>{creating ? <RefreshCw className="spin" size={16} /> : <Sparkles size={16} />}{creating ? (sourceFiles.length ? "Importing sources…" : "Creating project…") : "Create learning plan"}</button>}</footer>
  </div></div>;
}

function RegenerationSheet({ scene, onClose, onRun }: { scene: Scene; onClose: () => void; onRun: (instruction: string, preserve: boolean, alternatives: number) => void }) {
  const [instruction, setInstruction] = useState("");
  const [preserve, setPreserve] = useState(true);
  const [alternatives, setAlternatives] = useState(1);
  return <div className="sheet-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><aside className="regen-sheet" role="dialog" aria-modal="true" aria-labelledby="regen-title"><header><div><span className="section-kicker">Scoped regeneration</span><h2 id="regen-title">Create a new candidate</h2></div><button className="icon-button" onClick={onClose}><X size={18} /></button></header><div className="regen-scene"><span>{String(scene.index).padStart(2, "0")}</span><div><strong>{scene.title}</strong><small>{scene.kind.replace("-", " ")} · {scene.duration}s</small></div></div><label className="instruction-field"><span>What should change?</span><textarea autoFocus rows={5} value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="Make the transition from four products to three feel inevitable. Keep the exact algebra and citations." /></label><div className="quick-instructions"><button onClick={() => setInstruction("Make the explanation more concrete without adding length.")}>More concrete</button><button onClick={() => setInstruction("Reduce narration by 20% while preserving every factual claim.")}>Tighter</button><button onClick={() => setInstruction("Try a more visual treatment using the concept thread.")}>More visual</button></div><section className="preservation-section"><span className="section-kicker">Preservation locks</span><ToggleRow checked={preserve} onChange={setPreserve} title="Keep narration and citations" detail="Regenerate only the visual treatment" /><ToggleRow checked={true} onChange={() => {}} title="Keep learning objective" detail={scene.objective} locked /><label>Alternatives<select value={alternatives} onChange={(event) => setAlternatives(Number(event.target.value))}><option value={1}>1 candidate</option><option value={2}>2 candidates</option><option value={3}>3 candidates</option><option value={4}>4 candidates</option></select></label></section><section className="impact-preview"><div><Network size={17} /><span><strong>Dependency impact</strong><small>Visual layout, scene render, visual QA, and final composition</small></span></div><div><CircleDollarSign size={17} /><span><strong>Estimated cost</strong><small>Checked against the approved route and project budget</small></span></div><div><History size={17} /><span><strong>Accepted version is safe</strong><small>This creates a candidate. Nothing is overwritten.</small></span></div></section><footer><button className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={!instruction.trim()} onClick={() => onRun(instruction, preserve, alternatives)}><WandSparkles size={16} /> Generate candidate</button></footer></aside></div>;
}

function JobsDrawer({ open, jobs, nativeJobIds, onClose, onCancel, onRetry }: { open: boolean; jobs: JobRecord[]; nativeJobIds: ReadonlySet<string>; onClose: () => void; onCancel: (id: string) => void; onRetry: (id: string) => void }) {
  return <aside className={`jobs-drawer ${open ? "open" : ""}`} aria-hidden={!open} aria-label="Background jobs"><header><div><span className="section-kicker">Durable work queue</span><h2>Jobs</h2></div><button className="icon-button" onClick={onClose}><PanelRightClose size={18} /></button></header><div className="jobs-summary"><div><Activity size={17} /><span><strong>{jobs.filter((job) => job.status === "running").length} active</strong><small>Editing remains available</small></span></div><div className="local-job-badge"><HardDrive size={14} /> Local worker</div></div><div className="jobs-list">{jobs.length ? jobs.map((job) => { const receiptState = jobReceiptState(job); return <article className={`job-card ${job.status}`} key={job.id}><div className="job-icon">{job.status === "complete" ? <Check size={16} /> : job.status === "attention" ? <CircleAlert size={16} /> : <RefreshCw className={job.status === "running" ? "spin" : ""} size={16} />}</div><div className="job-copy"><div><strong>{job.title}</strong><span>{receiptState ? receiptState.toLowerCase().replaceAll("_", " ") : job.status}</span></div><p>{job.detail}</p>{job.status !== "complete" && <ProgressBar value={job.progress} />}<small>{job.eta}{job.cost && <> · {job.cost}</>}</small></div><div className="job-actions">{canRetryJob(job, nativeJobIds) && <button className="icon-button" onClick={() => onRetry(job.id)} aria-label={`Retry ${job.title}`}><RotateCcw size={14} /></button>}{canCancelJob(job) && <button className="icon-button" onClick={() => onCancel(job.id)} aria-label={`Cancel ${job.title}`}><X size={15} /></button>}</div></article>; }) : <EmptyState icon={CheckCircle2} title="No queued work" detail="New render and generation jobs appear here." />}</div><footer><ShieldCheck size={15} /> Native jobs recover after an app restart.</footer></aside>;
}

function CommandPalette({ projects, onClose, onNavigate, onOpen }: { projects: ProjectRecord[]; onClose: () => void; onNavigate: (area: GlobalArea) => void; onOpen: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const filteredProjects = projects.filter((project) => project.title.toLowerCase().includes(query.toLowerCase()));
  return <div className="command-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="command-palette" role="dialog" aria-modal="true"><label><Search size={19} /><input autoFocus placeholder="Search projects or run a command…" value={query} onChange={(event) => setQuery(event.target.value)} /><kbd>esc</kbd></label><div className="command-results"><small>Projects</small>{filteredProjects.map((project) => <button key={project.id} onClick={() => onOpen(project.id)}><span className="command-icon"><Film size={16} /></span><span><strong>{project.title}</strong><small>{project.status} · {project.updatedAt}</small></span><kbd>↵</kbd></button>)}<small>Go to</small>{globalNav.filter((item) => item.label.toLowerCase().includes(query.toLowerCase())).map(({ id, label, icon: Icon }) => <button key={id} onClick={() => onNavigate(id)}><span className="command-icon"><Icon size={16} /></span><span><strong>{label}</strong><small>{PRODUCT_NAME} area</small></span></button>)}</div></div></div>;
}

function Toast({ toast, onClose }: { toast: ToastMessage; onClose: () => void }) { return <div className={`toast ${toast.tone ?? "success"}`}><span>{toast.tone === "warning" ? <CircleAlert size={17} /> : toast.tone === "info" ? <CircleHelp size={17} /> : <CheckCircle2 size={17} />}</span><div><strong>{toast.title}</strong><p>{toast.detail}</p></div><button onClick={onClose}><X size={14} /></button></div>; }

function RuntimeBadge({ runtime }: { runtime: RuntimeState }) {
  const ready = runtime.environment === "native" && runtime.bootstrap?.worker.state === "ready";
  const boundary = runtime.environment === "native" ? "Packaged native runtime" : "Browser adapter only; no native artifact";
  return <span className={`runtime-badge ${ready ? "ready" : "attention"}`} title={runtime.error ? `${boundary}: ${runtime.error}` : `${boundary}: ${workerLabel(runtime.bootstrap?.worker)}`}><span className="runtime-dot" />{runtime.environment === "native" ? "Native" : "Browser preview"}{runtime.environment === "native" && <><i />{runtime.loading ? "Connecting" : ready ? "Worker ready" : workerLabel(runtime.bootstrap?.worker)}</>}</span>;
}

function PageTitle({ kicker, title, description, action }: { kicker: string; title: string; description: string; action?: React.ReactNode }) { return <div className="page-title"><div><span className="section-kicker">{kicker}</span><h1>{title}</h1><p>{description}</p></div>{action}</div>; }
function ProgressBar({ value }: { value: number }) { return <div className="progress-bar" aria-label={`${value}% complete`}><i style={{ width: `${value}%` }} /></div>; }
function StatusPill({ status }: { status: ProjectRecord["status"] }) { return <span className={`status-pill status-${status.toLowerCase().replaceAll(" ", "-")}`}>{status === "Complete" && <Check size={12} />}{status}</span>; }
function SceneStatus({ status }: { status: Scene["status"] }) { return <span className={`scene-status ${status}`}>{status === "approved" ? <CheckCircle2 size={13} /> : status === "attention" ? <CircleAlert size={13} /> : <Clock3 size={13} />}{status === "attention" ? "Needs review" : status}</span>; }
function EmptyState({ icon: Icon, title, detail, action }: { icon: LucideIcon; title: string; detail: string; action?: React.ReactNode }) { return <div className="empty-state"><span><Icon size={25} /></span><h3>{title}</h3><p>{detail}</p>{action}</div>; }
function formatTime(seconds: number) { return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; }

function workerLabel(worker: BootstrapInfo["worker"] | undefined): string {
  if (!worker) return "Not connected";
  if (worker.state === "ready") return "Ready";
  if (worker.state === "unavailable") return "Unavailable";
  if (worker.state === "degraded") return "Degraded";
  if (worker.state === "failed") return "Needs attention";
  return worker.state.charAt(0).toUpperCase() + worker.state.slice(1);
}

function localeCode(locale: ProjectRecord["locale"]): string {
  if (locale === "Spanish") return "es-ES";
  if (locale === "Hindi") return "hi-IN";
  return "en-US";
}

function providerDisplayName(providerId: string): string {
  if (providerId === "local-runtime") return `${PRODUCT_NAME} local runtime`;
  if (providerId === "openai-compatible-local") return "OpenAI-compatible local";
  return providerConfigs.find((provider) => provider.id === providerId)?.name ?? providerId;
}

function projectDirectoryName(title: string): string {
  const slug = title.normalize("NFKD").replace(/[\u0300-\u036f]/gu, "").toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "").slice(0, 52) || "untitled-tutorial";
  return `${slug}-${Date.now().toString(36)}`;
}

function projectSnapshotDocument(project: ProjectRecord, additions: Record<string, unknown> = {}): Record<string, unknown> {
  const portable = { ...project } as Record<string, unknown>;
  delete portable.nativeProjectId;
  delete portable.nativeProjectDirectory;
  delete portable.nativeHeadRevisionId;
  delete portable.nativeRevisionNumber;
  delete portable.nativeArchivePath;
  delete portable.nativeRepairableFindingIds;
  const payload = isRecord(portable.payload) ? portable.payload : null;
  const storyboard = payload && isRecord(payload.storyboard) ? payload.storyboard : null;
  if (payload && storyboard && Array.isArray(storyboard.scenes)) {
    portable.payload = { ...payload, storyboard: { ...storyboard, scenes: storyboard.scenes.map((raw) => {
      if (!isRecord(raw)) return raw;
      const edited = project.scenes.find((scene) => scene.id === raw.id);
      return edited ? { ...raw, title: edited.title, narration: edited.narration, visualIntent: edited.objective, durationTicks: Math.round(edited.duration * 240000) } : raw;
    }) } };
  }
  return { ...portable, ...additions };
}

async function importSelectedFile(project: ProjectRecord, file: File): Promise<SourceImportReceipt> {
  if (!project.nativeProjectId || !project.nativeProjectDirectory || !project.nativeHeadRevisionId) {
    throw new Error("The project must have a loaded durable snapshot before importing sources.");
  }
  if (file.size > MAX_SOURCE_FILE_BYTES) {
    throw new Error(`${file.name} is ${formatBytes(file.size)}; each source must be 8 MiB or smaller.`);
  }
  const contentBase64 = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
  return sourceImport({
    projectId: project.nativeProjectId,
    projectDirectory: project.nativeProjectDirectory,
    expectedHeadRevisionId: project.nativeHeadRevisionId,
    filename: file.name,
    mimeType: file.type || inferredMimeType(file.name),
    privacy: "project_local",
    rightsStatus: "unknown",
    contentBase64,
  });
}

function appendImportedSource(project: ProjectRecord, receipt: SourceImportReceipt): ProjectRecord {
  return {
    ...project,
    nativeHeadRevisionId: receipt.headRevisionId,
    nativeRevisionNumber: receipt.revisionNumber,
    sources: [...project.sources, {
      id: receipt.id,
      versionId: receipt.versionId,
      title: receipt.title,
      filename: receipt.filename,
      origin: receipt.origin,
      kind: "document",
      mediaType: receipt.mediaType,
      byteSize: receipt.byteSize,
      artifactHash: receipt.artifactHash,
      storedRelativePath: receipt.storedRelativePath,
      privacy: receipt.privacy,
      rightsStatus: receipt.rightsStatus,
      license: receipt.license,
      attribution: receipt.attribution,
      evidence: receipt.evidence,
      status: receipt.status,
    }],
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return btoa(binary);
}

function inferredMimeType(filename: string): string {
  const suffix = filename.toLowerCase().split(".").at(-1);
  if (suffix === "pdf") return "application/pdf";
  if (suffix === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (suffix === "pptx") return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (suffix === "epub") return "application/epub+zip";
  if (suffix === "md" || suffix === "markdown") return "text/markdown";
  if (suffix === "csv") return "text/csv";
  if (suffix === "json") return "application/json";
  return "text/plain";
}

function studioAssetMimeType(file: File): string {
  if (file.type) return file.type === "audio/opus" || file.type === "application/ogg" ? "audio/ogg" : file.type;
  const suffix = file.name.toLowerCase().split(".").at(-1);
  if (suffix === "png") return "image/png";
  if (suffix === "jpg" || suffix === "jpeg") return "image/jpeg";
  if (suffix === "webp") return "image/webp";
  if (suffix === "ttf") return "font/ttf";
  if (suffix === "otf") return "font/otf";
  if (suffix === "woff") return "font/woff";
  if (suffix === "woff2") return "font/woff2";
  if (suffix === "wav") return "audio/wav";
  if (suffix === "mp3") return "audio/mpeg";
  if (suffix === "flac") return "audio/flac";
  if (suffix === "ogg") return "audio/ogg";
  if (suffix === "opus") return "audio/ogg";
  return "application/octet-stream";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function downloadPhaseLabel(phase: ModelDownloadStatus["phase"] | undefined): string {
  if (phase === "downloading") return "Downloading";
  if (phase === "verifying") return "Verifying hashes";
  if (phase === "downloadedQuarantined") return "Verified · inactive";
  if (phase === "failed") return "Paused · resumable";
  return "License review";
}

function receiptJob(receipt: JobReceipt, title: string, detail: string, project?: Pick<NativeJobLink, "projectId" | "projectDirectory">): JobRecord {
  const status: JobRecord["status"] = receipt.state === "SUCCEEDED"
    ? "complete"
    : receipt.state === "RUNNING"
      ? "running"
      : receipt.state === "QUEUED" || receipt.state === "READY" || receipt.state === "RETRY_WAIT"
        ? "queued"
        : "attention";
  const eta = status === "attention" ? (receipt.retryable ? "retry available" : "review required") : status === "queued" ? "queued" : status === "running" ? "in progress" : null;
  return {
    id: receipt.jobId,
    title,
    detail: receipt.message || detail,
    status,
    progress: status === "complete" ? 100 : status === "running" ? 12 : 0,
    ...(eta ? { eta } : {}),
    ...(project ? { projectId: project.projectId, projectDirectory: project.projectDirectory } : {}),
    retryable: receipt.retryable,
    ...(receipt.operation ? { operation: receipt.operation } : {}),
    result: { ...(receipt.result ?? {}), receiptState: receipt.state },
  };
}

function jobReceiptState(job: JobRecord): JobReceipt["state"] | null {
  const state = job.result?.receiptState;
  return typeof state === "string" && ["BLOCKED", "READY", "QUEUED", "RUNNING", "SUCCEEDED", "RETRY_WAIT", "FAILED", "CANCELLED", "STALE"].includes(state)
    ? state as JobReceipt["state"]
    : null;
}

function canRetryJob(job: JobRecord, nativeJobIds: ReadonlySet<string>): boolean {
  return job.status === "attention" && job.retryable === true && nativeJobIds.has(job.id) && jobReceiptState(job) !== "BLOCKED";
}

function canCancelJob(job: JobRecord): boolean {
  const state = jobReceiptState(job);
  if (state) return state === "READY" || state === "QUEUED" || state === "RUNNING" || state === "RETRY_WAIT" || state === "BLOCKED";
  return job.status === "running" || job.status === "queued";
}

function codecPreferenceLabel(codec: CodecPreference): string {
  if (codec === "hevc-hardware") return "HEVC hardware";
  if (codec === "av1") return "AV1";
  return "H.264 hardware";
}

function authoritativeReviewMedia(project: ProjectRecord, jobs: readonly JobRecord[], environment: RuntimeState["environment"]): { src: string; label: string; mediaType: string; artifactHash?: string } | null {
  const candidate = jobs.find((job) => {
    const path = job.result?.path ?? job.result?.outputPath;
    const mediaType = job.result?.mediaType;
    return job.projectId === project.nativeProjectId
      && job.status === "complete"
      && (job.operation === "export_master" || job.operation === "render_scene" || job.operation === "editor_timeline_export" || job.id === project.nativeGenerationId)
      && typeof path === "string"
      && path.length > 0
      && (typeof mediaType !== "string" || mediaType.startsWith("video/"));
  });
  const path = candidate?.result?.path ?? candidate?.result?.outputPath;
  if (!candidate || typeof path !== "string") return null;
  const direct = /^(blob:|data:|https?:)/u.test(path);
  return {
    src: environment === "native" && !direct ? convertFileSrc(path) : path,
    label: candidate.operation === "editor_timeline_export" ? "Edited timeline export" : candidate.operation === "export_master" ? "Promoted master export" : candidate.id === project.nativeGenerationId ? "Generated tutorial" : "Promoted scene render",
    mediaType: typeof candidate.result?.mediaType === "string" ? candidate.result.mediaType : "video",
    ...(typeof candidate.result?.artifactHash === "string" ? { artifactHash: candidate.result.artifactHash } : {}),
  };
}

function nativeJobLinks(jobs: readonly JobRecord[]): Record<string, NativeJobLink> {
  return Object.fromEntries(jobs.flatMap((job) => isDurableNativeJob(job)
    ? [[job.id, { projectId: job.projectId, projectDirectory: job.projectDirectory, jobId: job.id } satisfies NativeJobLink] as const]
    : []));
}

function nativeJobProject(job: JobRecord): Pick<NativeJobLink, "projectId" | "projectDirectory"> | null {
  return job.projectId && job.projectDirectory ? { projectId: job.projectId, projectDirectory: job.projectDirectory } : null;
}

function nativeProjectLink(project: ProjectRecord): Pick<NativeJobLink, "projectId" | "projectDirectory"> | null {
  return project.nativeProjectId && project.nativeProjectDirectory
    ? { projectId: project.nativeProjectId, projectDirectory: project.nativeProjectDirectory }
    : null;
}

function diagnosticIcon(id: string): LucideIcon {
  if (id.includes("worker") || id.includes("python")) return Cpu;
  if (id.includes("ffmpeg") || id.includes("media")) return Film;
  if (id.includes("gpu")) return Gauge;
  if (id.includes("keyring") || id.includes("credential")) return KeyRound;
  if (id.includes("renderer") || id.includes("chromium")) return MonitorPlay;
  if (id.includes("power")) return Moon;
  return HardDrive;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return "An unexpected desktop integration error occurred.";
}

export default App;
