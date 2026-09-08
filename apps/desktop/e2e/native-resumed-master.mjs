import { createHash } from "node:crypto";

export function rendererIdentity(components) {
  const entries = components.map(item => [item.relativePath.replaceAll("\\", "/"), item.sha256])
    .filter(([relative]) => /^(renderer|node|chromium|ffmpeg)\//u.test(relative))
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  if (!entries.length) throw new Error("No declared renderer components");
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}

export function assertResumableMaster(row, expected, identity, receipt) {
  const params = row ? JSON.parse(row.parameters_json) : null;
  const result = row?.result_json ? JSON.parse(row.result_json) : null;
  if (row?.kind !== "native.export_master" || row.state !== "SUCCEEDED"
    || params?.baseGenerationId !== expected.generationId
    || params?.codecPreference !== expected.codecPreference
    || params?.target?.fps !== 30 || params?.target?.width !== 1920 || params?.target?.height !== 1080
    || params?.rendererRuntimeIdentitySha256 !== identity
    || result?.generationId !== expected.generationId
    || result?.rendererRuntimeIdentitySha256 !== identity
    || receipt?.schemaVersion !== 2 || receipt.exportJobId !== expected.jobId
    || receipt.generationId !== expected.generationId
    || receipt.rendererRuntimeIdentitySha256 !== identity
    || receipt.videoArtifactHash !== result.artifactHash
    || !/^[0-9a-f]{64}$/u.test(result.artifactHash ?? "")) {
    throw new Error("Requested master is not a successful matching 1080p30 export from the installed renderer");
  }
  return result;
}
