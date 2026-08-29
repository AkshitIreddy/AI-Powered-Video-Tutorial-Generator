import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { manifestDocumentFrom } from "../src/cli.js";
import { fixtureManifest } from "../src/fixture.js";

test("manifest document hash preserves cross-language numeric spelling", async () => {
  const directory = await mkdtemp(join(tmpdir(), "alystria-manifest-document-"));
  try {
    const path = join(directory, "render-manifest.json");
    const normalized = JSON.stringify(fixtureManifest());
    assert.match(normalized, /"pixelRatio":1/);
    const source = `${normalized.replace('"pixelRatio":1', '"pixelRatio":1.0')}\n`;
    await writeFile(path, source, "utf8");

    const loaded = await manifestDocumentFrom(path);
    const exactHash = createHash("sha256").update(source).digest("hex");
    const reparsedHash = createHash("sha256")
      .update(JSON.stringify(loaded.manifest))
      .digest("hex");

    assert.equal(loaded.manifest.target.pixelRatio, 1);
    assert.equal(loaded.sha256, exactHash);
    assert.notEqual(loaded.sha256, reparsedHash);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
