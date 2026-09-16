import type { BoundingBox, EntityId, IsoDate, IsoDateTime, Locale, Sha256, TickRange } from "./common.js";

export interface RightsGrant {
  status: "cleared" | "conditional" | "unknown" | "restricted" | "expired" | "revoked";
  usage: ("preview" | "edit" | "render" | "commercial" | "redistribution" | "model-input" | "voice-clone" | "presenter")[];
  licenseExpression?: string; territories: string[]; validFrom?: IsoDate; validUntil?: IsoDate; attributionRequired: boolean;
  attributionText?: string; restrictions?: string[]; proofArtifactIds?: EntityId[];
}

export interface ConsentRecord {
  id: EntityId; subject: string; subjectContactHash?: Sha256;
  scope: ("voice-cloning" | "lip-sync" | "portrait-animation" | "likeness-generation" | "training" | "distribution")[];
  status: "active" | "expired" | "revoked"; recordedAt: IsoDateTime; expiresAt?: IsoDateTime; revokedAt?: IsoDateTime;
  proofArtifactId: EntityId; syntheticDisclosureRequired: boolean;
}

export interface AssetProvenance {
  id: EntityId; assetId: EntityId; origin: "user-import" | "generated" | "licensed-media" | "public-domain" | "derived" | "screen-capture" | "recording" | "bundled";
  contentHash: Sha256; creator?: string; sourceUri?: string; providerId?: EntityId; modelId?: EntityId; modelRevision?: string;
  promptArtifactId?: EntityId; ingredientAssetIds?: EntityId[]; createdAt: IsoDateTime; rights: RightsGrant; consentRecordIds?: EntityId[];
  c2paStatus: "signed" | "verified" | "absent" | "invalid" | "unsupported"; c2paManifestArtifactId?: EntityId;
}

export interface SpeechDelivery {
  pace: number; pitchSemitones: number; energy: number;
  style: "neutral" | "warm" | "conversational" | "authoritative" | "enthusiastic" | "empathetic" | "dramatic" | "instructional";
  emotion?: string;
}

export interface PronunciationReference {
  id: EntityId; grapheme: string; locale: Locale; method: "ipa" | "alias" | "phoneme" | "provider-lexicon"; value: string; providerId?: EntityId;
}

export interface NarrationSpan {
  start: number; end: number; kind: "emphasis" | "strong-emphasis" | "pause-before" | "pause-after" | "pronunciation" | "aside"; value?: string; referenceId?: EntityId;
}

export interface NarrationSpec {
  text: string; locale: Locale; speakerId: EntityId; delivery: SpeechDelivery; spans: NarrationSpan[]; contextBefore?: string; contextAfter?: string;
  pronunciationIds?: EntityId[]; audioArtifactId?: EntityId; alignmentArtifactId?: EntityId;
}

export interface CaptionCue {
  id: EntityId; startTick: number; endTick: number; text: string; speakerId: EntityId; position: "auto" | "top" | "bottom" | "custom"; box?: BoundingBox;
  kind: "dialogue" | "sound" | "music" | "speaker" | "description"; confidence?: number;
}

export interface CaptionTrack {
  id: EntityId; locale: Locale; kind: "standard" | "sdh" | "translation" | "description"; cues: CaptionCue[]; artifactId?: EntityId; burnIn?: boolean;
}

export interface AudioMixSpec {
  sampleRate: 44100 | 48000 | 96000; channels: 1 | 2 | 6; targetLufs: number; maxTruePeakDbtp: number; musicEnabled: boolean; effectsEnabled: boolean;
  musicArtifactId?: EntityId; duckingDb?: number; audioDescriptionArtifactId?: EntityId;
}

export interface PresenterSpec {
  mode: "none" | "auto" | "avatar" | "real-person" | "illustrated"; profileId?: EntityId;
  speakerId?: EntityId; voiceId?: string;
  usage: "none" | "hook" | "transition" | "misconception" | "recap" | "full-scene"; direction: string; gestureCues?: TickRange[];
  consentRecordId?: EntityId; disclosure: "not-required" | "visible-label" | "credits" | "visible-and-credits"; clipArtifactId?: EntityId;
}

export interface TimingPolicy {
  mode: "narration-led" | "visual-led" | "fixed" | "interactive"; minimumTicks: number; maximumTicks: number; preferredTicks?: number;
  overflow: "extend" | "split" | "compress-pauses" | "block";
}

export interface AccessibilitySpec {
  description: string; essentialVisuals: string[]; readingOrder: EntityId[];
  reducedMotionAlternative: "none-needed" | "crossfade" | "step" | "static" | "custom"; colorIndependent: boolean; audioDescription?: string;
}
