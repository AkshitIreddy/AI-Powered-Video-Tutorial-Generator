export interface EditorLayoutPrefs {
  dockWidth: number;
  timelineHeight: number;
  dockCollapsed: boolean;
  timelineCollapsed: boolean;
  hideEmptyTracks: boolean;
}

export const EDITOR_LAYOUT_DEFAULTS: EditorLayoutPrefs = {
  dockWidth: 328,
  timelineHeight: 296,
  dockCollapsed: false,
  timelineCollapsed: false,
  hideEmptyTracks: false,
};

export const EDITOR_DOCK_MIN = 248;
export const EDITOR_DOCK_MAX = 560;
export const EDITOR_TIMELINE_MIN = 184;
export const EDITOR_TIMELINE_MAX = 640;

const STORAGE_KEY = "alystria.editor.layout.v1";

function viewportWidth(fallback = 1440): number {
  return typeof window === "undefined" ? fallback : window.innerWidth || fallback;
}

function viewportHeight(fallback = 900): number {
  return typeof window === "undefined" ? fallback : window.innerHeight || fallback;
}

export function editorDockMax(viewport = viewportWidth()): number {
  return Math.max(EDITOR_DOCK_MIN, Math.min(EDITOR_DOCK_MAX, viewport - 520));
}

export function editorTimelineMax(viewport = viewportHeight()): number {
  return Math.max(EDITOR_TIMELINE_MIN, Math.min(EDITOR_TIMELINE_MAX, viewport - 380));
}

export function clampDockWidth(width: number, viewport = viewportWidth()): number {
  return Math.min(editorDockMax(viewport), Math.max(EDITOR_DOCK_MIN, Math.round(width)));
}

export function clampTimelineHeight(height: number, viewport = viewportHeight()): number {
  return Math.min(editorTimelineMax(viewport), Math.max(EDITOR_TIMELINE_MIN, Math.round(height)));
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function loadEditorLayout(): EditorLayoutPrefs {
  const defaults = { ...EDITOR_LAYOUT_DEFAULTS, dockWidth: clampDockWidth(EDITOR_LAYOUT_DEFAULTS.dockWidth), timelineHeight: clampTimelineHeight(EDITOR_LAYOUT_DEFAULTS.timelineHeight) };
  if (typeof window === "undefined" || !("localStorage" in window)) return defaults;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<EditorLayoutPrefs>;
    return {
      dockWidth: clampDockWidth(asNumber(parsed.dockWidth, EDITOR_LAYOUT_DEFAULTS.dockWidth)),
      timelineHeight: clampTimelineHeight(asNumber(parsed.timelineHeight, EDITOR_LAYOUT_DEFAULTS.timelineHeight)),
      dockCollapsed: parsed.dockCollapsed === true,
      timelineCollapsed: parsed.timelineCollapsed === true,
      hideEmptyTracks: parsed.hideEmptyTracks === true,
    };
  } catch {
    return defaults;
  }
}

export function saveEditorLayout(prefs: EditorLayoutPrefs): void {
  if (typeof window === "undefined" || !("localStorage" in window)) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Layout persistence is a convenience; a full disk must never break editing.
  }
}
