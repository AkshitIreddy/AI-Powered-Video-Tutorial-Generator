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

export function clampDockWidth(width: number, viewport = viewportWidth()): number {
  const maxForWindow = Math.max(EDITOR_DOCK_MIN, Math.min(EDITOR_DOCK_MAX, viewport - 520));
  return Math.min(maxForWindow, Math.max(EDITOR_DOCK_MIN, Math.round(width)));
}

export function clampTimelineHeight(height: number, viewport = viewportHeight()): number {
  const maxForWindow = Math.max(EDITOR_TIMELINE_MIN, Math.min(EDITOR_TIMELINE_MAX, viewport - 380));
  return Math.min(maxForWindow, Math.max(EDITOR_TIMELINE_MIN, Math.round(height)));
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function loadEditorLayout(): EditorLayoutPrefs {
  if (typeof window === "undefined" || !("localStorage" in window)) return { ...EDITOR_LAYOUT_DEFAULTS };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...EDITOR_LAYOUT_DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<EditorLayoutPrefs>;
    return {
      dockWidth: clampDockWidth(asNumber(parsed.dockWidth, EDITOR_LAYOUT_DEFAULTS.dockWidth)),
      timelineHeight: clampTimelineHeight(asNumber(parsed.timelineHeight, EDITOR_LAYOUT_DEFAULTS.timelineHeight)),
      dockCollapsed: parsed.dockCollapsed === true,
      timelineCollapsed: parsed.timelineCollapsed === true,
      hideEmptyTracks: parsed.hideEmptyTracks === true,
    };
  } catch {
    return { ...EDITOR_LAYOUT_DEFAULTS };
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
