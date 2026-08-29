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

export interface SceneContent {
  readonly eyebrow?: string;
  readonly title: string;
  readonly body?: string;
  readonly accent?: string;
  readonly items?: readonly string[];
}

export interface ResolvedScene {
  readonly id: string;
  readonly kind: string;
  readonly durationTicks: number;
  readonly seed: string;
  readonly content: SceneContent;
  readonly captions?: readonly CaptionCue[];
  readonly accessibilityDescription?: string;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface RenderManifest {
  readonly id: string;
  readonly schemaVersion: 1;
  readonly rendererVersion: string;
  readonly target: RenderTarget;
  readonly scenes: readonly ResolvedScene[];
  readonly outputDirectory: string;
  readonly audioInputs?: readonly AudioInput[];
  /**
   * Immutable local presenter clips composited by FFmpeg after authoritative
   * Chromium frame capture. Clips are bound to one presenter scene and their
   * bytes are re-hashed immediately before rendering.
   */
  readonly presenterVideos?: readonly PresenterVideoInput[];
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface AudioInput {
  readonly path: string;
  readonly role: "narration" | "music" | "sfx" | "audio-description";
  readonly startTick: number;
  readonly endTick?: number;
  readonly gainDb?: number;
}

export type PresenterVideoPlacement = "full" | "picture-in-picture" | "split-left" | "split-right";

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
  readonly placement: PresenterVideoPlacement;
  readonly fit?: "cover" | "contain";
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
  const audioRoles = new Set<AudioInput["role"]>(["narration", "music", "sfx", "audio-description"]);
  for (const [index, input] of (manifest.audioInputs ?? []).entries()) {
    if (!input.path.trim()) throw new TypeError(`Audio input ${index} path must not be empty`);
    if (!audioRoles.has(input.role)) throw new TypeError(`Audio input ${index} has unsupported role ${String(input.role)}`);
    if (!Number.isSafeInteger(input.startTick) || input.startTick < 0) throw new RangeError(`Audio input ${index} startTick is invalid`);
    if (input.endTick !== undefined && (!Number.isSafeInteger(input.endTick) || input.endTick <= input.startTick)) {
      throw new RangeError(`Audio input ${index} endTick must be after startTick`);
    }
    if (input.gainDb !== undefined && (!Number.isFinite(input.gainDb) || input.gainDb < -96 || input.gainDb > 24)) {
      throw new RangeError(`Audio input ${index} gainDb must be in [-96, 24]`);
    }
  }
  const presenterIds = new Set<string>();
  const presenterSceneIds = new Set<string>();
  const presenterPlacements = new Set<PresenterVideoPlacement>(["full", "picture-in-picture", "split-left", "split-right"]);
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
    if (input.fit !== undefined && input.fit !== "cover" && input.fit !== "contain") {
      throw new TypeError(`Presenter video ${input.id} has unsupported fit ${String(input.fit)}`);
    }
    if (input.sourceStartTick !== undefined && (!Number.isSafeInteger(input.sourceStartTick) || input.sourceStartTick < 0)) {
      throw new RangeError(`Presenter video ${input.id} sourceStartTick must be a non-negative safe integer`);
    }
    presenterIds.add(input.id);
    presenterSceneIds.add(input.sceneId);
  }
}
