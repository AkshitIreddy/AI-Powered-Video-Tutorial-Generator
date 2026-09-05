import { secondsToFrames } from "./timecode";
import type { EditorMediaAsset, FrameRate } from "./types";

export interface EditorWaveformProfile {
  width: number;
  height: number;
}

export interface EditorWaveformNativeRequest {
  projectId: string;
  projectDirectory: string;
  artifactHash: string;
  profile: EditorWaveformProfile;
}

export interface EditorWaveformNativeReceipt {
  projectId: string;
  artifactHash: string;
  profile: EditorWaveformProfile;
  waveformHash: string;
  waveformPath: string;
  mediaType: "image/png";
  width: number;
  height: number;
  durationTicks: number;
}

export interface EditorWaveformPreview {
  artifactHash: string;
  waveformHash: string;
  url: string;
  width: number;
  height: number;
  durationFrames: number;
}

export async function resolveEditorWaveformNative(
  asset: EditorMediaAsset,
  frameRate: FrameRate,
  identity: { projectId: string; projectDirectory: string },
  invoke: (request: EditorWaveformNativeRequest) => Promise<EditorWaveformNativeReceipt>,
  pathToUrl: (path: string) => string,
  profile: EditorWaveformProfile = { width: 2048, height: 72 },
): Promise<EditorWaveformPreview> {
  if ((asset.kind !== "audio" && asset.kind !== "video") || asset.status !== "ready" || !asset.hash || !/^[0-9a-f]{64}$/u.test(asset.hash)) throw new Error(`${asset.name} has no renderable CAS media for waveform analysis.`);
  const receipt = await invoke({ ...identity, artifactHash: asset.hash, profile });
  if (receipt.projectId !== identity.projectId || receipt.artifactHash !== asset.hash || receipt.mediaType !== "image/png" || receipt.width !== profile.width || receipt.height !== profile.height || receipt.profile.width !== profile.width || receipt.profile.height !== profile.height || !/^[0-9a-f]{64}$/u.test(receipt.waveformHash) || !receipt.waveformPath || !Number.isInteger(receipt.durationTicks) || receipt.durationTicks <= 0) throw new Error(`Native waveform analysis returned an invalid receipt for ${asset.name}.`);
  return {
    artifactHash: asset.hash,
    waveformHash: receipt.waveformHash,
    url: pathToUrl(receipt.waveformPath),
    width: receipt.width,
    height: receipt.height,
    durationFrames: Math.max(1, secondsToFrames(receipt.durationTicks / 240_000, frameRate)),
  };
}
