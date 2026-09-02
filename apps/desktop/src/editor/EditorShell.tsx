import { useEffect, useId, useReducer, useRef, useState, type KeyboardEvent } from "react";
import "./editor.css";
import { EditorCanvas, EditorInspector, MediaBin, ProposalPanel, TranscriptPanel } from "./EditorPanels";
import { EditorTimeline } from "./EditorTimeline";
import { createEditorState } from "./model";
import { exportOtioLike, parseEditorProject, parseOtioLike } from "./otio";
import { editorReducer } from "./reducer";
import { formatTimecode, nominalFramesPerSecond, parseTimecode } from "./timecode";
import type { EditProposal, EditorClip, EditorImportBatch, EditorMediaAsset, EditorProject, OtioLikeTimeline } from "./types";

export interface AdvancedVideoEditorProps {
  project: EditorProject;
  proposals?: readonly EditProposal[];
  onProjectChange?: (project: EditorProject, revision: number) => void;
  onImportMedia?: (files: readonly File[]) => Promise<EditorImportBatch>;
  onCreateClipFromAsset?: (asset: EditorMediaAsset, trackId: string, startFrame: number) => EditorClip | null;
  onExportProject?: (project: EditorProject) => void | Promise<void>;
  onExportOtio?: (timeline: OtioLikeTimeline, project: EditorProject) => void | Promise<void>;
  onCreateProjectCopy?: (copy: EditorProject) => void | Promise<void>;
  allowProjectFileImport?: boolean;
  className?: string;
  editorLabel?: string;
}

function isTextEditingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable);
}

function TimecodeControl({ value, rate, onCommit }: { value: number; rate: EditorProject["frameRate"]; onCommit: (frame: number) => void }) {
  const [draft, setDraft] = useState(formatTimecode(value, rate));
  useEffect(() => setDraft(formatTimecode(value, rate)), [rate, value]);
  const commit = () => {
    const frame = parseTimecode(draft, rate);
    if (frame === null) setDraft(formatTimecode(value, rate));
    else onCommit(frame);
  };
  return <label className="aly-editor-timecode"><span className="aly-editor-sr-only">Playhead timecode</span><input aria-label="Playhead timecode" value={draft} inputMode="numeric" onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commit(); } }} /></label>;
}

export function AdvancedVideoEditor({
  project,
  proposals = [],
  onProjectChange,
  onImportMedia,
  onCreateClipFromAsset,
  onExportProject,
  onExportOtio,
  onCreateProjectCopy,
  allowProjectFileImport = true,
  className = "",
  editorLabel = "Advanced video editor",
}: AdvancedVideoEditorProps) {
  const [state, dispatch] = useReducer(editorReducer, undefined, () => createEditorState(project, proposals));
  const [projectImportError, setProjectImportError] = useState("");
  const projectInputRef = useRef<HTMLInputElement>(null);
  const initialRevision = useRef(true);
  const deliveredCopyId = useRef<string | null>(null);
  const statusId = useId();

  useEffect(() => {
    if (initialRevision.current) {
      initialRevision.current = false;
      return;
    }
    onProjectChange?.(state.project, state.revision);
  }, [onProjectChange, state.project, state.revision]);

  useEffect(() => {
    const copy = state.lastCreatedCopy;
    if (!copy || deliveredCopyId.current === copy.id) return;
    deliveredCopyId.current = copy.id;
    void onCreateProjectCopy?.(copy);
  }, [onCreateProjectCopy, state.lastCreatedCopy]);

  useEffect(() => {
    if (state.transport.status !== "playing") return;
    const timer = window.setInterval(() => dispatch({ type: "TRANSPORT_TICK", elapsedSeconds: 0.1 }), 100);
    return () => window.clearInterval(timer);
  }, [state.transport.status]);

  const importProjectFile = async (file: File | undefined) => {
    if (!file) return;
    setProjectImportError("");
    try {
      const text = await file.text();
      let imported: EditorProject;
      try {
        imported = parseEditorProject(text);
      } catch {
        imported = parseOtioLike(text);
      }
      dispatch({ type: "REPLACE_PROJECT", project: imported });
    } catch (error) {
      setProjectImportError(error instanceof Error ? error.message : "The project could not be imported.");
    } finally {
      if (projectInputRef.current) projectInputRef.current.value = "";
    }
  };

  const onEditorKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (isTextEditingTarget(event.target)) return;
    const command = event.ctrlKey || event.metaKey;
    if (command && event.key.toLowerCase() === "z") {
      event.preventDefault();
      dispatch({ type: event.shiftKey ? "REDO" : "UNDO" });
      return;
    }
    if (command && event.key.toLowerCase() === "y") {
      event.preventDefault();
      dispatch({ type: "REDO" });
      return;
    }
    if (event.key === " ") {
      event.preventDefault();
      dispatch({ type: "TRANSPORT_TOGGLE" });
      return;
    }
    if (event.key.toLowerCase() === "k") {
      event.preventDefault();
      dispatch({ type: "TRANSPORT_PAUSE" });
      return;
    }
    if (event.key.toLowerCase() === "l") {
      event.preventDefault();
      dispatch({ type: "TRANSPORT_PLAY" });
      return;
    }
    if (event.key.toLowerCase() === "s") {
      event.preventDefault();
      dispatch({ type: "SPLIT_SELECTED" });
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      dispatch({ type: event.shiftKey ? "RIPPLE_DELETE_SELECTED" : "LIFT_SELECTED" });
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const amount = event.shiftKey ? nominalFramesPerSecond(state.project.frameRate) : 1;
      dispatch({ type: "SET_PLAYHEAD", frame: state.transport.playheadFrame + direction * amount });
    }
  };

  const panel = state.view.activePanel === "media"
    ? <MediaBin state={state} dispatch={dispatch} onImportFiles={onImportMedia} onCreateClipFromAsset={onCreateClipFromAsset} />
    : state.view.activePanel === "transcript"
      ? <TranscriptPanel state={state} dispatch={dispatch} />
      : <ProposalPanel state={state} dispatch={dispatch} />;

  return (
    <div className={`aly-editor-shell${className ? ` ${className}` : ""}`} role="application" aria-label={editorLabel} aria-describedby={statusId} tabIndex={0} onKeyDown={onEditorKeyDown}>
      <header className="aly-editor-shell__topbar">
        <div className="aly-editor-shell__identity"><span className="aly-editor-shell__eyebrow">Editor project</span><h1>{state.project.name}</h1><span>{state.project.canvas.width}×{state.project.canvas.height} · {state.project.frameRate.numerator / state.project.frameRate.denominator} fps</span></div>
        <div className="aly-editor-shell__history" role="group" aria-label="Edit history">
          <button type="button" aria-label="Undo last edit" aria-keyshortcuts="Control+Z Meta+Z" disabled={state.versionIndex < 0} onClick={() => dispatch({ type: "UNDO" })}>Undo</button>
          <button type="button" aria-label="Redo last edit" aria-keyshortcuts="Control+Y Meta+Y" disabled={state.versionIndex >= state.versions.length - 1} onClick={() => dispatch({ type: "REDO" })}>Redo</button>
          <span className="aly-editor-shell__revision">Revision {state.revision}</span>
        </div>
        <div className="aly-editor-shell__project-actions" role="group" aria-label="Project import and export">
          {allowProjectFileImport ? <><input ref={projectInputRef} className="aly-editor-shell__project-input" type="file" accept="application/json,.json,.otio" aria-label="Import editor project file" onChange={(event) => void importProjectFile(event.target.files?.[0])} /><button type="button" onClick={() => projectInputRef.current?.click()}>Import project</button></> : null}
          <button type="button" disabled={!onExportProject} onClick={() => void onExportProject?.(state.project)}>Export project JSON</button>
          <button type="button" disabled={!onExportOtio} onClick={() => void onExportOtio?.(exportOtioLike(state.project), state.project)}>Export OTIO-like</button>
        </div>
      </header>
      {projectImportError ? <div className="aly-editor-shell__import-error" role="alert">{projectImportError}</div> : null}

      <div className="aly-editor-shell__workspace">
        <aside className="aly-editor-shell__left-panel">
          <nav className="aly-editor-panel-tabs" aria-label="Editor side panels">
            <button type="button" aria-current={state.view.activePanel === "media" ? "page" : undefined} onClick={() => dispatch({ type: "SET_ACTIVE_PANEL", panel: "media" })}>Media</button>
            <button type="button" aria-current={state.view.activePanel === "transcript" ? "page" : undefined} onClick={() => dispatch({ type: "SET_ACTIVE_PANEL", panel: "transcript" })}>Transcript</button>
            <button type="button" aria-current={state.view.activePanel === "proposals" ? "page" : undefined} onClick={() => dispatch({ type: "SET_ACTIVE_PANEL", panel: "proposals" })}>AI proposals</button>
          </nav>
          {panel}
        </aside>
        <main className="aly-editor-shell__center">
          <EditorCanvas state={state} dispatch={dispatch} />
          <div className="aly-editor-transport" role="group" aria-label="Playback transport">
            <button type="button" aria-label="Go to start" onClick={() => dispatch({ type: "SET_PLAYHEAD", frame: state.transport.inFrame ?? 0 })}>Start</button>
            <button type="button" aria-label="Step backward one frame" onClick={() => dispatch({ type: "SET_PLAYHEAD", frame: state.transport.playheadFrame - 1 })}>−1</button>
            <button type="button" aria-label={state.transport.status === "playing" ? "Pause playback" : "Play"} aria-keyshortcuts="Space" onClick={() => dispatch({ type: "TRANSPORT_TOGGLE" })}>{state.transport.status === "playing" ? "Pause" : "Play"}</button>
            <button type="button" aria-label="Step forward one frame" onClick={() => dispatch({ type: "SET_PLAYHEAD", frame: state.transport.playheadFrame + 1 })}>+1</button>
            <button type="button" aria-label="Stop playback" onClick={() => dispatch({ type: "TRANSPORT_STOP" })}>Stop</button>
            <TimecodeControl value={state.transport.playheadFrame} rate={state.project.frameRate} onCommit={(frame) => dispatch({ type: "SET_PLAYHEAD", frame })} />
            <button type="button" aria-pressed={state.transport.loop} onClick={() => dispatch({ type: "TOGGLE_LOOP" })}>Loop</button>
            <label className="aly-editor-transport__rate"><span>Speed</span><select value={state.transport.playbackRate} onChange={(event) => dispatch({ type: "SET_PLAYBACK_RATE", rate: Number(event.target.value) })}><option value="0.5">0.5×</option><option value="1">1×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label>
            <button type="button" onClick={() => dispatch({ type: "SET_IN_POINT" })}>Set in</button><button type="button" onClick={() => dispatch({ type: "SET_OUT_POINT" })}>Set out</button>
          </div>
        </main>
        <aside className="aly-editor-shell__right-panel"><EditorInspector state={state} dispatch={dispatch} /></aside>
      </div>
      <EditorTimeline state={state} dispatch={dispatch} />
      <div id={statusId} className="aly-editor-shell__status" role="status" aria-live="polite">{state.announcement}</div>
    </div>
  );
}
