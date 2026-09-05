import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  bundledAssets,
  importBundledAsset,
  verifyBundledAssetBytes,
  type BundledAsset,
} from "../bundledAssets";
import type { ProjectAssetImportReceipt, ProjectAssetImportRequest } from "../native";

const assetRoot = resolve(import.meta.dirname, "../assets");

async function assetBytes(asset: BundledAsset): Promise<Uint8Array> {
  return new Uint8Array(await readFile(resolve(assetRoot, "teaching", asset.filename)));
}

function responseFromBytes(bytes: Uint8Array): Response {
  const body = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);
  return new Response(body);
}

function receipt(asset: BundledAsset): ProjectAssetImportReceipt {
  return {
    projectId: "project-1",
    headRevisionId: "revision-2",
    revisionNumber: 2,
    artifact: {
      id: `asset-${asset.id}`,
      kind: asset.kind === "background" ? "backgroundImage" : "editorImage",
      sha256: asset.sha256,
      byteSize: asset.byteSize,
      mediaType: "image/png",
      originalFilename: asset.filename,
      state: "promoted",
    },
    provenance: {
      id: `provenance-${asset.id}`,
      origin: "userImport",
      rightsStatus: "owned",
      creator: "AI Video Tutorial Generator built-in image library",
      license: "Included generated asset · project use and export allowed",
      exportEligible: true,
      blockers: [],
    },
  };
}

describe("included offline asset manifest", () => {
  it("pins every generated slide asset to its checked-in bytes", async () => {
    expect(bundledAssets).toHaveLength(12);
    expect(new Set(bundledAssets.map((asset) => asset.id)).size).toBe(12);
    expect(bundledAssets.filter((asset) => asset.kind === "background")).toHaveLength(4);
    expect(bundledAssets.filter((asset) => asset.kind === "element")).toHaveLength(8);
    for (const asset of bundledAssets) {
      expect(asset.filename).toMatch(/-v1\.png$/u);
      expect(asset.sha256).toMatch(/^[a-f0-9]{64}$/u);
      await expect(verifyBundledAssetBytes(asset, await assetBytes(asset))).resolves.toBeUndefined();
    }
  });

  it("refuses changed bytes before calling the native importer", async () => {
    const asset = bundledAssets[0]!;
    const importAsset = vi.fn();
    const changed = new Uint8Array(asset.byteSize);
    await expect(importBundledAsset(asset, {
      projectId: "project-1",
      projectDirectory: "C:\\Projects\\Lesson",
      expectedHeadRevisionId: "revision-1",
    }, {
      fetchAsset: vi.fn(async () => responseFromBytes(changed)),
      importAsset,
    })).rejects.toThrow(/SHA-256 check/u);
    expect(importAsset).not.toHaveBeenCalled();
  });

  it("imports an element with included-generated rights", async () => {
    const assetId = "biology-seedling";
    const expectedKind = "editorImage";
    const asset = bundledAssets.find((candidate) => candidate.id === assetId)!;
    const bytes = await assetBytes(asset);
    let request: ProjectAssetImportRequest | undefined;
    const importAsset = vi.fn(async (input: ProjectAssetImportRequest) => {
      request = input;
      return receipt(asset);
    });
    await importBundledAsset(asset, {
      projectId: "project-1",
      projectDirectory: "C:\\Projects\\Lesson",
      expectedHeadRevisionId: "revision-1",
    }, {
      fetchAsset: vi.fn(async () => responseFromBytes(bytes)),
      importAsset,
    });

    expect(request).toMatchObject({
      expectedHeadRevisionId: "revision-1",
      kind: expectedKind,
      filename: asset.filename,
      mimeType: "image/png",
      privacy: "public",
      rights: {
        status: "owned",
        creator: "AI Video Tutorial Generator built-in image library",
        commercialUse: "allowed",
        redistribution: "allowed",
        modelInput: "allowed",
      },
    });
    expect(request?.contentBase64.length).toBeGreaterThan(asset.byteSize);
  });

  it("imports a slide surface as a selectable background", async () => {
    const asset = bundledAssets.find((candidate) => candidate.id === "slide-paper")!;
    const bytes = await assetBytes(asset);
    const importAsset = vi.fn(async () => receipt(asset));

    await importBundledAsset(asset, {
      projectId: "project-1",
      projectDirectory: "C:\\Projects\\Lesson",
      expectedHeadRevisionId: "revision-1",
    }, {
      fetchAsset: vi.fn(async () => responseFromBytes(bytes)),
      importAsset,
    });

    expect(importAsset).toHaveBeenCalledWith(expect.objectContaining({
      kind: "backgroundImage",
      filename: "slide-paper-v1.png",
      expectedHeadRevisionId: "revision-1",
    }));
  });
});
