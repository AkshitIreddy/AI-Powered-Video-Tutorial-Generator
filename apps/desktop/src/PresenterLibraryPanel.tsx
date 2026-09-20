import { useEffect, useRef, useState, type ReactNode } from "react";
import { CircleCheck, ImagePlus, LoaderCircle, Sparkles, Upload, UserRoundPlus } from "lucide-react";
import type { PresenterLibraryController } from "./customPresenterLibrary";
import { fileContentBase64 } from "./customPresenterLibrary";
import "./PresenterLibraryPanel.css";

const ACCEPTED_PORTRAITS = "image/png,image/jpeg,image/webp";
const MAX_PORTRAIT_BYTES = 24 * 1024 * 1024;

export function PresenterLibraryPanel({ library, canGenerate = false, generating = false, candidateReview, onGenerate }: {
  library: PresenterLibraryController;
  canGenerate?: boolean;
  generating?: boolean;
  candidateReview?: ReactNode;
  onGenerate?: (input: { displayName: string; prompt: string }) => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"closed" | "upload" | "create">("closed");
  const [file, setFile] = useState<File | null>(null);
  const [portraitPreview, setPortraitPreview] = useState("");
  const [portraitDecoded, setPortraitDecoded] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [localError, setLocalError] = useState("");
  useEffect(() => {
    setPortraitDecoded(false);
    if (mode !== "upload" || !file || typeof URL.createObjectURL !== "function") {
      setPortraitPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPortraitPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file, mode]);
  const canSaveUpload = Boolean(file && displayName.trim() && confirmed && portraitDecoded && !library.busy);
  const saveUpload = async () => {
    setLocalError("");
    if (!file || !displayName.trim()) return setLocalError("Choose a portrait and give the presenter a name.");
    if (file.size > MAX_PORTRAIT_BYTES) return setLocalError("Choose a portrait smaller than 24 MiB.");
    if (!confirmed) return setLocalError("Confirm that this is a fictional character you may use and animate.");
    if (!portraitDecoded) return setLocalError("Wait for the selected portrait preview to finish loading before saving.");
    try {
      await library.importPortrait({
        filename: file.name,
        mimeType: file.type,
        contentBase64: await fileContentBase64(file),
        rights: {
          status: "owned",
          creator: "Project owner",
          commercialUse: "allowed",
          redistribution: "allowed",
          modelInput: "allowed",
        },
        presenter: {
          identityType: "synthetic",
          displayName: displayName.trim(),
          syntheticOriginAttested: true,
          selectAfterImport: false,
        },
      });
      setFile(null);
      setDisplayName("");
      setConfirmed(false);
      setMode("closed");
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : "The portrait could not be saved.");
    }
  };
  const generate = async () => {
    setLocalError("");
    if (!displayName.trim() || !prompt.trim()) return setLocalError("Name the presenter and describe their appearance.");
    if (!onGenerate) return setLocalError("Open a saved tutorial before creating a presenter with an image model.");
    try { await onGenerate({ displayName: displayName.trim(), prompt: prompt.trim() }); }
    catch (caught) { setLocalError(caught instanceof Error ? caught.message : "Presenter creation could not start."); }
  };
  return <section className="presenter-library-panel" aria-label="Custom presenter library">
    <div className="presenter-library-panel__heading"><span className="presenter-library-panel__title"><span><UserRoundPlus size={17} /></span><span><strong>My presenters</strong><small>Reusable across tutorials</small></span></span><span className="presenter-library-panel__count">{library.entries.length ? `${library.entries.length} saved` : "None saved"}</span></div>
    <div className="presenter-library-panel__actions">
      <button type="button" className={mode === "upload" ? "active" : ""} aria-expanded={mode === "upload"} title="Import a portrait you own" onClick={() => setMode(mode === "upload" ? "closed" : "upload")}><span><Upload size={16} /></span><span><strong>Upload</strong><small>From your device</small></span></button>
      <button type="button" className={mode === "create" ? "active" : ""} aria-expanded={mode === "create"} title="Create presenter candidates with this tutorial's image model" onClick={() => setMode(mode === "create" ? "closed" : "create")}><span><Sparkles size={16} /></span><span><strong>Create</strong><small>With an image model</small></span></button>
    </div>
    {mode === "upload" && <div className="presenter-library-panel__form">
      <div className="presenter-library-panel__form-heading"><strong>Add a portrait</strong><small>Review the exact still before it enters your reusable cast.</small></div>
      <button type="button" className="presenter-library-panel__drop" onClick={() => inputRef.current?.click()}><ImagePlus size={21} /><span><strong>{file?.name ?? "Choose a front-facing portrait"}</strong><small>PNG, JPEG, or WebP · up to 24 MiB</small></span></button>
      <input ref={inputRef} className="visually-hidden-file" aria-label="Portrait file" type="file" accept={ACCEPTED_PORTRAITS} onChange={(event) => { setLocalError(""); setFile(event.target.files?.[0] ?? null); }} />
      {portraitPreview && <div className="presenter-library-panel__preview"><img src={portraitPreview} alt={`Preview of ${file?.name ?? "selected presenter portrait"}`} onLoad={() => setPortraitDecoded(true)} onError={() => { setPortraitDecoded(false); setLocalError("This portrait could not be decoded. Choose another PNG, JPEG, or WebP image."); }} /><span><strong>{portraitDecoded ? "Portrait loaded" : "Loading portrait…"}</strong><small>Check the face, framing, and neutral resting mouth.</small></span></div>}
      <label><span>Presenter name</span><input value={displayName} maxLength={120} placeholder="For example, Nova" onChange={(event) => setDisplayName(event.target.value)} /></label>
      <label className="presenter-library-panel__check"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>This is a fictional or generated character I may use and animate.</span></label>
      <button type="button" className="primary-button" disabled={!canSaveUpload} onClick={() => { void saveUpload(); }}>{library.busy ? <LoaderCircle className="spin" size={15} /> : <Upload size={15} />}{library.busy ? "Saving…" : "Save to my presenters"}</button>
    </div>}
    {mode === "create" && <div className="presenter-library-panel__form">
      <div className="presenter-library-panel__form-heading"><strong>Create a presenter</strong><small>You will review candidates before anything is saved.</small></div>
      <label><span>Presenter name</span><input value={displayName} maxLength={120} placeholder="For example, Nova" onChange={(event) => setDisplayName(event.target.value)} /></label>
      <label><span>Appearance</span><textarea rows={4} maxLength={2000} value={prompt} placeholder="A friendly anime science teacher in a warm home studio, centered, looking at camera, neutral resting mouth…" onChange={(event) => setPrompt(event.target.value)} /></label>
      <p>Your tutorial’s selected image provider or local model creates review candidates. Nothing enters the cast until you inspect and accept it.</p>
      <button type="button" className="primary-button" disabled={!canGenerate || generating} onClick={() => { void generate(); }}>{generating ? <LoaderCircle className="spin" size={15} /> : <Sparkles size={15} />}{generating ? "Creating candidates…" : canGenerate ? "Create review candidate" : "Open a tutorial to create"}</button>
    </div>}
    {(localError || library.error) && <p className="presenter-library-panel__error" role="alert">{localError || library.error}</p>}
    {candidateReview}
    <p className="presenter-library-panel__readiness"><CircleCheck size={15} /><span><strong>Still image ready after save</strong><small>Animation remains “Preview required” until this exact portrait passes a local animation preview.</small></span></p>
  </section>;
}
