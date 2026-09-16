import { useEffect, useId, useReducer, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import {
  Captions,
  ChevronDown,
  ChevronUp,
  Clapperboard,
  FileJson,
  Film,
  Pause,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Redo2,
  Repeat,
  RotateCcw,
  SkipBack,
  SlidersHorizontal,
  Sparkles,
  Square,
  StepBack,
  StepForward,
  Undo2,
  Upload,
  X,
  type LucideIcon,
} from "lucide-react";
import "./editor.css";
import { clipCarriesProgrammeAudio } from "./audioPolicy";
import { BrowserMediaImportController, createBrowserClipFromAsset, downloadEditorProject, downloadOtioTimeline } from "./browserBridge";
import { EditorCanvas, EditorInspector, MediaBin, ProposalPanel, TranscriptPanel } from "./EditorPanels";
import { EditorTimeline } from "./EditorTimeline";
import { EditorIconButton, EditorTooltip } from "./EditorTooltip";
import { EDITOR_DOCK_MAX, EDITOR_DOCK_MIN, EDITOR_LAYOUT_DEFAULTS, EDITOR_TIMELINE_MAX, EDITOR_TIMELINE_MIN, clampDockWidth, clampTimelineHeight, loadEditorLayout, saveEditorLayout } from "./editorLayout";
import { createEditorState, selectedClips } from "./model";
import { exportOtioLike, parseEditorProject, parseOtioLike } from "./otio";
import { editorReducer } from "./reducer";
import { formatTimecode, nominalFramesPerSecond, parseTimecode } from "./timecode";
import type { EditorWaveformPreview } from "./waveform";
import type { EditProposal, EditorClip, EditorImportBatch, EditorMediaAsset, EditorProject, OtioLikeTimeline } from "./types";

export type EditorImportRights = "unknown" | "owned" | "licensed" | "publicDomain";

export interface AdvancedVideoEditorProps {
  project: EditorProject;
  proposals?: readonly EditProposal[];
  onProjectChange?: (project: EditorProject, revision: number) => void;
  onImportMedia?: (files: readonly File[]) => Promise<EditorImportBatch>;
  onCreateClipFromAsset?: (asset: EditorMediaAsset, trackId: string, startFrame: number) => EditorClip | null;
  onExportProject?: (project: EditorProject) => void | Promise<void>;
  onExportOtio?: (timeline: OtioLikeTimeline, project: EditorProject) => void | Promise<void>;
  onRenderTimeline?: (project: EditorProject) => Promise<{ message?: string; outputPath?: string; warnings?: readonly string[] }>;
  onResolveWaveform?: (asset: EditorMediaAsset) => Promise<EditorWaveformPreview>;
  onCreateProjectCopy?: (copy: EditorProject) => void | Promise<void>;
  allowProjectFileImport?: boolean;
  className?: string;
  editorLabel?: string;
  saveStatus?: ReactNode;
  importRightsValue?: EditorImportRights;
  onImportRightsChange?: (value: EditorImportRights) => void;
  onReturn?: () => void | Promise<void>;
  returning?: boolean;
}

function waveformAssets(project: EditorProject): EditorMediaAsset[] {
  const ids = new Set(project.tracks.flatMap((track) => track.clips.flatMap((clip) => {
    const carriesAudio = clipCarriesProgrammeAudio(track, clip);
    return carriesAudio && clip.enabled && clip.assetId ? [clip.assetId] : [];
  })));
  return project.assets.filter((asset) => ids.has(asset.id) && asset.status === "ready" && (asset.kind === "audio" || asset.kind === "video") && Boolean(asset.hash));
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

function WorkspaceSplitter({ orientation, label, value, min, max, onChange, inverted = false }: {
  orientation: "vertical" | "horizontal";
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  inverted?: boolean;
}) {
  const drag = useRef<{ origin: number; value: number } | null>(null);
  const clamp = (candidate: number) => Math.min(max, Math.max(min, Math.round(candidate)));
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      className={`aly-editor-splitter aly-editor-splitter--${orientation}`}
      onKeyDown={(event) => {
        const large = event.shiftKey ? 48 : 12;
        if (event.key === "ArrowLeft" || event.key === "ArrowUp") { event.preventDefault(); event.stopPropagation(); onChange(clamp(value - large)); }
        else if (event.key === "ArrowRight" || event.key === "ArrowDown") { event.preventDefault(); event.stopPropagation(); onChange(clamp(value + large)); }
        else if (event.key === "Home") { event.preventDefault(); event.stopPropagation(); onChange(min); }
        else if (event.key === "End") { event.preventDefault(); event.stopPropagation(); onChange(max); }
      }}
      onPointerDown={(event) => {
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        drag.current = { origin: orientation === "vertical" ? event.clientX : event.clientY, value };
      }}
      onPointerMove={(event) => {
        const active = drag.current;
        if (!active) return;
        const cursor = orientation === "vertical" ? event.clientX : event.clientY;
        const delta = inverted ? active.origin - cursor : cursor - active.origin;
        onChange(clamp(active.value + delta));
      }}
      onPointerUp={(event) => {
        drag.current = null;
        if ((event.currentTarget as HTMLElement).hasPointerCapture(event.pointerId)) (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => { drag.current = null; }}
    >
      <span aria-hidden="true" />
    </div>
  );
}

interface RailItem {
  id: "media" | "transcript" | "inspector" | "proposals";
  label: string;
  accessibleName: string;
  icon: LucideIcon;
  tooltip: ReactNode;
  badge?: string | undefined;
  dot?: boolean | undefined;
}

function RailButton({ item, active, onSelect }: { item: RailItem; active: boolean; onSelect: () => void }) {
  return (
    <EditorTooltip description={item.tooltip}>
      {({ ref, describedBy, handlers }) => (
        <button
          type="button"
          ref={ref as (element: HTMLButtonElement | null) => void}
          aria-label={item.accessibleName}
          aria-describedby={describedBy}
          aria-current={active ? "page" : undefined}
          onMouseEnter={handlers.onMouseEnter}
          onMouseLeave={handlers.onMouseLeave}
          onFocus={handlers.onFocus}
          onBlur={handlers.onBlur}
          onKeyDown={handlers.onKeyDown}
          onClick={onSelect}
          className={`aly-editor-rail__btn${active ? " is-active" : ""}`}
        >
          <item.icon size={18} aria-hidden="true" />
          <span aria-hidden="true">{item.label}</span>
          {item.dot ? <i className="aly-editor-rail__dot" aria-hidden="true" /> : null}
          {item.badge ? <em className="aly-editor-rail__badge" aria-hidden="true">{item.badge}</em> : null}
        </button>
      )}
    </EditorTooltip>
  );
}

export function AdvancedVideoEditor({
  project,
  proposals = [],
  onProjectChange,
  onImportMedia,
  onCreateClipFromAsset,
  onExportProject,
  onExportOtio,
  onRenderTimeline,
  onResolveWaveform,
  onCreateProjectCopy,
  allowProjectFileImport = true,
  className = "",
  editorLabel = "Advanced video editor",
  saveStatus,
  importRightsValue,
  onImportRightsChange,
  onReturn,
  returning = false,
}: AdvancedVideoEditorProps) {
  const [state, dispatch] = useReducer(editorReducer, undefined, () => createEditorState(project, proposals));
  const [projectImportError, setProjectImportError] = useState("");
  const [renderStatus, setRenderStatus] = useState("");
  const [rendering, setRendering] = useState(false);
  const [exportingDocument, setExportingDocument] = useState(false);
  const [documentExportStatus, setDocumentExportStatus] = useState<{ message: string; failed: boolean } | null>(null);
  const [layout, setLayout] = useState(loadEditorLayout);
  useEffect(() => { saveEditorLayout(layout); }, [layout]);
  useEffect(() => {
    const handleResize = () => {
      setLayout((current) => {
        const dockWidth = clampDockWidth(current.dockWidth);
        const timelineHeight = clampTimelineHeight(current.timelineHeight);
        return dockWidth === current.dockWidth && timelineHeight === current.timelineHeight
          ? current
          : { ...current, dockWidth, timelineHeight };
      });
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);
  const resetLayout = () => {
    setLayout((current) => ({ ...current, dockWidth: EDITOR_LAYOUT_DEFAULTS.dockWidth, timelineHeight: EDITOR_LAYOUT_DEFAULTS.timelineHeight, dockCollapsed: false, timelineCollapsed: false }));
  };
  const exportDocument = async (format: "editorJson" | "otio") => {
    if (exportingDocument) return;
    setExportingDocument(true);
    setDocumentExportStatus(null);
    try {
      const nativeExport = format === "editorJson" ? Boolean(onExportProject) : Boolean(onExportOtio);
      if (format === "editorJson") await (onExportProject ? onExportProject(state.project) : downloadEditorProject(state.project));
      else {
        const timeline = exportOtioLike(state.project);
        await (onExportOtio ? onExportOtio(timeline, state.project) : downloadOtioTimeline(timeline, state.project));
      }
      setDocumentExportStatus({ message: nativeExport ? "Document exported to the project's exports folder." : "Document download requested.", failed: false });
    } catch (error) {
      const message = typeof error === "string" ? error : error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message : "The document could not be saved. Try again.";
      setDocumentExportStatus({ message: `Document export failed: ${message}`, failed: true });
    } finally { setExportingDocument(false); }
  };
  const [waveforms, setWaveforms] = useState<Record<string, EditorWaveformPreview>>({});
  const projectInputRef = useRef<HTMLInputElement>(null);
  const onProjectChangeRef = useRef(onProjectChange);
  const onResolveWaveformRef = useRef(onResolveWaveform);
  const latestProjectRef = useRef(state.project);
  const deliveredRevision = useRef(state.revision);
  const deliveredCopyId = useRef<string | null>(null);
  const statusId = useId();
  const browserImport = useRef<BrowserMediaImportController | null>(null);
  if (!browserImport.current) browserImport.current = new BrowserMediaImportController(state.project.frameRate);
  const effectiveImportMedia = onImportMedia ?? ((files: readonly File[]) => browserImport.current!.importFiles(files));
  const effectiveCreateClip = onCreateClipFromAsset ?? ((asset: EditorMediaAsset, trackId: string, startFrame: number) => createBrowserClipFromAsset(asset, trackId, startFrame, state.project.frameRate));

  useEffect(() => {
    onProjectChangeRef.current = onProjectChange;
  }, [onProjectChange]);

  useEffect(() => {
    onResolveWaveformRef.current = onResolveWaveform;
  }, [onResolveWaveform]);

  latestProjectRef.current = state.project;
  const waveformKey = waveformAssets(state.project).map((asset) => `${asset.id}:${asset.hash}`).sort().join("|");
  useEffect(() => {
    const resolve = onResolveWaveformRef.current;
    const assets = waveformAssets(latestProjectRef.current);
    const activeIds = new Set(assets.map((asset) => asset.id));
    setWaveforms((current) => Object.fromEntries(Object.entries(current).filter(([id]) => activeIds.has(id))));
    if (!resolve) return;
    let cancelled = false;
    void Promise.allSettled(assets.map(async (asset) => ({ assetId: asset.id, preview: await resolve(asset) }))).then((results) => {
      if (cancelled) return;
      setWaveforms((current) => {
        const next = { ...current };
        for (const result of results) if (result.status === "fulfilled") next[result.value.assetId] = result.value.preview;
        return next;
      });
    });
    return () => { cancelled = true; };
  }, [waveformKey]);

  useEffect(() => {
    if (deliveredRevision.current === state.revision) return;
    deliveredRevision.current = state.revision;
    onProjectChangeRef.current?.(state.project, state.revision);
  }, [state.project, state.revision]);

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

  useEffect(() => () => browserImport.current?.dispose(), []);

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
      if (imported.id !== state.project.id) {
        imported = {
          ...imported,
          id: state.project.id,
          metadata: {
            ...imported.metadata,
            importedProjectId: imported.id,
            importedIntoProjectId: state.project.id,
          },
        };
      }
      dispatch({ type: "REPLACE_PROJECT", project: imported });
    } catch (error) {
      setProjectImportError(error instanceof Error ? error.message : "The project could not be imported.");
    } finally {
      if (projectInputRef.current) projectInputRef.current.value = "";
    }
  };

  const renderTimeline = async () => {
    if (!onRenderTimeline || rendering) return;
    setRendering(true);
    setRenderStatus("Rendering the edited timeline…");
    try {
      const receipt = await onRenderTimeline(state.project);
      setRenderStatus(`${receipt.outputPath ? `Timeline rendered to ${receipt.outputPath}` : receipt.message ?? "Timeline render queued."}${receipt.warnings?.length ? ` · ${receipt.warnings.join(" ")}` : ""}`);
    } catch (error) {
      setRenderStatus(error instanceof Error ? error.message : "The edited timeline could not be rendered.");
    } finally {
      setRendering(false);
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

  const selection = selectedClips(state);
  const selectedClip = selection[0] ?? null;
  const captionTrack = state.project.tracks.find((track) => track.kind === "captions");
  const narrationTrack = state.project.tracks.find((track) => track.kind === "narration");
  const cueCount = (captionTrack && captionTrack.clips.length ? captionTrack.clips : narrationTrack?.clips ?? []).length;
  const effectivePanel = state.view.activePanel === "proposals" && !state.proposals.length ? "media" : state.view.activePanel;
  const rail: RailItem[] = [
    { id: "media", label: "Media", accessibleName: "Media", icon: Film, tooltip: "Project media bin. Import verified media and place ready assets at the playhead." },
    { id: "transcript", label: "Script", accessibleName: "Transcript", icon: Captions, tooltip: cueCount ? `${cueCount} transcript cues. Edit cue text across most of this panel; timecodes stay compact.` : "Transcript. Caption or narration cues appear here for full-width editing.", badge: cueCount ? String(cueCount) : undefined },
    { id: "inspector", label: "Inspect", accessibleName: "Inspector", icon: SlidersHorizontal, tooltip: selectedClip ? `Inspector. ${selectedClip.name} is selected; edit timing, transform, audio, text, and keyframes.` : "Inspector. Select a clip in the preview or timeline to edit its properties.", dot: selection.length > 0 },
  ];
  if (state.proposals.length) {
    rail.push({ id: "proposals", label: "Plans", accessibleName: "AI proposals", icon: Sparkles, tooltip: `${state.proposals.length} edit proposals awaiting review. Nothing applies until you accept it.`, badge: String(state.proposals.length) });
  }
  const canUndo = state.versionIndex >= 0;
  const canRedo = state.versionIndex < state.versions.length - 1;
  const frameRateValue = state.project.frameRate.numerator / state.project.frameRate.denominator;

  return (
    <div className={`aly-editor-shell${className ? ` ${className}` : ""}`} role="application" aria-label={editorLabel} aria-describedby={statusId} tabIndex={0} onKeyDown={onEditorKeyDown}>
      <header className="aly-editor-shell__topbar">
        <div className="aly-editor-shell__identity">
          {onReturn ? (
            <EditorIconButton
              icon={X}
              label={returning ? "Saving editor changes" : "Return to scene"}
              tooltip={returning ? "Saving the timeline. The editor stays open until the save finishes." : "Save the timeline and return to the scene workspace."}
              disabled={returning}
              onClick={() => { void onReturn(); }}
              className="aly-editor-shell__return"
            />
          ) : null}
          <div className="aly-editor-shell__titlewrap">
            <span className="aly-editor-shell__eyebrow">Finishing room · {state.project.canvas.width}×{state.project.canvas.height} · {frameRateValue} fps</span>
            <h1 title={state.project.name}>{state.project.name}</h1>
          </div>
          {saveStatus ? <span className="aly-editor-shell__savestate">{saveStatus}</span> : null}
          <span className="aly-editor-shell__revision">Revision {state.revision}</span>
        </div>
        <div className="aly-editor-shell__actions" role="group" aria-label="Editor document actions">
          <span className="aly-editor-shell__actiongroup" role="group" aria-label="Edit history">
            <EditorIconButton icon={Undo2} label="Undo last edit" tooltip="Undo the last edit. Every undo is itself reversible with redo." shortcut="Ctrl+Z" disabled={!canUndo} disabledReason="There is nothing to undo yet." onClick={() => dispatch({ type: "UNDO" })} />
            <EditorIconButton icon={Redo2} label="Redo last edit" tooltip="Redo the undone edit." shortcut="Ctrl+Shift+Z" disabled={!canRedo} disabledReason="There is nothing to redo." onClick={() => dispatch({ type: "REDO" })} />
          </span>
          {onImportRightsChange ? (
            <label className="aly-editor-shell__rights">
              <span className="aly-editor-sr-only">Rights for new editor media</span>
              <EditorTooltip description="Rights applied to media you import from here. This travels with the asset; it never changes your provider routes.">
                {({ ref, describedBy, handlers }) => (
                  <span
                    className="aly-editor-shell__rights-tip"
                    ref={ref as (element: HTMLSpanElement | null) => void}
                    aria-describedby={describedBy}
                    onMouseEnter={handlers.onMouseEnter}
                    onMouseLeave={handlers.onMouseLeave}
                    onFocus={handlers.onFocus}
                    onBlur={handlers.onBlur}
                    onKeyDown={handlers.onKeyDown}
                  >
                    Rights
                  </span>
                )}
              </EditorTooltip>
              <select aria-label="Rights for new editor media" value={importRightsValue ?? "unknown"} onChange={(event) => onImportRightsChange(event.target.value as EditorImportRights)}>
                <option value="unknown">Not reviewed · preview only</option>
                <option value="owned">I own the media</option>
                <option value="licensed">Licensed for distribution</option>
                <option value="publicDomain">Public domain</option>
              </select>
            </label>
          ) : null}
          <span className="aly-editor-shell__actiongroup" role="group" aria-label="Project import and export">
            {allowProjectFileImport ? (
              <>
                <input ref={projectInputRef} className="aly-editor-shell__project-input" type="file" accept="application/json,.json,.otio" aria-label="Import editor project file" onChange={(event) => void importProjectFile(event.target.files?.[0])} />
                <EditorIconButton icon={Upload} label="Import project" tooltip="Import an editor JSON or OTIO file into this project. The open project keeps its identity; the file is treated as provenance." onClick={() => projectInputRef.current?.click()} />
              </>
            ) : null}
            <EditorIconButton icon={FileJson} label="Export project JSON" tooltip={onExportProject ? "Export the editor document to this project's exports folder." : "Download the editor document as JSON."} disabled={exportingDocument} disabledReason="An export is already running." onClick={() => void exportDocument("editorJson")} />
            <EditorIconButton icon={Clapperboard} label="Export OTIO" tooltip={onExportOtio ? "Export an OTIO interchange timeline to this project's exports folder." : "Download an OTIO interchange timeline."} disabled={exportingDocument} disabledReason="An export is already running." onClick={() => void exportDocument("otio")} />
            {onRenderTimeline ? (
              <button type="button" className="aly-editor-shell__render" aria-label="Render timeline" disabled={rendering} onClick={() => void renderTimeline()}>
                {rendering ? <Square size={13} aria-hidden="true" /> : <Play size={13} aria-hidden="true" />}
                {rendering ? "Rendering…" : "Render"}
              </button>
            ) : null}
          </span>
        </div>
      </header>
      {projectImportError ? <div className="aly-editor-shell__import-error" role="alert">{projectImportError}</div> : null}
      {documentExportStatus ? <div className="aly-editor-shell__import-error" role={documentExportStatus.failed ? "alert" : "status"}>{documentExportStatus.message}</div> : null}

      <div
        className={`aly-editor-shell__workspace${layout.dockCollapsed ? " is-dock-collapsed" : ""}`}
        style={{ "--aly-editor-dock-width": `${layout.dockCollapsed ? 0 : layout.dockWidth}px` } as CSSProperties}
      >
        <nav className="aly-editor-rail" aria-label="Editor side panels">
          {rail.map((item) => <RailButton key={item.id} item={item} active={effectivePanel === item.id} onSelect={() => {
            if (layout.dockCollapsed) setLayout((current) => ({ ...current, dockCollapsed: false }));
            dispatch({ type: "SET_ACTIVE_PANEL", panel: item.id });
          }} />)}
          <span className="aly-editor-rail__spacer" aria-hidden="true" />
          <EditorIconButton
            icon={layout.dockCollapsed ? PanelLeftOpen : PanelLeftClose}
            label={layout.dockCollapsed ? "Expand side panel" : "Collapse side panel"}
            tooltip={layout.dockCollapsed ? "Reopen the side panel at its previous width." : "Collapse the side panel to give the preview the full width. Your place and drafts are kept."}
            onClick={() => setLayout((current) => ({ ...current, dockCollapsed: !current.dockCollapsed }))}
          />
        </nav>
        <div className="aly-editor-dock" hidden={layout.dockCollapsed}>
          <div className="aly-editor-dock__body">
            <div className="aly-editor-dock__page" hidden={effectivePanel !== "media"}>
              <MediaBin state={state} dispatch={dispatch} onImportFiles={effectiveImportMedia} onCreateClipFromAsset={effectiveCreateClip} />
            </div>
            <div className="aly-editor-dock__page" hidden={effectivePanel !== "transcript"}>
              <TranscriptPanel state={state} dispatch={dispatch} />
            </div>
            <div className="aly-editor-dock__page" hidden={effectivePanel !== "inspector"}>
              <EditorInspector state={state} dispatch={dispatch} />
            </div>
            {state.proposals.length ? (
              <div className="aly-editor-dock__page" hidden={effectivePanel !== "proposals"}>
                <ProposalPanel state={state} dispatch={dispatch} />
              </div>
            ) : null}
          </div>
          <div className="aly-editor-dock__footer">
            {selectedClip ? (
              <button type="button" className="aly-editor-dock__inspect" onClick={() => dispatch({ type: "SET_ACTIVE_PANEL", panel: "inspector" })}>
                Inspect {selectedClip.name}
              </button>
            ) : <span className="aly-editor-dock__hint">Select a clip to inspect it</span>}
            <button
              type="button"
              className="aly-editor-dock__reset"
              onClick={resetLayout}
            >
              <RotateCcw size={12} aria-hidden="true" /> Reset layout
            </button>
          </div>
        </div>
        {layout.dockCollapsed ? null : (
          <WorkspaceSplitter
            orientation="vertical"
            label="Resize side panel width"
            value={layout.dockWidth}
            min={EDITOR_DOCK_MIN}
            max={EDITOR_DOCK_MAX}
            onChange={(dockWidth) => setLayout((current) => ({ ...current, dockWidth: clampDockWidth(dockWidth) }))}
          />
        )}
        <main className="aly-editor-shell__center">
          <EditorCanvas state={state} dispatch={dispatch} />
          <div className="aly-editor-transport" role="group" aria-label="Playback transport">
            <EditorIconButton icon={SkipBack} label="Go to start" tooltip="Jump to the in point, or to the timeline start when no in point is set." onClick={() => dispatch({ type: "SET_PLAYHEAD", frame: state.transport.inFrame ?? 0 })} />
            <EditorIconButton icon={StepBack} label="Step backward one frame" tooltip="Move the playhead back one frame." shortcut="←" onClick={() => dispatch({ type: "SET_PLAYHEAD", frame: state.transport.playheadFrame - 1 })} />
            <EditorIconButton
              icon={state.transport.status === "playing" ? Pause : Play}
              label={state.transport.status === "playing" ? "Pause playback" : "Play"}
              tooltip={state.transport.status === "playing" ? "Pause playback. Composite scene audio pauses with it." : "Play from the playhead. What you hear matches the audible tracks."}
              shortcut="Space"
              pressed={state.transport.status === "playing"}
              onClick={() => dispatch({ type: "TRANSPORT_TOGGLE" })}
            />
            <EditorIconButton icon={StepForward} label="Step forward one frame" tooltip="Move the playhead forward one frame. Hold Shift with arrow keys to jump a second." shortcut="→" onClick={() => dispatch({ type: "SET_PLAYHEAD", frame: state.transport.playheadFrame + 1 })} />
            <EditorIconButton icon={Square} label="Stop playback" tooltip="Stop playback and return to the in point (or the start)." shortcut="K pauses" onClick={() => dispatch({ type: "TRANSPORT_STOP" })} />
            <TimecodeControl value={state.transport.playheadFrame} rate={state.project.frameRate} onCommit={(frame) => dispatch({ type: "SET_PLAYHEAD", frame })} />
            <EditorIconButton icon={Repeat} label="Loop playback" tooltip="Loop between the in and out points while playing." pressed={state.transport.loop} onClick={() => dispatch({ type: "TOGGLE_LOOP" })} />
            <label className="aly-editor-transport__rate"><span>Speed</span><select value={state.transport.playbackRate} aria-label="Playback speed" onChange={(event) => dispatch({ type: "SET_PLAYBACK_RATE", rate: Number(event.target.value) })}><option value="0.5">0.5×</option><option value="1">1×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label>
            <button type="button" onClick={() => dispatch({ type: "SET_IN_POINT" })}>Set in</button><button type="button" onClick={() => dispatch({ type: "SET_OUT_POINT" })}>Set out</button>
          </div>
        </main>
      </div>
      <div className={`aly-editor-shell__timelinewrap${layout.timelineCollapsed ? " is-collapsed" : ""}`} style={layout.timelineCollapsed ? undefined : { height: layout.timelineHeight }}>
        {layout.timelineCollapsed ? null : (
          <WorkspaceSplitter
            orientation="horizontal"
            label="Resize timeline height"
            value={layout.timelineHeight}
            min={EDITOR_TIMELINE_MIN}
            max={EDITOR_TIMELINE_MAX}
            inverted
            onChange={(timelineHeight) => setLayout((current) => ({ ...current, timelineHeight: clampTimelineHeight(timelineHeight) }))}
          />
        )}
        <EditorTimeline
          state={state}
          dispatch={dispatch}
          waveforms={waveforms}
          collapsed={layout.timelineCollapsed}
          onToggleCollapse={() => setLayout((current) => ({ ...current, timelineCollapsed: !current.timelineCollapsed }))}
          hideEmptyTracks={layout.hideEmptyTracks}
          onToggleEmptyTracks={() => setLayout((current) => ({ ...current, hideEmptyTracks: !current.hideEmptyTracks }))}
          onResetLayout={resetLayout}
          collapseControl={
            <EditorIconButton
              icon={layout.timelineCollapsed ? ChevronUp : ChevronDown}
              label={layout.timelineCollapsed ? "Expand timeline" : "Collapse timeline"}
              tooltip={layout.timelineCollapsed ? "Reopen the timeline at its previous height." : "Collapse the timeline to give the preview full height. Clips and the playhead are kept."}
              onClick={() => setLayout((current) => ({ ...current, timelineCollapsed: !current.timelineCollapsed }))}
            />
          }
        />
      </div>
      <div id={statusId} className="aly-editor-shell__status" role="status" aria-live="polite">{renderStatus || state.announcement}</div>
    </div>
  );
}
