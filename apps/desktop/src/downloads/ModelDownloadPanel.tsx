import { useEffect, useRef } from "react";
import { CheckCircle2, Download, Minus, RefreshCw, X } from "lucide-react";
import { downloadPhaseLabel, isDownloadActive, isDownloadComplete } from "./downloadState";
import { useModelDownloads } from "./ModelDownloadProvider";
import "./downloads.css";

function bytes(value: number) { return value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(1)} GB` : `${(value / 1024 ** 2).toFixed(1)} MB`; }

export function ModelDownloadLauncher() {
  const downloads = useModelDownloads();
  const count = new Set([...downloads.queuedModelIds, ...downloads.startingModelIds, ...downloads.statuses.filter((status) => isDownloadActive(status.phase)).map((status) => status.modelId)]).size;
  return <button type="button" className="model-download-launcher" aria-label={`Downloads${count ? ` (${count} active)` : ""}`} aria-expanded={downloads.panelOpen} aria-controls="model-download-panel" onClick={downloads.openPanel}><Download size={17} /><span>Downloads</span>{count > 0 && <b>{count}</b>}</button>;
}

export function ModelDownloadPanel() {
  const downloads = useModelDownloads();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (downloads.panelOpen) heading.current?.focus(); }, [downloads.panelOpen]);
  if (!downloads.panelOpen) return null;
  const ids = [...new Set([...downloads.queuedModelIds, ...downloads.startingModelIds, ...Object.keys(downloads.errors), ...downloads.statuses.filter((status) => isDownloadActive(status.phase) || isDownloadComplete(status.phase) || ["failed", "cancelled", "corrupt", "incompatible"].includes(status.phase)).map((status) => status.modelId)])];
  return <aside id="model-download-panel" className="model-download-drawer" role="region" aria-label="Model downloads" onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); downloads.minimize(); } }}>
    <header><div className="model-download-drawer__title"><span><Download size={20} /></span><div><small>YOUR MODEL TOOLKIT</small><h2 ref={heading} tabIndex={-1}>Downloads</h2></div></div><button type="button" className="icon-button" aria-label="Minimize downloads" title="Keep downloading in the background" onClick={downloads.minimize}><Minus size={20} /></button></header>
    <p className="model-download-drawer__intro">Keep working while your models download. Minimize this panel and reopen it from Downloads.</p>
    {downloads.error && <div className="model-download-drawer__error" role="alert"><p>{downloads.error}</p><button type="button" onClick={() => { void downloads.refresh(); }}>Retry status check</button></div>}
    <div className="model-download-drawer__list">
      {!ids.length && <div className="model-download-drawer__empty"><Download size={32} /><h3>{downloads.loading ? "Loading downloads…" : "Your next tools start here"}</h3><p>Choose Download on a model, or select a model during setup. Its progress will appear here.</p></div>}
      {ids.map((id) => {
        const entry = downloads.catalog.find((item) => item.modelId === id);
        const status = downloads.statuses.find((item) => item.modelId === id);
        const starting = downloads.startingModelIds.has(id);
        const queued = downloads.queuedModelIds.includes(id) && !starting;
        const active = isDownloadActive(status?.phase);
        const complete = isDownloadComplete(status?.phase);
        const failure = downloads.errors[id];
        const total = status?.totalBytes || entry?.totalBytes || 0;
        const downloaded = status?.downloadedBytes ?? 0;
        const percent = total ? Math.min(100, Math.max(0, downloaded / total * 100)) : 0;
        const label = starting ? "Starting download" : queued ? "Queued" : failure ? "Could not start" : downloadPhaseLabel(status?.phase);
        return <article className="model-download-item" key={id} aria-label={entry?.displayName ?? id}><div className="model-download-item__heading"><div><h3>{entry?.displayName ?? id}</h3><span>{label}</span></div>{complete ? <CheckCircle2 size={20} /> : active || starting ? <RefreshCw size={18} className="spin" /> : queued ? <button type="button" className="icon-button" aria-label={`Remove ${entry?.displayName ?? id} from queue`} onClick={() => { void downloads.cancel(id); }}><X size={16} /></button> : null}</div>
          <progress aria-label={`${entry?.displayName ?? id} download progress`} max={100} value={queued || starting ? 0 : percent} />
          <div className="model-download-item__numbers"><span>{bytes(downloaded)} / {bytes(total)}</span><span>{Math.floor(percent)}%</span></div>
          {failure ? <p role="alert">{failure}</p> : status?.detail && <p>{status.detail}</p>}
          {status?.phase === "downloadedQuarantined" && <p className="model-download-item__note">Files are saved. This model still needs a compatible runtime before it can generate.</p>}
          <footer>{entry && <a href={entry.licenseUrl} target="_blank" rel="noreferrer">{entry.licenseId} license</a>}{!active && !starting && !queued && !complete && entry?.available && <button type="button" className="secondary-button small" onClick={() => downloads.enqueue([id])}>{downloaded > 0 ? "Resume download" : "Retry download"}</button>}</footer>
        </article>;
      })}
    </div><footer className="model-download-drawer__footer"><span>Downloads stay active while the app is open.</span><button type="button" className="secondary-button" onClick={downloads.minimize}>Keep working</button></footer>
  </aside>;
}
