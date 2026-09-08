import test from "node:test";
import assert from "node:assert/strict";
import { assertResumableMaster, rendererIdentity } from "./native-resumed-master.mjs";

const components = [{ relativePath: "renderer\\main.js", sha256: "a".repeat(64) }, { relativePath: "ffmpeg/ffmpeg.exe", sha256: "b".repeat(64) }];
const identity = rendererIdentity(components);
const expected = { jobId: "master", generationId: "generation", codecPreference: "h264-hardware" };
function fixture() {
  const params = { baseGenerationId: "generation", codecPreference: "h264-hardware", target: { fps: 30, width: 1920, height: 1080 }, rendererRuntimeIdentitySha256: identity };
  const result = { generationId: "generation", rendererRuntimeIdentitySha256: identity, artifactHash: "c".repeat(64) };
  const receipt = { schemaVersion: 2, exportJobId: "master", generationId: "generation", rendererRuntimeIdentitySha256: identity, videoArtifactHash: result.artifactHash };
  const row = { kind: "native.export_master", state: "SUCCEEDED", parameters_json: JSON.stringify(params), result_json: JSON.stringify(result) };
  return { row, receipt };
}
test("renderer identity ignores worker-only refresh but detects media tool changes", () => {
  assert.equal(rendererIdentity([...components].reverse()), identity);
  assert.equal(rendererIdentity([...components, { relativePath: "alystria-pipeline.exe", sha256: "d".repeat(64) }]), identity);
  assert.notEqual(rendererIdentity([{ ...components[0], sha256: "e".repeat(64) }, components[1]]), identity);
});
test("accepts only the explicitly named verified successful master", () => {
  const { row, receipt } = fixture();
  assert.equal(assertResumableMaster(row, expected, identity, receipt).artifactHash, receipt.videoArtifactHash);
  for (const state of ["RUNNING", "FAILED", "CANCELLED"]) {
    assert.throws(() => assertResumableMaster({ ...row, state }, expected, identity, receipt));
  }
  for (const change of [{ jobId: "another" }, { generationId: "another" }, { codecPreference: "hevc-hardware" }]) {
    assert.throws(() => assertResumableMaster(row, { ...expected, ...change }, identity, receipt));
  }
  assert.throws(() => assertResumableMaster(row, expected, "f".repeat(64), receipt));
  assert.throws(() => assertResumableMaster(row, expected, identity, { ...receipt, videoArtifactHash: "f".repeat(64) }));
  assert.throws(() => assertResumableMaster(row, expected, identity, { ...receipt, schemaVersion: 1 }));
});
