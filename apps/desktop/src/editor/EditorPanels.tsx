import { readTranscriptDraft, writeTranscriptDraft } from "./transcriptDrafts";
import { useEffect, useMemo, useRef, useState, type Dispatch } from "react";
import { Check, Crosshair, Grid3x3, Pencil, Scan, Type, Upload, User, UserPlus, X } from "lucide-react";
import { clipCarriesProgrammeAudio, isClipAudible } from "./audioPolicy";
import { selectedClips } from "./model";
import { describeEditProposal } from "./proposals";
import { previewCanvasScale, previewMediaShouldSeek, previewStyleAtFrame, resolvedTextStyle, textPreviewStyleAtFrame, volumeAtFrame, type PreviewCanvasScale } from "./preview";
import { formatTimecode, framesToSeconds } from "./timecode";
import { EditorIconButton, EditorTooltip } from "./EditorTooltip";
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
  const [showLibraryReferences, setShowLibraryReferences] = useState(false);
  const usedAssets = new Set(state.project.tracks.flatMap((track) => track.clips.map((clip) => clip.assetId)));
  const libraryReferences = new Set(state.project.assets.filter((asset) =>
    asset.status === "pending" && !asset.uri && !asset.importReceiptId
    && asset.metadata.alystriaAssetSource === "starter-pack" && !usedAssets.has(asset.id),
  ).map((asset) => asset.id));
  const visibleAssets = state.project.assets
    .filter((asset) => showLibraryReferences || !libraryReferences.has(asset.id))
    .toSorted((left, right) => Number(right.status === "ready") - Number(left.status === "ready"));

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
            <button type="button" className="aly-editor-media-bin__import" disabled={busy} onClick={() => inputRef.current?.click()}><Upload size={13} aria-hidden="true" />{busy ? "Importing…" : "Import media"}</button>
          </>
        ) : null}
      </header>
      {error ? <p className="aly-editor-media-bin__error" role="alert">{error}</p> : null}
      {libraryReferences.size > 0 ? <label className="aly-editor-media-bin__reference-toggle">
        <input type="checkbox" checked={showLibraryReferences} onChange={(event) => setShowLibraryReferences(event.target.checked)} />
        <span>Show unlinked library references ({libraryReferences.size})<small>Catalog entries, with no import or render queued.</small></span>
      </label> : null}
      <div className="aly-editor-media-bin__assets" role="list" aria-label="Imported media">
        {visibleAssets.map((asset) => {
          const receipt = asset.importReceiptId ? state.project.importReceipts.find((candidate) => candidate.id === asset.importReceiptId) : undefined;
          const selected = state.selection.assetId === asset.id;
          return (
            <article key={asset.id} className={`aly-editor-media-card${selected ? " aly-editor-media-card--selected" : ""}`} role="listitem">
              <button type="button" className="aly-editor-media-card__select" aria-pressed={selected} onClick={() => dispatch({ type: "SELECT_ASSET", assetId: asset.id })}>
                <span className="aly-editor-media-card__preview" aria-hidden="true">
                  {asset.thumbnailUrl ? <img src={asset.thumbnailUrl} alt="" /> : <span>{asset.kind.slice(0, 1).toUpperCase()}</span>}
                </span>
                <span className="aly-editor-media-card__copy"><strong>{asset.name}</strong><span>{asset.kind} · {asset.durationFrames ? formatTimecode(asset.durationFrames, state.project.frameRate) : asset.kind === "image" ? "Still image" : "Duration unknown"}</span></span>
                <span className={`aly-editor-media-card__status aly-editor-media-card__status--${asset.status}`}>{asset.status === "pending" && asset.metadata.playableUriRequired ? "Not linked" : asset.status}</span>
              </button>
              {onCreateClipFromAsset && asset.status === "ready" ? <button type="button" className="aly-editor-media-card__place" aria-label={`Place ${asset.name} at playhead`} onClick={() => placeAsset(asset)}>Place at playhead</button> : null}
              {receipt?.status === "failed" ? <span className="aly-editor-media-card__receipt-error">{receipt.errorMessage ?? "Import failed."}</span> : null}
            </article>
          );
        })}
        {!visibleAssets.length ? <div className="aly-editor-media-bin__empty">Import media or generate a scene to begin editing.</div> : null}
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

function activeClip(state: EditorState, kind: EditorClip["kind"]): EditorClip | null {
  const track = state.project.tracks.find((candidate) => candidate.kind === kind);
  if (!track || track.hidden) return null;
  return track.clips.find((clip) => clip.enabled && state.transport.playheadFrame >= clip.timelineRange.startFrame && state.transport.playheadFrame < clip.timelineRange.startFrame + clip.timelineRange.durationFrames) ?? null;
}

function MediaPreview({ state, clip, className, canvasScale, muted = true }: { state: EditorState; clip: EditorClip; className: string; canvasScale: PreviewCanvasScale; muted?: boolean }) {
  const ref = useRef<HTMLMediaElement>(null);
  const syncStateRef = useRef<{ sourceKey: string; status: EditorState["transport"]["status"] } | null>(null);
  const lastSeekAtRef = useRef<number | null>(null);
  const asset = clip.assetId ? state.project.assets.find((candidate) => candidate.id === clip.assetId) : null;
  const playable = asset?.status === "ready" && asset.previewUrl && (asset.kind === "video" || asset.kind === "audio");
  useEffect(() => {
    const media = ref.current;
    if (!media || !playable) return;
    const sourceFrame = clip.sourceRange.startFrame + (Math.max(0, state.transport.playheadFrame - clip.timelineRange.startFrame) * (clip.playbackRate ?? 1));
    const expectedTime = framesToSeconds(sourceFrame, state.project.frameRate);
    const boundedTime = Number.isFinite(media.duration) ? Math.min(expectedTime, Math.max(0, media.duration - 0.001)) : expectedTime;
    const previousSync = syncStateRef.current;
    const playing = state.transport.status === "playing";
    const enteringPlayback = playing && previousSync?.status !== "playing";
    const sourceKey = `${clip.id}:${asset?.previewUrl ?? ""}`;
    const clipChanged = previousSync?.sourceKey !== sourceKey;
    const now = performance.now();
    const secondsSinceLastSeek = lastSeekAtRef.current === null ? Number.POSITIVE_INFINITY : (now - lastSeekAtRef.current) / 1000;
    if (previewMediaShouldSeek(media.currentTime, boundedTime, { playing, enteringPlayback, clipChanged, secondsSinceLastSeek })) {
      media.currentTime = boundedTime;
      lastSeekAtRef.current = now;
    }
    media.playbackRate = state.transport.playbackRate * (clip.playbackRate ?? 1);
    media.volume = muted ? 0 : volumeAtFrame(clip, state.transport.playheadFrame);
    if (playing) {
      if (media.paused) void media.play().catch(() => undefined);
    } else if (!media.paused) media.pause();
    syncStateRef.current = { sourceKey, status: state.transport.status };
  }, [asset?.previewUrl, clip, muted, playable, state.project.frameRate, state.transport.playbackRate, state.transport.playheadFrame, state.transport.status]);
  if (!asset?.previewUrl || asset.status !== "ready") return null;
  const style = previewStyleAtFrame(clip, state.transport.playheadFrame, canvasScale);
  if (asset.kind === "image") return <img className={className} src={asset.previewUrl} alt={`Preview of ${asset.name}`} style={style} />;
  if (asset.kind === "video") return <video ref={(element) => { ref.current = element; }} className={className} src={asset.previewUrl} muted={muted} aria-label={`Preview of ${asset.name}`} style={style} />;
  if (asset.kind === "audio") return <audio ref={(element) => { ref.current = element; }} src={asset.previewUrl} aria-label={`Preview audio for ${asset.name}`} />;
  return null;
}

export function EditorCanvas({ state, dispatch }: { state: EditorState; dispatch: Dispatch<EditorAction> }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [previewSize, setPreviewSize] = useState({ width: 640, height: 360 });
  const slideTrack = state.project.tracks.find((track) => track.kind === "slides");
  const presenterTrack = state.project.tracks.find((track) => track.kind === "presenter");
  const slide = activeClip(state, "slides");
  const presenter = activeClip(state, "presenter");
  const title = activeClip(state, "titles");
  const caption = activeClip(state, "captions");
  const audioClips = (["narration", "music", "sfx"] as const).flatMap((kind) => {
    const track = state.project.tracks.find((candidate) => candidate.kind === kind);
    const clip = activeClip(state, kind);
    return clip && track && isClipAudible(state.project, track, clip) ? [clip] : [];
  });
  const slideAsset = slide?.assetId ? state.project.assets.find((candidate) => candidate.id === slide.assetId) : null;
  const hasVisibleContent = Boolean(slide || presenter || title || caption);
  useEffect(() => {
    const stage = viewportRef.current;
    if (!stage) return;
    const updateSize = () => {
      const ratio = state.project.canvas.width / state.project.canvas.height;
      const width = Math.min(stage.clientWidth, stage.clientHeight * ratio);
      const height = width / ratio;
      if (width > 0 && height > 0) setPreviewSize((current) => current.width === width && current.height === height ? current : { width, height });
    };
    updateSize();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateSize);
      return () => window.removeEventListener("resize", updateSize);
    }
    const observer = new ResizeObserver(updateSize);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [state.project.canvas.height, state.project.canvas.width]);
  const canvasScale = previewCanvasScale(state.project.canvas, previewSize);
  return (
    <section className="aly-editor-canvas-panel" aria-label="Canvas preview">
      <div className="aly-editor-canvas-toolbar">
        <span>{state.project.canvas.width} × {state.project.canvas.height}</span>
        <div role="group" aria-label="Canvas guides">
          <EditorIconButton icon={Scan} label="Safe action" tooltip="Outline the safe-action area. Keep essential motion inside it for small players." pressed={state.view.guides.includes("safe-action")} onClick={() => dispatch({ type: "TOGGLE_GUIDE", guide: "safe-action" })} iconSize={14} />
          <EditorIconButton icon={Type} label="Safe title" tooltip="Outline the safe-title area. Keep text inside it so nothing is cropped." pressed={state.view.guides.includes("safe-title")} onClick={() => dispatch({ type: "TOGGLE_GUIDE", guide: "safe-title" })} iconSize={14} />
          <EditorIconButton icon={Grid3x3} label="Thirds" tooltip="Overlay a rule-of-thirds grid to balance the composition." pressed={state.view.guides.includes("thirds")} onClick={() => dispatch({ type: "TOGGLE_GUIDE", guide: "thirds" })} iconSize={14} />
          <EditorIconButton icon={Crosshair} label="Center" tooltip="Mark the canvas center for alignment checks." pressed={state.view.guides.includes("center")} onClick={() => dispatch({ type: "TOGGLE_GUIDE", guide: "center" })} iconSize={14} />
        </div>
      </div>
      <div ref={viewportRef} className="aly-editor-canvas-viewport"><div className="aly-editor-canvas-stage" style={{ width: previewSize.width, height: previewSize.height, aspectRatio: `${state.project.canvas.width} / ${state.project.canvas.height}`, backgroundColor: state.project.canvas.backgroundColor }} data-media-status={slideAsset?.status ?? "none"}>
        {slide ? <MediaPreview state={state} clip={slide} className="aly-editor-canvas-stage__media" canvasScale={canvasScale} muted={!slideTrack || !isClipAudible(state.project, slideTrack, slide)} /> : null}
        {slide && (!slideAsset?.previewUrl || slideAsset.status !== "ready") ? <div className="aly-editor-canvas-stage__slide" data-testid="editor-preview-slide"><span>Scene media not generated</span><small>{slide.name}</small></div> : null}
        {presenter ? <MediaPreview state={state} clip={presenter} className="aly-editor-canvas-stage__media aly-editor-canvas-stage__media--presenter" canvasScale={canvasScale} muted={!presenterTrack || !isClipAudible(state.project, presenterTrack, presenter)} /> : null}
        {title?.text ? <div className="aly-editor-canvas-stage__text aly-editor-canvas-stage__text--titles" data-testid="editor-preview-title" title={`Preview and export use Arial; your requested “${resolvedTextStyle(title).fontFamily}” font is saved.`} style={textPreviewStyleAtFrame(title, state.transport.playheadFrame, canvasScale)}>{title.text}</div> : null}
        {caption?.text ? <div className="aly-editor-canvas-stage__text aly-editor-canvas-stage__text--captions" data-testid="editor-preview-caption" title={`Preview and export use Arial; your requested “${resolvedTextStyle(caption).fontFamily}” font is saved.`} style={textPreviewStyleAtFrame(caption, state.transport.playheadFrame, canvasScale)}>{caption.text}</div> : null}
        {audioClips.map((clip) => <MediaPreview key={clip.id} state={state} clip={clip} className="aly-editor-canvas-stage__audio" canvasScale={canvasScale} muted={false} />)}
        {!hasVisibleContent ? <div className="aly-editor-canvas-stage__empty">No visual clip at the playhead</div> : null}
        {state.view.guides.includes("safe-action") ? <div className="aly-editor-canvas-guide aly-editor-canvas-guide--safe-action" aria-hidden="true" /> : null}
        {state.view.guides.includes("safe-title") ? <div className="aly-editor-canvas-guide aly-editor-canvas-guide--safe-title" aria-hidden="true" /> : null}
        {state.view.guides.includes("thirds") ? <div className="aly-editor-canvas-guide aly-editor-canvas-guide--thirds" aria-hidden="true"><span /><span /><span /><span /></div> : null}
        {state.view.guides.includes("center") ? <div className="aly-editor-canvas-guide aly-editor-canvas-guide--center" aria-hidden="true"><span /><span /></div> : null}
      </div></div>
    </section>
  );
}

function NumberControl({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min?: number; max?: number; step?: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) return setDraft(String(value));
    const bounded = Math.min(max ?? parsed, Math.max(min ?? parsed, parsed));
    if (bounded !== value) onChange(bounded);
    setDraft(String(bounded));
  };
  return <label className="aly-editor-inspector__field"><span>{label}</span><input type="number" value={draft} step={step} {...(min !== undefined ? { min } : {})} {...(max !== undefined ? { max } : {})} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") commit(); }} /></label>;
}

type PreviewInspectorProperty = Exclude<InspectorProperty, "audio.pan">;

export function EditorInspector({ state, dispatch }: { state: EditorState; dispatch: Dispatch<EditorAction> }) {
  const clip = selectedClips(state)[0];
  const [keyframeProperty, setKeyframeProperty] = useState<PreviewInspectorProperty>("transform.x");
  if (!clip) return <section className="aly-editor-inspector" aria-labelledby="aly-editor-inspector-title"><header className="aly-editor-panel__header"><h2 id="aly-editor-inspector-title">Inspector</h2></header><div className="aly-editor-inspector__empty">Select a clip to inspect transform, audio, text, and keyframes.</div></section>;
  const visualClip = clip.kind === "slides" || clip.kind === "presenter";
  const textClip = clip.kind === "titles" || clip.kind === "captions";
  const clipTrack = state.project.tracks.find((track) => track.id === clip.trackId);
  const audioClip = clipTrack ? clipCarriesProgrammeAudio(clipTrack, clip) : clip.metadata.includeSourceAudio === true;
  const keyframeProperties: readonly PreviewInspectorProperty[] = visualClip
    ? ["transform.x", "transform.y", "transform.scaleX", "transform.scaleY", "transform.rotation", "opacity", ...(audioClip ? ["audio.volumeDb" as const] : [])]
    : textClip ? ["transform.x", "transform.y", "opacity"] : ["audio.volumeDb"];
  const selectedKeyframeProperty = keyframeProperties.includes(keyframeProperty) ? keyframeProperty : keyframeProperties[0]!;
  const textStyle = textClip ? resolvedTextStyle(clip) : null;
  const updateTransform = (property: keyof EditorClip["transform"], value: number) => dispatch({ type: "UPDATE_SELECTED_CLIP", patch: { transform: { ...clip.transform, [property]: value } }, label: `Change ${property}` });
  const updateAudio = (property: keyof EditorClip["audio"], value: number | boolean) => dispatch({ type: "UPDATE_SELECTED_CLIP", patch: { audio: { ...clip.audio, [property]: value } }, label: `Change audio ${property}` });
  const updateTextStyle = (patch: Partial<NonNullable<EditorClip["textStyle"]>>) => {
    if (!textStyle) return;
    dispatch({ type: "UPDATE_SELECTED_CLIP", patch: { textStyle: { ...textStyle, ...patch } }, label: "Change text style" });
  };
  const propertyValue = (property: PreviewInspectorProperty): number => {
    switch (property) {
      case "transform.x": return clip.transform.x;
      case "transform.y": return clip.transform.y;
      case "transform.scaleX": return clip.transform.scaleX;
      case "transform.scaleY": return clip.transform.scaleY;
      case "transform.rotation": return clip.transform.rotation;
      case "opacity": return clip.opacity;
      case "audio.volumeDb": return clip.audio.volumeDb;
    }
  };
  return (
    <section className="aly-editor-inspector" aria-labelledby="aly-editor-inspector-title">
      <header className="aly-editor-panel__header"><div><span className="aly-editor-panel__eyebrow">Selected clip</span><h2 id="aly-editor-inspector-title">{clip.name}</h2></div><span>{clip.kind}</span></header>
      <fieldset className="aly-editor-inspector__section"><legend>Timing</legend>
        <NumberControl label="Start frame" value={clip.timelineRange.startFrame} min={0} onChange={(frame) => dispatch({ type: "TRIM_CLIP", clipId: clip.id, edge: "start", frame })} />
        <NumberControl label="End frame" value={clip.timelineRange.startFrame + clip.timelineRange.durationFrames} min={clip.timelineRange.startFrame + 1} onChange={(frame) => dispatch({ type: "TRIM_CLIP", clipId: clip.id, edge: "end", frame })} />
        <NumberControl label="Speed" value={clip.playbackRate ?? 1} min={0.25} max={4} step={0.05} onChange={(playbackRate) => dispatch({ type: "UPDATE_SELECTED_CLIP", patch: { playbackRate }, label: "Change clip speed" })} />
      </fieldset>
      {(visualClip || textClip) ? <fieldset className="aly-editor-inspector__section"><legend>Transform</legend>
        <NumberControl label="X" value={clip.transform.x} onChange={(value) => updateTransform("x", value)} /><NumberControl label="Y" value={clip.transform.y} onChange={(value) => updateTransform("y", value)} />
        {visualClip ? <><NumberControl label="Scale X" value={clip.transform.scaleX} min={0.01} step={0.05} onChange={(value) => updateTransform("scaleX", value)} /><NumberControl label="Scale Y" value={clip.transform.scaleY} min={0.01} step={0.05} onChange={(value) => updateTransform("scaleY", value)} /><NumberControl label="Rotation" value={clip.transform.rotation} step={0.5} onChange={(value) => updateTransform("rotation", value)} /></> : null}<NumberControl label="Opacity" value={clip.opacity} min={0} max={1} step={0.05} onChange={(opacity) => dispatch({ type: "UPDATE_SELECTED_CLIP", patch: { opacity }, label: "Change opacity" })} />
      </fieldset> : null}
      {audioClip ? <fieldset className="aly-editor-inspector__section"><legend>{visualClip ? "Source audio" : "Audio"}</legend>
        <NumberControl label="Volume dB" value={clip.audio.volumeDb} min={-60} max={0} step={0.5} onChange={(value) => updateAudio("volumeDb", value)} />
        <label className="aly-editor-inspector__check"><input type="checkbox" checked={clip.audio.muted} onChange={(event) => updateAudio("muted", event.target.checked)} />Mute clip</label>
      </fieldset> : null}
      {clip.text !== undefined ? <label className="aly-editor-inspector__text"><span>On-screen text</span><textarea value={clip.text} onChange={(event) => dispatch({ type: "UPDATE_SELECTED_CLIP", patch: { text: event.target.value }, label: "Edit clip text" })} /></label> : null}
      {textStyle ? <fieldset className="aly-editor-inspector__section aly-editor-inspector__section--text-style"><legend>On-screen text style</legend>
        <NumberControl label="Text size" value={textStyle.fontSize} min={6} max={512} onChange={(fontSize) => updateTextStyle({ fontSize })} />
        <label className="aly-editor-inspector__field"><span>Text color</span><input aria-label="Text color" type="color" value={textStyle.color} onChange={(event) => updateTextStyle({ color: event.target.value.toUpperCase() })} /></label>
        <label className="aly-editor-inspector__field"><span>Alignment</span><select aria-label="Text alignment" value={textStyle.align} onChange={(event) => updateTextStyle({ align: event.target.value as typeof textStyle.align })}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label>
        <label className="aly-editor-inspector__field"><span>Placement</span><select aria-label="Text placement" value={textStyle.position} onChange={(event) => updateTextStyle({ position: event.target.value as typeof textStyle.position })}><option value="top">Top</option><option value="center">Center</option><option value="bottom">Bottom</option><option value="custom">Custom center + X/Y</option></select></label>
        <label className="aly-editor-inspector__check"><input type="checkbox" checked={textStyle.backgroundColor !== null} onChange={(event) => updateTextStyle({ backgroundColor: event.target.checked ? "#000000" : null })} />Background panel</label>
        {textStyle.backgroundColor ? <label className="aly-editor-inspector__field"><span>Background color</span><input aria-label="Text background color" type="color" value={textStyle.backgroundColor} onChange={(event) => updateTextStyle({ backgroundColor: event.target.value.toUpperCase() })} /></label> : null}
        <p className="aly-editor-inspector__text-note">Preview and export keep only explicit line breaks. If text reaches an edge, add a line break or reduce its size. Export uses Arial on Windows. Your chosen “{textStyle.fontFamily}” font is saved, but its appearance may differ.</p>
      </fieldset> : null}
      <fieldset className="aly-editor-inspector__section aly-editor-inspector__section--keyframes"><legend>Keyframes</legend>
        <div className="aly-editor-inspector__keyframe-add"><select value={selectedKeyframeProperty} aria-label="Keyframe property" onChange={(event) => setKeyframeProperty(event.target.value as PreviewInspectorProperty)}>{keyframeProperties.map((property) => <option key={property} value={property}>{property}</option>)}</select><button type="button" onClick={() => dispatch({ type: "ADD_KEYFRAME", clipId: clip.id, keyframe: { id: `${clip.id}-${selectedKeyframeProperty}-${state.transport.playheadFrame}`, property: selectedKeyframeProperty, frame: state.transport.playheadFrame, value: propertyValue(selectedKeyframeProperty), interpolation: "ease-in-out" } })}>Add at playhead</button></div>
        <ul className="aly-editor-inspector__keyframes">{clip.keyframes.map((keyframe) => <li key={keyframe.id}><button type="button" onClick={() => dispatch({ type: "SET_PLAYHEAD", frame: keyframe.frame })}>{keyframe.property} · {formatTimecode(keyframe.frame, state.project.frameRate)}</button><select aria-label={`Interpolation for ${keyframe.property} at frame ${keyframe.frame}`} value={keyframe.interpolation} onChange={(event) => dispatch({ type: "UPDATE_KEYFRAME", clipId: clip.id, keyframeId: keyframe.id, patch: { interpolation: event.target.value as typeof keyframe.interpolation } })}><option value="hold">Hold</option><option value="linear">Linear</option><option value="ease-in">Ease in</option><option value="ease-out">Ease out</option><option value="ease-in-out">Ease in/out</option></select><button type="button" aria-label={`Remove ${keyframe.property} keyframe at frame ${keyframe.frame}`} onClick={() => dispatch({ type: "REMOVE_KEYFRAME", clipId: clip.id, keyframeId: keyframe.id })}>Remove</button></li>)}</ul>
      </fieldset>
    </section>
  );
}

function TranscriptCue({ clip, state, dispatch }: { clip: EditorClip; state: EditorState; dispatch: Dispatch<EditorAction> }) {
  const [draft, setDraft] = useState(() => readTranscriptDraft(state.project.id, clip));
  const { text, speaker } = draft;
  const [draftStorageFailed, setDraftStorageFailed] = useState(false);
  const [editingSpeaker, setEditingSpeaker] = useState(false);
  useEffect(() => {
    setDraft(readTranscriptDraft(state.project.id, { id: clip.id, text: clip.text ?? "", speaker: clip.speaker ?? "" }));
    setEditingSpeaker(false);
  }, [state.project.id, clip.id, clip.speaker, clip.text]);
  const changeDraft = (patch: Partial<typeof draft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    setDraftStorageFailed(!writeTranscriptDraft(state.project.id, clip, next));
  };
  const startTimecode = formatTimecode(clip.timelineRange.startFrame, state.project.frameRate);
  const endTimecode = formatTimecode(clip.timelineRange.startFrame + clip.timelineRange.durationFrames, state.project.frameRate);
  const durationSeconds = framesToSeconds(clip.timelineRange.durationFrames, state.project.frameRate);
  const speakerDirty = speaker !== (clip.speaker ?? "");
  const dirty = text !== (clip.text ?? "") || speakerDirty;
  const revert = () => { setDraft({ text: clip.text ?? "", speaker: clip.speaker ?? "" }); setDraftStorageFailed(!writeTranscriptDraft(state.project.id, clip, null)); setEditingSpeaker(false); };
  const save = () => {
    // Locked cues retain their unfinished draft until the edit can be applied.
    if (!clip.locked && !state.project.tracks.find((track) => track.id === clip.trackId)?.locked) writeTranscriptDraft(state.project.id, clip, null);
    dispatch(speakerDirty
      ? { type: "SET_TRANSCRIPT", clipId: clip.id, text, speaker }
      : { type: "SET_TRANSCRIPT", clipId: clip.id, text });
  };
  const seek = () => { dispatch({ type: "SET_PLAYHEAD", frame: clip.timelineRange.startFrame }); dispatch({ type: "SELECT_CLIP", clipId: clip.id }); };
  return (
    <li className="aly-editor-transcript__cue">
      <div className="aly-editor-transcript__cue-head">
        <EditorTooltip description={`Seek to ${startTimecode} and select “${clip.name}”. The cue runs to ${endTimecode}.`}>
          {({ ref, describedBy, handlers }) => (
            <button
              type="button"
              ref={ref as (element: HTMLButtonElement | null) => void}
              className="aly-editor-transcript__time"
              aria-label={`Seek to ${startTimecode} and select ${clip.name}`}
              aria-describedby={describedBy}
              onMouseEnter={handlers.onMouseEnter}
              onMouseLeave={handlers.onMouseLeave}
              onFocus={handlers.onFocus}
              onBlur={handlers.onBlur}
              onKeyDown={handlers.onKeyDown}
              onClick={seek}
            >
              {startTimecode}
            </button>
          )}
        </EditorTooltip>
        <span className="aly-editor-transcript__duration" title={`Cue length ${durationSeconds.toFixed(1)} seconds`}>{durationSeconds.toFixed(1)}s</span>
        {speaker || editingSpeaker ? (
          editingSpeaker ? (
            <span className="aly-editor-transcript__speaker-edit">
              <User size={12} aria-hidden="true" />
              <input aria-label="Speaker" placeholder="Speaker name (optional)" value={speaker} onChange={(event) => changeDraft({ speaker: event.target.value })} />
              <EditorIconButton icon={Check} label="Done editing speaker" tooltip="Finish editing the speaker name. Save the cue to keep it." iconSize={13} onClick={() => setEditingSpeaker(false)} />
            </span>
          ) : (
            <span className="aly-editor-transcript__speaker">
              <User size={12} aria-hidden="true" />
              <strong>{speaker}</strong>
              <EditorIconButton icon={Pencil} label={`Edit speaker ${speaker}`} tooltip="Change who is credited for this cue. No speaker is ever filled in automatically." iconSize={12} onClick={() => setEditingSpeaker(true)} />
            </span>
          )
        ) : (
          <button type="button" className="aly-editor-transcript__speaker-add" onClick={() => setEditingSpeaker(true)}>
            <UserPlus size={12} aria-hidden="true" /> Add speaker
          </button>
        )}
      </div>
      <label className="aly-editor-transcript__cue-text"><span className="aly-editor-sr-only">Transcript</span><textarea value={text} rows={3} onChange={(event) => changeDraft({ text: event.target.value })} /></label>
      <div className="aly-editor-transcript__cue-foot">
        <span className={`aly-editor-transcript__draft${dirty ? " is-dirty" : ""}`}>{dirty ? (draftStorageFailed ? "Draft not stored — save before leaving" : "Draft kept on this device") : "Saved"}</span>
        <button
          type="button"
          className="aly-editor-transcript__revert"
          disabled={!dirty}
          onClick={revert}
        >
          <X size={12} aria-hidden="true" /> Revert
        </button>
        <button type="button" className="aly-editor-transcript__save" disabled={!dirty} onClick={save}>Save cue</button>
      </div>
    </li>
  );
}

export function TranscriptPanel({ state, dispatch }: { state: EditorState; dispatch: Dispatch<EditorAction> }) {
  const captionCues = state.project.tracks.find((track) => track.kind === "captions")?.clips ?? [];
  const narrationCues = state.project.tracks.find((track) => track.kind === "narration")?.clips ?? [];
  const cues = [...(captionCues.length ? captionCues : narrationCues)].sort((left, right) => left.timelineRange.startFrame - right.timelineRange.startFrame);
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
