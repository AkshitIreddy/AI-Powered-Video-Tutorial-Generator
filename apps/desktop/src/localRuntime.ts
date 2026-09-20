import type { ModelDownloadCatalogEntry, ModelDownloadStatus } from "./native";

export const COMFYUI_RUNTIME_PACKAGE_ID = "runtime/comfyui-0.9.2";
export const COMFYUI_RUNTIME_VERSION = "0.9.2";

/** Image packs installed through the native ManagedComfy flow. */
const MANAGED_COMFY_PACK_IDS: ReadonlySet<string> = new Set([
  "local/sdxl-base-1.0",
  "local/flux.2-klein-4b-fp8",
  "local/z-image-turbo-int8",
]);

function normalizedPackageId(value: string): string {
  return value.trim().replaceAll("\\", "/").toLowerCase();
}

export function isComfyuiRuntimePackage(modelId: string): boolean {
  return normalizedPackageId(modelId) === COMFYUI_RUNTIME_PACKAGE_ID;
}

export function packRequiresComfyui(modelId: string): boolean {
  return MANAGED_COMFY_PACK_IDS.has(normalizedPackageId(modelId));
}

export function isVerifiedComfyuiRuntime(status: ModelDownloadStatus | undefined): boolean {
  if (!status || !isComfyuiRuntimePackage(status.modelId)) return false;
  if (status.phase !== "ready" && status.phase !== "inUse") return false;
  if (status.activationBlocked) return false;
  if (!status.runtimeRevision?.trim()) return false;
  return /^[a-f0-9]{64}$/.test(status.installFingerprint ?? "");
}

/** Runtime availability is derived only from the dedicated native package receipt. */
export function comfyuiVersionFromStatuses(statuses: readonly ModelDownloadStatus[]): string | null {
  return statuses.some((status) => isVerifiedComfyuiRuntime(status)) ? COMFYUI_RUNTIME_VERSION : null;
}

/** Every managed image pack needs the dedicated runtime package first. */
export function shouldPromptForRuntime(modelId: string, comfyInstalled: boolean): boolean {
  return !comfyInstalled && packRequiresComfyui(modelId);
}

export function comfyuiRuntimeEntry(catalog: readonly ModelDownloadCatalogEntry[]): ModelDownloadCatalogEntry | null {
  return catalog.find((entry) => isComfyuiRuntimePackage(entry.modelId)) ?? null;
}

export function comfyuiRuntimeStatus(statuses: readonly ModelDownloadStatus[]): ModelDownloadStatus | null {
  return statuses.find((status) => isComfyuiRuntimePackage(status.modelId)) ?? null;
}
