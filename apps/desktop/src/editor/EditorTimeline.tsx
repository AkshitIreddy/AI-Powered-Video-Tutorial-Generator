import { formatTimecode, framesToSeconds } from "./timecode";
import { defaultClipValues } from "./model";
import type { CSSProperties, Dispatch, ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Captions,
  Ear,
  EarOff,
  Eye,
  EyeOff,
  Focus,
  ListFilter,
  Lock,
  LockOpen,
  Magnet,
  RotateCcw,
  Scissors,
  Slice,
  Trash2,
  Type,
  Volume2,
  VolumeX,
} from "lucide-react";
import { EditorIconButton } from "./EditorTooltip";
import type { EditorAction, EditorClip, EditorState, EditorTrack } from "./types";
import type { EditorWaveformPreview } from "./waveform";

export interface EditorTimelineProps {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
  waveforms?: Readonly<Record<string, EditorWaveformPreview>>;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  hideEmptyTracks?: boolean;
  onToggleEmptyTracks?: () => void;
  onResetLayout?: () => void;
  collapseControl?: ReactNode;
}

type TimelineScrollStyle = CSSProperties & { "--aly-editor-timeline-width": string };

function clipLabel(clip: EditorClip, state: EditorState): string {
  const start = formatTimecode(clip.timelineRange.startFrame, state.project.frameRate);
  const end = formatTimecode(clip.timelineRange.startFrame + clip.timelineRange.durationFrames, state.project.frameRate);
  return `${clip.name}, ${clip.kind}, ${start} to ${end}`;
}

function TrackControls({ track, dispatch }: { track: EditorTrack; dispatch: Dispatch<EditorAction> }) {
  const canCarryAudio = track.kind !== "titles" && track.kind !== "captions";
  return (
    <div className="aly-editor-track__controls">
      <button type="button" className="aly-editor-track__select" title={`Select the ${track.name} track`} onClick={() => dispatch({ type: "SELECT_TRACK", trackId: track.id })}>{track.name}</button>
      <div className="aly-editor-track__toggles">
        <EditorIconButton
          icon={track.locked ? Lock : LockOpen}
          label={`Lock ${track.name}`}
          tooltip={track.locked ? `Unlock the ${track.name} track so its clips can be edited again.` : `Lock the ${track.name} track to protect its clips from edits.`}
          pressed={track.locked}
          iconSize={13}
          onClick={() => dispatch({ type: "UPDATE_TRACK", trackId: track.id, patch: { locked: !track.locked } })}
        />
        <EditorIconButton
          icon={track.hidden ? EyeOff : Eye}
          label={`Hide ${track.name}`}
          tooltip={track.hidden ? `Show the ${track.name} track in the preview and renders.` : `Hide the ${track.name} track from the preview and renders. Clips are kept.`}
          pressed={track.hidden}
          iconSize={13}
          onClick={() => dispatch({ type: "UPDATE_TRACK", trackId: track.id, patch: { hidden: !track.hidden } })}
        />
        {canCarryAudio ? (
          <EditorIconButton
            icon={track.muted ? VolumeX : Volume2}
            label={`Mute ${track.name}`}
            tooltip={track.muted ? `Unmute the ${track.name} track.` : `Mute the ${track.name} track in preview and renders. Clips are kept.`}
            pressed={track.muted}
            iconSize={13}
            onClick={() => dispatch({ type: "UPDATE_TRACK", trackId: track.id, patch: { muted: !track.muted } })}
          />
        ) : null}
        {canCarryAudio ? (
          <EditorIconButton
            icon={track.solo ? Ear : EarOff}
            label={`Solo ${track.name}`}
            tooltip={track.solo ? `Stop soloing the ${track.name} track; other audible tracks return.` : `Solo the ${track.name} track to hear only it in preview and renders.`}
            pressed={track.solo}
            iconSize={13}
            onClick={() => dispatch({ type: "UPDATE_TRACK", trackId: track.id, patch: { solo: !track.solo } })}
          />
        ) : null}
      </div>
    </div>
  );
}

function TimelineClip({ clip, state, dispatch, waveform }: { clip: EditorClip; state: EditorState; dispatch: Dispatch<EditorAction>; waveform?: EditorWaveformPreview }) {
  const duration = Math.max(1, state.project.durationFrames);
  const left = clip.timelineRange.startFrame / duration * 100;
  const width = Math.max(0.5, clip.timelineRange.durationFrames / duration * 100);
  const selected = state.selection.clipIds.includes(clip.id);
  const waveformFits = waveform && clip.sourceRange.startFrame + clip.sourceRange.durationFrames <= waveform.durationFrames;
  return (
    <button
      type="button"
      className={`aly-editor-clip aly-editor-clip--${clip.kind}${selected ? " aly-editor-clip--selected" : ""}${clip.locked ? " aly-editor-clip--locked" : ""}`}
      style={{ left: `${left}%`, width: `${width}%`, ...(clip.color ? { "--aly-editor-clip-color": clip.color } : {}) }}
      aria-label={clipLabel(clip, state)}
      aria-pressed={selected}
      data-clip-id={clip.id}
      onClick={(event) => dispatch({ type: "SELECT_CLIP", clipId: clip.id, additive: event.ctrlKey || event.metaKey || event.shiftKey })}
      onDoubleClick={() => dispatch({ type: "SET_PLAYHEAD", frame: clip.timelineRange.startFrame })}
    >
      <span className="aly-editor-clip__edge aly-editor-clip__edge--start" aria-hidden="true" />
      {waveformFits ? <span className="aly-editor-clip__waveform" aria-hidden="true" data-testid={`waveform-${clip.id}`}><img src={waveform.url} alt="" draggable={false} style={{ left: `${-clip.sourceRange.startFrame / clip.sourceRange.durationFrames * 100}%`, width: `${waveform.durationFrames / clip.sourceRange.durationFrames * 100}%` }} /></span> : null}
      <span className="aly-editor-clip__copy">
        <strong>{clip.name}</strong>
        <span>{clip.text || `${framesToSeconds(clip.timelineRange.durationFrames, state.project.frameRate).toFixed(1)}s`}</span>
      </span>
      <span className="aly-editor-clip__keyframes" aria-hidden="true">
        {clip.keyframes.map((keyframe) => (
          <span key={keyframe.id} className="aly-editor-clip__keyframe" style={{ left: `${Math.max(0, Math.min(100, (keyframe.frame - clip.timelineRange.startFrame) / clip.timelineRange.durationFrames * 100))}%` }} />
        ))}
      </span>
      <span className="aly-editor-clip__edge aly-editor-clip__edge--end" aria-hidden="true" />
    </button>
  );
}

export function EditorTimeline({ state, dispatch, waveforms = {}, collapsed = false, hideEmptyTracks = false, onToggleEmptyTracks, onResetLayout, collapseControl }: EditorTimelineProps) {
  const duration = Math.max(1, state.project.durationFrames);
  const fps = state.project.frameRate.numerator / state.project.frameRate.denominator;
  const seconds = Math.max(1, Math.ceil(duration / fps));
  const tickStep = seconds > 600 ? 60 : seconds > 180 ? 30 : seconds > 60 ? 10 : seconds > 20 ? 5 : 1;
  const ticks = Array.from({ length: Math.min(200, Math.floor(seconds / tickStep) + 1) }, (_, index) => index * tickStep);
  const playheadLeft = state.transport.playheadFrame / duration * 100;
  const textSpace = (kind: "titles" | "captions") => {
    const track = state.project.tracks.find((candidate) => candidate.kind === kind);
    const start = state.transport.playheadFrame;
    if (!track || track.locked || track.clips.some((clip) => clip.timelineRange.startFrame <= start && clip.timelineRange.startFrame + clip.timelineRange.durationFrames > start)) return null;
    const nextStart = Math.min(...track.clips.filter((clip) => clip.timelineRange.startFrame > start).map((clip) => clip.timelineRange.startFrame));
    const remaining = state.project.durationFrames > start ? state.project.durationFrames - start : Math.round(3 * fps);
    return { track, start, length: Math.max(1, Math.min(Math.round(3 * fps), remaining, nextStart - start)) };
  };
  const addText = (kind: "titles" | "captions") => {
    const space = textSpace(kind);
    if (!space) return;
    const clip: EditorClip = {
      ...defaultClipValues(),
      id: `user-${kind}-${crypto.randomUUID()}`,
      trackId: space.track.id,
      kind,
      name: kind === "titles" ? "New title" : "New caption",
      assetId: null,
      timelineRange: { startFrame: space.start, durationFrames: space.length },
      sourceRange: { startFrame: 0, durationFrames: space.length },
      text: kind === "titles" ? "Your title" : "Your caption",
      textStyle: { fontFamily: "Arial", fontSize: kind === "titles" ? 48 : 42, fontWeight: 400, color: "#ffffff", backgroundColor: "#151827", align: "center", position: "bottom" },
      metadata: { userCreatedText: true },
    };
    dispatch({ type: "INSERT_CLIP", trackId: space.track.id, clip });
    dispatch({ type: "SELECT_CLIP", clipId: clip.id });
    dispatch({ type: "SET_ACTIVE_PANEL", panel: "inspector" });
  };
  const canReorder = state.selection.clipIds.length === 1;
  const reorderReason = canReorder ? undefined : state.selection.clipIds.length === 0 ? "Select a clip in the timeline first." : "Select exactly one clip to reorder it.";
  const emptyTracks = state.project.tracks.filter((track) => track.clips.length === 0);
  const visibleTracks = hideEmptyTracks ? state.project.tracks.filter((track) => track.clips.length > 0) : state.project.tracks;

  return (
    <section className="aly-editor-timeline" aria-label="Multitrack timeline">
      <div className="aly-editor-timeline__toolbar">
        <div className="aly-editor-timeline__edit-tools" role="group" aria-label="Timeline edit tools">
          <EditorIconButton icon={Type} label="Add title" tooltip="Add a title in the empty space at the playhead, then edit it in the inspector." disabled={!textSpace("titles")} disabledReason="No empty title space at the playhead." onClick={() => addText("titles")} />
          <EditorIconButton icon={Captions} label="Add caption" tooltip="Add a caption in the empty space at the playhead." disabled={!textSpace("captions")} disabledReason="No empty caption space at the playhead." onClick={() => addText("captions")} />
          <EditorIconButton icon={Scissors} label="Split" tooltip="Split every selected clip at the playhead. Clips that do not cross the playhead are left alone." shortcut="S" onClick={() => dispatch({ type: "SPLIT_SELECTED" })} />
          <EditorIconButton icon={ArrowUpFromLine} label="Earlier" tooltip="Move the selected clip earlier in its track." disabled={!canReorder} disabledReason={reorderReason} onClick={() => { const id = state.selection.clipIds[0]; if (id) dispatch({ type: "REORDER_CLIP", clipId: id, direction: "previous" }); }} />
          <EditorIconButton icon={ArrowDownToLine} label="Later" tooltip="Move the selected clip later in its track." disabled={!canReorder} disabledReason={reorderReason} onClick={() => { const id = state.selection.clipIds[0]; if (id) dispatch({ type: "REORDER_CLIP", clipId: id, direction: "next" }); }} />
          <EditorIconButton icon={Slice} label="Lift" tooltip="Lift the selected clips, leaving a gap. The timeline does not close up." shortcut="Delete" onClick={() => dispatch({ type: "LIFT_SELECTED" })} />
          <EditorIconButton icon={Trash2} label="Ripple delete" tooltip="Delete the selected clips and close the gap. Later clips shift earlier; this cannot be undone except with Undo." shortcut="Shift+Delete" onClick={() => dispatch({ type: "RIPPLE_DELETE_SELECTED" })} />
          <EditorIconButton icon={Focus} label="Extract range" tooltip="Remove everything between the first and last selected clip across all tracks and close the gap." onClick={() => dispatch({ type: "EXTRACT_SELECTED_RANGE" })} />
        </div>
        <div className="aly-editor-timeline__mode-tools" role="group" aria-label="Timeline modes">
          <EditorIconButton icon={Magnet} label="Snap" tooltip="Snap edits to clip edges and the playhead." pressed={state.view.snappingEnabled} onClick={() => dispatch({ type: "TOGGLE_SNAPPING" })} />
          {onToggleEmptyTracks ? (
            <EditorIconButton icon={ListFilter} label="Hide empty tracks" tooltip={hideEmptyTracks ? `Bring back the ${emptyTracks.length} hidden empty tracks. No track data was deleted.` : "Hide tracks that have no clips to give the timeline room. Tracks and their settings are kept."} pressed={hideEmptyTracks} onClick={onToggleEmptyTracks} />
          ) : null}
          <label className="aly-editor-timeline__zoom">Zoom
            <input type="range" min="12" max="240" value={state.view.pixelsPerSecond} aria-label="Timeline zoom" onChange={(event) => dispatch({ type: "SET_ZOOM", pixelsPerSecond: Number(event.target.value) })} />
          </label>
          {onResetLayout ? (
            <EditorIconButton icon={RotateCcw} label="Reset panel layout" tooltip="Restore the default side-panel width and timeline height." onClick={onResetLayout} />
          ) : null}
          {collapseControl}
        </div>
      </div>
      {collapsed ? null : (
      <div className="aly-editor-timeline__scroll" style={{ "--aly-editor-timeline-width": `${Math.max(900, seconds * state.view.pixelsPerSecond)}px` } as TimelineScrollStyle}>
        <div className="aly-editor-timeline__labels-spacer" aria-hidden="true" />
        <div className="aly-editor-ruler" aria-label="Time ruler">
          {ticks.map((second) => {
            const frame = Math.round(second * fps);
            return <button key={second} type="button" className="aly-editor-ruler__tick" style={{ left: `${frame / duration * 100}%` }} aria-label={`Move playhead to ${formatTimecode(frame, state.project.frameRate)}`} onClick={() => dispatch({ type: "SET_PLAYHEAD", frame })}><span>{formatTimecode(frame, state.project.frameRate).slice(0, 8)}</span></button>;
          })}
        </div>
        <div className="aly-editor-timeline__tracks">
          <div className="aly-editor-playhead" style={{ left: `calc(var(--aly-editor-track-label-width, 216px) + (100% - var(--aly-editor-track-label-width, 216px)) * ${playheadLeft / 100})` }} aria-hidden="true"><span /></div>
          {visibleTracks.map((track) => (
            <div key={track.id} className={`aly-editor-track aly-editor-track--${track.kind}${track.hidden ? " aly-editor-track--hidden" : ""}${track.clips.length === 0 ? " aly-editor-track--empty" : ""}`} data-track-id={track.id}>
              <TrackControls track={track} dispatch={dispatch} />
              <div className="aly-editor-track__lane" role="group" aria-label={`${track.name} track`} onDoubleClick={(event) => {
                if (event.target !== event.currentTarget) return;
                const rect = event.currentTarget.getBoundingClientRect();
                dispatch({ type: "SET_PLAYHEAD", frame: Math.round((event.clientX - rect.left) / rect.width * duration), snap: true });
              }}>
                {!track.hidden ? track.clips.map((clip) => <TimelineClip key={clip.id} clip={clip} state={state} dispatch={dispatch} {...(clip.assetId && waveforms[clip.assetId] ? { waveform: waveforms[clip.assetId] } : {})} />) : null}
                {!track.clips.length ? <span className="aly-editor-track__empty">Empty · clips placed at the playhead land here</span> : null}
              </div>
            </div>
          ))}
        </div>
        {hideEmptyTracks && emptyTracks.length ? (
          <p className="aly-editor-timeline__hidden-note" role="status">
            {emptyTracks.length} empty {emptyTracks.length === 1 ? "track" : "tracks"} hidden ({emptyTracks.map((track) => track.name).join(", ")}).
            {onToggleEmptyTracks ? <button type="button" onClick={onToggleEmptyTracks}>Show empty tracks</button> : null}
          </p>
        ) : null}
      </div>
      )}
    </section>
  );
}
