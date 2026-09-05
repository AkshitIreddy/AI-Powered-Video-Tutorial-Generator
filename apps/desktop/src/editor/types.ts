export const EDITOR_PROJECT_SCHEMA = "alystria.editor.project.v1" as const;
export const EDITOR_STATE_SCHEMA = "alystria.editor.state.v1" as const;

export type TrackKind = "slides" | "presenter" | "titles" | "captions" | "narration" | "music" | "sfx";
export type MediaKind = "image" | "video" | "audio" | "caption" | "title" | "document" | "unknown";
export type ImportStatus = "pending" | "ready" | "failed" | "cancelled";
export type TransportStatus = "stopped" | "playing" | "paused";
export type KeyframeInterpolation = "hold" | "linear" | "ease-in" | "ease-out" | "ease-in-out";
export type CanvasGuide = "safe-action" | "safe-title" | "thirds" | "center";
export type InspectorProperty =
  | "transform.x"
  | "transform.y"
  | "transform.scaleX"
  | "transform.scaleY"
  | "transform.rotation"
  | "opacity"
  | "audio.volumeDb"
  | "audio.pan";

export interface FrameRate {
  numerator: number;
  denominator: number;
  dropFrame?: boolean;
}

export interface FrameRange {
  startFrame: number;
  durationFrames: number;
}

export interface ClipTransform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  anchorX: number;
  anchorY: number;
}

export interface ClipAudio {
  volumeDb: number;
  pan: number;
  muted: boolean;
  fadeInFrames: number;
  fadeOutFrames: number;
}

export interface TextStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  color: string;
  backgroundColor: string | null;
  align: "left" | "center" | "right";
  position: "top" | "center" | "bottom" | "custom";
}

export interface EditorKeyframe {
  id: string;
  property: InspectorProperty;
  frame: number;
  value: number;
  interpolation: KeyframeInterpolation;
}

export interface MediaProvenance {
  origin: "user-import" | "local-generation" | "cloud-generation" | "project-derived" | "unknown";
  createdAt: string;
  sourceId?: string;
  providerId?: string;
  modelId?: string;
  modelRevision?: string;
  generationRequestId?: string;
  policyDecisionId?: string;
  humanApproved?: boolean;
}

export interface ImportReceipt {
  id: string;
  assetId: string;
  fileName: string;
  status: ImportStatus;
  requestedAt: string;
  completedAt?: string;
  byteLength?: number;
  mimeType?: string;
  errorCode?: string;
  errorMessage?: string;
  localOnly: boolean;
}

export interface EditorImportBatch {
  receipts: ImportReceipt[];
  assets: EditorMediaAsset[];
}

export interface EditorMediaAsset {
  id: string;
  name: string;
  kind: MediaKind;
  status: ImportStatus;
  durationFrames: number | null;
  width?: number;
  height?: number;
  sampleRate?: number;
  channels?: number;
  uri?: string;
  previewUrl?: string;
  thumbnailUrl?: string;
  mimeType?: string;
  hash?: string;
  importReceiptId?: string;
  provenance: MediaProvenance;
  metadata: Record<string, string | number | boolean | null>;
}

export interface EditorClip {
  id: string;
  trackId: string;
  name: string;
  kind: TrackKind;
  assetId: string | null;
  timelineRange: FrameRange;
  sourceRange: FrameRange;
  enabled: boolean;
  locked: boolean;
  linkedGroupId?: string;
  color?: string;
  text?: string;
  speaker?: string;
  transcriptConfidence?: number;
  transform: ClipTransform;
  opacity: number;
  /** Source playback multiplier. Omitted legacy documents are interpreted as 1. */
  playbackRate?: number;
  audio: ClipAudio;
  textStyle?: TextStyle;
  keyframes: EditorKeyframe[];
  metadata: Record<string, string | number | boolean | null>;
}

export interface EditorTrack {
  id: string;
  name: string;
  kind: TrackKind;
  index: number;
  locked: boolean;
  muted: boolean;
  solo: boolean;
  hidden: boolean;
  clips: EditorClip[];
}

export interface TimelineMarker {
  id: string;
  frame: number;
  label: string;
  color?: string;
  kind: "chapter" | "comment" | "beat" | "export-range";
}

export interface EditorCanvasSettings {
  width: number;
  height: number;
  pixelAspectRatio: number;
  backgroundColor: string;
}

export interface EditorProject {
  schema: typeof EDITOR_PROJECT_SCHEMA;
  id: string;
  name: string;
  frameRate: FrameRate;
  canvas: EditorCanvasSettings;
  durationFrames: number;
  tracks: EditorTrack[];
  assets: EditorMediaAsset[];
  importReceipts: ImportReceipt[];
  markers: TimelineMarker[];
  metadata: Record<string, string | number | boolean | null>;
  createdAt: string;
  updatedAt: string;
}

export interface EditorSelection {
  clipIds: string[];
  trackId: string | null;
  assetId: string | null;
}

export interface EditorTransport {
  status: TransportStatus;
  playheadFrame: number;
  inFrame: number | null;
  outFrame: number | null;
  playbackRate: number;
  loop: boolean;
}

export interface EditorViewState {
  pixelsPerSecond: number;
  horizontalScrollFrame: number;
  activePanel: "media" | "transcript" | "proposals";
  inspectorOpen: boolean;
  guides: CanvasGuide[];
  snappingEnabled: boolean;
  snapThresholdFrames: number;
  rippleEnabled: boolean;
}

export interface ProposalProvenance {
  source: "ai" | "automation" | "human";
  providerId?: string;
  modelId?: string;
  modelRevision?: string;
  requestId?: string;
  generatedAt: string;
  promptSummary?: string;
  evidenceIds?: string[];
}

export interface ProposalPolicyImpact {
  usesCloudData: boolean;
  sendsSourceMedia: boolean;
  createsGeneratedMedia: boolean;
  changesAttribution: boolean;
  estimatedCostUsd?: number;
  retentionSummary?: string;
  regions?: string[];
  warnings: string[];
}

export type ClipPatch = Partial<Pick<EditorClip, "name" | "enabled" | "locked" | "text" | "speaker" | "opacity" | "playbackRate" | "transform" | "audio" | "textStyle" | "metadata">>;

export type EditOperation =
  | { type: "insert-clip"; trackId: string; clip: EditorClip }
  | { type: "remove-clips"; clipIds: string[]; ripple: boolean }
  | { type: "move-clip"; clipId: string; trackId: string; startFrame: number; snap?: boolean }
  | { type: "reorder-clip"; clipId: string; direction: "previous" | "next" }
  | { type: "trim-clip"; clipId: string; edge: "start" | "end"; frame: number }
  | { type: "split-clip"; clipId: string; frame: number; rightClipId: string }
  | { type: "update-clip"; clipId: string; patch: ClipPatch }
  | { type: "set-transcript"; clipId: string; text: string; speaker?: string }
  | { type: "add-marker"; marker: TimelineMarker };

export type EditProposalStatus = "pending" | "previewing" | "applied" | "applied-to-copy" | "rejected";

export interface EditProposal {
  id: string;
  title: string;
  summary: string;
  operations: EditOperation[];
  provenance: ProposalProvenance;
  policyImpact: ProposalPolicyImpact;
  status: EditProposalStatus;
  createdFromProjectRevision?: number;
}

export interface HumanReadableEditDiff {
  proposalId: string;
  headline: string;
  changes: string[];
  affectedClipIds: string[];
  affectedTrackIds: string[];
  policySummary: string[];
  provenanceSummary: string;
}

export interface EditorDocumentSnapshot {
  project: EditorProject;
  proposals: EditProposal[];
  lastCreatedCopy: EditorProject | null;
}

export interface EditorVersion {
  id: string;
  label: string;
  createdAt: string;
  transactionKind: "edit" | "proposal" | "import" | "transcript" | "inspector";
  before: EditorDocumentSnapshot;
  after: EditorDocumentSnapshot;
}

export interface EditorState {
  schema: typeof EDITOR_STATE_SCHEMA;
  project: EditorProject;
  selection: EditorSelection;
  transport: EditorTransport;
  view: EditorViewState;
  proposals: EditProposal[];
  activeProposalId: string | null;
  versions: EditorVersion[];
  versionIndex: number;
  revision: number;
  lastCreatedCopy: EditorProject | null;
  announcement: string;
}

export type EditorAction =
  | { type: "SELECT_CLIP"; clipId: string; additive?: boolean }
  | { type: "SELECT_TRACK"; trackId: string }
  | { type: "SELECT_ASSET"; assetId: string }
  | { type: "CLEAR_SELECTION" }
  | { type: "SET_PLAYHEAD"; frame: number; snap?: boolean }
  | { type: "SET_IN_POINT"; frame?: number }
  | { type: "SET_OUT_POINT"; frame?: number }
  | { type: "TRANSPORT_PLAY" }
  | { type: "TRANSPORT_PAUSE" }
  | { type: "TRANSPORT_STOP" }
  | { type: "TRANSPORT_TOGGLE" }
  | { type: "TRANSPORT_TICK"; elapsedSeconds: number }
  | { type: "SET_PLAYBACK_RATE"; rate: number }
  | { type: "TOGGLE_LOOP" }
  | { type: "SET_ZOOM"; pixelsPerSecond: number }
  | { type: "SET_ACTIVE_PANEL"; panel: EditorViewState["activePanel"] }
  | { type: "TOGGLE_GUIDE"; guide: CanvasGuide }
  | { type: "TOGGLE_SNAPPING" }
  | { type: "TOGGLE_RIPPLE" }
  | { type: "UPDATE_TRACK"; trackId: string; patch: Partial<Pick<EditorTrack, "name" | "locked" | "muted" | "solo" | "hidden">> }
  | { type: "IMPORT_RECEIPTS"; receipts: ImportReceipt[]; assets: EditorMediaAsset[] }
  | { type: "UPDATE_IMPORT_RECEIPT"; receipt: ImportReceipt; asset?: EditorMediaAsset }
  | { type: "INSERT_CLIP"; trackId: string; clip: EditorClip }
  | { type: "MOVE_CLIP"; clipId: string; trackId: string; startFrame: number; snap?: boolean }
  | { type: "REORDER_CLIP"; clipId: string; direction: "previous" | "next" }
  | { type: "SPLIT_SELECTED"; frame?: number; idFactory?: () => string }
  | { type: "TRIM_CLIP"; clipId: string; edge: "start" | "end"; frame: number }
  | { type: "LIFT_SELECTED" }
  | { type: "RIPPLE_DELETE_SELECTED" }
  | { type: "EXTRACT_SELECTED_RANGE" }
  | { type: "UPDATE_SELECTED_CLIP"; patch: ClipPatch; label?: string }
  | { type: "ADD_KEYFRAME"; clipId: string; keyframe: EditorKeyframe }
  | { type: "UPDATE_KEYFRAME"; clipId: string; keyframeId: string; patch: Partial<EditorKeyframe> }
  | { type: "REMOVE_KEYFRAME"; clipId: string; keyframeId: string }
  | { type: "SET_TRANSCRIPT"; clipId: string; text: string; speaker?: string }
  | { type: "ADD_PROPOSALS"; proposals: EditProposal[] }
  | { type: "PREVIEW_PROPOSAL"; proposalId: string }
  | { type: "APPLY_PROPOSAL"; proposalId: string }
  | { type: "APPLY_PROPOSAL_TO_COPY"; proposalId: string; copyId: string; copyName?: string }
  | { type: "REJECT_PROPOSAL"; proposalId: string }
  | { type: "UNDO" }
  | { type: "REDO" }
  | { type: "REPLACE_PROJECT"; project: EditorProject }
  | { type: "CLEAR_ANNOUNCEMENT" };

export interface OtioLikeRationalTime {
  value: number;
  rate: number;
}

export interface OtioLikeTimeRange {
  start_time: OtioLikeRationalTime;
  duration: OtioLikeRationalTime;
}

export interface OtioLikeClip {
  OTIO_SCHEMA: "Clip.2";
  name: string;
  metadata: Record<string, unknown>;
  source_range: OtioLikeTimeRange;
  media_reference: {
    OTIO_SCHEMA: "ExternalReference.1" | "MissingReference.1";
    target_url?: string;
    available_range?: OtioLikeTimeRange;
    metadata: Record<string, unknown>;
  };
}

export interface OtioLikeTrack {
  OTIO_SCHEMA: "Track.1";
  name: string;
  kind: "Video" | "Audio";
  metadata: Record<string, unknown>;
  children: Array<OtioLikeClip | { OTIO_SCHEMA: "Gap.1"; source_range: OtioLikeTimeRange; metadata: Record<string, unknown> }>;
}

export interface OtioLikeTimeline {
  OTIO_SCHEMA: "Timeline.1";
  name: string;
  global_start_time: OtioLikeRationalTime;
  metadata: Record<string, unknown>;
  tracks: {
    OTIO_SCHEMA: "Stack.1";
    name: string;
    metadata: Record<string, unknown>;
    children: OtioLikeTrack[];
  };
}
