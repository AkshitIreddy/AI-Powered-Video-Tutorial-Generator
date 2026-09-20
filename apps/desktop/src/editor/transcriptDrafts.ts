import type { EditorClip } from "./types";

export interface TranscriptDraft { text: string; speaker: string }

function key(projectId: string, clip: Pick<EditorClip, "id" | "text" | "speaker">): string {
  // Separate source versions prevent an imported document or undo from silently
  // applying unfinished wording to a different cue with the same identity.
  return `alystria.editor.cue-draft.v1:${JSON.stringify([projectId, clip.id, clip.text ?? "", clip.speaker ?? ""])}`;
}

export function readTranscriptDraft(projectId: string, clip: Pick<EditorClip, "id" | "text" | "speaker">): TranscriptDraft {
  const original = { text: clip.text ?? "", speaker: clip.speaker ?? "" };
  try {
    const raw = localStorage.getItem(key(projectId, clip));
    if (!raw) return original;
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && "text" in parsed && "speaker" in parsed
      && typeof parsed.text === "string" && typeof parsed.speaker === "string") {
      return { text: parsed.text, speaker: parsed.speaker };
    }
  } catch { /* An unavailable browser store must not block the saved document. */ }
  return original;
}

export function writeTranscriptDraft(projectId: string, clip: Pick<EditorClip, "id" | "text" | "speaker">, draft: TranscriptDraft | null): boolean {
  try {
    if (draft) localStorage.setItem(key(projectId, clip), JSON.stringify(draft));
    else localStorage.removeItem(key(projectId, clip));
    return true;
  } catch { return false; }
}
