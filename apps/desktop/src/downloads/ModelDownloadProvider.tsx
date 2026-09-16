import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { localModelDownloadCatalog, localModelDownloadStart, localModelDownloadStatus, type ModelDownloadCatalogEntry, type ModelDownloadStatus } from "../native";

import { isDownloadActive, isDownloadComplete } from "./downloadState";

const QUEUE_KEY = "alystria-model-download-queue-v1";
interface Intent { modelId: string; licenseSha256: string }
export interface ModelDownloads {
  catalog: ModelDownloadCatalogEntry[];
  statuses: ModelDownloadStatus[];
  loading: boolean;
  error: string | null;
  errors: Readonly<Record<string, string>>;
  queuedModelIds: string[];
  startingModelIds: ReadonlySet<string>;
  panelOpen: boolean;
  enqueue: (modelIds: readonly string[]) => void;
  refresh: () => Promise<void>;
  openPanel: () => void;
  minimize: () => void;
  cancel: (modelId: string) => Promise<void>;
}
const Context = createContext<ModelDownloads | null>(null);
// Provider and its context hook form one public API.
// eslint-disable-next-line react-refresh/only-export-components
export function useModelDownloads(): ModelDownloads {
  const value = useContext(Context);
  if (!value) throw new Error("Model downloads require the app download provider.");
  return value;
}
function storedQueue(): Intent[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    const unique = new Map<string, Intent>();
    for (const item of raw) {
      if (item && typeof item.modelId === "string" && typeof item.licenseSha256 === "string") unique.set(item.modelId, { modelId: item.modelId, licenseSha256: item.licenseSha256 });
    }
    return [...unique.values()];
  } catch { return []; }
}
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function sameStatuses(left: ModelDownloadStatus[], right: ModelDownloadStatus[]) {
  const values = (items: ModelDownloadStatus[]) => items.map(({ updatedAt: _updatedAt, ...status }) => status);
  return JSON.stringify(values(left)) === JSON.stringify(values(right));
}

/** App-scoped ownership: closing onboarding, drawers, and routes never drops work. */
export function ModelDownloadProvider({ children }: { children: ReactNode }) {
  const [catalog, setCatalog] = useState<ModelDownloadCatalogEntry[]>([]);
  const [statuses, setStatuses] = useState<ModelDownloadStatus[]>([]);
  const [queue, setQueue] = useState<Intent[]>(storedQueue);
  const [startingModelIds, setStarting] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [panelOpen, setPanelOpen] = useState(false);
  const launching = useRef<string | null>(null);
  const readSequence = useRef(0);
  const pollBusy = useRef(false);

  useEffect(() => { localStorage.setItem(QUEUE_KEY, JSON.stringify(queue)); }, [queue]);
  const refresh = useCallback(async () => {
    const sequence = ++readSequence.current;
    setLoading(true);
    try {
      const [entries, records] = await Promise.all([localModelDownloadCatalog(), localModelDownloadStatus()]);
      if (sequence !== readSequence.current) return;
      setCatalog((current) => JSON.stringify(current) === JSON.stringify(entries) ? current : entries);
      setStatuses((current) => sameStatuses(current, records) ? current : records);
      setLoaded(true);
      setError(null);
    } catch (failure) { if (sequence === readSequence.current) setError(message(failure)); }
    finally { if (sequence === readSequence.current) setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); return () => { readSequence.current += 1; }; }, [refresh]);
  const hasActive = statuses.some((status) => isDownloadActive(status.phase));
  useEffect(() => {
    if (!hasActive) return;
    const timer = window.setInterval(() => {
      if (pollBusy.current || launching.current) return;
      pollBusy.current = true;
      const sequence = readSequence.current;
      void localModelDownloadStatus().then((records) => {
        if (sequence !== readSequence.current) return;
        setStatuses((current) => sameStatuses(current, records) ? current : records);
        setError(null);
      }).catch((failure: unknown) => setError(message(failure))).finally(() => { pollBusy.current = false; });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [hasActive]);

  const enqueue = useCallback((ids: readonly string[]) => {
    setPanelOpen(true);
    const accepted: Intent[] = [];
    for (const modelId of ids) {
      const entry = catalog.find((item) => item.modelId === modelId);
      if (!entry?.available) {
        setErrors((current) => ({ ...current, [modelId]: "A downloadable package is not available for this model yet." }));
        continue;
      }
      const status = statuses.find((item) => item.modelId === modelId);
      if (isDownloadActive(status?.phase) || isDownloadComplete(status?.phase) || launching.current === modelId) continue;
      accepted.push({ modelId, licenseSha256: entry.licenseSha256 });
      setErrors((current) => { const next = { ...current }; delete next[modelId]; return next; });
    }
    setQueue((current) => [...current, ...accepted.filter((entry, index) => !current.some((item) => item.modelId === entry.modelId) && accepted.findIndex((item) => item.modelId === entry.modelId) === index)]);
  }, [catalog, statuses]);

  useEffect(() => {
    if (!loaded || loading || hasActive || launching.current || queue.length === 0) return;
    const intent = queue[0]!;
    const entry = catalog.find((item) => item.modelId === intent.modelId);
    const remove = () => setQueue((current) => current.filter((item) => item.modelId !== intent.modelId));
    if (!entry?.available || entry.licenseSha256 !== intent.licenseSha256) {
      setErrors((current) => ({ ...current, [intent.modelId]: "This package changed while waiting. Choose Download again to use its current license and files." }));
      remove();
      return;
    }
    if (isDownloadComplete(statuses.find((item) => item.modelId === intent.modelId)?.phase)) { remove(); return; }
    launching.current = intent.modelId;
    readSequence.current += 1;
    setStarting(new Set([intent.modelId]));
    void localModelDownloadStart({ modelId: intent.modelId, licenseSha256: intent.licenseSha256, licenseAccepted: true }).then((status) => {
      setStatuses((current) => [...current.filter((item) => item.modelId !== status.modelId), status]);
    }).catch((failure: unknown) => {
      setErrors((current) => ({ ...current, [intent.modelId]: message(failure) }));
    }).finally(() => {
      remove();
      launching.current = null;
      setStarting(new Set());
    });
  }, [catalog, hasActive, loaded, loading, queue, statuses]);

  const cancel = useCallback(async (modelId: string) => {
    if (launching.current === modelId) return;
    setQueue((current) => current.filter((item) => item.modelId !== modelId));
  }, []);
  const openPanel = useCallback(() => setPanelOpen(true), []);
  const minimize = useCallback(() => setPanelOpen(false), []);
  const value = useMemo<ModelDownloads>(() => ({ catalog, statuses, loading, error, errors, queuedModelIds: queue.map((item) => item.modelId), startingModelIds, panelOpen, enqueue, refresh, openPanel, minimize, cancel }), [catalog, statuses, loading, error, errors, queue, startingModelIds, panelOpen, enqueue, refresh, openPanel, minimize, cancel]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
