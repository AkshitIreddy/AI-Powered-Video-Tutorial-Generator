import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { inspectStarterKit, validateStarterKitManifest } from "../../contracts/src/index.js";
import { BUILT_IN_STARTER_KIT, STARTER_ASSET_COUNTS } from "../src/index.js";

describe("built-in starter kit", () => {
  it("is schema-valid and relationally complete for all ten themes", () => {
    expect(validateStarterKitManifest(BUILT_IN_STARTER_KIT)).toEqual({ valid: true, value: BUILT_IN_STARTER_KIT, issues: [] });
    expect(inspectStarterKit(BUILT_IN_STARTER_KIT)).toEqual([]);
    expect(new Set(BUILT_IN_STARTER_KIT.themePacks.map((pack) => pack.themeId))).toHaveLength(10);
  });

  it("keeps the checked-in native starter manifest identical to the TypeScript catalog", async () => {
    const manifest = JSON.parse(await readFile(resolve(process.cwd(), "starter-kits/core.v1.json"), "utf8")) as unknown;
    expect(manifest).toEqual(BUILT_IN_STARTER_KIT);
    expect((manifest as typeof BUILT_IN_STARTER_KIT).assets.filter((asset) => asset.source.availability === "ready" && asset.technical.mediaType.startsWith("image/"))).toHaveLength(55);
    expect((manifest as typeof BUILT_IN_STARTER_KIT).assets.filter((asset) => asset.kind === "presenter-portrait")).toHaveLength(52);
  });

  it("offers substantial choice with audio remaining opt-in", () => {
    expect(STARTER_ASSET_COUNTS).toMatchObject({
      background: 13, transition: 8, font: 14, "presenter-style": 12,
      "presenter-portrait": 52, music: 2, "sound-effect": 14,
    });
    const audio = BUILT_IN_STARTER_KIT.assets.filter((asset) => asset.kind === "music" || asset.kind === "sound-effect");
    expect(audio).toHaveLength(16);
    expect(audio.every((asset) => asset.source.availability === "ready" && asset.source.delivery === "bundled-file" && asset.license.exportAllowed)).toBe(true);
    expect(BUILT_IN_STARTER_KIT.defaults).toEqual({ musicEnabled: false, effectsEnabled: false, remoteFetchDuringRender: false, unknownRightsBlockExport: true });
    expect(BUILT_IN_STARTER_KIT.themePacks.every((pack) => !pack.audioDefaults.musicEnabled && !pack.audioDefaults.effectsEnabled)).toBe(true);
  });

  it("defines separate consent policies for synthetic and real presenter uploads", () => {
    const synthetic = BUILT_IN_STARTER_KIT.userAssetSlots.find((slot) => slot.id === "upload.presenter-portrait-synthetic");
    const real = BUILT_IN_STARTER_KIT.userAssetSlots.find((slot) => slot.id === "upload.presenter-portrait-real");
    expect(synthetic?.consentRequired).toBe(false);
    expect(real?.consentRequired).toBe(true);
    expect(BUILT_IN_STARTER_KIT.userAssetSlots.map((slot) => slot.kind)).toEqual(expect.arrayContaining(["background", "font", "music", "sound-effect", "presenter-portrait", "presenter-video", "logo"]));
    const portraitIds = BUILT_IN_STARTER_KIT.assets.filter((asset) => asset.kind === "presenter-portrait").map((asset) => asset.id);
    expect(portraitIds).toEqual(expect.arrayContaining(["presenter-portrait.science-zara-v1", "presenter-portrait.mathematics-arjun-v1"]));
    expect(BUILT_IN_STARTER_KIT.themePacks.every((pack) => pack.alternatives.presenterPortraitAssetIds.includes("presenter-portrait.science-zara-v1") && pack.alternatives.presenterPortraitAssetIds.includes("presenter-portrait.mathematics-arjun-v1"))).toBe(true);
    for (const id of ["presenter-portrait.science-zara-v1", "presenter-portrait.mathematics-arjun-v1"]) {
      expect(BUILT_IN_STARTER_KIT.assets.find((asset) => asset.id === id)?.license).toMatchObject({ expression: "MIT", status: "cleared", exportAllowed: true });
    }
  });

  it("binds every bundled generated image to its actual bytes", async () => {
    const bundled = BUILT_IN_STARTER_KIT.assets.filter((asset) => asset.source.delivery === "bundled-file");
    expect(bundled).toHaveLength(71);
    for (const asset of bundled) {
      const bytes = await readFile(resolve(process.cwd(), "../..", asset.source.relativePath!));
      expect(bytes.byteLength, asset.id).toBe(asset.source.byteSize);
      expect(createHash("sha256").update(bytes).digest("hex"), asset.id).toBe(asset.source.contentHash);
      if (asset.technical.mediaType === "image/png" || asset.technical.mediaType === "image/webp") {
        expect(asset.provenance).toMatchObject({ synthetic: true, reviewStatus: "verified" });
        if (asset.id.startsWith("presenter-portrait.casual-") || asset.id.startsWith("presenter-portrait.animal-")) {
          expect(asset.provenance).toMatchObject({ model: "OpenAI image_gen (model not exposed)", promptAvailability: "artifact-recorded" });
          expect(asset.provenance.notes).toContain("docs/assets/casual-presenter-prompts-2026-09-20.json");
        } else {
          expect(asset.provenance).toMatchObject({ model: "gpt-image 2.0" });
        }
        if (asset.provenance.origin === "derived") {
          expect(asset.provenance).toMatchObject({ creationMethod: "derived-edit", tool: "ImageMagick 7.1.1-43", c2paStatus: "absent" });
          expect(asset.provenance.sourceRevision).toMatch(/^OpenAI built-in imagegen source sha256 [0-9a-f]{64};/);
        } else {
          expect(asset.provenance).toMatchObject({ origin: "generated", tool: "image_gen", c2paStatus: "present-embedded" });
        }
      } else {
        expect(asset.provenance).toMatchObject({ origin: "alystria-authored", creationMethod: "procedural-code", tool: "assets/starter/audio/tools/generate.py", sourceRevision: "alystria-starter-audio-v1", reviewStatus: "verified" });
        expect(asset.license).toMatchObject({ status: "cleared", expression: "MIT", exportAllowed: true });
      }
    }
  });
});
