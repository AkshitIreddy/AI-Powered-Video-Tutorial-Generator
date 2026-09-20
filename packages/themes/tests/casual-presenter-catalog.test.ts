import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CASUAL_PRESENTER_CATALOG,
  CASUAL_PRESENTER_IDS,
  CASUAL_PRESENTER_PLANS,
  CASUAL_PRESENTER_STARTER_ASSETS,
  casualPresenterStarterAsset,
  defineCasualPresenter,
} from "../src/casualPresenterCatalog.js";

const HASH_A = "a".repeat(64);

function verifiedDetails() {
  return {
    label: "Emma · casual tutor",
    description: "A fictional synthetic casual tutor.",
    tags: ["presenter", "casual", "synthetic"],
    style: "Natural editorial portrait",
    background: "Quiet home study",
    focalPoint: "50% 20%",
    voiceDirection: "Warm adult tutor · clear and conversational",
    fileExtension: "png" as const,
    mediaType: "image/png" as const,
    contentHash: HASH_A,
    byteSize: 42_000,
    width: 768,
    height: 768,
    c2paStatus: "unsupported" as const,
    generationTool: "OpenAI built-in imagegen",
    generationModel: "OpenAI image_gen (model not exposed)",
    promptRecordPath: "docs/assets/casual-presenter-prompts-2026-09-20.json",
    recordedAt: "2026-09-20T00:00:00.000Z" as const,
    lipSync: {
      preferredEngineId: "liveportrait-musetalk-1.5",
      qualifications: [{
        engineId: "liveportrait-musetalk-1.5",
        displayName: "LivePortrait + MuseTalk 1.5",
        outcome: "reviewed-compatible",
        notes: "Front-facing mouth and chin remain unobstructed.",
      }],
    } as const,
  };
}

describe("casual presenter catalog", () => {
  it("keeps all planned ids unique and leads with woman, anime, man, and cartoon tutors", () => {
    expect(CASUAL_PRESENTER_IDS).toHaveLength(14);
    expect(new Set(CASUAL_PRESENTER_IDS).size).toBe(14);
    expect(CASUAL_PRESENTER_PLANS.filter((entry) => entry.featuredRank !== undefined)
      .toSorted((left, right) => left.featuredRank! - right.featuredRank!)
      .map((entry) => entry.displayName)).toEqual(["Emma", "Yuki", "Noah", "Chloe"]);
  });

  it("publishes every verified static portrait while keeping runtime qualification separate", () => {
    expect(CASUAL_PRESENTER_CATALOG.map((entry) => entry.id)).toEqual(CASUAL_PRESENTER_IDS);
    expect(CASUAL_PRESENTER_STARTER_ASSETS.map((entry) => entry.id)).toEqual(CASUAL_PRESENTER_IDS);
    expect(CASUAL_PRESENTER_STARTER_ASSETS.every((entry) => entry.source.availability === "ready")).toBe(true);
    expect(CASUAL_PRESENTER_CATALOG.filter((entry) => entry.lipSync.qualifications.some((review) => review.outcome === "reviewed-compatible")).map((entry) => entry.displayName))
      .toEqual(["Emma", "Yuki", "Noah", "Chloe", "Maya", "Lena"]);
    expect(CASUAL_PRESENTER_CATALOG.filter((entry) => entry.styleGroup === "Animal").every((entry) => (
      entry.lipSync.preferredEngineId === "joyvasa-animal"
      && entry.lipSync.qualifications.some((review) => review.engineId === "liveportrait-musetalk-1.5" && review.outcome === "incompatible")
      && entry.lipSync.qualifications.some((review) => review.engineId === "joyvasa-animal" && review.outcome === "pending-review")
    ))).toBe(true);
    const finnReview = CASUAL_PRESENTER_CATALOG.find((entry) => entry.displayName === "Finn")?.lipSync;
    expect(finnReview?.preferredEngineId).toBe("joyvasa-human");
    expect(finnReview?.qualifications).toEqual(expect.arrayContaining([
        { engineId: "liveportrait-musetalk-1.5", outcome: "incompatible" },
        { engineId: "joyvasa-human", outcome: "pending-review" },
      ].map((entry) => expect.objectContaining(entry))));
    expect(CASUAL_PRESENTER_CATALOG.find((entry) => entry.displayName === "Pip")?.lipSync.preferredEngineId).toBe("joyvasa-animal");
  });

  it("binds the catalog to the actual PNG bytes, dimensions, and embedded C2PA carrier", async () => {
    for (const presenter of CASUAL_PRESENTER_CATALOG) {
      const bytes = await readFile(resolve(process.cwd(), "../..", presenter.relativePath));
      expect(bytes.byteLength, presenter.id).toBe(presenter.byteSize);
      expect(createHash("sha256").update(bytes).digest("hex"), presenter.id).toBe(presenter.contentHash);
      expect(bytes.subarray(1, 4).toString("ascii"), presenter.id).toBe("PNG");
      expect(bytes.readUInt32BE(16), presenter.id).toBe(presenter.width);
      expect(bytes.readUInt32BE(20), presenter.id).toBe(presenter.height);
      const chunkTypes: string[] = [];
      let offset = 8;
      while (offset + 12 <= bytes.length) {
        const length = bytes.readUInt32BE(offset);
        const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
        chunkTypes.push(type);
        offset += length + 12;
        if (type === "IEND") break;
      }
      expect(chunkTypes, presenter.id).toContain("caBX");
      expect(presenter.c2paStatus, presenter.id).toBe("present-embedded");
    }
  });

  it("uses explicit character and animal groups instead of name heuristics", () => {
    expect(CASUAL_PRESENTER_PLANS.find((entry) => entry.displayName === "Pip")?.styleGroup).toBe("Character");
    expect(CASUAL_PRESENTER_PLANS.filter((entry) => entry.styleGroup === "Animal").map((entry) => entry.displayName))
      .toEqual(["Milo", "Peaches", "Buddy", "Poppy", "Tavi", "Leo"]);
  });

  it("derives delivery paths and a ready starter asset only from verified details", () => {
    const presenter = defineCasualPresenter(CASUAL_PRESENTER_PLANS[0], verifiedDetails());
    expect(presenter.filename).toBe("casual-realistic-emma-v1.png");
    expect(presenter.relativePath).toBe("apps/desktop/src/assets/presenters/casual-realistic-emma-v1.png");
    expect(casualPresenterStarterAsset(presenter)).toMatchObject({
      id: presenter.id,
      source: { availability: "ready", contentHash: HASH_A, byteSize: 42_000 },
      technical: { dimensions: { width: 768, height: 768 } },
    });
  });

  it("keeps a verified static portrait ready while its separate lip-sync review is pending", () => {
    const presenter = defineCasualPresenter(CASUAL_PRESENTER_PLANS[0], {
      ...verifiedDetails(),
      lipSync: {
        preferredEngineId: "joyvasa-human",
        qualifications: [{
          engineId: "joyvasa-human",
          displayName: "JoyVASA character route",
          outcome: "pending-review",
          notes: "Static portrait verified; animation suitability has not been tested.",
        }],
      },
    });
    expect(casualPresenterStarterAsset(presenter).source.availability).toBe("ready");
    expect(presenter.lipSync.qualifications[0]?.outcome).toBe("pending-review");
  });

  it("refuses unverified hashes, dimensions, sizes, media pairs, or review state notes", () => {
    const plan = CASUAL_PRESENTER_PLANS[0];
    expect(() => defineCasualPresenter(plan, { ...verifiedDetails(), contentHash: "pending" })).toThrow(/SHA-256/);
    expect(() => defineCasualPresenter(plan, { ...verifiedDetails(), byteSize: 0 })).toThrow(/byte size/);
    expect(() => defineCasualPresenter(plan, { ...verifiedDetails(), width: 0 })).toThrow(/pixel dimensions/);
    expect(() => defineCasualPresenter(plan, { ...verifiedDetails(), mediaType: "image/webp" })).toThrow(/media type/);
    expect(() => defineCasualPresenter(plan, { ...verifiedDetails(), lipSync: { preferredEngineId: "joyvasa-human", qualifications: [] } })).toThrow(/lip-sync qualifications/);
    expect(() => defineCasualPresenter(plan, { ...verifiedDetails(), lipSync: {
      preferredEngineId: "joyvasa-human",
      qualifications: [{ engineId: "liveportrait-musetalk-1.5", displayName: "MuseTalk", outcome: "incompatible", notes: "Rejected." }],
    } })).toThrow(/preferred engine/);
  });
});
