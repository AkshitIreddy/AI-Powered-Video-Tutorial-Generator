import {
  resolveBuiltinSceneSpec,
  type AuthoredResolvedScene,
  type AuthoredSceneVisualAssetReference,
} from "./authoring.js";
import { stableHashNumber } from "./random.js";
import { TIMEBASE_TICKS_PER_SECOND, type SceneSpec } from "./types.js";

export interface AuthoredStoryboardScene {
  readonly id: string;
  readonly type?: string;
  readonly kind?: string;
  readonly title: string;
  readonly narration?: string;
  readonly visualIntent?: string;
  readonly durationTicks?: number;
  readonly duration?: number;
  readonly seed?: number | string;
  readonly objectiveIds?: readonly string[];
  readonly claimIds?: readonly string[];
  readonly accessibilityDescription?: string;
  readonly onScreenText?: readonly string[];
  readonly visualBeat?: unknown;
  readonly visualAssets?: readonly AuthoredSceneVisualAssetReference[];
}

export interface StoryboardSceneSpecOptions {
  readonly seedScope?: string;
}

/**
 * Adapts the persisted provider-authored storyboard shape to the canonical
 * semantic resolver shared by desktop preview and final rendering.
 */
export function sceneSpecFromStoryboard(
  scene: AuthoredStoryboardScene,
  options: StoryboardSceneSpecOptions = {},
): SceneSpec | undefined {
  const id = safeId(scene.id);
  const kind = String(scene.type ?? scene.kind ?? "").trim().replaceAll("_", "-");
  const title = cleanText(scene.title, "Untitled scene");
  const durationTicks = resolvedDurationTicks(scene);
  const seed = typeof scene.seed === "number" && Number.isSafeInteger(scene.seed)
    ? String(scene.seed)
    : String(scene.seed ?? stableHashNumber(`${options.seedScope ?? "storyboard"}:${id}`));
  const onScreenText = stringList(scene.onScreenText);
  const resolved: AuthoredResolvedScene = {
    id,
    kind,
    durationTicks,
    seed,
    content: {
      title,
      ...(scene.visualIntent?.trim() ? { body: cleanText(scene.visualIntent, "") } : {}),
      ...(onScreenText.length ? { items: onScreenText, onScreenText } : {}),
      ...(scene.visualBeat !== undefined ? { visualBeat: scene.visualBeat } : {}),
    },
    ...(scene.accessibilityDescription?.trim()
      ? { accessibilityDescription: cleanText(scene.accessibilityDescription, "") }
      : {}),
    ...(scene.visualAssets?.length ? { visualAssets: [...scene.visualAssets] } : {}),
  };
  const spec = resolveBuiltinSceneSpec(resolved);
  if (!spec) return undefined;
  return {
    ...spec,
    ...(scene.objectiveIds?.length ? { objectiveIds: [...scene.objectiveIds] } : {}),
    ...(scene.claimIds?.length ? { claimIds: [...scene.claimIds] } : {}),
  };
}

function resolvedDurationTicks(scene: AuthoredStoryboardScene): number {
  if (Number.isSafeInteger(scene.durationTicks) && scene.durationTicks! > 0) return scene.durationTicks!;
  if (typeof scene.duration === "number" && Number.isFinite(scene.duration) && scene.duration > 0) {
    return Math.max(1, Math.round(scene.duration * TIMEBASE_TICKS_PER_SECOND));
  }
  throw new TypeError(`Scene ${scene.id} requires a positive durationTicks or duration`);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => cleanText(item, "")).filter(Boolean)
    : [];
}

function cleanText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.replace(/\s+/gu, " ").trim() : fallback;
}

function safeId(value: string): string {
  const normalized = value.replace(/[^a-zA-Z0-9._:-]/gu, "-").replace(/^-+/u, "");
  return /^[a-zA-Z]/u.test(normalized) ? normalized : `scene-${normalized || "authored"}`;
}
