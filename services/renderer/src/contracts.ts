/** Renderer-local wire contracts. The schema package can generate adapters to these shapes. */

export type FrameRate = Readonly<{
  numerator: number;
  denominator: number;
}>;

export type RenderTargetName = "landscape" | "portrait" | "square" | "custom";

export interface Insets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface RenderTarget {
  readonly name: RenderTargetName;
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
  readonly frameRate: FrameRate;
  readonly colorSpace: "srgb-rec709";
  readonly safeArea?: Partial<Insets>;
}

export interface CaptionCue {
  readonly id: string;
  readonly startTick: number;
  readonly endTick: number;
  readonly text: string;
  readonly speaker?: string;
  readonly position?: "top" | "bottom";
}

export interface CaptionRenderStyle {
  readonly position: "auto" | "top" | "lower-third";
  readonly style: "soft-panel" | "solid-panel" | "outline";
  readonly sizePercent: number;
  readonly safeInsetPercent: number;
  readonly maxLines: 1 | 2 | 3;
  readonly textColor: string;
  readonly panelColor: string;
  /** Closed font-family name. Uploaded font bytes are not transported yet. */
  readonly fontFamily: string;
  readonly fallbackFamilies: readonly string[];
}

/**
 * Caption delivery is independent from caption authoring. The canonical cue
 * ledger and UTF-8 sidecars are always written; this mode controls only what
 * is added to the video frames/container.
 */
export type CaptionDeliveryMode = "sidecar" | "embedded" | "burned" | "both";

export interface SceneContent {
  readonly eyebrow?: string;
  readonly title: string;
  readonly body?: string;
  readonly accent?: string;
  readonly items?: readonly string[];
}

export interface NarrationWordTiming {
  readonly token: string;
  readonly startTick: number;
  readonly endTick: number;
}

export interface NarrationTiming {
  readonly schemaVersion: 1;
  readonly source: "provider-native" | "forced-alignment" | "duration-proportional";
  /** Measured token coverage. Omitted for duration-proportional estimates. */
  readonly alignedTokenRatio?: number;
  readonly words: readonly NarrationWordTiming[];
}

export interface ResolvedScene {
  readonly id: string;
  readonly kind: string;
  readonly durationTicks: number;
  readonly seed: string;
  readonly content: SceneContent;
  readonly captions?: readonly CaptionCue[];
  /** Provider-free narration cues used by captions and authored scene motion. */
  readonly narrationTiming?: NarrationTiming;
  readonly accessibilityDescription?: string;
  /** Semantic, hash-bound image references used by this scene. */
  readonly visualAssets?: readonly SceneVisualAssetReference[];
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export type SceneVisualAssetRole = "background" | "primary" | "secondary" | "presenter-portrait";

export interface SceneVisualAssetReference {
  /** Stable manifest-local id. It is not a path and is safe to persist in scene data. */
  readonly assetId: string;
  readonly sha256: string;
  readonly role: SceneVisualAssetRole;
  readonly alt: string;
  readonly fit?: "cover" | "contain";
}

export type VisualAssetMediaType = "image/png" | "image/jpeg" | "image/webp";

export interface VisualAssetInput {
  /** Stable id referenced by ResolvedScene.visualAssets. */
  readonly id: string;
  /** Plain absolute path to an attempt-local, CAS-materialized regular file. */
  readonly path: string;
  readonly sha256: string;
  readonly mediaType: VisualAssetMediaType;
}

export type FontAssetMediaType = "font/ttf" | "font/otf" | "font/woff";
export type FontAssetRole = "display" | "body" | "code" | "caption";
export type FontEmbeddingPermission = "installable" | "previewPrint" | "editable";

/** Hash-bound, fully inspected font staged for this render attempt only. */
export interface FontAssetInput {
  readonly id: string;
  readonly path: string;
  readonly sha256: string;
  readonly mediaType: FontAssetMediaType;
  /** Closed deterministic alias: AlystriaImported- plus 16 lowercase hash digits. */
  readonly family: string;
  readonly roles: readonly FontAssetRole[];
  readonly weight: number | readonly [number, number];
  readonly style: "normal" | "italic";
  readonly inspectionStatus: "metadata-inspected";
  readonly embeddingPermission: FontEmbeddingPermission;
  readonly exportEligible: true;
}

export interface RenderTypography {
  readonly displayFamily: string;
  readonly bodyFamily: string;
  readonly codeFamily: string;
  readonly captionFamily: string;
}

export interface RenderManifest {
  readonly id: string;
  readonly schemaVersion: 1;
  readonly rendererVersion: string;
  readonly target: RenderTarget;
  readonly scenes: readonly ResolvedScene[];
  readonly outputDirectory: string;
  readonly audioInputs?: readonly AudioInput[];
  /** Missing means sidecar: clean frames with external UTF-8 caption files. */
  readonly captionDeliveryMode?: CaptionDeliveryMode;
  readonly captionStyle?: CaptionRenderStyle;
  /** Attempt-local copies of immutable CAS image objects. */
  readonly visualAssets?: readonly VisualAssetInput[];
  /** Attempt-local copies of immutable, inspected and export-cleared fonts. */
  readonly fontAssets?: readonly FontAssetInput[];
  /** Closed family aliases/names used by scene and caption typography. */
  readonly typography?: RenderTypography;
  /**
   * Immutable local presenter clips composited by FFmpeg after authoritative
   * Chromium frame capture. Clips are bound to one presenter scene and their
   * bytes are re-hashed immediately before rendering.
   */
  readonly presenterVideos?: readonly PresenterVideoInput[];
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface AudioInput {
  /** Unique timeline cue id. */
  readonly id: string;
  /** Stable project/starter asset id; never interpreted as a path. */
  readonly assetId: string;
  readonly path: string;
  readonly sha256: string;
  readonly mediaType: "audio/wav" | "audio/x-wav" | "audio/flac" | "audio/mpeg" | "audio/mp4" | "audio/ogg" | "audio/webm";
  readonly role: "narration" | "music" | "sfx" | "audio-description";
  readonly startTick: number;
  readonly endTick?: number;
  readonly gainDb?: number;
  /** Repeat the source until endTick. Valid only for music. */
  readonly loop?: boolean;
  /** Maximum side-chain gain reduction while voice is active. */
  readonly duckingDb?: number;
}

export type PresenterVideoPlacement = "full" | "picture-in-picture" | "split-left" | "split-right";
export type PresenterMotionProfile = "lip-sync-only" | "native-idle";

export interface PresenterVideoInput {
  readonly id: string;
  /** Plain absolute local filesystem path. URI schemes and control characters are rejected. */
  readonly path: string;
  /** Lower- or upper-case hexadecimal SHA-256 of the immutable clip bytes. */
  readonly sha256: string;
  /** The presenter or presenter-slide scene whose timeline this clip follows. */
  readonly sceneId: string;
  /** Offset into the source clip. Defaults to zero. */
  readonly sourceStartTick?: number;
  /**
   * Duration for which presenter pixels are active from the scene start.
   * Defaults to the full scene only for legacy manifests. New generation
   * requests bind this to the finished narration duration so an authored
   * visual tail can continue after lip-sync ends without stretching video.
   */
  readonly activeDurationTicks?: number;
  readonly placement: PresenterVideoPlacement;
  readonly fit?: "cover" | "contain";
  /** Prevents fallback idle motion from being stacked onto a provider that already animates pose. */
  readonly motionProfile?: PresenterMotionProfile;
}

export interface FrameContext {
  readonly manifestId: string;
  readonly sceneId: string;
  readonly target: RenderTarget;
  readonly frame: number;
  readonly globalFrame: number;
  readonly tick: number;
  readonly localTick: number;
  readonly progress: number;
  readonly seed: string;
  readonly mode: "preview" | "final";
}

export interface CompiledLayout {
  readonly family: "wide" | "tall" | "balanced";
  readonly safeArea: Insets;
  readonly contentBox: Readonly<{ x: number; y: number; width: number; height: number }>;
  readonly titleSize: number;
  readonly bodySize: number;
  readonly columns: 1 | 2;
}

export interface RenderedFrame {
  readonly frame: number;
  readonly tick: number;
  readonly sceneId: string;
  readonly html: string;
  readonly svg: string;
  readonly contentHash: string;
}

export function assertRenderTarget(value: RenderTarget): void {
  if (!Number.isInteger(value.width) || value.width < 64 || value.width > 16_384) {
    throw new RangeError(`Render target width must be an integer in [64, 16384], got ${value.width}`);
  }
  if (!Number.isInteger(value.height) || value.height < 64 || value.height > 16_384) {
    throw new RangeError(`Render target height must be an integer in [64, 16384], got ${value.height}`);
  }
  if (!Number.isFinite(value.pixelRatio) || value.pixelRatio <= 0 || value.pixelRatio > 4) {
    throw new RangeError(`Pixel ratio must be in (0, 4], got ${value.pixelRatio}`);
  }
  for (const [key, part] of Object.entries(value.frameRate)) {
    if (!Number.isSafeInteger(part) || part <= 0) {
      throw new RangeError(`Frame rate ${key} must be a positive safe integer, got ${part}`);
    }
  }
}

export function assertResolvedScene(scene: ResolvedScene): void {
  if (!scene.id.trim()) throw new TypeError("Scene id must not be empty");
  if (!scene.kind.trim()) throw new TypeError(`Scene ${scene.id} kind must not be empty`);
  if (!Number.isSafeInteger(scene.durationTicks) || scene.durationTicks <= 0) {
    throw new RangeError(`Scene ${scene.id} durationTicks must be a positive safe integer`);
  }
  if (!scene.content.title.trim()) throw new TypeError(`Scene ${scene.id} title must not be empty`);
  const captionIds = new Set<string>();
  let captionStart = -1;
  for (const cue of scene.captions ?? []) {
    if (!cue.id.trim() || captionIds.has(cue.id)) throw new TypeError(`Scene ${scene.id} caption ids must be unique and non-empty`);
    if (!Number.isSafeInteger(cue.startTick) || !Number.isSafeInteger(cue.endTick) || cue.startTick < 0 || cue.endTick <= cue.startTick || cue.endTick > scene.durationTicks) {
      throw new RangeError(`Scene ${scene.id} caption ${cue.id} has an invalid range`);
    }
    if (cue.startTick < captionStart) throw new RangeError(`Scene ${scene.id} captions must be sorted by startTick`);
    captionStart = cue.startTick;
    captionIds.add(cue.id);
  }
  if (scene.narrationTiming !== undefined) {
    const timing = scene.narrationTiming;
    const timingSources = new Set(["provider-native", "forced-alignment", "duration-proportional"]);
    if (timing.schemaVersion !== 1 || !timingSources.has(timing.source)) {
      throw new TypeError(`Scene ${scene.id} narration timing has an unsupported source`);
    }
    if (timing.alignedTokenRatio !== undefined && (!Number.isFinite(timing.alignedTokenRatio) || timing.alignedTokenRatio < 0 || timing.alignedTokenRatio > 1)) {
      throw new RangeError(`Scene ${scene.id} narration timing alignedTokenRatio must be in [0, 1]`);
    }
    if (timing.words.length === 0 || timing.words.length > 4_096) {
      throw new RangeError(`Scene ${scene.id} narration timing needs between 1 and 4096 words`);
    }
    let wordStart = -1;
    for (const [index, word] of timing.words.entries()) {
      if (!word.token.trim() || word.token.length > 200) {
        throw new TypeError(`Scene ${scene.id} narration word ${index} needs a bounded token`);
      }
      if (!Number.isSafeInteger(word.startTick) || !Number.isSafeInteger(word.endTick)
        || word.startTick < 0 || word.endTick <= word.startTick || word.endTick > scene.durationTicks) {
        throw new RangeError(`Scene ${scene.id} narration word ${index} has an invalid range`);
      }
      if (word.startTick < wordStart) {
        throw new RangeError(`Scene ${scene.id} narration words must be sorted by startTick`);
      }
      wordStart = word.startTick;
    }
  }
  const visualIds = new Set<string>();
  const visualRoles = new Set<SceneVisualAssetRole>(["background", "primary", "secondary", "presenter-portrait"]);
  for (const [index, visual] of (scene.visualAssets ?? []).entries()) {
    if (!visual.assetId.trim() || visualIds.has(visual.assetId)) {
      throw new TypeError(`Scene ${scene.id} visual asset ${index} id must be unique and non-empty`);
    }
    if (!/^[0-9a-f]{64}$/i.test(visual.sha256)) {
      throw new TypeError(`Scene ${scene.id} visual asset ${visual.assetId} must have a 64-character SHA-256 hash`);
    }
    if (!visualRoles.has(visual.role)) {
      throw new TypeError(`Scene ${scene.id} visual asset ${visual.assetId} has unsupported role ${String(visual.role)}`);
    }
    if (!visual.alt.trim() || visual.alt.length > 1_000) {
      throw new TypeError(`Scene ${scene.id} visual asset ${visual.assetId} needs bounded alternative text`);
    }
    if (visual.fit !== undefined && visual.fit !== "cover" && visual.fit !== "contain") {
      throw new TypeError(`Scene ${scene.id} visual asset ${visual.assetId} has unsupported fit ${String(visual.fit)}`);
    }
    visualIds.add(visual.assetId);
  }
}

export function assertRenderManifest(manifest: RenderManifest): void {
  if (manifest.schemaVersion !== 1) throw new TypeError(`Unsupported render manifest schema ${manifest.schemaVersion}`);
  if (!manifest.id.trim()) throw new TypeError("Manifest id must not be empty");
  if (!manifest.rendererVersion.trim()) throw new TypeError("rendererVersion must not be empty");
  if (!manifest.outputDirectory.trim()) throw new TypeError("outputDirectory must not be empty");
  assertRenderTarget(manifest.target);
  if (manifest.scenes.length === 0) throw new TypeError("A render manifest needs at least one scene");
  const ids = new Set<string>();
  let duration = 0;
  for (const scene of manifest.scenes) {
    assertResolvedScene(scene);
    if (ids.has(scene.id)) throw new TypeError(`Duplicate scene id ${scene.id}`);
    ids.add(scene.id);
    duration += scene.durationTicks;
    if (!Number.isSafeInteger(duration)) throw new RangeError("Manifest duration exceeds JavaScript safe integer range");
  }
  const visualInputs = new Map<string, VisualAssetInput>();
  const supportedVisualMediaTypes = new Set<VisualAssetMediaType>(["image/png", "image/jpeg", "image/webp"]);
  for (const [index, input] of (manifest.visualAssets ?? []).entries()) {
    if (!input.id.trim() || visualInputs.has(input.id)) {
      throw new TypeError(`Visual asset ${index} id must be unique and non-empty`);
    }
    const windowsDrivePath = /^[a-z]:[\\/]/i.test(input.path);
    const unixAbsolutePath = /^\//.test(input.path);
    const uriScheme = /^[a-z][a-z0-9+.-]*:/i.test(input.path) && !windowsDrivePath;
    if (!input.path.trim() || /[\u0000\r\n]/.test(input.path) || uriScheme || (!windowsDrivePath && !unixAbsolutePath)) {
      throw new TypeError(`Visual asset ${input.id} must use a plain absolute local filesystem path`);
    }
    if (!/^[0-9a-f]{64}$/i.test(input.sha256)) {
      throw new TypeError(`Visual asset ${input.id} must have a 64-character SHA-256 hash`);
    }
    if (!supportedVisualMediaTypes.has(input.mediaType)) {
      throw new TypeError(`Visual asset ${input.id} has unsupported media type ${String(input.mediaType)}`);
    }
    visualInputs.set(input.id, input);
  }
  const referencedVisuals = new Set<string>();
  for (const scene of manifest.scenes) {
    for (const reference of scene.visualAssets ?? []) {
      const input = visualInputs.get(reference.assetId);
      if (!input) throw new TypeError(`Scene ${scene.id} references missing visual asset ${reference.assetId}`);
      if (input.sha256.toLowerCase() !== reference.sha256.toLowerCase()) {
        throw new TypeError(`Scene ${scene.id} visual asset ${reference.assetId} hash does not match its input`);
      }
      referencedVisuals.add(reference.assetId);
    }
  }
  for (const id of visualInputs.keys()) {
    if (!referencedVisuals.has(id)) throw new TypeError(`Visual asset ${id} is not referenced by any scene`);
  }
  const fontIds = new Set<string>();
  const fontRoles = new Map<FontAssetRole, FontAssetInput>();
  const supportedFontMediaTypes = new Set<FontAssetMediaType>(["font/ttf", "font/otf", "font/woff"]);
  const supportedEmbedding = new Set<FontEmbeddingPermission>(["installable", "previewPrint", "editable"]);
  for (const [index, input] of (manifest.fontAssets ?? []).entries()) {
    if (!input.id.trim() || input.id.length > 200 || fontIds.has(input.id)) {
      throw new TypeError(`Font asset ${index} id must be bounded, unique, and non-empty`);
    }
    const windowsDrivePath = /^[a-z]:[\\/]/i.test(input.path);
    const unixAbsolutePath = /^\//.test(input.path);
    const uriScheme = /^[a-z][a-z0-9+.-]*:/i.test(input.path) && !windowsDrivePath;
    if (!input.path.trim() || /[\u0000\r\n]/.test(input.path) || uriScheme || (!windowsDrivePath && !unixAbsolutePath)) {
      throw new TypeError(`Font asset ${input.id} must use a plain absolute local filesystem path`);
    }
    if (!/^[0-9a-f]{64}$/i.test(input.sha256)) throw new TypeError(`Font asset ${input.id} must have a SHA-256 binding`);
    const expectedFamily = `AlystriaImported-${input.sha256.toLowerCase().slice(0, 16)}`;
    if (input.family !== expectedFamily) throw new TypeError(`Font asset ${input.id} family alias does not match its immutable hash`);
    if (!supportedFontMediaTypes.has(input.mediaType)) throw new TypeError(`Font asset ${input.id} has unsupported media type ${String(input.mediaType)}`);
    if (input.inspectionStatus !== "metadata-inspected" || input.exportEligible !== true || !supportedEmbedding.has(input.embeddingPermission)) {
      throw new TypeError(`Font asset ${input.id} is not inspected and cleared for final rendering`);
    }
    if (!Array.isArray(input.roles) || input.roles.length === 0 || input.roles.length > 4) throw new TypeError(`Font asset ${input.id} needs one to four typography roles`);
    for (const role of input.roles) {
      if (!(["display", "body", "code", "caption"] as const).includes(role) || fontRoles.has(role)) {
        throw new TypeError(`Typography role ${role} is unsupported or bound by more than one font asset`);
      }
      fontRoles.set(role, input);
    }
    const weights = typeof input.weight === "number" ? [input.weight] : input.weight;
    if (weights.length < 1 || weights.length > 2 || weights.some((weight) => !Number.isInteger(weight) || weight < 1 || weight > 1_000) || (weights.length === 2 && weights[0]! > weights[1]!)) {
      throw new RangeError(`Font asset ${input.id} weight must stay within OpenType's 1..1000 range`);
    }
    if (input.style !== "normal" && input.style !== "italic") throw new TypeError(`Font asset ${input.id} has unsupported style`);
    fontIds.add(input.id);
  }
  if (manifest.typography !== undefined) {
    const roleFamilies: readonly [FontAssetRole, string][] = [
      ["display", manifest.typography.displayFamily],
      ["body", manifest.typography.bodyFamily],
      ["code", manifest.typography.codeFamily],
      ["caption", manifest.typography.captionFamily],
    ];
    for (const [role, family] of roleFamilies) {
      if (!/^[\w .'-]{1,120}$/u.test(family)) throw new TypeError(`Typography ${role} family contains unsupported characters`);
      if (family.startsWith("AlystriaImported-") && fontRoles.get(role)?.family !== family) {
        throw new TypeError(`Typography ${role} references an unbound imported font`);
      }
    }
  }
  if (manifest.captionStyle !== undefined) assertCaptionRenderStyle(manifest.captionStyle);
  if (manifest.captionDeliveryMode !== undefined && !(new Set<CaptionDeliveryMode>(["sidecar", "embedded", "burned", "both"])).has(manifest.captionDeliveryMode)) {
    throw new TypeError(`Unsupported caption delivery mode ${String(manifest.captionDeliveryMode)}`);
  }
  if (manifest.captionStyle !== undefined && manifest.typography !== undefined && manifest.captionStyle.fontFamily !== manifest.typography.captionFamily) {
    throw new TypeError("Caption font family must match the resolved caption typography role");
  }
  const audioRoles = new Set<AudioInput["role"]>(["narration", "music", "sfx", "audio-description"]);
  const audioMediaTypes = new Set<AudioInput["mediaType"]>(["audio/wav", "audio/x-wav", "audio/flac", "audio/mpeg", "audio/mp4", "audio/ogg", "audio/webm"]);
  const audioIds = new Set<string>();
  for (const [index, input] of (manifest.audioInputs ?? []).entries()) {
    if (!input.id.trim() || audioIds.has(input.id)) throw new TypeError(`Audio input ${index} id must be unique and non-empty`);
    if (!input.assetId.trim() || input.assetId.length > 200) throw new TypeError(`Audio input ${input.id} assetId must be bounded and non-empty`);
    const windowsDrivePath = /^[a-z]:[\\/]/i.test(input.path);
    const unixAbsolutePath = /^\//.test(input.path);
    const uriScheme = /^[a-z][a-z0-9+.-]*:/i.test(input.path) && !windowsDrivePath;
    if (!input.path.trim() || /[\u0000\r\n]/.test(input.path) || uriScheme || (!windowsDrivePath && !unixAbsolutePath)) {
      throw new TypeError(`Audio input ${input.id} must use a plain absolute local filesystem path`);
    }
    if (!/^[0-9a-f]{64}$/i.test(input.sha256)) throw new TypeError(`Audio input ${input.id} must have a 64-character SHA-256 hash`);
    if (!audioMediaTypes.has(input.mediaType)) throw new TypeError(`Audio input ${input.id} has unsupported media type ${String(input.mediaType)}`);
    if (!audioRoles.has(input.role)) throw new TypeError(`Audio input ${index} has unsupported role ${String(input.role)}`);
    if (!Number.isSafeInteger(input.startTick) || input.startTick < 0) throw new RangeError(`Audio input ${index} startTick is invalid`);
    if (input.endTick !== undefined && (!Number.isSafeInteger(input.endTick) || input.endTick <= input.startTick)) {
      throw new RangeError(`Audio input ${index} endTick must be after startTick`);
    }
    if (input.gainDb !== undefined && (!Number.isFinite(input.gainDb) || input.gainDb < -96 || input.gainDb > 24)) {
      throw new RangeError(`Audio input ${index} gainDb must be in [-96, 24]`);
    }
    if (input.loop !== undefined && typeof input.loop !== "boolean") throw new TypeError(`Audio input ${input.id} loop must be boolean`);
    if (input.loop && (input.role !== "music" || input.endTick === undefined)) {
      throw new TypeError(`Looped audio input ${input.id} must be music with an explicit endTick`);
    }
    if (input.duckingDb !== undefined && (!Number.isFinite(input.duckingDb) || input.duckingDb < -36 || input.duckingDb > 0)) {
      throw new RangeError(`Audio input ${input.id} duckingDb must be in [-36, 0]`);
    }
    if (input.duckingDb !== undefined && input.role !== "music") {
      throw new TypeError(`Only music audio input ${input.id} may define duckingDb`);
    }
    audioIds.add(input.id);
  }
  const presenterIds = new Set<string>();
  const presenterSceneIds = new Set<string>();
  const presenterPlacements = new Set<PresenterVideoPlacement>(["full", "picture-in-picture", "split-left", "split-right"]);
  const presenterMotionProfiles = new Set<PresenterMotionProfile>(["lip-sync-only", "native-idle"]);
  for (const [index, input] of (manifest.presenterVideos ?? []).entries()) {
    if (!input.id.trim() || presenterIds.has(input.id)) {
      throw new TypeError(`Presenter video ${index} id must be unique and non-empty`);
    }
    const windowsDrivePath = /^[a-z]:[\\/]/i.test(input.path);
    const unixAbsolutePath = /^\//.test(input.path);
    const uriScheme = /^[a-z][a-z0-9+.-]*:/i.test(input.path) && !windowsDrivePath;
    if (!input.path.trim() || /[\u0000\r\n]/.test(input.path) || uriScheme || (!windowsDrivePath && !unixAbsolutePath)) {
      throw new TypeError(`Presenter video ${input.id} must use a plain absolute local filesystem path`);
    }
    if (!/^[0-9a-f]{64}$/i.test(input.sha256)) {
      throw new TypeError(`Presenter video ${input.id} must have a 64-character SHA-256 hash`);
    }
    const scene = manifest.scenes.find((candidate) => candidate.id === input.sceneId);
    if (!scene) throw new TypeError(`Presenter video ${input.id} references unknown scene ${input.sceneId}`);
    if (scene.kind !== "presenter" && scene.kind !== "presenter-slide" && scene.kind !== "presenter-with-slide") {
      throw new TypeError(`Presenter video ${input.id} can only bind to a presenter scene, got ${scene.kind}`);
    }
    if (presenterSceneIds.has(input.sceneId)) {
      throw new TypeError(`Scene ${input.sceneId} has more than one presenter video`);
    }
    if (!presenterPlacements.has(input.placement)) {
      throw new TypeError(`Presenter video ${input.id} has unsupported placement ${String(input.placement)}`);
    }
    if (input.motionProfile !== undefined && !presenterMotionProfiles.has(input.motionProfile)) {
      throw new TypeError(`Presenter video ${input.id} has unsupported motionProfile ${input.motionProfile}`);
    }
    if (input.fit !== undefined && input.fit !== "cover" && input.fit !== "contain") {
      throw new TypeError(`Presenter video ${input.id} has unsupported fit ${String(input.fit)}`);
    }
    if (input.sourceStartTick !== undefined && (!Number.isSafeInteger(input.sourceStartTick) || input.sourceStartTick < 0)) {
      throw new RangeError(`Presenter video ${input.id} sourceStartTick must be a non-negative safe integer`);
    }
    if (input.activeDurationTicks !== undefined) {
      if (!Number.isSafeInteger(input.activeDurationTicks) || input.activeDurationTicks <= 0) {
        throw new RangeError(`Presenter video ${input.id} activeDurationTicks must be a positive safe integer`);
      }
      if (input.activeDurationTicks > scene.durationTicks) {
        throw new RangeError(`Presenter video ${input.id} activeDurationTicks cannot exceed scene ${scene.id} duration`);
      }
      if (!Number.isSafeInteger((input.sourceStartTick ?? 0) + input.activeDurationTicks)) {
        throw new RangeError(`Presenter video ${input.id} source interval exceeds the safe tick range`);
      }
    }
    presenterIds.add(input.id);
    presenterSceneIds.add(input.sceneId);
  }
}

function assertCaptionRenderStyle(style: CaptionRenderStyle): void {
  if (!new Set(["auto", "top", "lower-third"]).has(style.position)) throw new TypeError("Caption position is unsupported");
  if (!new Set(["soft-panel", "solid-panel", "outline"]).has(style.style)) throw new TypeError("Caption style is unsupported");
  if (!Number.isFinite(style.sizePercent) || style.sizePercent < 60 || style.sizePercent > 160) throw new RangeError("Caption sizePercent must be in [60, 160]");
  if (!Number.isFinite(style.safeInsetPercent) || style.safeInsetPercent < 2 || style.safeInsetPercent > 24) throw new RangeError("Caption safeInsetPercent must be in [2, 24]");
  if (!Number.isInteger(style.maxLines) || style.maxLines < 1 || style.maxLines > 3) throw new RangeError("Caption maxLines must be 1, 2, or 3");
  if (!/^#[0-9a-f]{6}$/iu.test(style.textColor) || !/^#[0-9a-f]{6}$/iu.test(style.panelColor)) throw new TypeError("Caption colors must be six-digit hexadecimal values");
  const fontName = /^[\p{L}\p{N} .'-]{1,120}$/u;
  if (!fontName.test(style.fontFamily)) throw new TypeError("Caption fontFamily contains unsupported characters");
  if (!Array.isArray(style.fallbackFamilies) || style.fallbackFamilies.length < 1 || style.fallbackFamilies.length > 4 || style.fallbackFamilies.some((family) => !fontName.test(family))) {
    throw new TypeError("Caption fallbackFamilies must contain one to four safe family names");
  }
}
