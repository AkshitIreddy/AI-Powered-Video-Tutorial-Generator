import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  localModelDownloadCatalog,
  localModelDownloadStart,
  localModelDownloadStatus,
  type ModelDownloadCatalogEntry,
  type ModelDownloadPhase,
  type ModelDownloadStatus,
} from "../native";

const ACTIVE_PHASES = new Set<ModelDownloadPhase>([
  "downloading",
  "verifying",
  "installing",
  "activating",
  "repairing",
  "cancelling",
]);

export interface OnboardingModelDownloads {
  catalog: readonly ModelDownloadCatalogEntry[];
  statuses: readonly ModelDownloadStatus[];
  loading: boolean;
  error: string | null;
  startingModelIds: ReadonlySet<string>;
  queuedModelIds: readonly string[];
  refresh: () => Promise<void>;
  start: (entry: ModelDownloadCatalogEntry) => Promise<void>;
  queue: (entries: readonly ModelDownloadCatalogEntry[]) => void;
  clearQueue: () => void;
}

function messageFromError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "The selected download could not be started. Check the model details and try again.";
}

function replaceStatus(
  statuses: readonly ModelDownloadStatus[],
  next: ModelDownloadStatus,
): ModelDownloadStatus[] {
  const index = statuses.findIndex((status) => status.modelId === next.modelId);
  if (index < 0) return [...statuses, next];
  const updated = [...statuses];
  updated[index] = next;
  return updated;
}

/**
 * Loads and drives the native, hash-verified model download manager from the
 * onboarding surface. Browser preview mode exposes declarations but rejects
 * start requests, so it never fetches model bytes.
 */
export function useOnboardingModelDownloads(enabled: boolean): OnboardingModelDownloads {
  const [catalog, setCatalog] = useState<ModelDownloadCatalogEntry[]>([]);
  const [statuses, setStatuses] = useState<ModelDownloadStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startingModelIds, setStartingModelIds] = useState<Set<string>>(() => new Set());
  const [queuedModelIds, setQueuedModelIds] = useState<string[]>([]);
  const requestSequence = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++requestSequence.current;
    setLoading(true);
    try {
      const [nextCatalog, nextStatuses] = await Promise.all([
        localModelDownloadCatalog(),
        localModelDownloadStatus(),
      ]);
      if (request !== requestSequence.current) return;
      setCatalog(nextCatalog);
      setStatuses(nextStatuses);
      setError(null);
    } catch (nextError) {
      if (request === requestSequence.current) setError(messageFromError(nextError));
    } finally {
      if (request === requestSequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
  }, [enabled, refresh]);

  const hasActiveDownload = statuses.some((status) => ACTIVE_PHASES.has(status.phase));
  useEffect(() => {
    if (!enabled || !hasActiveDownload) return;
    const timer = window.setInterval(() => { void refresh(); }, 1_000);
    return () => window.clearInterval(timer);
  }, [enabled, hasActiveDownload, refresh]);

  const start = useCallback(async (entry: ModelDownloadCatalogEntry) => {
    setStartingModelIds((current) => new Set(current).add(entry.modelId));
    setError(null);
    try {
      const status = await localModelDownloadStart({
        modelId: entry.modelId,
        licenseSha256: entry.licenseSha256,
        licenseAccepted: true,
      });
      setStatuses((current) => replaceStatus(current, status));
    } catch (nextError) {
      setError(messageFromError(nextError));
      throw nextError;
    } finally {
      setStartingModelIds((current) => {
        const next = new Set(current);
        next.delete(entry.modelId);
        return next;
      });
    }
  }, []);

  const queue = useCallback((entries: readonly ModelDownloadCatalogEntry[]) => {
    setQueuedModelIds((current) => [
      ...current,
      ...entries.map((entry) => entry.modelId).filter((modelId) => !current.includes(modelId)),
    ]);
  }, []);

  const clearQueue = useCallback(() => {
    setQueuedModelIds([]);
  }, []);

  useEffect(() => {
    if (!enabled || hasActiveDownload || startingModelIds.size > 0 || queuedModelIds.length === 0) return;
    const modelId = queuedModelIds[0]!;
    const entry = catalog.find((candidate) => candidate.modelId === modelId);
    setQueuedModelIds((current) => current.filter((candidate) => candidate !== modelId));
    if (!entry) return;
    void start(entry).catch(() => undefined);
  }, [catalog, enabled, hasActiveDownload, queuedModelIds, start, startingModelIds.size]);

  return useMemo(() => ({
    catalog,
    statuses,
    loading,
    error,
    startingModelIds,
    queuedModelIds,
    refresh,
    start,
    queue,
    clearQueue,
  }), [catalog, clearQueue, error, loading, queue, queuedModelIds, refresh, start, startingModelIds, statuses]);
}

export function isActiveModelDownloadPhase(phase: ModelDownloadPhase | undefined): boolean {
  return phase !== undefined && ACTIVE_PHASES.has(phase);
}
