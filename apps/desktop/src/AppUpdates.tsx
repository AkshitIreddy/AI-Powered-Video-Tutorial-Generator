import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Download, RefreshCw, X } from "lucide-react";
import "./appUpdates.css";
import { useModelDownloads } from "./downloads/ModelDownloadProvider";
import { isDownloadActive } from "./downloads/downloadState";

type UpdateInfo = { currentVersion: string; version: string | null; notes: string | null };
type Progress = { downloaded: number; total: number | null; phase: string };

export function AppUpdates({ beforeInstall, busy, settingsVisible }: {
  beforeInstall: () => Promise<void>; busy: boolean; settingsVisible: boolean;
}) {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState<Progress | null>(null);
  const checkingRef = useRef(false);
  const downloads = useModelDownloads();
  const workActive = busy || downloads.statuses.some((status) => isDownloadActive(status.phase)) || downloads.queuedModelIds.length > 0 || downloads.startingModelIds.size > 0;

  const check = async (manual = false) => {
    if (!isTauri() || checkingRef.current) return;
    checkingRef.current = true;
    setChecking(true);
    if (manual) { setDismissed(false); setMessage(""); }
    try {
      const result = await invoke<UpdateInfo>("app_update_check");
      setInfo(result);
      if (manual) setMessage(result.version ? "" : "You’re up to date.");
    } catch {
      if (manual) setMessage("Could not check for updates. Try again when online.");
    } finally { checkingRef.current = false; setChecking(false); }
  };

  useEffect(() => {
    if (!isTauri()) return;
    const start = window.setTimeout(() => { void check(); }, 15_000);
    const interval = window.setInterval(() => { void check(); }, 6 * 60 * 60 * 1000);
    return () => { window.clearTimeout(start); window.clearInterval(interval); };
  }, []);

  const install = async () => {
    if (!info?.version || workActive || installing) return;
    setInstalling(true);
    setMessage("Saving your work…");
    let unlisten: (() => void) | undefined;
    try {
      await beforeInstall();
      unlisten = await listen<Progress>("app-update-progress", (event) => setProgress(event.payload));
      setMessage("Downloading the signed update…");
      await invoke("app_update_install", { version: info.version });
    } catch (error) {
      const detail = error && typeof error === "object" && "message" in error ? String(error.message) : "The update could not finish. Try again or restart the app.";
      setMessage(detail);
      setInstalling(false);
      setProgress(null);
    } finally { unlisten?.(); }
  };

  if (!isTauri()) return null;
  const available = Boolean(info?.version) && !dismissed;
  if (!settingsVisible && !available && !installing) return null;
  const percent = progress?.total ? Math.min(100, Math.round(progress.downloaded / progress.total * 100)) : undefined;
  return <div className={installing ? "app-update-shade" : "app-update-anchor"}>
    <section className="app-update-card" role={installing ? "dialog" : "region"} aria-label="Application updates" aria-modal={installing || undefined}>
      <div className="app-update-heading"><Download size={20} /><strong>{info?.version ? `Version ${info.version} is available` : `App updates${info ? ` · ${info.currentVersion}` : ""}`}</strong>
        {!installing && !settingsVisible && <button aria-label="Remind me next time" title="Remind me next time" onClick={() => setDismissed(true)}><X size={16} /></button>}
      </div>
      <p role="status">{installing && progress?.phase === "installing" ? "Installing and restarting…" : message || (info?.version ? "Save your work and install the latest version." : "Checks automatically when you open the app and every six hours.")}</p>
      {installing && <progress aria-label="Update download" max={100} value={percent} />}
      {!installing && <div className="app-update-actions">
        <button className="secondary-button" disabled={checking} onClick={() => { void check(true); }}><RefreshCw size={15} className={checking ? "spin" : ""} />{checking ? "Checking…" : "Check for updates"}</button>
        {info?.version && <button className="primary-button" disabled={workActive} title={workActive ? "Wait for active generation and downloads to finish" : "Save work, install and restart"} onClick={() => { void install(); }}>Update and restart</button>}
      </div>}
      {workActive && info?.version && !installing && <small>Finish active jobs and downloads before updating.</small>}
    </section>
  </div>;
}
