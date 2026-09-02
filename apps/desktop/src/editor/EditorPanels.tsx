import { useEffect, useMemo, useRef, useState, type Dispatch } from "react";
import { selectedClips } from "./model";
import { describeEditProposal } from "./proposals";
import { formatTimecode } from "./timecode";
import type { EditProposal, EditorAction, EditorClip, EditorImportBatch, EditorMediaAsset, EditorState, ImportReceipt, InspectorProperty } from "./types";

export interface MediaBinProps {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
  onImportFiles?: ((files: readonly File[]) => Promise<EditorImportBatch>) | undefined;
  onCreateClipFromAsset?: ((asset: EditorMediaAsset, trackId: string, startFrame: number) => EditorClip | null) | undefined;
}

export function MediaBin({ state, dispatch, onImportFiles, onCreateClipFromAsset }: MediaBinProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const importFiles = async (files: FileList | null) => {
    if (!files?.length || !onImportFiles) return;
    setBusy(true);
    setError("");
    try {
      const batch = await onImportFiles([...files]);
      dispatch({ type: "IMPORT_RECEIPTS", receipts: batch.receipts, assets: batch.assets });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Media import failed before a receipt was returned.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const placeAsset = (asset: EditorMediaAsset) => {
    const targetTrackId = state.selection.trackId ?? state.project.tracks.find((track) => track.kind === "slides")?.id;
    if (!targetTrackId || !onCreateClipFromAsset) return;
    const clip = onCreateClipFromAsset(asset, targetTrackId, state.transport.playheadFrame);
    if (clip) dispatch({ type: "INSERT_CLIP", trackId: targetTrackId, clip });
  };

  return (
    <section className="aly-editor-media-bin" aria-labelledby="aly-editor-media-bin-title">
      <header className="aly-editor-panel__header">
        <div><span className="aly-editor-panel__eyebrow">Project media</span><h2 id="aly-editor-media-bin-title">Media bin</h2></div>
        {onImportFiles ? (
          <>
            <input ref={inputRef} className="aly-editor-media-bin__file-input" type="file" multiple aria-label="Import media files" disabled={busy} onChange={(event) => void importFiles(event.target.files)} />
            <button type="button" className="aly-editor-media-bin__import" disabled={busy} onClick={() => inputRef.current?.click()}>{busy ? "Importing…" : "Import media"}</button>
          </>
        ) : null}
      </header>
      {error ? <p className="aly-editor-media-bin__error" role="alert">{error}</p> : null}
      <div className="aly-editor-media-bin__assets" role="list" aria-label="Imported media">
        {state.project.assets.map((asset) => {
          const receipt = asset.importReceiptId ? state.project.importReceipts.find((candidate) => candidate.id === asset.importReceiptId) : undefined;
          const selected = state.selection.assetId === asset.id;
          return (
            <article key={asset.id} className={`aly-editor-media-card${selected ? " aly-editor-media-card--selected" : ""}`} role="listitem">
              <button type="button" className="aly-editor-media-card__select" aria-pressed={selected} onClick={() => dispatch({ type: "SELECT_ASSET", assetId: asset.id })}>
                <span className="aly-editor-media-card__preview" aria-hidden="true">
                  {asset.thumbnailUrl ? <img src={asset.thumbnailUrl} alt="" /> : <span>{asset.kind.slice(0, 1).toUpperCase()}</span>}
                </span>
                <span className="aly-editor-media-card__copy"><strong>{asset.name}</strong><span>{asset.kind} · {asset.durationFrames ? formatTimecode(asset.durationFrames, state.project.frameRate) : "Duration pending"}</span></span>
                <span className={`aly-editor-media-card__status aly-editor-media-card__status--${asset.status}`}>{asset.status}</span>
              </button>
              {onCreateClipFromAsset && asset.status === "ready" ? <button type="button" className="aly-editor-media-card__place" aria-label={`Place ${asset.name} at playhead`} onClick={() => placeAsset(asset)}>Place at playhead</button> : null}
              {receipt?.status === "failed" ? <span className="aly-editor-media-card__receipt-error">{receipt.errorMessage ?? "Import failed."}</span> : null}
            </article>
          );
        })}
        {!state.project.assets.length ? <div className="aly-editor-media-bin__empty">No media has been imported. This editor does not create placeholder media.</div> : null}
      </div>
      {state.project.importReceipts.length ? (
        <details className="aly-editor-media-bin__receipts">
          <summary>Import receipts ({state.project.importReceipts.length})</summary>
          <ul>{state.project.importReceipts.map((receipt: ImportReceipt) => <li key={receipt.id}><strong>{receipt.fileName}</strong><span>{receipt.status}{receipt.localOnly ? " · local only" : ""}</span></li>)}</ul>
        </details>
      ) : null}
    </section>
  );
}

function clipAtPlayhead(state: EditorState): EditorClip | null {
  const selected = selectedClips(state).find((clip) => state.transport.playheadFrame >= clip.timelineRange.startFrame && state.transport.playheadFrame < clip.timelineRange.startFrame + clip.timelineRange.durationFrames);
  if (selected) return selected;
  for (const track of [...state.project.tracks].reverse()) {
    if (track.hidden || track.muted) continue;
    const clip = track.clips.find((candidate) => candidate.enabled && state.transport.playheadFrame >= candidate.timelineRange.startFrame && state.transport.playheadFrame < candidate.timelineRange.startFrame + candidate.timelineRange.durationFrames);
    if (clip) return clip;
  }
  return null;
}

export function EditorCanvas({ state, dispatch }: { state: EditorState; dispatch: Dispatch<EditorAction> }) {
  const clip = clipAtPlayhead(state);
  const asset = clip?.assetId ? state.project.assets.find((candidate) => candidate.id === clip.assetId) : null;
  return (
    <section className="aly-editor-canvas-panel" aria-label="Canvas preview">
      <div className="aly-editor-canvas-toolbar">
        <span>{state.project.canvas.width} × {state.project.canvas.height}</span>
        <div role="group" aria-label="Canvas guides">
          {(["safe-action", "safe-title", "thirds", "center"] as const).map((guide) => <button key={guide} type="button" aria-pressed={state.view.guides.includes(guide)} onClick={() => dispatch({ type: "TOGGLE_GUIDE", guide })}>{guide.replace("-", " ")}</button>)}
        </div>
      </div>
      <div className="aly-editor-canvas-stage" style={{ aspectRatio: `${state.project.canvas.width} / ${state.project.canvas.height}`, backgroundColor: state.project.canvas.backgroundColor }} data-media-status={asset?.status ?? "none"}>
        {asset?.status === "ready" && asset.previewUrl && asset.kind === "image" ? <img className="aly-editor-canvas-stage__media" src={asset.previewUrl} alt={`Preview of ${asset.name}`} /> : null}
        {asset?.status === "ready" && asset.previewUrl && asset.kind === "video" ? <video className="aly-editor-canvas-stage__media" src={asset.previewUrl} muted aria-label={`Preview of ${asset.name}`} /> : null}
        {clip?.text ? <div className={`aly-editor-canvas-stage__text aly-editor-canvas-stage__text--${clip.kind}`} style={{ opacity: clip.opacity }}>{clip.text}</div> : null}
        {!clip ? <div className="aly-editor-canvas-stage__empty">No clip at the playhead</div> : null}
        {clip && asset?.status !== "ready" && !clip.text ? <div className="aly-editor-canvas-stage__empty">{asset ? `Media is ${asset.status}` : "No preview media is attached to this clip"}</div> : null}
        {state.view.guides.includes("safe-action") ? <div className="aly-editor-canvas-guide aly-editor-canvas-guide--safe-action" aria-hidden="true" /> : null}
        {state.view.guides.includes("safe-title") ? <div className="aly-editor-canvas-guide aly-editor-canvas-guide--safe-title" aria-hidden="true" /> : null}
        {state.view.guides.includes("thirds") ? <div className="aly-editor-canvas-guide aly-editor-canvas-guide--thirds" aria-hidden="true"><span /><span /><span /><span /></div> : null}
        {state.view.guides.includes("center") ? <div className="aly-editor-canvas-guide aly-editor-canvas-guide--center" aria-hidden="true"><span /><span /></div> : null}
      </div>
    </section>
  );
}

function NumberControl({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min?: number; max?: number; step?: number; onChange: (value: number) => void }) {
  return <label className="aly-editor-inspector__field"><span>{label}</span><input type="number" value={Number.isFinite(value) ? value : 0} step={step} {...(min !== undefined ? { min } : {})} {...(max !== undefined ? { max } : {})} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

const keyframeProperties: readonly InspectorProperty[] = ["transform.x", "transform.y", "transform.scaleX", "transform.scaleY", "transform.rotation", "opacity", "audio.volumeDb", "audio.pan"];

export function EditorInspector({ state, dispatch }: { state: EditorState; dispatch: Dispatch<EditorAction> }) {
  const clip = selectedClips(state)[0];
  const [keyframeProperty, setKeyframeProperty] = useState<InspectorProperty>("transform.x");
  if (!clip) return <section className="aly-editor-inspector" aria-labelledby="aly-editor-inspector-title"><header className="aly-editor-panel__header"><h2 id="aly-editor-inspector-title">Inspector</h2></header><div className="aly-editor-inspector__empty">Select a clip to inspect transform, audio, text, and keyframes.</div></section>;
  const updateTransform = (property: keyof EditorClip["transform"], value: number) => dispatch({ type: "UPDATE_SELECTED_CLIP", patch: { transform: { ...clip.transform, [property]: value } }, label: `Change ${property}` });
  const updateAudio = (property: keyof EditorClip["audio"], value: number | boolean) => dispatch({ type: "UPDATE_SELECTED_CLIP", patch: { audio: { ...clip.audio, [property]: value } }, label: `Change audio ${property}` });
  const propertyValue = (): number => {
    switch (keyframeProperty) {
      case "transform.x": return clip.transform.x;
      case "transform.y": return clip.transform.y;
      case "transform.scaleX": return clip.transform.scaleX;
      case "transform.scaleY": return clip.transform.scaleY;
      case "transform.rotation": return clip.transform.rotation;
      case "opacity": return clip.opacity;
      case "audio.volumeDb": return clip.audio.volumeDb;
      case "audio.pan": return clip.audio.pan;
    }
  };
  return (
    <section className="aly-editor-inspector" aria-labelledby="aly-editor-inspector-title">
      <header className="aly-editor-panel__header"><div><span className="aly-editor-panel__eyebrow">Selected clip</span><h2 id="aly-editor-inspector-title">{clip.name}</h2></div><span>{clip.kind}</span></header>
      <fieldset className="aly-editor-inspector__section"><legend>Timing</legend>
        <NumberControl label="Start frame" value={clip.timelineRange.startFrame} min={0} onChange={(frame) => dispatch({ type: "TRIM_CLIP", clipId: clip.id, edge: "start", frame })} />
        <NumberControl label="End frame" value={clip.timelineRange.startFrame + clip.timelineRange.durationFrames} min={clip.timelineRange.startFrame + 1} onChange={(frame) => dispatch({ type: "TRIM_CLIP", clipId: clip.id, edge: "end", frame })} />
      </fieldset>
      <fieldset className="aly-editor-inspector__section"><legend>Transform</legend>
        <NumberControl label="X" value={clip.transform.x} onChange={(value) => updateTransform("x", value)} /><NumberControl label="Y" value={clip.transform.y} onChange={(value) => updateTransform("y", value)} />
        <NumberControl label="Scale X" value={clip.transform.scaleX} min={0.01} step={0.05} onChange={(value) => updateTransform("scaleX", value)} /><NumberControl label="Scale Y" value={clip.transform.scaleY} min={0.01} step={0.05} onChange={(value) => updateTransform("scaleY", value)} />
        <NumberControl label="Rotation" value={clip.transform.rotation} step={0.5} onChange={(value) => updateTransform("rotation", value)} /><NumberControl label="Opacity" value={clip.opacity} min={0} max={1} step={0.05} onChange={(opacity) => dispatch({ type: "UPDATE_SELECTED_CLIP", patch: { opacity }, label: "Change opacity" })} />
      </fieldset>
      <fieldset className="aly-editor-inspector__section"><legend>Audio</legend>
        <NumberControl label="Volume dB" value={clip.audio.volumeDb} min={-60} max={12} step={0.5} onChange={(value) => updateAudio("volumeDb", value)} /><NumberControl label="Pan" value={clip.audio.pan} min={-1} max={1} step={0.05} onChange={(value) => updateAudio("pan", value)} />
        <label className="aly-editor-inspector__check"><input type="checkbox" checked={clip.audio.muted} onChange={(event) => updateAudio("muted", event.target.checked)} />Mute clip</label>
      </fieldset>
      {clip.text !== undefined ? <label className="aly-editor-inspector__text"><span>On-screen text</span><textarea value={clip.text} onChange={(event) => dispatch({ type: "UPDATE_SELECTED_CLIP", patch: { text: event.target.value }, label: "Edit clip text" })} /></label> : null}
      <fieldset className="aly-editor-inspector__section aly-editor-inspector__section--keyframes"><legend>Keyframes</legend>
        <div className="aly-editor-inspector__keyframe-add"><select value={keyframeProperty} aria-label="Keyframe property" onChange={(event) => setKeyframeProperty(event.target.value as InspectorProperty)}>{keyframeProperties.map((property) => <option key={property} value={property}>{property}</option>)}</select><button type="button" onClick={() => dispatch({ type: "ADD_KEYFRAME", clipId: clip.id, keyframe: { id: `${clip.id}-${keyframeProperty}-${state.transport.playheadFrame}`, property: keyframeProperty, frame: state.transport.playheadFrame, value: propertyValue(), interpolation: "ease-in-out" } })}>Add at playhead</button></div>
        <ul className="aly-editor-inspector__keyframes">{clip.keyframes.map((keyframe) => <li key={keyframe.id}><button type="button" onClick={() => dispatch({ type: "SET_PLAYHEAD", frame: keyframe.frame })}>{keyframe.property} · {formatTimecode(keyframe.frame, state.project.frameRate)}</button><select aria-label={`Interpolation for ${keyframe.property} at frame ${keyframe.frame}`} value={keyframe.interpolation} onChange={(event) => dispatch({ type: "UPDATE_KEYFRAME", clipId: clip.id, keyframeId: keyframe.id, patch: { interpolation: event.target.value as typeof keyframe.interpolation } })}><option value="hold">Hold</option><option value="linear">Linear</option><option value="ease-in">Ease in</option><option value="ease-out">Ease out</option><option value="ease-in-out">Ease in/out</option></select><button type="button" aria-label={`Remove ${keyframe.property} keyframe at frame ${keyframe.frame}`} onClick={() => dispatch({ type: "REMOVE_KEYFRAME", clipId: clip.id, keyframeId: keyframe.id })}>Remove</button></li>)}</ul>
      </fieldset>
    </section>
  );
}

function TranscriptCue({ clip, state, dispatch }: { clip: EditorClip; state: EditorState; dispatch: Dispatch<EditorAction> }) {
  const [text, setText] = useState(clip.text ?? "");
  const [speaker, setSpeaker] = useState(clip.speaker ?? "");
  useEffect(() => { setText(clip.text ?? ""); setSpeaker(clip.speaker ?? ""); }, [clip.id, clip.speaker, clip.text]);
  return (
    <li className="aly-editor-transcript__cue">
      <button type="button" className="aly-editor-transcript__time" onClick={() => { dispatch({ type: "SET_PLAYHEAD", frame: clip.timelineRange.startFrame }); dispatch({ type: "SELECT_CLIP", clipId: clip.id }); }}>{formatTimecode(clip.timelineRange.startFrame, state.project.frameRate)}</button>
      <label><span>Speaker</span><input value={speaker} onChange={(event) => setSpeaker(event.target.value)} /></label>
      <label><span>Transcript</span><textarea value={text} onChange={(event) => setText(event.target.value)} /></label>
      <button type="button" disabled={text === (clip.text ?? "") && speaker === (clip.speaker ?? "")} onClick={() => dispatch({ type: "SET_TRANSCRIPT", clipId: clip.id, text, speaker })}>Save cue</button>
    </li>
  );
}

export function TranscriptPanel({ state, dispatch }: { state: EditorState; dispatch: Dispatch<EditorAction> }) {
  const cues = state.project.tracks.filter((track) => track.kind === "captions" || track.kind === "narration").flatMap((track) => track.clips).sort((left, right) => left.timelineRange.startFrame - right.timelineRange.startFrame);
  return <section className="aly-editor-transcript" aria-labelledby="aly-editor-transcript-title"><header className="aly-editor-panel__header"><div><span className="aly-editor-panel__eyebrow">Dialogue and captions</span><h2 id="aly-editor-transcript-title">Transcript</h2></div><span>{cues.length} cues</span></header><ol className="aly-editor-transcript__list">{cues.map((clip) => <TranscriptCue key={clip.id} clip={clip} state={state} dispatch={dispatch} />)}</ol>{!cues.length ? <div className="aly-editor-transcript__empty">No caption or narration cues are present.</div> : null}</section>;
}

function ProposalCard({ proposal, state, dispatch }: { proposal: EditProposal; state: EditorState; dispatch: Dispatch<EditorAction> }) {
  const diff = useMemo(() => describeEditProposal(state.project, proposal), [proposal, state.project]);
  const expanded = state.activeProposalId === proposal.id;
  return <article className={`aly-editor-proposal aly-editor-proposal--${proposal.status}`}><header><div><span>{proposal.status}</span><h3>{proposal.title}</h3></div><button type="button" aria-expanded={expanded} onClick={() => dispatch({ type: "PREVIEW_PROPOSAL", proposalId: proposal.id })}>{expanded ? "Refresh preview" : "Preview changes"}</button></header><p>{proposal.summary}</p>{expanded ? <div className="aly-editor-proposal__diff"><strong>{diff.headline}</strong><ol>{diff.changes.map((change, index) => <li key={`${proposal.id}-${index}`}>{change}</li>)}</ol><div className="aly-editor-proposal__provenance"><h4>Provenance</h4><p>{diff.provenanceSummary}</p></div><div className="aly-editor-proposal__policy"><h4>Policy impact</h4><ul>{diff.policySummary.map((impact) => <li key={impact}>{impact}</li>)}</ul></div></div> : null}<footer><button type="button" onClick={() => dispatch({ type: "APPLY_PROPOSAL", proposalId: proposal.id })}>Apply</button><button type="button" onClick={() => dispatch({ type: "APPLY_PROPOSAL_TO_COPY", proposalId: proposal.id, copyId: `${state.project.id}-copy-${proposal.id}` })}>Apply to copy</button><button type="button" onClick={() => dispatch({ type: "REJECT_PROPOSAL", proposalId: proposal.id })}>Reject</button></footer></article>;
}

export function ProposalPanel({ state, dispatch }: { state: EditorState; dispatch: Dispatch<EditorAction> }) {
  return <section className="aly-editor-proposals" aria-labelledby="aly-editor-proposals-title"><header className="aly-editor-panel__header"><div><span className="aly-editor-panel__eyebrow">Review before mutation</span><h2 id="aly-editor-proposals-title">AI edit proposals</h2></div><span>{state.proposals.length}</span></header><div className="aly-editor-proposals__list">{state.proposals.map((proposal) => <ProposalCard key={proposal.id} proposal={proposal} state={state} dispatch={dispatch} />)}</div>{!state.proposals.length ? <div className="aly-editor-proposals__empty">No edit proposals are awaiting review. The editor will not invent proposal results.</div> : null}</section>;
}
