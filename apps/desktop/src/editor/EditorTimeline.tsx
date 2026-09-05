import { formatTimecode, framesToSeconds } from "./timecode";
import { defaultClipValues } from "./model";
import type { CSSProperties, Dispatch } from "react";
import type { EditorAction, EditorClip, EditorState, EditorTrack } from "./types";
import type { EditorWaveformPreview } from "./waveform";

export interface EditorTimelineProps {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
  waveforms?: Readonly<Record<string, EditorWaveformPreview>>;
}

type TimelineScrollStyle = CSSProperties & { "--aly-editor-timeline-width": string };

function clipLabel(clip: EditorClip, state: EditorState): string {
  const start = formatTimecode(clip.timelineRange.startFrame, state.project.frameRate);
  const end = formatTimecode(clip.timelineRange.startFrame + clip.timelineRange.durationFrames, state.project.frameRate);
  return `${clip.name}, ${clip.kind}, ${start} to ${end}`;
}

function TrackControls({ track, dispatch }: { track: EditorTrack; dispatch: Dispatch<EditorAction> }) {
  return (
    <div className="aly-editor-track__controls">
      <button type="button" className="aly-editor-track__select" onClick={() => dispatch({ type: "SELECT_TRACK", trackId: track.id })}>{track.name}</button>
      <div className="aly-editor-track__toggles">
        <button type="button" className={`aly-editor-track__toggle${track.locked ? " aly-editor-track__toggle--active" : ""}`} aria-pressed={track.locked} aria-label={`${track.locked ? "Unlock" : "Lock"} ${track.name}`} onClick={() => dispatch({ type: "UPDATE_TRACK", trackId: track.id, patch: { locked: !track.locked } })}>L</button>
        <button type="button" className={`aly-editor-track__toggle${track.muted ? " aly-editor-track__toggle--active" : ""}`} aria-pressed={track.muted} aria-label={`${track.muted ? "Unmute" : "Mute"} ${track.name}`} onClick={() => dispatch({ type: "UPDATE_TRACK", trackId: track.id, patch: { muted: !track.muted } })}>M</button>
        <button type="button" className={`aly-editor-track__toggle${track.solo ? " aly-editor-track__toggle--active" : ""}`} aria-pressed={track.solo} aria-label={`${track.solo ? "Unsolo" : "Solo"} ${track.name}`} onClick={() => dispatch({ type: "UPDATE_TRACK", trackId: track.id, patch: { solo: !track.solo } })}>S</button>
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

export function EditorTimeline({ state, dispatch, waveforms = {} }: EditorTimelineProps) {
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
  };

  return (
    <section className="aly-editor-timeline" aria-label="Multitrack timeline">
      <div className="aly-editor-timeline__toolbar">
        <div className="aly-editor-timeline__edit-tools" role="group" aria-label="Timeline edit tools">
          <button type="button" disabled={!textSpace("titles")} title="Add a title in an empty space at the playhead" onClick={() => addText("titles")}>Add title</button>
          <button type="button" disabled={!textSpace("captions")} title="Add a caption in an empty space at the playhead" onClick={() => addText("captions")}>Add caption</button>
          <button type="button" onClick={() => dispatch({ type: "SPLIT_SELECTED" })}>Split</button>
          <button type="button" disabled={state.selection.clipIds.length !== 1} onClick={() => dispatch({ type: "REORDER_CLIP", clipId: state.selection.clipIds[0]!, direction: "previous" })}>Earlier</button>
          <button type="button" disabled={state.selection.clipIds.length !== 1} onClick={() => dispatch({ type: "REORDER_CLIP", clipId: state.selection.clipIds[0]!, direction: "next" })}>Later</button>
          <button type="button" onClick={() => dispatch({ type: "LIFT_SELECTED" })}>Lift</button>
          <button type="button" onClick={() => dispatch({ type: "RIPPLE_DELETE_SELECTED" })}>Ripple delete</button>
          <button type="button" onClick={() => dispatch({ type: "EXTRACT_SELECTED_RANGE" })}>Extract range</button>
        </div>
        <div className="aly-editor-timeline__mode-tools" role="group" aria-label="Timeline modes">
          <button type="button" aria-pressed={state.view.snappingEnabled} onClick={() => dispatch({ type: "TOGGLE_SNAPPING" })}>Snap</button>
          <label className="aly-editor-timeline__zoom">Zoom
            <input type="range" min="12" max="240" value={state.view.pixelsPerSecond} onChange={(event) => dispatch({ type: "SET_ZOOM", pixelsPerSecond: Number(event.target.value) })} />
          </label>
        </div>
      </div>
      <div className="aly-editor-timeline__scroll" style={{ "--aly-editor-timeline-width": `${Math.max(900, seconds * state.view.pixelsPerSecond)}px` } as TimelineScrollStyle}>
        <div className="aly-editor-timeline__labels-spacer" aria-hidden="true" />
        <div className="aly-editor-ruler" aria-label="Time ruler">
          {ticks.map((second) => {
            const frame = Math.round(second * fps);
            return <button key={second} type="button" className="aly-editor-ruler__tick" style={{ left: `${frame / duration * 100}%` }} aria-label={`Move playhead to ${formatTimecode(frame, state.project.frameRate)}`} onClick={() => dispatch({ type: "SET_PLAYHEAD", frame })}><span>{formatTimecode(frame, state.project.frameRate).slice(0, 8)}</span></button>;
          })}
        </div>
        <div className="aly-editor-timeline__tracks">
          <div className="aly-editor-playhead" style={{ left: `calc(var(--aly-editor-track-label-width, 168px) + (100% - var(--aly-editor-track-label-width, 168px)) * ${playheadLeft / 100})` }} aria-hidden="true"><span /></div>
          {state.project.tracks.map((track) => (
            <div key={track.id} className={`aly-editor-track aly-editor-track--${track.kind}${track.hidden ? " aly-editor-track--hidden" : ""}`} data-track-id={track.id}>
              <TrackControls track={track} dispatch={dispatch} />
              <div className="aly-editor-track__lane" role="group" aria-label={`${track.name} track`} onDoubleClick={(event) => {
                if (event.target !== event.currentTarget) return;
                const rect = event.currentTarget.getBoundingClientRect();
                dispatch({ type: "SET_PLAYHEAD", frame: Math.round((event.clientX - rect.left) / rect.width * duration), snap: true });
              }}>
                {track.clips.map((clip) => <TimelineClip key={clip.id} clip={clip} state={state} dispatch={dispatch} {...(clip.assetId && waveforms[clip.assetId] ? { waveform: waveforms[clip.assetId] } : {})} />)}
                {!track.clips.length ? <span className="aly-editor-track__empty">Empty {track.name.toLowerCase()} track</span> : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
