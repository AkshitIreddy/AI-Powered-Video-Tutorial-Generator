import { useEffect, useRef, type KeyboardEvent } from "react";
import { CheckCircle2, Cpu, Download, HardDrive, X } from "lucide-react";
import { isDownloadActive } from "./downloads/downloadState";
import { COMFYUI_RUNTIME_VERSION, isVerifiedComfyuiRuntime } from "./localRuntime";
import type { ModelDownloadCatalogEntry, ModelDownloadStatus } from "./native";

function formatDownloadSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(bytes >= 10 * 1024 ** 3 ? 0 : 1)} GB`;
  return `${Math.ceil(bytes / 1024 ** 2)} MB`;
}

export interface LocalRuntimePanelProps {
  runtimeEntry: ModelDownloadCatalogEntry | null;
  runtimeStatus: ModelDownloadStatus | null;
  queued: boolean;
  starting: boolean;
  loading: boolean;
  onDownloadRuntime: () => void;
  onViewDownloads: () => void;
}

export function LocalRuntimePanel({
  runtimeEntry,
  runtimeStatus,
  queued,
  starting,
  loading,
  onDownloadRuntime,
  onViewDownloads,
}: LocalRuntimePanelProps) {
  const installed = isVerifiedComfyuiRuntime(runtimeStatus ?? undefined);
  const busy = queued || starting || isDownloadActive(runtimeStatus?.phase);
  const available = runtimeEntry?.available === true;
  const state = installed ? "Ready" : busy ? "Downloading" : "Not installed";

  return (
    <section className="model-setup-panel local-runtime-panel" aria-labelledby="local-runtime-title">
      <div className="model-setup-heading">
        <div>
          <span className="section-kicker">Local image engine</span>
          <h2 id="local-runtime-title">ComfyUI runtime</h2>
          <p>Install the verified runtime once, then reuse it with every managed local image model.</p>
        </div>
        <span className="setup-state">
          {installed ? <CheckCircle2 size={15} /> : <Cpu size={15} />}
          {state}
        </span>
      </div>
      <div className="runtime-row">
        <span>
          <b>ComfyUI {COMFYUI_RUNTIME_VERSION} portable runtime</b>
          <small>
            {installed
              ? `${formatDownloadSize(runtimeStatus?.totalBytes ?? runtimeEntry?.totalBytes ?? 0)} verified · ${runtimeStatus?.licenseId ?? runtimeEntry?.licenseId ?? "license recorded"} · shared by every managed local image model.`
              : runtimeEntry
              ? `${formatDownloadSize(runtimeEntry.totalBytes)} · ${runtimeEntry.licenseId} · one shared runtime for SDXL, FLUX.2 Klein, and Z-Image Turbo.`
              : loading
                ? "Checking the verified runtime package…"
                : "The verified runtime package is unavailable in this build."}
          </small>
        </span>
        <em className={installed ? "is-ready" : undefined}>{state}</em>
      </div>
      <div className="model-setup-actions">
        {installed || busy ? (
          <button type="button" className="secondary-button" onClick={onViewDownloads}>
            <HardDrive size={16} /> View downloads
          </button>
        ) : (
          <button type="button" className="primary-button" disabled={!available || loading} onClick={onDownloadRuntime}>
            <Download size={16} /> Download ComfyUI
          </button>
        )}
        <small>{installed ? "Verified and ready for compatible local image models." : busy ? "You can minimize Downloads and keep working." : "Optional unless you want to generate images locally."}</small>
      </div>
    </section>
  );
}

export interface RuntimeDownloadPromptProps {
  modelName: string;
  modelTotalBytes: number;
  runtimeBytes: number;
  canDownload: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function RuntimeDownloadPrompt({
  modelName,
  modelTotalBytes,
  runtimeBytes,
  canDownload,
  onConfirm,
  onCancel,
}: RuntimeDownloadPromptProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;

  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    primaryRef.current?.focus();
    return () => {
      previousFocus.current?.focus();
    };
  }, []);

  const trapFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancelRef.current();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])") ?? []);
    if (!focusable.length) return;
    const first = focusable[0]!;
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="sheet-backdrop runtime-prompt-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <div ref={dialogRef} className="regen-sheet runtime-prompt" role="alertdialog" aria-modal="true" aria-labelledby="runtime-prompt-title" aria-describedby="runtime-prompt-detail" onKeyDown={trapFocus}>
        <header>
          <div><span className="section-kicker">Runtime required</span><h2 id="runtime-prompt-title">Install ComfyUI with {modelName}</h2></div>
          <button type="button" className="icon-button" aria-label="Close runtime download" onClick={onCancel}><X size={17} /></button>
        </header>
        <p id="runtime-prompt-detail">
          {modelName} needs ComfyUI {COMFYUI_RUNTIME_VERSION}. The complete download is {formatDownloadSize(modelTotalBytes)}. {runtimeBytes > 0 ? `That total already includes the ${formatDownloadSize(runtimeBytes)} shared runtime, so it is not counted twice.` : "The selected model total already includes its shared runtime dependency."}
        </p>
        <div className="runtime-prompt__actions">
          <button ref={primaryRef} type="button" className="primary-button" disabled={!canDownload} onClick={onConfirm}>
            <Download size={15} /> Download {modelName} + ComfyUI
          </button>
          <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
        </div>
        {!canDownload ? <small>The runtime package is not available in this build.</small> : null}
      </div>
    </div>
  );
}
