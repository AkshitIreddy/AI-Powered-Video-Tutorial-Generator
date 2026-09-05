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
  Play,
  PlayCircle,
  Plus,
  Presentation,
  Quote,
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
  Volume2,
  WandSparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import appMark from "./assets/ai-video-tutorial-generator-mark.svg";
import tutorialCreatorStudio from "./assets/brand/ai-tutorial-creator-studio-v1.webp";
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
import {
  GuidedTour,
  OnboardingDialog,
  useOnboardingController,
  type AccountProfileConfiguration,
  type OnboardingCatalog,
  type OnboardingSetupState,
  type PersistedOnboardingState,
} from "./onboarding";
import {
  appBootstrap,
  catalogDiscover,
  desktopEnvironment,
  diagnosticsRun,
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
  type CatalogCapability,
  type CatalogItem,
  type CloudCatalogEndpoint,
  type RawCivitaiModel,
  type RawCivitaiModelVersion,
  type RawHuggingFaceModel,
  type RawNvidiaCatalogEntry,
} from "./catalog";
import { alystriaCatalogItems, catalogHardwareFromDiagnostics } from "./appCatalog";
import { AdvancedVideoEditor, createEditorProjectFromAlystriaProject, type EditorProject } from "./editor";
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
  { id: "cohere", name: "Cohere", icon: Layers3, detail: "Command · Embed · Rerank", tone: "teal" },
  { id: "gemini", name: "Google AI", icon: Globe2, detail: "Language · images · video", tone: "neutral" },
  { id: "nvidia-nim", name: "NVIDIA NIM (dev/test)", icon: Cpu, detail: "One key · public/synthetic hosted previews · per-model checks", tone: "teal" },
  { id: "black-forest-labs", name: "Black Forest Labs", icon: Image, detail: "FLUX image generation and editing", tone: "neutral" },
  { id: "recraft", name: "Recraft", icon: Sparkles, detail: "Illustration and design assets", tone: "indigo" },
  { id: "elevenlabs", name: "ElevenLabs", icon: Mic2, detail: "Voices and narration", tone: "neutral" },
  { id: "azure-speech", name: "Azure Speech", icon: AudioLines, detail: "Speech, transcription, presenter", tone: "neutral" },
  { id: "google-cloud-speech", name: "Google Cloud Speech", icon: Languages, detail: "Speech and alignment", tone: "neutral" },
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
  { id: "local/flux2-klein-4b", name: "FLUX.2 Klein 4B", medium: "Illustration", detail: "Optional 12 GB benchmark" },
  { id: "local/qwen3-tts-0.6b", name: "Qwen3 TTS 0.6B", medium: "Narration", detail: "English / Spanish candidate" },
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
  ["cohere", "Cohere"],
  ["gemini", "Google Gemini"],
  ["nvidia-nim", "NVIDIA NIM (public/synthetic preview)"],
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
    .filter((asset) => asset.kind === "presenter")
    .flatMap((asset) => {
      const preview = STARTER_PRESENTER_PREVIEWS[asset.id];
      if (!preview) return [];
      const [label, style = "Presenter"] = asset.label.split(" · ");
      return [{ id: asset.id, src: preview.src, alt: `${style} portrait of the fictional presenter ${label}`, label: label ?? asset.label, style, attribution: asset.attribution }];
    }),
};

const GUIDED_TOUR_STEPS = [
  { id: "create", target: ".new-project-button", title: "Start from one clear idea", description: "Create a tutorial, choose any duration, approve its provider routes, then generate an editable learning plan.", placement: "right" as const, allowTargetInteraction: true },
  { id: "models", target: "[aria-label='Models & providers']", title: "Every capability has its own model route", description: "Search local and hosted catalogs, compare compatibility and licenses, then choose writer, visual review, image, voice, presenter, lip-sync and upscale models independently.", placement: "right" as const },
  { id: "templates", target: "[aria-label='Templates']", title: "Choose an authored visual grammar", description: "Templates define pacing and scene structure. Designed slides remain editable; illustrated slides keep authoritative text on deterministic layers.", placement: "right" as const },
  { id: "jobs", target: ".jobs-button", title: "Background work stays accountable", description: "Every download, generation and render appears here only after you start it, with origin, progress, resource use and cancellation controls.", placement: "bottom" as const },
  { id: "profile", target: ".profile-button", title: "Your profile and presenter gallery", description: "Choose from 30 supplied educator styles or configure your own portrait. Presenter identity, voice, idle motion and consent remain explicit project choices.", placement: "right" as const },
  { id: "editor", target: ".command-trigger", title: "Edit the result, not just the prompt", description: "Open a project to refine slides, transcript, presenter, audio and timeline. AI changes arrive as previewable, reversible proposals before export.", placement: "bottom" as const },
] as const;

function starterAsset(id: string, kind: StudioAssetKind, label: string, creator: string, license: string, sha256?: string, byteSize?: number, mediaType?: string): StudioAssetReference {
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
  const [snapshot, setSnapshot, resetSnapshot] = usePersistentState<AppSnapshot>("alystria-studio-v2", defaultSnapshot, normalizeAppSnapshot);
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
      runtimeConfigured: false,
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
  }, [attachedModelIds, detectedConnections, diagnosticReport, initialOnboarding, runtime.environment]);
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
  const previousOnboardingStatus = useRef(initialOnboarding?.status ?? "not-started");
  const toastCounter = useRef(0);
  const snapshotSaveSequence = useRef(Promise.resolve());
  const durableVersionByProject = useRef(new Map<string, number>());
  const customizationSaves = useRef(new Map<string, {
    projectId: string;
    projectDirectory: string;
    expectedHeadRevisionId: string;
    latest: CanvasCustomization;
    version: number;
    persistedVersion: number;
    saving: boolean;
    timer?: number;
  }>());

  const activeProject = snapshot.projects.find((project) => project.id === activeProjectId) ?? snapshot.projects[0] ?? null;
  const activeScene = activeProject?.scenes.find((scene) => scene.id === activeSceneId) ?? activeProject?.scenes[0] ?? null;

  const notify = (title: string, detail: string, tone: ToastMessage["tone"] = "success") => {
    const id = ++toastCounter.current;
    setToasts((items) => [...items, { id, title, detail, tone }]);
    window.setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 3800);
  };

  const openProject = (projectId: string, nextWorkspace: Workspace = "plan") => {
    const project = snapshot.projects.find((item) => item.id === projectId);
    if (project?.nativeProjectDirectory && runtime.environment === "native") {
      void projectOpen({ projectDirectory: project.nativeProjectDirectory, allowReadOnly: true })
        .then(async (handle) => {
          const durable = await projectSnapshotGet({
            projectId: handle.manifest.projectId,
            projectDirectory: handle.projectDirectory,
          });
          setSnapshot((current) => ({
            ...current,
            projects: current.projects.map((item) => item.id === projectId
              ? hydrateDurableProject(item, durable.snapshot, {
                nativeProjectId: handle.manifest.projectId,
                nativeProjectDirectory: handle.projectDirectory,
                nativeHeadRevisionId: durable.headRevisionId,
                nativeRevisionNumber: durable.revisionNumber,
              })
              : item),
          }));
        })
        .catch((error: unknown) => notify("Project folder needs attention", errorMessage(error), "warning"));
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
          ? { ...project, scenes: project.scenes.map((scene) => (scene.id === sceneId ? { ...scene, ...update } : scene)), updatedAt: "just now" }
          : project,
      ),
      version: current.version + 1,
    }));
  };

  const flushProjectCustomization = async (projectKey: string) => {
    const entry = customizationSaves.current.get(projectKey);
    if (!entry || entry.saving || entry.persistedVersion >= entry.version) return;
    entry.saving = true;
    let conflictRetries = 0;
    try {
      while (entry.persistedVersion < entry.version) {
        const savingVersion = entry.version;
        const expectedHead = entry.expectedHeadRevisionId;
        const customization = structuredClone(entry.latest);
        try {
          const saved = await projectCustomizationSave({
            projectId: entry.projectId,
            projectDirectory: entry.projectDirectory,
            expectedHeadRevisionId: expectedHead,
            customization,
            message: "Updated visual bible customization",
          });
          if (entry.expectedHeadRevisionId === expectedHead) {
            entry.expectedHeadRevisionId = saved.headRevisionId;
          }
          entry.persistedVersion = savingVersion;
          conflictRetries = 0;
          setSnapshot((current) => ({
            ...current,
            projects: current.projects.map((project) => project.id === projectKey && project.nativeHeadRevisionId === expectedHead
              ? {
                ...project,
                nativeHeadRevisionId: saved.headRevisionId,
                nativeRevisionNumber: saved.revisionNumber,
              }
              : project),
          }));
        } catch (error) {
          if (!errorMessage(error).includes("REVISION_CONFLICT") || conflictRetries >= 2) throw error;
          conflictRetries += 1;
          const current = await projectSnapshotGet({
            projectId: entry.projectId,
            projectDirectory: entry.projectDirectory,
          });
          entry.expectedHeadRevisionId = current.headRevisionId;
          setSnapshot((snapshotState) => ({
            ...snapshotState,
            projects: snapshotState.projects.map((project) => project.id === projectKey
              ? {
                ...project,
                nativeHeadRevisionId: current.headRevisionId,
                nativeRevisionNumber: current.revisionNumber,
              }
              : project),
          }));
        }
      }
    } catch (error) {
      // Stop automatic retry storms after bounded conflict recovery. The
      // in-memory choice remains visible and the next user edit queues a fresh
      // save against the most recently observed head.
      entry.persistedVersion = entry.version;
      notify("Visual bible needs attention", `${errorMessage(error)} Your choices remain in this app session and can be saved again after the project is refreshed.`, "warning");
    } finally {
      entry.saving = false;
      if (entry.persistedVersion < entry.version) {
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
    next.timer = window.setTimeout(() => { void flushProjectCustomization(project.id); }, 500);
    customizationSaves.current.set(project.id, next);
  };

  const updateProjectCreative = (projectId: string, creative: CreativeConfiguration) => {
    setSnapshot((current) => ({
      ...current,
      projects: current.projects.map((project) => project.id === projectId ? { ...project, creative, updatedAt: "just now" } : project),
      version: current.version + 1,
    }));
  };

  const addJob = (job: JobRecord) => setSnapshot((current) => ({ ...current, jobs: [job, ...current.jobs] }));

  useEffect(() => {
    let active = true;
    void appBootstrap().then((bootstrap) => {
      if (active) setRuntime((current) => ({ ...current, bootstrap, loading: false, error: null }));
    }).catch((error: unknown) => {
      if (active) setRuntime((current) => ({ ...current, loading: false, error: errorMessage(error) }));
    });
    return () => { active = false; };
  }, []);

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
      setGuidedTourIndex(0);
      setGuidedTourOpen(true);
    }
    previousOnboardingStatus.current = onboarding.state.status;
  }, [onboarding.state.status]);

  useEffect(() => () => {
    for (const entry of customizationSaves.current.values()) {
      if (entry.timer) window.clearTimeout(entry.timer);
    }
  }, []);

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

  useEffect(() => {
    if (runtime.environment !== "native" || !jobsOpen || Object.keys(nativeJobs).length === 0) return;
    let active = true;
    const refresh = async () => {
      const entries = await Promise.all(Object.entries(nativeJobs).map(async ([id, input]) => {
        try {
          return [id, await jobStatus(input)] as const;
        } catch {
          return null;
        }
      }));
      if (!active) return;
      setSnapshot((current) => ({
        ...current,
        jobs: current.jobs.map((job) => {
          const receipt = entries.find((entry) => entry?.[0] === job.id)?.[1];
          return receipt ? receiptJob(receipt, job.title, job.detail, nativeJobProject(job) ?? undefined) : job;
        }),
      }));
    };
    void refresh();
    const interval = window.setInterval(() => { void refresh(); }, 5_000);
    return () => { active = false; window.clearInterval(interval); };
  }, [jobsOpen, nativeJobs, runtime.environment, setSnapshot]);

  useEffect(() => {
    if (snapshot.version === 0) return;
    const project = snapshot.projects.find((item) => item.id === activeProjectId);
    if (!project?.nativeProjectId || !project.nativeProjectDirectory || !project.nativeHeadRevisionId) return;
    const savedVersion = durableVersionByProject.current.get(project.id);
    if (savedVersion === undefined) {
      durableVersionByProject.current.set(project.id, snapshot.version);
      return;
    }
    if (savedVersion === snapshot.version) return;
    const timer = window.setTimeout(() => {
      const durableProject = projectSnapshotDocument(project);
      snapshotSaveSequence.current = snapshotSaveSequence.current
        .catch(() => undefined)
        .then(async () => {
          let expectedHead = project.nativeHeadRevisionId!;
          try {
            const saved = await projectSnapshotSave({
              projectId: project.nativeProjectId!,
              projectDirectory: project.nativeProjectDirectory!,
              expectedHeadRevisionId: expectedHead,
              snapshot: durableProject,
              message: "Saved scene and script edits",
            });
            durableVersionByProject.current.set(project.id, snapshot.version);
            setSnapshot((current) => ({
              ...current,
              projects: current.projects.map((item) => item.id === project.id ? {
                ...item,
                nativeHeadRevisionId: saved.headRevisionId,
                nativeRevisionNumber: saved.revisionNumber,
              } : item),
            }));
          } catch (error) {
            if (!errorMessage(error).includes("REVISION_CONFLICT")) throw error;
            const current = await projectSnapshotGet({
              projectId: project.nativeProjectId!,
              projectDirectory: project.nativeProjectDirectory!,
            });
            expectedHead = current.headRevisionId;
            const saved = await projectSnapshotSave({
              projectId: project.nativeProjectId!,
              projectDirectory: project.nativeProjectDirectory!,
              expectedHeadRevisionId: expectedHead,
              snapshot: durableProject,
              message: "Saved scene and script edits after refresh",
            });
            durableVersionByProject.current.set(project.id, snapshot.version);
            setSnapshot((state) => ({
              ...state,
              projects: state.projects.map((item) => item.id === project.id ? {
                ...item,
                nativeHeadRevisionId: saved.headRevisionId,
                nativeRevisionNumber: saved.revisionNumber,
              } : item),
            }));
          }
        })
        .catch((error: unknown) => notify("Project edits need attention", errorMessage(error), "warning"));
    }, 650);
    return () => window.clearTimeout(timer);
  }, [activeProjectId, snapshot.projects, snapshot.version, setSnapshot]);

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
    const entry = Object.entries(nativeJobs).find(([, link]) => link.projectId === projectId);
    if (!entry) {
      notify("Learning plan approved", "Browser demo approval is reflected in the storyboard.", "success");
      setWorkspace("storyboard");
      return;
    }
    const [jobId, link] = entry;
    try {
      const receipt = await generationApprove(link);
      setSnapshot((current) => ({
        ...current,
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
      notify(receipt.state === "SUCCEEDED" ? "Scene rendered" : "Scene render unavailable", receipt.message, receipt.state === "SUCCEEDED" ? "success" : "warning");
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
      notify(receipt.state === "SUCCEEDED" ? "Repair candidate persisted" : "QA repair blocked", receipt.message, receipt.state === "SUCCEEDED" ? "success" : "warning");
    } catch (error) {
      notify("QA repair blocked", errorMessage(error), "warning");
    }
  };

  const exportNativeMaster = async (settings: ExportRequestSettings) => {
    const project = snapshot.projects.find((item) => item.id === activeProjectId)!;
    const link = nativeProjectLink(project);
    const baseJobId = baseGenerationJobId(project);
    const { codecPreference, ...nativeSettings } = settings;
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
    const receipt = await masterExport({ ...link, baseRevisionId: project.nativeHeadRevisionId, baseJobId, ...nativeSettings });
    const annotatedReceipt: JobReceipt = {
      ...receipt,
      result: { ...(receipt.result ?? {}), requestedFps: settings.fps, requestedCodec: codecPreference, codecForwarded: false },
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
              onRegenerate={setRegenScene}
              onNotify={notify}
              onAddJob={addJob}
              onImportSources={(files) => importSources(activeProject.id, files)}
              onExportArchive={() => exportArchive(activeProject.id)}
              onApproveGeneration={() => { void approveProjectGeneration(activeProject.id); }}
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
              onReset={() => { resetSnapshot(); notify("Workspace reset", "Local browser preferences returned to a clean state.", "info"); }}
              onReplayOnboarding={onboarding.replay}
              onReplayTour={() => { setGuidedTourIndex(0); setGuidedTourOpen(true); }}
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
            notify(receipt.state === "SUCCEEDED" ? "Candidate work persisted" : "Candidate work blocked", receipt.message, receipt.state === "SUCCEEDED" ? "success" : "warning");
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
        open={guidedTourOpen}
        steps={GUIDED_TOUR_STEPS}
        activeIndex={guidedTourIndex}
        onActiveIndexChange={setGuidedTourIndex}
        onExit={() => setGuidedTourOpen(false)}
        onComplete={() => { localStorage.setItem("alystria-guided-tour-v1", "completed"); setGuidedTourOpen(false); }}
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
                {id === "review" && <span className="nav-badge amber">3</span>}
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
              {id === "providers" && <span className="status-dot online" aria-label="Providers ready" />}
            </button>
          ))}
        </nav>
      )}
      <div className="sidebar-bottom">
        <div className="local-status"><span><HardDrive size={14} /> Local workspace</span><small>Protected · 184 GB free</small></div>
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
        <button className="command-trigger" onClick={onCommand}><Search size={15} /><span>Search or run</span><kbd>⌘ K</kbd></button>
        <button className={`jobs-button ${running ? "is-running" : ""}`} onClick={onJobs}><Activity size={17} /><span>Jobs</span>{running > 0 && <b>{running}</b>}</button>
      </div>
    </header>
  );
}

function GlobalWorkspace({ area, snapshot, runtime, diagnosticReport, onArea, onOpenProject, onNew, onUseTemplate, onNotify, onImportSources, onReset, onReplayOnboarding, onReplayTour }: {
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
}) {
  switch (area) {
    case "home": return <HomeView snapshot={snapshot} runtime={runtime} onOpen={onOpenProject} onNew={onNew} onArea={onArea} />;
    case "projects": return <ProjectsView projects={snapshot.projects} onOpen={onOpenProject} onNew={onNew} />;
    case "templates": return <TemplatesView onUse={onUseTemplate} />;
    case "library": return <LibraryView project={snapshot.projects.find((project) => project.id === snapshot.recentProjectId) ?? snapshot.projects[0] ?? null} onNotify={onNotify} onImportSources={onImportSources} />;
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
      <section className="home-hero">
        <div className="hero-copy">
          <span className="section-kicker"><Sparkles size={14} /> Your teaching studio</span>
          <h1>Turn a difficult idea into<br /><em>a clear line of thought.</em></h1>
          <p>Research, structure, narrate, and render rigorous tutorials—without losing the thread between a claim and the scene that teaches it.</p>
          <div className="hero-actions"><button className="primary-button" onClick={onNew}><Plus size={17} /> Create a tutorial</button>{featured && <button className="secondary-button" onClick={() => onOpen(featured.id)}><PlayCircle size={17} /> Continue working</button>}</div>
        </div>
        <div className="concept-thread-hero" aria-label="A tutorial moves from idea to evidence to scene to review">
          <img className="concept-hero-art" src={tutorialCreatorStudio} alt="A tutorial creator teaching beside a camera, storyboard, waveform, and editing timeline" width="1536" height="1024" decoding="async" />
          <div className="thread-line" />
          <div className="thread-node node-idea"><span><TextCursorInput size={17} /></span><small>Idea</small><strong>Your difficult question</strong></div>
          <div className="thread-node node-evidence"><span><Link2 size={17} /></span><small>Evidence</small><strong>Sources you approve</strong></div>
          <div className="thread-node node-scene"><span><Film size={17} /></span><small>Scenes</small><strong>Editable visual beats</strong></div>
          <div className="thread-node node-review"><span><BadgeCheck size={17} /></span><small>Review</small><strong>Clear export checks</strong></div>
          <div className="thread-watermark">IDEA → VIDEO</div>
        </div>
      </section>

      {featured ? <section className="continue-section">
        <div className="section-heading"><div><span className="section-kicker">Continue the thread</span><h2>{featured.title}</h2></div><button className="text-button" onClick={() => onOpen(featured.id)}>Open project <ArrowRight size={15} /></button></div>
        <button className="continue-card" onClick={() => onOpen(featured.id, "storyboard")}>
          <div className="continue-preview"><SceneArtwork scene={featured.scenes[3]!} compact /><div className="preview-time">03:14 / 12:00</div></div>
          <div className="continue-details">
            <div className="project-status-line"><StatusPill status={featured.status} /><span>{featured.updatedAt}</span></div>
            <h3>Review the three-product insight</h3>
            <p>The worked derivation is ready. One citation and two narration beats still need attention before production.</p>
            <div className="continue-metrics"><span><Layers3 size={15} /> 8 scenes</span><span><Link2 size={15} /> 42 evidence spans</span><span><Languages size={15} /> English</span></div>
            <ProgressBar value={featured.progress} /><small>{featured.progress}% ready for export</small>
          </div>
        </button>
      </section> : <section className="continue-section empty-workbench"><EmptyState icon={Sparkles} title="Your workbench is ready" detail="No sample projects or background jobs were added. Start a tutorial when you are ready, or follow the guided setup first." action={<button className="primary-button" onClick={onNew}><Plus size={17} /> Create your first tutorial</button>} /></section>}

      <section className="home-grid">
        <div className="home-panel recent-panel">
          <div className="panel-heading"><div><span className="section-kicker">Recent projects</span><h3>On your workbench</h3></div><button className="icon-button" onClick={() => onArea("projects")} aria-label="View all projects"><ArrowRight size={17} /></button></div>
          <div className="mini-project-list">{snapshot.projects.length ? snapshot.projects.slice(0, 3).map((project) => <button key={project.id} onClick={() => onOpen(project.id)}><span className={`mini-project-art art-${project.id}`}><Film size={19} /></span><span><strong>{project.title}</strong><small>{project.locale} · {project.duration} min · {project.updatedAt}</small></span><span className="mini-progress">{project.progress}%</span></button>) : <p className="empty-list-copy">Projects you create will appear here.</p>}</div>
        </div>
        <div className="home-panel readiness-panel">
          <div className="panel-heading"><div><span className="section-kicker">Studio readiness</span><h3>Everything stays in view</h3></div><ShieldCheck className="teal" size={23} /></div>
          <div className="readiness-list">
            <span><CheckCircle2 /> {runtime.environment === "native" ? "Native project storage" : "Browser demo storage"} <b>{runtime.bootstrap ? "Ready" : "Checking"}</b></span>
            <span>{runtime.bootstrap?.worker.state === "ready" ? <CheckCircle2 /> : <CircleAlert />} Pipeline worker <b className={runtime.bootstrap?.worker.state === "ready" ? "" : "amber-text"}>{workerLabel(runtime.bootstrap?.worker)}</b></span>
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
      {filtered.length ? <div className="project-grid">{filtered.map((project) => <ProjectCard key={project.id} project={project} onOpen={() => onOpen(project.id)} />)}<button className="project-card new-card" onClick={onNew}><span><Plus size={24} /></span><strong>Start with a difficult idea</strong><small>Build a grounded learning plan first.</small></button></div> : <EmptyState icon={Search} title="No projects match" detail="Try a different phrase or clear the current status filter." action={<button className="secondary-button" onClick={() => { setQuery(""); setFilter("All"); }}>Clear filters</button>} />}
    </div>
  );
}

function ProjectCard({ project, onOpen }: { project: ProjectRecord; onOpen: () => void }) {
  return <button className="project-card" onClick={onOpen}>
    <div className={`project-card-art art-${project.id}`}><span className="project-card-label">{project.theme}</span><SceneArtwork scene={project.scenes[0]!} compact /></div>
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
    <div className="template-grid">{shown.map((template) => <article className={`template-card template-${template.color}`} key={template.id}><div className="template-visual"><img src={TEMPLATE_PREVIEWS[template.id]} alt="" width="832" height="468" loading="eager" decoding="async" /><span>{template.category}</span></div><div><small>{template.scenes} suggested scenes</small><h3>{template.name}</h3><p>{template.description}</p><button className="text-button" onClick={() => onUse(template.id)}>Use template <ArrowRight size={15} /></button></div></article>)}</div>
  </div>;
}

function LibraryView({ project, onNotify, onImportSources }: { project: ProjectRecord | null; onNotify: (title: string, detail: string, tone?: ToastMessage["tone"]) => void; onImportSources: (files: File[]) => Promise<SourceImportReceipt[]> }) {
  const [tab, setTab] = useState("Sources");
  if (!project) return <div className="page"><PageTitle kicker="Reusable material" title="Library" description="Sources, visuals, audio, and brand kits stay local and carry their rights information with them." /><EmptyState icon={Library} title="No project library yet" detail="Create or open a tutorial before importing project-owned material." /></div>;
  return <div className="page">
    <PageTitle kicker="Reusable material" title="Library" description="Sources, visuals, audio, and brand kits stay local and carry their rights information with them." action={<SourceImportControl label="Import assets" onImport={onImportSources} onNotify={onNotify} />} />
    <div className="subtabs">{["Sources", "Visuals", "Audio", "Brand kits"].map((item) => <button className={tab === item ? "active" : ""} onClick={() => setTab(item)} key={item}>{item}</button>)}</div>
    {tab === "Sources" ? <div className="library-layout"><div className="library-list"><div className="library-list-head"><strong>{project.sources.length} source records</strong><span>{project.sources.filter((source) => source.status === "verified").length} verified · {project.sources.filter((source) => source.privacy !== "public").length} private</span></div>{project.sources.map((source) => <button key={source.id}><span className={`source-icon ${source.kind}`}><FileText size={18} /></span><span><strong>{source.title}</strong><small>{source.origin}{source.byteSize ? ` · ${formatBytes(source.byteSize)}` : ""}</small></span><span className="license-tag">{source.license}</span><ChevronRight size={16} /></button>)}</div><aside className="library-summary"><span className="section-kicker">Rights at a glance</span><h3>Every reusable asset has a paper trail.</h3><div className="donut-wrap"><div className="donut"><span>{project.sources.length ? Math.round(project.sources.filter((source) => source.status === "verified").length / project.sources.length * 100) : 0}%<small>cleared</small></span></div></div><ul><li><i className="teal-bg" /> Cleared for export <b>{project.sources.filter((source) => source.status === "verified").length}</b></li><li><i className="amber-bg" /> Needs review <b>{project.sources.filter((source) => source.status === "review").length}</b></li><li><i className="ink-bg" /> Local/private <b>{project.sources.filter((source) => source.privacy !== "public").length}</b></li></ul></aside></div> : <EmptyState icon={tab === "Visuals" ? Image : tab === "Audio" ? AudioLines : Presentation} title={`${tab} library is ready`} detail={`Import ${tab.toLowerCase()} with provenance, or create them inside a project.`} action={<SourceImportControl label={`Import ${tab.toLowerCase()}`} onImport={onImportSources} onNotify={onNotify} secondary />} />}
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
      const capabilities: CatalogCapability[] = endpoints.some((endpoint) => /embed/i.test(endpoint)) ? ["retrieval.embed"] : endpoints.some((endpoint) => /rerank/i.test(endpoint)) ? ["retrieval.embed", "llm.structured"] : ["llm.text", "llm.structured"];
      const raw: CloudCatalogEndpoint = {
        id: `cohere/${name}`,
        providerId: "cohere",
        publisher: "Cohere",
        name,
        revision: null,
        capabilities,
        modalities: ["text"],
        operationIds: endpoints.length ? endpoints : ["POST /v2/chat"],
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
    const capabilities = nvidiaCapabilities(id);
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
      entitlement: "available",
      sourceUrl: `https://build.nvidia.com/${encodeURIComponent(id)}`,
      documentationUrl: "https://docs.api.nvidia.com/nim/",
      publisherVerifiedBySource: true,
      retrievedAt: response.retrievedAt,
    };
    return [adaptNvidiaCatalogEntry(raw)];
  });
}

function nvidiaCapabilities(id: string): CatalogCapability[] {
  const normalized = id.toLowerCase();
  if (/flux|stable-diffusion|image|diffusion/u.test(normalized)) return ["image.generate", "image.edit"];
  if (/embed/u.test(normalized)) return ["retrieval.embed"];
  if (/rerank/u.test(normalized)) return ["retrieval.embed", "llm.structured"];
  if (/vision|vlm|multimodal|gemma-3/u.test(normalized)) return ["llm.text", "vlm.review"];
  return ["llm.text", "llm.structured"];
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
    <section className="routing-card"><div><span className="section-kicker">Default routing boundary</span><h3>{mode} creation</h3><p>{mode === "Local" ? "All generation remains on this device. No cloud fallback." : mode === "Cloud" ? "Use only connected cloud providers after cost and privacy approval." : "Keep private sources local; route approved creative tasks to cloud providers."}</p></div><div className="segmented-large" role="group" aria-label="Provider routing mode">{["Local", "Hybrid", "Cloud"].map((item) => <button key={item} className={mode === item ? "active" : ""} onClick={() => setMode(item)}><span>{item === "Local" ? <HardDrive /> : item === "Cloud" ? <Cloud /> : <Network />}</span>{item}</button>)}</div><div className="routing-facts"><span><ShieldCheck /> No silent fallback</span><span><CircleDollarSign /> Hard budgets enabled</span><span><Lock /> Keys in OS vault</span></div></section>
    <section className="federated-catalog-panel" aria-labelledby="federated-catalog-title">
      <div className="federated-catalog-heading"><div><span className="section-kicker">LM Studio-style discovery, widened for production</span><h2 id="federated-catalog-title">One model library for every capability</h2><p>Search supported recipe candidates now; sync live hub rows only from a dated API response, a connected provider, or a verified local scan. Unknown revisions and licenses stay visibly blocked.</p></div><span><Cpu size={16} /> {catalogHardware.gpuNames[0] ?? "Hardware probe pending"}</span></div>
      <div className="catalog-source-strip" aria-label="Federated catalog sources">{defaultCatalogSources.map((source) => {
        const syncable = (["hugging-face", "civitai", "nvidia-nim", "cohere"] as const).find((candidate) => candidate === source.id);
        const count = syncable ? catalogSyncedCounts[syncable] ?? 0 : 0;
        const hasMore = syncable ? Boolean(catalogCursors[syncable]) : false;
        return <article key={source.id} className={!source.catalogUrl ? "local-source" : ""}><ProviderMark providerId={source.brandAssetId} compact /><strong>{source.label}</strong><small>{count ? `${count} live rows · ` : ""}{source.discovery.replaceAll("-", " ")} · {source.authentication.replaceAll("-", " ")}</small><span>{source.catalogUrl && <a href={source.catalogUrl} target="_blank" rel="noreferrer">Explore</a>}{syncable && <button type="button" disabled={catalogSyncing !== null || ((syncable === "nvidia-nim" || syncable === "cohere") && secretRefs[syncable]?.availability !== "present")} onClick={() => { void syncCatalog(syncable); }}><RefreshCw size={11} className={catalogSyncing === syncable ? "spinning" : ""} />{catalogSyncing === syncable ? "Syncing…" : hasMore ? "Load more" : "Sync"}</button>}</span></article>;
      })}</div>
      <CatalogIntegrationExample hardware={catalogHardware} items={catalogItems} onModelSelected={(item) => onNotify("Model inspected", `${item.identity.name} remains blocked until its exact revision, license, compatibility, and required artifacts pass review.`, "info")} />
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
        return <label className="profile-route-choice" key={medium}><span>{label}</span><div className="profile-route-fields"><select aria-label={`${label} provider`} value={selection.providerId} onChange={(event) => updateSelection({ providerId: event.target.value })}>{profileProviderOptions.map(([id, name]) => <option value={id} key={id}>{name}</option>)}</select><input value={selection.modelId} aria-label={`${label} model`} onChange={(event) => updateSelection({ modelId: event.target.value })} placeholder="Exact model ID" />{medium === "voice" && <input value={selection.voiceId ?? ""} aria-label={`${label} voice ID`} onChange={(event) => updateSelection({ voiceId: event.target.value || null })} placeholder="Voice ID" />}{presenterBound && <input value={selection.presenterProfileId ?? ""} aria-label={`${label} presenter profile ID`} onChange={(event) => updateSelection({ presenterProfileId: event.target.value || null })} placeholder="Presenter profile ID" />}{selection.providerId === "local-runtime" && <><input value={selection.modelRevision ?? ""} aria-label={`${label} model revision`} onChange={(event) => updateSelection({ modelRevision: event.target.value || null })} placeholder="Immutable revision" /><input value={selection.installFingerprint ?? ""} aria-label={`${label} install fingerprint`} onChange={(event) => updateSelection({ installFingerprint: event.target.value || null })} placeholder="Verified SHA-256" /></>}</div></label>;
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
    { id: "frame-renderer", label: "Frame renderer", level: "pass", summary: "Shared deterministic SceneView" },
    { id: "power-profile", label: "Power profile", level: "info", summary: "Silent profile respected; no changes requested" },
  ];
  return <div className="page">
    <PageTitle kicker="Settings & diagnostics" title="A healthy studio is predictable." description="Inspect local runtimes, storage, privacy, accessibility, and recovery without changing your Windows power profile." action={<button className="primary-button" onClick={() => { void runChecks(); }} disabled={checking}>{checking ? <RefreshCw className="spin" size={17} /> : <Activity size={17} />}{checking ? " Running checks" : " Run diagnostics"}</button>} />
    <div className="diagnostics-grid">
      <section className="diagnostic-panel wide"><div className="panel-heading"><div><span className="section-kicker">System readiness</span><h3>{runtime.environment === "native" ? "Native toolchain" : "Browser preview"}</h3></div><span className="health-score">{rows.filter((row) => row.level === "pass").length} / {rows.length} passed</span></div><div className="diagnostic-rows">{rows.map((row) => { const Icon = diagnosticIcon(row.id); const ready = row.level === "pass"; return <div key={row.id}><span className="diagnostic-icon"><Icon size={17} /></span><span><strong>{row.label}</strong><small>{row.summary}</small></span><span className={`check-state ${ready ? "ready" : "attention"}`}>{ready ? <Check size={13} /> : <CircleAlert size={13} />}{row.level}</span></div>; })}</div></section>
      <section className="diagnostic-panel"><span className="section-kicker">Privacy boundary</span><div className="privacy-orbit"><Lock size={22} /><i /><i /></div><h3>Local means local.</h3><p>Analytics are off. Private source contents cannot leave this device unless you explicitly reclassify them.</p><button className="text-button">Review privacy controls <ArrowRight size={15} /></button></section>
      <section className="diagnostic-panel"><span className="section-kicker">Power & performance</span><div className="power-mode"><Moon size={22} /><span><strong>Silent profile respected</strong><small>Benchmarks are estimation-only</small></span></div><p>{PRODUCT_NAME} won’t change Windows or G-Helper power modes. Use a performance profile only for deliberate benchmark runs.</p><button className="text-button" onClick={() => onNotify("Power profile unchanged", "No benchmark needs boost for functional acceptance.", "info")}>Why this is recommended <ArrowRight size={15} /></button></section>
      <section className="diagnostic-panel wide intricate-settings"><div className="panel-heading"><div><span className="section-kicker">Storage & recovery</span><h3>Keep heavy work away from the system drive</h3></div><HardDrive size={21} /></div><div className="settings-form-grid"><label><span>Model cache</span><input value={preferences.modelCacheDirectory} onChange={(event) => updatePreference("modelCacheDirectory", event.target.value)} /></label><label><span>Render scratch</span><input value={preferences.renderScratchDirectory} onChange={(event) => updatePreference("renderScratchDirectory", event.target.value)} /></label><label><span>Autosave interval</span><select value={preferences.autosaveSeconds} onChange={(event) => updatePreference("autosaveSeconds", Number(event.target.value))}><option value="3">3 seconds</option><option value="8">8 seconds</option><option value="15">15 seconds</option><option value="30">30 seconds</option></select></label><label><span>Local backup versions</span><input type="number" min="3" max="100" value={preferences.backupCount} onChange={(event) => updatePreference("backupCount", Number(event.target.value))} /></label></div></section>
      <section className="diagnostic-panel wide intricate-settings"><div className="panel-heading"><div><span className="section-kicker">Privacy & trust</span><h3>Every external boundary remains deliberate</h3></div><ShieldCheck size={21} /></div><div className="settings-toggle-grid"><SettingsToggle checked={preferences.confirmCloudTransfer} title="Confirm every new cloud content class" detail="A saved provider route never implies consent for private source transfer." onChange={(value) => updatePreference("confirmCloudTransfer", value)} /><SettingsToggle checked={preferences.redactLogs} title="Redact paths, keys and source excerpts from logs" detail="Keep diagnostic bundles useful without leaking project or credential content." onChange={(value) => updatePreference("redactLogs", value)} /><SettingsToggle checked={preferences.crashReports} title="Send anonymous crash reports" detail="Off by default; source text and media are never attached." onChange={(value) => updatePreference("crashReports", value)} /></div></section>
      <section className="diagnostic-panel wide intricate-settings"><div className="panel-heading"><div><span className="section-kicker">Editor & accessibility</span><h3>Fit the creative surface to the person</h3></div><MonitorPlay size={21} /></div><div className="settings-toggle-grid"><SettingsToggle checked={preferences.reducedMotion} title="Reduce interface motion" detail="Preserve hierarchy and feedback without camera-like transitions." onChange={(value) => updatePreference("reducedMotion", value)} /><SettingsToggle checked={preferences.highContrast} title="High-contrast controls and guides" detail="Increase control boundaries, focus rings and canvas guide contrast." onChange={(value) => updatePreference("highContrast", value)} /><SettingsToggle checked={preferences.denseEditor} title="Dense multitrack editor" detail="Show more tracks and inspector fields on large displays." onChange={(value) => updatePreference("denseEditor", value)} /></div><div className="settings-form-grid"><label><span>Caption language</span><select value={preferences.defaultCaptionLanguage} onChange={(event) => updatePreference("defaultCaptionLanguage", event.target.value)}><option>Match tutorial</option><option>English</option><option>Spanish</option><option>Hindi</option></select></label><label><span>Default export rate</span><select value={preferences.defaultExportFps} onChange={(event) => updatePreference("defaultExportFps", Number(event.target.value))}><option value="24">24 fps</option><option value="30">30 fps</option><option value="60">60 fps</option></select></label></div></section>
      <section className="diagnostic-panel wide compact-settings"><div><span className="section-kicker">Tutorial & maintenance</span><h3>Replay guidance or clean local UI state</h3></div><div className="setting-actions"><button className="secondary-button" onClick={onReplayOnboarding}><PlayCircle size={16} /> Replay setup</button><button className="secondary-button" onClick={onReplayTour}><Sparkles size={16} /> Replay guided tour</button><button className="secondary-button" onClick={() => onNotify("Backup queued", "A copy-first local project backup will be created by the desktop service.", "info")}><Archive size={16} /> Create backup</button><button className="secondary-button danger-text" onClick={onReset}><RotateCcw size={16} /> Reset local workspace</button></div></section>
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
  onRegenerate: (scene: Scene) => void;
  onNotify: (title: string, detail: string, tone?: ToastMessage["tone"]) => void;
  onAddJob: (job: JobRecord) => void;
  onImportSources: (files: File[]) => Promise<SourceImportReceipt[]>;
  onExportArchive: () => Promise<string>;
  onApproveGeneration: () => void;
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

function PlanWorkspace({ project, onNotify, onApproveGeneration, onImportSources, onSceneUpdate, onUndo, onRedo }: ProjectWorkspaceProps) {
  const [tab, setTab] = useState("Learning plan");
  const objectives = ["Explain why the school method creates four half-size products", "Derive the identity that recovers both cross terms from one product", "Work through 1234 × 5678 without skipping place-value reconstruction", "Compare T(n) = 4T(n/2) + O(n) with Karatsuba’s recurrence"];
  return <div className="page project-page plan-workspace">
    <ProjectHeader project={project} step="1 · Plan" title="Shape the learning journey" description="Keep the audience, evidence, objectives, and script connected before a single frame is rendered." action={<button className="primary-button" onClick={onApproveGeneration}>Approve learning plan <ArrowRight size={16} /></button>} />
    <div className="plan-progress" aria-label="Plan progress">{["Brief", "Sources", "Research", "Learning plan", "Script"].map((item, index) => <button key={item} className={tab === item ? "active" : index < 3 ? "complete" : ""} onClick={() => setTab(item)}><i>{index < 3 ? <Check size={13} /> : index + 1}</i><span>{item}</span></button>)}</div>
    <div className="plan-grid">
      <section className="plan-main-card">
        <div className="card-title-row"><div><span className="section-kicker">Instructional blueprint</span><h2>{tab === "Learning plan" ? "From intuition to recurrence" : tab}</h2></div><button className="secondary-button small"><WandSparkles size={15} /> Refine</button></div>
        {tab === "Learning plan" ? <>
          <div className="learner-strip"><div><UserRoundCheck size={18} /><span><small>Learner</small><strong>{project.audience}</strong></span></div><div><Clock3 size={18} /><span><small>Target</small><strong>{project.duration} minutes</strong></span></div><div><Languages size={18} /><span><small>Language</small><strong>{project.locale}</strong></span></div></div>
          <div className="objective-section"><div className="section-number">01</div><div><span className="section-kicker">Learning objectives</span><div className="objective-list">{objectives.map((objective, index) => <div key={objective}><span>{index + 1}</span><p>{objective}</p><button aria-label="Edit objective"><TextCursorInput size={15} /></button></div>)}</div></div></div>
          <div className="objective-section"><div className="section-number">02</div><div><span className="section-kicker">Prerequisite thread</span><div className="prerequisite-thread"><span>Place value</span><ArrowRight /><span>Algebraic expansion</span><ArrowRight /><span>Recursion</span><ArrowRight /><span className="active">Divide & conquer</span></div></div></div>
          <div className="objective-section"><div className="section-number">03</div><div><span className="section-kicker">Misconceptions to surface</span><div className="misconception-grid"><article><CircleAlert /><strong>“Three products means an approximation.”</strong><p>Show the exact identity before discussing speed.</p></article><article><CircleAlert /><strong>“Fewer calls always means faster.”</strong><p>Name base-case and overhead tradeoffs honestly.</p></article></div></div></div>
        </> : tab === "Sources" || tab === "Research" ? <SourceEvidence project={project} research={tab === "Research"} onImportSources={onImportSources} onNotify={onNotify} /> : <ScriptEditor project={project} onNotify={onNotify} onSceneUpdate={onSceneUpdate} onUndo={onUndo} onRedo={onRedo} />}
      </section>
      <aside className="plan-aside">
        <div className="grounding-card"><div className="grounding-head"><span><ShieldCheck size={17} /> Grounded mode</span><span className="toggle-on"><i /></span></div><p>Externally verifiable claims must be connected to evidence before export.</p><div className="grounding-meter"><span><strong>18 / 18</strong><small>claims supported</small></span><ProgressBar value={100} /></div></div>
        <div className="concept-map-card"><span className="section-kicker">Concept map</span><h3>The dependency thread</h3><ConceptDiagram /><div className="legend"><span><i className="indigo-bg" /> objective</span><span><i className="teal-bg" /> evidence</span><span><i className="amber-bg" /> review</span></div></div>
        <div className="approval-note"><Quote size={18} /><p>“The learner should feel the missing multiplication before they see the algebra.”</p><small>Director’s note · version 12</small></div>
      </aside>
    </div>
  </div>;
}

function SourceEvidence({ project, research, onImportSources, onNotify }: { project: ProjectRecord; research: boolean; onImportSources: (files: File[]) => Promise<SourceImportReceipt[]>; onNotify: ProjectWorkspaceProps["onNotify"] }) {
  return <div className="source-evidence"><div className="source-table-head"><span>{research ? "Evidence ledger" : "Project sources"}</span><SourceImportControl label="Add source" onImport={onImportSources} onNotify={onNotify} secondary small /></div>{project.sources.length ? project.sources.map((source) => <article key={source.id}><span className={`source-icon ${source.kind}`}><FileText size={17} /></span><div><strong>{source.title}</strong><small>{source.origin} · {source.license}{source.byteSize ? ` · ${formatBytes(source.byteSize)}` : ""}</small></div><span className="evidence-count">{source.evidence} {research ? "spans" : "claims"}</span><span className={`source-state ${source.status}`}>{source.status === "verified" ? <CheckCircle2 size={14} /> : <CircleAlert size={14} />} {source.status}</span><button className="icon-button"><ChevronRight size={16} /></button></article>) : <EmptyState icon={FileText} title="No source files yet" detail="Choose local files to validate in quarantine and preserve in this project’s content-addressed store." />}</div>;
}

function ScriptEditor({ project, onNotify, onSceneUpdate, onUndo, onRedo }: { project: ProjectRecord; onNotify: ProjectWorkspaceProps["onNotify"]; onSceneUpdate: ProjectWorkspaceProps["onSceneUpdate"]; onUndo?: () => void; onRedo?: () => void }) {
  return <div className="script-editor"><div className="script-toolbar"><span>{project.scenes.reduce((count, scene) => count + scene.narration.split(/\s+/u).filter(Boolean).length, 0)} words · debounced to project history</span><div><button onClick={onUndo} aria-label="Undo durable revision"><Undo2 size={15} /></button><button onClick={onRedo} aria-label="Redo durable revision"><Redo2 size={15} /></button><button onClick={() => onNotify("Script save scheduled", "Scene edits are appended to project.sqlite after a short debounce.")}><Check size={15} /> Save snapshot</button></div></div>{project.scenes.slice(0, 4).map((scene) => <div className="script-block" key={scene.id}><span>S{scene.index.toString().padStart(2, "0")}</span><div><strong>{scene.title}</strong><p contentEditable suppressContentEditableWarning onBlur={(event) => onSceneUpdate(scene.id, { narration: event.currentTarget.textContent ?? "" })}>{scene.narration}</p><small>{scene.citations} citations · {scene.duration}s target</small></div></div>)}</div>;
}

function StoryboardWorkspace({ project, onScene, onRegenerate, onWorkspace }: ProjectWorkspaceProps) {
  const [view, setView] = useState<"cards" | "list">("cards");
  const approved = project.scenes.filter((scene) => scene.status === "approved").length;
  return <div className="page project-page storyboard-workspace">
    <ProjectHeader project={project} step="2 · Storyboard" title="See the teaching sequence" description="Every card joins a learning objective, narration beat, evidence, and visual treatment." action={<div className="header-action-group"><button className="secondary-button" onClick={() => onWorkspace("plan")}><ArrowLeft size={16} /> Learning plan</button><button className="primary-button" onClick={() => onWorkspace("studio")}>Open studio <ArrowRight size={16} /></button></div>} />
    <div className="storyboard-status"><div><span className="status-ring"><strong>{approved}</strong><small>of {project.scenes.length}</small></span><span><strong>{approved} scenes approved</strong><small>Scene 4 needs evidence review before production.</small></span></div><div className="storyboard-toolbar"><button><Sparkles size={15} /> Suggest a scene</button><button><RefreshCw size={15} /> Regenerate all draft scenes</button><span className="view-toggle"><button className={view === "cards" ? "active" : ""} onClick={() => setView("cards")} aria-label="Card view"><TableProperties size={16} /></button><button className={view === "list" ? "active" : ""} onClick={() => setView("list")} aria-label="List view"><AlignLeft size={16} /></button></span></div></div>
    <div className={`storyboard-list ${view}`}>
      <div className="section-thread-label"><span>Section 01</span><strong>The surprising shortcut</strong><small>4:02</small></div>
      {project.scenes.map((scene, index) => <article className={`storyboard-card status-${scene.status}`} key={scene.id}>
        <div className="scene-order"><span>{String(scene.index).padStart(2, "0")}</span><i /></div>
        <button className="scene-thumbnail" onClick={() => onScene(scene)} aria-label={`Edit ${scene.title}`}><SceneArtwork scene={scene} compact /><span className="scene-duration">{formatTime(scene.duration)}</span><span className="scene-play"><Play size={15} fill="currentColor" /></span></button>
        <div className="scene-card-copy"><div className="scene-card-top"><span className={`scene-kind kind-${scene.kind}`}>{scene.kind.replace("-", " ")}</span><SceneStatus status={scene.status} /></div><button className="scene-title-button" onClick={() => onScene(scene)}><h3>{scene.title}</h3></button><p>{scene.narration}</p><div className="scene-objective"><span>Teaches</span>{scene.objective}</div><div className="scene-metadata"><span><Link2 size={14} /> {scene.citations} citations</span><span><AudioLines size={14} /> Narration draft</span>{scene.locked && <span><Lock size={13} /> Preserved</span>}</div></div>
        <div className="scene-card-actions"><button className="icon-button"><MoreHorizontal size={17} /></button><button className="secondary-button small" onClick={() => onRegenerate(scene)}><RefreshCw size={14} /> Regenerate</button></div>
        {index === 3 && <div className="review-ribbon"><CircleAlert size={14} /> One source span is link-only</div>}
      </article>)}
      <button className="add-scene-card"><Plus size={19} /><span><strong>Add a teaching moment</strong><small>Choose from 28 purpose-built scene families</small></span></button>
    </div>
  </div>;
}

function StudioWorkspace({ project, activeScene, mode, version, onSelectScene, onSceneUpdate, onProjectCustomization, onProjectCreative, onRegenerate, onUndo, onRedo, onRenderScene, onNotify, onAddJob }: ProjectWorkspaceProps) {
  const [playing, setPlaying] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorProject, setEditorProject] = useState<EditorProject>(() => createEditorProjectFromAlystriaProject(project, { now: new Date().toISOString() }));
  const [inspectorTab, setInspectorTab] = useState("Content");
  const [zoom, setZoom] = useState(72);
  const [assetPreviews, setAssetPreviews] = useState<Record<string, string>>({});
  const assetPreviewsRef = useRef(assetPreviews);
  const projectRef = useRef(project);
  projectRef.current = project;
  const customization = canvasCustomization(project);
  const creative = project.creative ?? DEFAULT_CREATIVE_CONFIGURATION;
  useEffect(() => { setEditorProject(createEditorProjectFromAlystriaProject(projectRef.current, { now: new Date().toISOString() })); }, [project.id]);
  useEffect(() => { assetPreviewsRef.current = assetPreviews; }, [assetPreviews]);
  useEffect(() => () => Object.values(assetPreviewsRef.current).forEach((url) => URL.revokeObjectURL(url)), []);
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
  const queueCreativeJob = (operation: "visual_review" | "presenter_generate", title: string, detail: string) => {
    onAddJob({ id: `${operation}-${Date.now()}`, title, detail, status: "queued", progress: 0, eta: "Waiting for an approved model route", operation });
    onNotify(`${title} queued`, "This user-started proposal is visible in Jobs. It will not overwrite an accepted scene or portrait.", "info");
  };
  return <div className="studio-workspace">
    <div className="studio-toolbar"><div><span className="scene-crumb">Scene {String(activeScene.index).padStart(2, "0")}</span><strong>{activeScene.title}</strong><SceneStatus status={activeScene.status} /></div><div className="studio-toolbar-center"><button onClick={onUndo} aria-label="Undo durable revision"><Undo2 size={16} /></button><button onClick={onRedo} aria-label="Redo durable revision"><Redo2 size={16} /></button><span className="separator" /><button><Square size={14} /> Fit</button><label><input aria-label="Canvas zoom" type="range" min="45" max="110" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />{zoom}%</label></div><div><button className="secondary-button small" onClick={() => setEditorOpen(true)}><Film size={15} /> Advanced editor</button><button className="secondary-button small" onClick={() => onRegenerate(activeScene)}><WandSparkles size={15} /> New candidate</button><button className="primary-button small" onClick={() => onRenderScene(activeScene)}><Play size={14} /> Render scene</button></div></div>
    <div className="studio-layout">
      <aside className="scene-rail"><div className="scene-rail-head"><span>Scenes</span><button><Plus size={15} /></button></div><div className="scene-rail-list">{project.scenes.map((scene) => <button className={scene.id === activeScene.id ? "active" : ""} onClick={() => onSelectScene(scene.id)} key={scene.id}><span className="rail-index">{String(scene.index).padStart(2, "0")}</span><span className="rail-thumb"><SceneArtwork scene={scene} compact /></span><span className="rail-copy"><strong>{scene.title}</strong><small>{formatTime(scene.duration)} · {scene.kind.replace("-", " ")}</small></span><i className={`rail-state ${scene.status}`} /></button>)}</div></aside>
      <section className="canvas-stage"><div className="canvas-surround"><div className="canvas-rulers top" /><div className="canvas-rulers side" /><div className={`preview-canvas canvas-${customization.backgroundMode} treatment-${customization.sceneTreatment} density-${customization.density} contrast-${customization.contrast}`} style={{ ...canvasStyle, width: `${Math.min(92, zoom + 20)}%`, ...(selectedBackground ? { backgroundImage: `url(${selectedBackground})` } : {}) }} data-testid="customized-canvas"><SharedScenePreview scene={activeScene} project={project} fallback={<SceneArtwork scene={activeScene} />} />{customization.presenter.placement !== "off" && <div className={`presenter-preview placement-${customization.presenter.placement} side-${customization.presenter.side} frame-${customization.presenter.frame} crop-${customization.presenter.crop}`} style={{ width: `${Math.round(customization.presenter.scale * .42)}%` }} data-testid="presenter-preview">{selectedPresenter ? <img src={selectedPresenter} alt="Uploaded presenter preview" /> : <PresenterPortrait assetId={customization.presenter.assetId} />}</div>}<CaptionPreview settings={customization.captions} fontFamily={customization.bodyFont} /><div className="safe-area" style={{ inset: `${customization.captions.safeInset}%` }} aria-hidden="true" /><div className="frame-badge">VISUAL BIBLE · v{version} · FRAME 01842</div></div></div><div className="playback-bar"><button aria-label="Previous scene"><ArrowLeft size={17} /></button><button className="play-toggle" onClick={() => setPlaying((value) => !value)} aria-label={playing ? "Pause preview" : "Play preview"}>{playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}</button><button aria-label="Next scene"><ArrowRight size={17} /></button><span className="timecode">{playing ? "00:00:18:08" : "00:00:00:00"} <i>/</i> 00:01:34:00</span><div className="playback-progress"><i style={{ width: playing ? "24%" : "0%" }} /></div><button><Volume2 size={16} /></button><button>1×</button></div>
      </section>
      <aside className="inspector"><div className="inspector-tabs">{["Content", "Generate", "Design", "Motion"].map((tab) => <button className={inspectorTab === tab ? "active" : ""} onClick={() => setInspectorTab(tab)} key={tab}>{tab}</button>)}</div>
        {inspectorTab === "Content" ? <div className="inspector-body"><InspectorSection title="Scene identity"><label>Title<input value={activeScene.title} onChange={(event) => onSceneUpdate(activeScene.id, { title: event.target.value })} /></label><label>Scene family<select value={activeScene.kind} onChange={(event) => onSceneUpdate(activeScene.id, { kind: event.target.value as Scene["kind"] })}><option value="title">Title</option><option value="definition">Definition</option><option value="diagram">Diagram</option><option value="worked-example">Worked example</option><option value="comparison">Comparison</option><option value="code">Code trace</option><option value="recap">Recap</option></select></label></InspectorSection><InspectorSection title="Narration"><textarea rows={7} value={activeScene.narration} onChange={(event) => onSceneUpdate(activeScene.id, { narration: event.target.value })} /><div className="field-meta"><span>{activeScene.narration.split(" ").length} words</span><span>~{activeScene.duration}s</span></div><button className="secondary-button full"><Mic2 size={15} /> Voice & pronunciation</button></InspectorSection><InspectorSection title="Evidence"><button className="evidence-chip"><ShieldCheck size={15} /><span><strong>{activeScene.citations} supported claims</strong><small>View evidence spans</small></span><ChevronRight size={15} /></button></InspectorSection>{mode === "studio" && <InspectorSection title="Dependency impact"><p className="inspector-note">Editing narration invalidates alignment, captions, presenter timing, scene render, and final composition.</p></InspectorSection>}</div>
        : inspectorTab === "Generate" ? <CreativeInspector configuration={creative} onChange={onProjectCreative} onQueueVisualReview={() => queueCreativeJob("visual_review", `Visual review · scene ${activeScene.index}`, `${creative.slide.mode} slide · ${creative.slide.visualReviewModel}`)} onGeneratePresenter={() => queueCreativeJob("presenter_generate", "Presenter candidate", `${creative.presenter.style} · ${creative.presenter.baseModel}`)} />
        : inspectorTab === "Design" ? <DesignInspector project={project} customization={customization} onChange={onProjectCustomization} onNotify={onNotify} onPreviewAsset={(id, url) => setAssetPreviews((current) => ({ ...current, [id]: url }))} /> : <MotionInspector studioMode={mode === "studio"} />}
      </aside>
    </div>
    <div className="timeline-panel"><div className="timeline-tools"><button><PanelRightClose size={15} /> Timeline</button><span>00:00</span><span>00:20</span><span>00:40</span><span>01:00</span><span>01:20</span></div><div className="timeline-tracks"><div className="track-labels"><span><Eye size={14} /> Visual</span><span><AudioLines size={14} /> Narration</span><span><AlignLeft size={14} /> Captions</span></div><div className="track-content"><div className="timeline-cursor" style={{ left: playing ? "25%" : "2%" }} /><div className="visual-clip">Formula reveal <small>00:00–01:34</small></div><div className="audio-wave">{Array.from({ length: 90 }, (_, i) => <i key={i} style={{ height: `${8 + ((i * 13) % 24)}px` }} />)}</div><div className="caption-clips"><span style={{ width: "28%" }}>Multiply a plus b…</span><span style={{ width: "34%" }}>Subtract ac and bd…</span><span style={{ width: "29%" }}>Four products become three.</span></div></div></div><div className="version-stamp"><History size={14} /> v{version} saved</div></div>
    {editorOpen && <div className="integrated-editor-layer" role="dialog" aria-modal="true" aria-label="Integrated advanced video editor"><div className="integrated-editor-layer__bar"><div><span className="section-kicker">Non-destructive finishing room</span><strong>{project.title}</strong></div><span>Slides · presenter · titles · captions · narration · music · SFX</span><button className="secondary-button small" onClick={() => setEditorOpen(false)}><X size={15} /> Return to scene</button></div><AdvancedVideoEditor project={editorProject} onProjectChange={(next) => setEditorProject(next)} onExportProject={() => onNotify("Editor project ready", "The versioned editor document is ready for project-owned JSON export.", "success")} onExportOtio={() => onNotify("OTIO-like timeline ready", "The interchange document preserves timing, tracks and provenance; media remains in the project store.", "success")} onCreateProjectCopy={(copy) => { setEditorProject(copy); onNotify("Version copy created", `${copy.name} is an independent non-destructive edit.`, "success"); }} /></div>}
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
        {customization.assets.some((asset) => asset.kind === "font" && asset.source === "user-upload") && <><label>Uploaded display font<select value={customization.fonts.displayAssetId ?? ""} onChange={(event) => { const asset = customization.assets.find((item) => item.id === event.target.value); update({ fontPairId: asset ? "custom" : customization.fontPairId, displayFont: asset?.label ?? customization.displayFont, fonts: { ...customization.fonts, displayAssetId: asset?.id ?? null } }); }}><option value="">Use theme display font</option>{customization.assets.filter((asset) => asset.kind === "font" && asset.source === "user-upload").map((asset) => <option key={asset.id} value={asset.id}>{asset.label}</option>)}</select></label><label>Uploaded body font<select value={customization.fonts.bodyAssetId ?? ""} onChange={(event) => { const asset = customization.assets.find((item) => item.id === event.target.value); update({ fontPairId: asset ? "custom" : customization.fontPairId, bodyFont: asset?.label ?? customization.bodyFont, fonts: { ...customization.fonts, bodyAssetId: asset?.id ?? null } }); }}><option value="">Use theme body font</option>{customization.assets.filter((asset) => asset.kind === "font" && asset.source === "user-upload").map((asset) => <option key={asset.id} value={asset.id}>{asset.label}</option>)}</select></label></>}
        <div className="range-field"><label><span>Type scale</span><output>{customization.typeScale}%</output></label><input aria-label="Project type scale" type="range" min="85" max="125" value={customization.typeScale} onChange={(event) => update({ typeScale: Number(event.target.value) })} /></div>
        <label>Reading rhythm<select value={customization.lineHeight} onChange={(event) => update({ lineHeight: event.target.value as CanvasCustomization["lineHeight"] })}><option value="compact">Compact · data dense</option><option value="balanced">Balanced · general teaching</option><option value="airy">Airy · young learners</option></select></label>
        <AssetUpload label="Upload a font file" accept=".woff,.woff2,.ttf,.otf" onFile={(file) => { void acceptAsset(file, "font"); }} />
      </InspectorSection>
      <InspectorSection title="Color language">
        <div className="palette-list">{PALETTE_PRESETS.map((palette) => <button key={palette.id} className={customization.paletteId === palette.id ? "active" : ""} onClick={() => update({ paletteId: palette.id, colors: palette.colors })}><span>{Object.values(palette.colors).map((color) => <i key={color} style={{ background: color }} />)}</span><strong>{palette.name}</strong></button>)}</div>
        <div className="color-field-grid">{(["paper", "ink", "accent", "evidence"] as const).map((key) => <label key={key}><span>{key}</span><input aria-label={`${key} color`} type="color" value={customization.colors[key]} onChange={(event) => update({ paletteId: "custom", colors: { ...customization.colors, [key]: event.target.value } })} /></label>)}</div>
      </InspectorSection>
      <InspectorSection title="Canvas & material">
        <div className="choice-grid compact">{(["paper", "grid", "gradient", "image"] as const).map((mode) => <button key={mode} className={customization.backgroundMode === mode ? "active" : ""} onClick={() => update({ backgroundMode: mode })}><span className={`material-swatch ${mode}`} />{mode}</button>)}</div>
        <div className="starter-backgrounds" aria-label="Generated starter backgrounds">{Object.entries(STARTER_BACKGROUND_PREVIEWS).map(([id, src]) => { const asset = customization.assets.find((item) => item.id === id); return <button key={id} className={customization.backgroundAssetId === id ? "active" : ""} onClick={() => update({ backgroundMode: "image", backgroundAssetId: id })}><img src={src} alt="" /><span><strong>{asset?.label}</strong><small>Generated · MIT starter pack</small></span></button>; })}</div>
        {customization.assets.some((asset) => asset.kind === "background" && asset.source === "user-upload") && <label>Uploaded background<select value={customization.backgroundAssetId ?? ""} onChange={(event) => update({ backgroundMode: "image", backgroundAssetId: event.target.value || null })}><option value="">Choose an imported background</option>{customization.assets.filter((asset) => asset.kind === "background" && asset.source === "user-upload").map((asset) => <option key={asset.id} value={asset.id}>{asset.label}</option>)}</select></label>}
        <div className="range-field"><label><span>Material strength</span><output>{customization.materialStrength}%</output></label><input aria-label="Material strength" type="range" min="0" max="80" value={customization.materialStrength} onChange={(event) => update({ materialStrength: Number(event.target.value) })} /></div>
        <AssetUpload label="Upload a background" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" onFile={(file) => { void acceptAsset(file, "background"); }} />
      </InspectorSection>
      <InspectorSection title="Scene framing">
        <div className="segmented-control three">{(["edge-to-edge", "card", "editorial-frame"] as const).map((item) => <button key={item} className={customization.sceneTreatment === item ? "active" : ""} onClick={() => update({ sceneTreatment: item })}>{item.replace("-", " ")}</button>)}</div>
        <div className="compact-row"><label>Density<select value={customization.density} onChange={(event) => update({ density: event.target.value as CanvasCustomization["density"] })}><option value="compact">Compact</option><option value="balanced">Balanced</option><option value="spacious">Spacious</option></select></label><label>Contrast<select value={customization.contrast} onChange={(event) => update({ contrast: event.target.value as CanvasCustomization["contrast"] })}><option value="standard">Standard</option><option value="high">High</option></select></label></div>
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
        <div className="presenter-grid">{[...Object.keys(STARTER_PRESENTER_PREVIEWS), ...customization.assets.filter((asset) => asset.kind === "presenter" && asset.source === "user-upload").map((asset) => asset.id)].map((id) => { const asset = customization.assets.find((item) => item.id === id); const voiceMatch = presenterVoiceMatch(id, asset?.label); return <button key={id} aria-label={asset?.label ?? id} className={customization.presenter.assetId === id ? "active" : ""} onClick={() => updatePresenter({ assetId: id, placement: "picture-in-picture", ...voiceMatch })}><PresenterPortrait assetId={id} /><span><strong>{asset?.label}</strong><small>{STARTER_PRESENTER_PREVIEWS[id]?.idleReady ? "Front-facing · idle-ready" : "Presenter style"}</small></span></button>; })}</div>
        <div className="presenter-upload-identity"><span>Uploaded portrait identity</span><div className="rights-selector two"><button className={presenterIdentity === "synthetic" ? "active" : ""} onClick={() => setPresenterIdentity("synthetic")}>Fictional / generated</button><button className={presenterIdentity === "realPerson" ? "active" : ""} onClick={() => setPresenterIdentity("realPerson")}>Real person</button></div><label>Presenter name<input value={presenterName} onChange={(event) => setPresenterName(event.target.value)} /></label>{presenterIdentity === "synthetic" ? <label className="mini-toggle"><input type="checkbox" checked={syntheticAttested} onChange={(event) => setSyntheticAttested(event.target.checked)} /><span><strong>I attest this identity is fictional or generated</strong><small>Required before local lip-sync or presenter animation.</small></span></label> : <div className="consent-fields"><label>Person shown<input value={consentSubject} onChange={(event) => { setConsentSubject(event.target.value); if (consentAuthority === "selfConsent") setConsentAttestor(event.target.value); }} /></label><label>Consent authority<select value={consentAuthority} onChange={(event) => { const authority = event.target.value as typeof consentAuthority; setConsentAuthority(authority); if (authority === "selfConsent") setConsentAttestor(consentSubject); }}><option value="selfConsent">Self-consent</option><option value="parentOrGuardian">Parent or guardian</option><option value="authorizedRepresentative">Authorized representative</option></select></label><label>Authorized distribution<select value={presenterDistributionScope} onChange={(event) => setPresenterDistributionScope(event.target.value as typeof presenterDistributionScope)}><option value="privatePreview">Private preview only</option><option value="publicNonCommercial">Public, non-commercial</option><option value="publicCommercial">Public and commercial</option></select></label><label>Consent attested by<input value={consentAttestor} readOnly={consentAuthority === "selfConsent"} onChange={(event) => setConsentAttestor(event.target.value)} /></label><label className="mini-toggle"><input type="checkbox" checked={consentAccepted} onChange={(event) => setConsentAccepted(event.target.checked)} /><span><strong>Portrait animation and the selected distribution scope are authorized</strong><small>Synthetic-media disclosure stays required. Revocation remains attached to this profile.</small></span></label></div>}</div>
        <AssetUpload label="Upload your presenter picture" accept="image/png,image/jpeg,image/webp" onFile={(file) => { void acceptAsset(file, "presenter"); }} />
        <label>Presenter layout<select value={customization.presenter.placement} onChange={(event) => updatePresenter({ placement: event.target.value as CanvasCustomization["presenter"]["placement"] })}><option value="off">Off</option><option value="picture-in-picture">Picture in picture</option><option value="split">Split stage</option><option value="full-frame">Full frame</option></select></label>
        <div className="presenter-voice-match" role="note"><Mic2 size={16} /><span><strong>Voice matched to the presenter persona</strong><small>{customization.presenter.voiceDirection}{customization.presenter.preferredVoiceId ? " · curated ElevenLabs voice attached" : " · provider voice chosen at generation"}</small></span></div>
        <label className="mini-toggle"><input type="checkbox" checked={customization.presenter.idleAnimation} onChange={(event) => updatePresenter({ idleAnimation: event.target.checked, blink: event.target.checked, breathing: event.target.checked })} /><span><strong>Natural idle motion</strong><small>Generate quiet breathing and irregular blinks between spoken phrases.</small></span></label>
        <div className="compact-row"><label className="mini-toggle"><input type="checkbox" checked={customization.presenter.blink} disabled={!customization.presenter.idleAnimation} onChange={(event) => updatePresenter({ blink: event.target.checked })} /><span><strong>Blinking</strong><small>Seeded, non-looping cadence</small></span></label><label className="mini-toggle"><input type="checkbox" checked={customization.presenter.breathing} disabled={!customization.presenter.idleAnimation} onChange={(event) => updatePresenter({ breathing: event.target.checked })} /><span><strong>Breathing</strong><small>Subtle torso motion only</small></span></label></div>
        <p className="inspector-note"><strong>Rest-mouth guard:</strong> supplied idle portraits use closed lips. Speech animation owns mouth opening only while aligned narration is active.</p>
        <div className="compact-row"><label>Side<select value={customization.presenter.side} onChange={(event) => updatePresenter({ side: event.target.value as "left" | "right" })}><option value="left">Left</option><option value="right">Right</option></select></label><label>Crop<select value={customization.presenter.crop} onChange={(event) => updatePresenter({ crop: event.target.value as CanvasCustomization["presenter"]["crop"] })}><option value="portrait">Portrait safe</option><option value="contain">Contain</option><option value="cover">Fill</option></select></label></div>
        <div className="range-field"><label><span>Presenter scale</span><output>{customization.presenter.scale}%</output></label><input aria-label="Presenter scale" type="range" min="28" max="100" value={customization.presenter.scale} onChange={(event) => updatePresenter({ scale: Number(event.target.value) })} /></div>
      </InspectorSection>
      <InspectorSection title="Music & sound cues">
        <label>Music bed<select value={customization.audio.musicAssetId ?? "music-none"} onChange={(event) => updateAudio({ musicAssetId: event.target.value === "music-none" ? null : event.target.value })}><option value="music-none">No music · recommended</option><option value="starter.audio.music.focus-loop">Focus loop · starter pack</option><option value="starter.audio.music.inquiry-loop">Inquiry loop · starter pack</option>{customization.assets.filter((asset) => asset.kind === "music" && asset.source === "user-upload").map((asset) => <option value={asset.id} key={asset.id}>{asset.label} · uploaded</option>)}</select></label>
        <AssetUpload label="Upload music" accept="audio/wav,audio/mpeg,audio/flac,audio/ogg,audio/opus,.wav,.mp3,.flac,.ogg,.opus" onFile={(file) => { void acceptAsset(file, "music"); }} />
        <label>Sound cue<select value={customization.audio.sfxAssetId ?? "sfx-none"} onChange={(event) => updateAudio({ sfxAssetId: event.target.value === "sfx-none" ? null : event.target.value })}><option value="sfx-none">No sound cues · recommended</option><option value="starter.audio.sfx.emphasis-a">Quiet teaching cue</option><option value="starter.audio.sfx.emphasis-b">Technical emphasis</option>{customization.assets.filter((asset) => asset.kind === "sfx" && asset.source === "user-upload").map((asset) => <option value={asset.id} key={asset.id}>{asset.label} · uploaded</option>)}</select></label>
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
  const selected = assets.filter((asset) => asset.source === "user-upload");
  return <InspectorSection title="Project asset ledger">{selected.length ? <div className="asset-ledger">{selected.map((asset) => <div key={asset.id}><span className={`asset-state ${asset.rightsStatus}`}><FileCheck2 size={14} /></span><span><strong>{asset.label}</strong><small>{asset.kind} · {asset.license}{asset.byteSize ? ` · ${formatBytes(asset.byteSize)}` : ""}</small><code>{asset.sha256?.slice(0, 12)}…</code></span></div>)}</div> : <p className="inspector-note">No custom files yet. Starter-pack assets are already cleared and attributed.</p>}</InspectorSection>;
}

function PresenterPortrait({ assetId }: { assetId: string | null }) {
  const starter = assetId ? STARTER_PRESENTER_PREVIEWS[assetId] : undefined;
  if (starter) return <span className="presenter-portrait generated-portrait" aria-hidden="true"><img src={starter.src} alt="" style={{ objectPosition: starter.focalPoint }} /></span>;
  return <span className="presenter-portrait portrait-mentor" aria-hidden="true"><i className="portrait-halo" /><i className="portrait-head" /><i className="portrait-hair" /><i className="portrait-neck" /><i className="portrait-shirt" /></span>;
}

function CaptionPreview({ settings, fontFamily }: { settings: CanvasCustomization["captions"]; fontFamily: string }) {
  return <div className={`caption-preview position-${settings.position} style-${settings.style}`} style={{ color: settings.textColor, backgroundColor: settings.style === "outline" ? "transparent" : `${settings.panelColor}e8`, fontFamily: `"${fontFamily}", sans-serif`, fontSize: `${Math.round(12 * settings.size / 100)}px`, maxWidth: `calc(100% - ${settings.safeInset * 2}%)` }} data-testid="caption-preview"><span>Four products become <em>three</em>.</span><small>Open-caption preview · {settings.maxLines} line{settings.maxLines === 1 ? "" : "s"} max</small></div>;
}

function MotionInspector({ studioMode }: { studioMode: boolean }) { return <div className="inspector-body"><InspectorSection title="Choreography"><div className="motion-row"><span><small>Entrance</small><strong>Thread draw</strong></span><span>0.8s</span></div><div className="motion-row"><span><small>Emphasis</small><strong>Term isolate</strong></span><span>2 beats</span></div><div className="motion-row"><span><small>Exit</small><strong>Carry forward</strong></span><span>0.5s</span></div></InspectorSection>{studioMode ? <InspectorSection title="Frame controls"><label>Start tick<input value="240000" readOnly /></label><label>Duration ticks<input value="22560000" readOnly /></label><label>Seed<input value="alya-scene-004" readOnly /></label></InspectorSection> : <div className="guided-callout"><Sparkles size={18} /><strong>Timing is guided by narration.</strong><p>Switch to Studio mode for exact ticks, easing curves, and responsive overrides.</p></div>}</div>; }

function ReviewWorkspace({ project, jobs, environment, onWorkspace, onScene, onRepairQa }: ProjectWorkspaceProps) {
  const [mediaError, setMediaError] = useState<string | null>(null);
  const media = authoritativeReviewMedia(project, jobs, environment);
  const checks = [
    { title: "Claim support", result: "18 / 18 supported", tone: "pass", icon: ShieldCheck },
    { title: "Caption safety", result: "8 / 8 scenes pass", tone: "pass", icon: AlignLeft },
    { title: "Narration timing", result: "1 scene needs review", tone: "warn", icon: AudioLines },
    { title: "Visual contrast", result: "AA across all targets", tone: "pass", icon: Eye },
    { title: "Asset rights", result: "1 link-only source", tone: "warn", icon: FileCheck2 },
    { title: "Frame continuity", result: "No blank frames", tone: "pass", icon: Film },
  ];
  const reviewReady = Boolean(media && !mediaError);
  const ReviewBoundaryIcon = mediaError ? CircleAlert : Film;
  const reviewBoundaryTitle = mediaError ? "Generated media could not be loaded" : "No authoritative media yet";
  const reviewBoundaryDetail = mediaError ?? (environment === "native" ? "Render a scene or complete a master export. Review only plays a promoted native artifact." : "The browser UI contract does not create video. Packaged-native acceptance must supply a promoted scene or master render.");
  return <div className="page project-page review-workspace"><ProjectHeader project={project} step="4 · Review" title="Review the whole argument" description="Play the latest promoted render, inspect the evidence behind it, and resolve the checks that can block export." action={<div className="header-action-group"><button className="secondary-button" onClick={() => onWorkspace("studio")}>Back to studio</button><button className="primary-button" disabled={!reviewReady} onClick={() => onWorkspace("export")}>Prepare export <ArrowRight size={16} /></button></div>} />
    <div className="review-layout"><section className="review-player">{reviewReady ? <><div className="review-canvas"><video aria-label="Authoritative generated tutorial media" controls preload="metadata" src={media!.src} onError={() => setMediaError("The promoted media could not be loaded. Re-render it before export.")} style={{ width: "100%", height: "100%", objectFit: "contain", background: "#090b11" }} /></div><div className="review-controls" role="status"><FileCheck2 size={16} /><span style={{ flex: 1 }}>{media!.label}</span><span>{media!.mediaType}</span></div></> : <div className="review-canvas"><div className="empty-state"><span><ReviewBoundaryIcon size={25} /></span><h3 style={{ color: "#f7f8fc" }}>{reviewBoundaryTitle}</h3><p>{reviewBoundaryDetail}</p><button className="secondary-button" onClick={() => onWorkspace("studio")}>Return to Studio</button></div></div>}<div className="review-scene-strip">{project.scenes.map((scene) => <button key={scene.id} onClick={() => onScene(scene)}><span>{scene.index}</span><SceneArtwork scene={scene} compact /></button>)}</div></section>
      <aside className="review-inspector"><div className="review-score"><div className="score-ring"><strong>91</strong><span>quality</span></div><div><span className="section-kicker">Review summary</span><h3>Nearly ready to export</h3><p>Resolve two review items. All blocking factual checks pass.</p></div></div><div className="check-list">{checks.map(({ title, result, tone, icon: Icon }) => <button key={title}><span className={`check-icon ${tone}`}><Icon size={17} /></span><span><strong>{title}</strong><small>{result}</small></span><ChevronRight size={16} /></button>)}</div><button className="secondary-button full" onClick={onRepairQa}><WandSparkles size={16} /> Repair selected review item</button></aside>
    </div>
    <section className="claims-panel"><div className="panel-heading"><div><span className="section-kicker">Evidence at this moment</span><h3>Three-product identity</h3></div><span className="source-state verified"><CheckCircle2 size={14} /> Supported</span></div><div className="claim-grid"><article><span>Claim 12</span><p>Subtracting <code>ac</code> and <code>bd</code> from <code>(a+b)(c+d)</code> yields <code>ad+bc</code>.</p><small><Link2 size={13} /> 3 exact source spans</small></article><blockquote>“The middle coefficient can be computed using one additional multiplication…”<cite>Karatsuba & Ofman · 1962 · translated abstract</cite></blockquote><div className="annotation-box"><MessageSquareText size={16} /><textarea aria-label="Review annotation" placeholder="Leave a local review note…" /><button>Save note</button></div></div></section>
  </div>;
}

function ExportWorkspace({ project, onWorkspace, onNotify, onExportArchive, onExportMaster }: ProjectWorkspaceProps) {
  const [aspect, setAspect] = useState("16:9");
  const [quality, setQuality] = useState("1440p");
  const [fps, setFps] = useState<MasterExportRequest["fps"]>(30);
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
    <div className="export-layout"><section className="export-preview-panel"><div className="export-preview"><SceneArtwork scene={project.scenes[0]!} /><span className={`export-caption-status ${openCaptions ? "open" : "clean"}`}>{openCaptions ? "Open captions in picture" : "Clean picture · no caption pixels"}</span><span className="export-resolution">2560 × 1440</span></div><div className="export-summary"><span><Film size={17} /><b>{project.duration}:00</b><small>estimated duration</small></span><span><HardDrive size={17} /><b>~1.8 GB</b><small>estimated master</small></span><span><TimerReset size={17} /><b>8–14 min</b><small>silent profile estimate</small></span></div><div className="export-ready"><PackageCheck size={21} /><div><strong>Ready to render</strong><p>All blocking export gates pass. Caption timing and sidecar files will be validated with the master.</p></div></div></section>
      <section className="export-settings"><div className="settings-section"><span className="section-kicker">Frame</span><h3>Format and resolution</h3><label>Aspect ratio<div className="format-options">{([['16:9', 'Landscape'], ['9:16', 'Portrait'], ['1:1', 'Square']] as const).map(([ratio, label]) => <button key={ratio} className={aspect === ratio ? "active" : ""} onClick={() => setAspect(ratio)}><i className={`aspect-shape ratio-${ratio.replace(":", "-")}`} /><span><strong>{ratio}</strong><small>{label}</small></span></button>)}</div></label><label>Resolution<select value={quality} onChange={(event) => setQuality(event.target.value)}><option>1080p</option><option>1440p</option><option>4K</option></select></label><div className="setting-row"><label>Frame rate<select aria-label="Frame rate" value={fps} onChange={(event) => setFps(Number(event.target.value) as MasterExportRequest["fps"])}><option value="30">30 fps</option><option value="60">60 fps</option><option value="24">24 fps</option></select></label><label>Codec preference<select aria-label="Codec preference" value={codecPreference} onChange={(event) => setCodecPreference(event.target.value as CodecPreference)}><option value="h264-hardware">H.264 hardware</option><option value="hevc-hardware">HEVC hardware</option><option value="av1">AV1</option></select></label></div><p className="settings-intro" role="note"><strong>Encoder boundary:</strong> frame rate is sent to the native export command. Codec preference is recorded with this request, but the current command contract does not yet select an encoder.</p></div>
        <div className="settings-section caption-delivery-section"><span className="section-kicker">Captions</span><h3>Choose how viewers receive captions</h3><p className="settings-intro">Every option includes named UTF-8 <strong>.srt</strong> and <strong>.vtt</strong> files. The recommended clean master is ready for YouTube upload without text baked into the picture.</p><div className="caption-delivery-options" role="radiogroup" aria-label="Caption delivery"><>{CAPTION_DELIVERY_OPTIONS.map(({ id, label, eyebrow, detail, icon: Icon }, index) => <button type="button" role="radio" aria-checked={captionDeliveryMode === id} tabIndex={captionDeliveryMode === id ? 0 : -1} key={id} className={captionDeliveryMode === id ? "active" : ""} onClick={() => setCaptionDeliveryMode(id)} onKeyDown={(event) => moveCaptionDelivery(event, index)}><span className="caption-delivery-icon"><Icon size={17} /></span><span><small>{eyebrow}</small><strong>{label}</strong><em>{detail}</em></span>{captionDeliveryMode === id && <CheckCircle2 size={16} />}</button>)}</></div><div className="caption-file-receipt"><FileCheck2 size={17} /><span><strong>Caption files included</strong><small>{project.title}.{captionLocale}.srt · {project.title}.{captionLocale}.vtt</small></span></div>{openCaptions ? <div className="burned-caption-warning" role="note"><TextCursorInput size={17} /><span><strong>Open captions will become picture pixels.</strong><small>Font, color, size, and placement come from the Studio caption style. They cannot be hidden after export.</small></span><button type="button" onClick={() => onWorkspace("studio")}>Edit open-caption style</button></div> : <p className="caption-player-note"><MonitorPlay size={15} /><span><strong>Appearance stays with the viewer.</strong> Sidecar and selectable captions use YouTube or the video player's font, color, size, and position controls.</span></p>}</div>
        <div className="settings-section"><span className="section-kicker">Accessibility & evidence</span><h3>Export companions</h3><ToggleRow checked={transcript} onChange={setTranscript} title="Accessible transcript" detail="Scene headings and descriptions" /><ToggleRow checked={bibliography} onChange={setBibliography} title="Sources & bibliography" detail="Human-readable + JSON manifest" /><ToggleRow checked={true} onChange={() => {}} title="Provenance manifest" detail="Required · cannot be disabled" locked /></div>
        <div className="export-cost"><ShieldCheck size={18} /><div><strong>Local export · no provider cost</strong><small>Project content stays on this device.</small></div></div><button className="secondary-button full" onClick={() => { void archiveProject(); }} disabled={archiving}>{archiving ? <RefreshCw className="spin" size={17} /> : <Archive size={17} />}{archiving ? "Archiving project…" : "Export portable .alytutorial"}</button>{project.nativeArchivePath && <small className="archive-path"><CheckCircle2 size={13} /> Last archive: {project.nativeArchivePath}</small>}<button className="export-button" onClick={() => { void exportProject(); }} disabled={exporting}>{exporting ? <RefreshCw className="spin" size={18} /> : <Download size={18} />}{exporting ? "Submitting render…" : `Render ${quality} master`}<span>{aspect} · {fps} fps · {codecPreferenceLabel(codecPreference)}</span></button>
      </section></div>
  </div>;
}

function ToggleRow({ checked, onChange, title, detail, locked }: { checked: boolean; onChange: (checked: boolean) => void; title: string; detail: string; locked?: boolean }) { return <button className="toggle-row" onClick={() => !locked && onChange(!checked)} aria-pressed={checked}><span className={`switch ${checked ? "on" : ""}`}><i /></span><span><strong>{title}</strong><small>{detail}</small></span>{locked && <Lock size={14} />}</button>; }

function SourceImportControl({ label, onImport, onNotify, secondary = false, small = false }: { label: string; onImport: (files: File[]) => Promise<SourceImportReceipt[]>; onNotify: (title: string, detail: string, tone?: ToastMessage["tone"]) => void; secondary?: boolean; small?: boolean }) {
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
  return <span className="source-import-control"><input ref={inputRef} aria-label={`${label} files`} className="visually-hidden-file" type="file" multiple accept={SOURCE_FILE_ACCEPT} onChange={(event) => { void choose(Array.from(event.target.files ?? [])); }} /><button className={`${secondary ? "secondary-button" : "primary-button"}${small ? " small" : ""}`} onClick={() => inputRef.current?.click()} disabled={status === "importing"}>{status === "importing" ? <RefreshCw className="spin" size={16} /> : <Upload size={16} />}{status === "importing" ? " Importing…" : ` ${label}`}</button></span>;
}

function SceneArtwork({ scene, compact = false }: { scene: Scene; compact?: boolean }) {
  return <div className={`scene-art scene-art-${scene.visual} ${compact ? "compact" : ""}`} aria-hidden="true">
    <div className="art-grid" /><div className="art-code">ALY / {String(scene.index).padStart(2, "0")}</div>
    {scene.visual === "thread" && <><div className="art-kicker">THE FASTER WAY TO MULTIPLY</div><div className="art-headline">One product<br /><em>disappears.</em></div><div className="art-thread"><i /><i /><i /><i /></div><div className="art-footnote">Karatsuba · divide and conquer</div></>}
    {scene.visual === "split" && <><div className="art-kicker">SPLIT THE PROBLEM</div><div className="number-split"><span>12<small>a</small></span><i>·100 +</i><span>34<small>b</small></span><b>×</b><span>56<small>c</small></span><i>·100 +</i><span>78<small>d</small></span></div><div className="split-brace left" /><div className="split-brace right" /><div className="art-caption">high half <b>→</b> low half</div></>}
    {scene.visual === "formula" && <><div className="art-kicker">THE THREE-PRODUCT INSIGHT</div><div className="formula-stack"><span><small>z₂</small> ac</span><span className="formula-middle"><small>z₁</small> (a+b)(c+d) − ac − bd</span><span><small>z₀</small> bd</span></div><div className="formula-result"><i />3 multiplications, exactly</div></>}
    {scene.visual === "whiteboard" && <><div className="art-kicker">DRAW WITH THE EXPLANATION</div><div className="whiteboard-preview"><svg viewBox="0 0 640 300"><path d="M58 74 C128 68 184 72 234 74" /><path d="M235 78 C310 108 346 158 406 194" /><path d="M235 78 C304 54 352 42 414 44" /><path className="accent" d="M62 240 C188 246 366 232 562 240" /></svg><span className="board-label input">1234</span><span className="board-label high">12 × 100</span><span className="board-label low">+ 34</span><i className="pencil-cursor" /></div><div className="trace-pill">narration-timed strokes</div></>}
    {scene.visual === "code" && <><div className="art-kicker">TRACE THE RECURSION</div><div className="code-window"><div><i /><i /><i /></div><pre><span>function</span> karatsuba(x, y) {'{'}{"\n"}  <b>if</b> (small) <em>return</em> x * y;{"\n"}  z2 = karatsuba(a, c);{"\n"}  z0 = karatsuba(b, d);{"\n"}  z1 = karatsuba(a+b, c+d);{"\n"}{'}'}</pre></div><div className="trace-pill">call depth · 03</div></>}
    {scene.visual === "live-code" && <><div className="art-kicker">CODE AS THE PRESENTER SPEAKS</div><div className="code-window live-code-window"><div><i /><i /><i /></div><pre><span>def</span> karatsuba(x, y):{"\n"}  <b>if</b> x &lt; 10 or y &lt; 10:{"\n"}    <em>return</em> x * y<span className="typing-cursor">▌</span>{"\n"}  high, low = split(x)</pre></div><div className="trace-pill">type · explain · run · verify</div></>}
    {scene.visual === "summary" && <><div className="art-kicker">THE THREAD, COMPLETE</div><div className="summary-flow"><span>split</span><i /><span>three products</span><i /><span>recover middle</span><i /><span>combine</span></div><div className="summary-equation">T(n) = 3T(n/2) + O(n)</div></>}
  </div>;
}

function ConceptDiagram() { return <svg className="concept-diagram" viewBox="0 0 320 180" role="img" aria-label="A concept map connecting split, expand, reuse, and compare"><path d="M24 92 C68 24,112 30,146 78 S218 156,296 84" /><path d="M54 130 C110 154,176 36,266 42" className="secondary-path" /><g transform="translate(28,82)"><circle r="15" /><text x="24" y="5">split</text></g><g transform="translate(113,51)"><circle r="11" /><text x="18" y="5">expand</text></g><g transform="translate(190,116)"><circle r="13" /><text x="20" y="5">reuse</text></g><g transform="translate(286,84)"><circle r="16" /><text x="-64" y="-24">compare</text></g></svg>; }

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
  const effectiveClassification = sourceFiles.length ? "project" : dataClassification;
  const routingReview = selectedProfile ? buildProviderRoutingReview({
    profile: selectedProfile,
    secretRefs,
    dataClassification: effectiveClassification,
    hardLimitMinorUnits: Math.max(0, Number.parseInt(hardLimitMinorUnits, 10) || 0),
    approvalChecked: routingApproval,
    hasPrivateSources: sourceFiles.length > 0,
    groundingMode: grounding.toLowerCase() as GroundingMode,
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
          <div className="routing-review-controls"><label><span>Creation profile</span><select aria-label="Creation profile" value={selectedProfile?.id ?? ""} disabled={routingLoading || !setup} onChange={(event) => { setSelectedProfileId(event.target.value); setRoutingApproval(false); setRoutingReviewedAt(null); }}>{setup?.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label><label><span>Content class</span><select aria-label="Content class" value={effectiveClassification} disabled={sourceFiles.length > 0} onChange={(event) => { setDataClassification(event.target.value as "public" | "project"); setRoutingApproval(false); setRoutingReviewedAt(null); }}><option value="project">Project content</option><option value="public">Public / synthetic</option></select></label><label><span>Hard budget</span><span className="currency-input"><b>$</b><input aria-label="Hard budget in cents" type="number" min="0" max="100000" value={hardLimitMinorUnits} onChange={(event) => { setHardLimitMinorUnits(event.target.value); setRoutingApproval(false); setRoutingReviewedAt(null); }} /><em>cents</em></span></label></div>
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
  return <div className="sheet-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><aside className="regen-sheet" role="dialog" aria-modal="true" aria-labelledby="regen-title"><header><div><span className="section-kicker">Scoped regeneration</span><h2 id="regen-title">Create a new candidate</h2></div><button className="icon-button" onClick={onClose}><X size={18} /></button></header><div className="regen-scene"><span>{String(scene.index).padStart(2, "0")}</span><div><strong>{scene.title}</strong><small>{scene.kind.replace("-", " ")} · {scene.duration}s</small></div></div><label className="instruction-field"><span>What should change?</span><textarea autoFocus rows={5} value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="Make the transition from four products to three feel inevitable. Keep the exact algebra and citations." /></label><div className="quick-instructions"><button onClick={() => setInstruction("Make the explanation more concrete without adding length.")}>More concrete</button><button onClick={() => setInstruction("Reduce narration by 20% while preserving every factual claim.")}>Tighter</button><button onClick={() => setInstruction("Try a more visual treatment using the concept thread.")}>More visual</button></div><section className="preservation-section"><span className="section-kicker">Preservation locks</span><ToggleRow checked={preserve} onChange={setPreserve} title="Keep narration and citations" detail="Regenerate only the visual treatment" /><ToggleRow checked={true} onChange={() => {}} title="Keep learning objective" detail={scene.objective} locked /><label>Alternatives<select value={alternatives} onChange={(event) => setAlternatives(Number(event.target.value))}><option value={1}>1 candidate</option><option value={2}>2 candidates</option><option value={3}>3 candidates</option><option value={4}>4 candidates</option></select></label></section><section className="impact-preview"><div><Network size={17} /><span><strong>Dependency impact</strong><small>Visual layout, scene render, visual QA, and final composition</small></span></div><div><CircleDollarSign size={17} /><span><strong>Estimated cost</strong><small>$0.03–$0.08 · one image call at most</small></span></div><div><History size={17} /><span><strong>Accepted version is safe</strong><small>This creates a candidate. Nothing is overwritten.</small></span></div></section><footer><button className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={!instruction.trim()} onClick={() => onRun(instruction, preserve, alternatives)}><WandSparkles size={16} /> Generate candidate</button></footer></aside></div>;
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
  const ready = runtime.bootstrap?.worker.state === "ready";
  const boundary = runtime.environment === "native" ? "Packaged native runtime" : "Browser adapter only; no native artifact";
  return <span className={`runtime-badge ${ready ? "ready" : "attention"}`} title={runtime.error ? `${boundary}: ${runtime.error}` : `${boundary}: ${workerLabel(runtime.bootstrap?.worker)}`}><span className="runtime-dot" />{runtime.environment === "native" ? "Native" : "UI contract"}<i />{runtime.loading ? "Connecting" : ready ? "Worker ready" : workerLabel(runtime.bootstrap?.worker)}</span>;
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

function authoritativeReviewMedia(project: ProjectRecord, jobs: readonly JobRecord[], environment: RuntimeState["environment"]): { src: string; label: string; mediaType: string } | null {
  const candidate = jobs.find((job) => {
    const path = job.result?.path;
    const mediaType = job.result?.mediaType;
    return job.projectId === project.nativeProjectId
      && job.status === "complete"
      && (job.operation === "export_master" || job.operation === "render_scene")
      && typeof path === "string"
      && path.length > 0
      && (typeof mediaType !== "string" || mediaType.startsWith("video/"));
  });
  const path = candidate?.result?.path;
  if (!candidate || typeof path !== "string") return null;
  const direct = /^(blob:|data:|https?:)/u.test(path);
  return {
    src: environment === "native" && !direct ? convertFileSrc(path) : path,
    label: candidate.operation === "export_master" ? "Promoted master export" : "Promoted scene render",
    mediaType: typeof candidate.result?.mediaType === "string" ? candidate.result.mediaType : "video",
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
