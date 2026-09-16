import type { ModelDownloadPhase } from "../native";
const ACTIVE = new Set<ModelDownloadPhase>(["downloading", "verifying", "installing", "activating", "repairing", "cancelling", "removing"]);
export const isDownloadActive = (phase: ModelDownloadPhase | undefined) => phase !== undefined && ACTIVE.has(phase);
export const isDownloadComplete = (phase: ModelDownloadPhase | undefined) => phase === "ready" || phase === "inUse" || phase === "downloadedQuarantined";

export function downloadPhaseLabel(phase: ModelDownloadPhase | undefined): string {
  switch (phase) {
    case "downloading": return "Downloading";
    case "verifying": return "Checking files";
    case "installing": return "Installing";
    case "activating": return "Preparing model";
    case "ready": case "inUse": return "Installed";
    case "downloadedQuarantined": return "Files downloaded";
    case "failed": case "corrupt": return "Needs attention";
    case "cancelled": return "Interrupted";
    default: return "Ready to download";
  }
}
