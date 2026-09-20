import { describe, expect, it } from "vitest";
import { CASUAL_PRESENTER_CATALOG, CASUAL_PRESENTER_SELECTABLE_IDS } from "@alystria/themes";
import {
  CASUAL_PRESENTER_ASSETS,
  CASUAL_PRESENTER_IDS,
  CASUAL_PRESENTER_PERSONAS,
} from "../casualPresenterLibrary";

describe("casual presenter desktop library", () => {
  it("keeps the static imports, canonical metadata, and studio assets in lockstep", () => {
    expect(CASUAL_PRESENTER_IDS).toHaveLength(15);
    expect(Object.keys(CASUAL_PRESENTER_PERSONAS)).toEqual(CASUAL_PRESENTER_IDS);
    expect(CASUAL_PRESENTER_ASSETS.map((asset) => asset.id)).toEqual(CASUAL_PRESENTER_IDS);

    for (const presenter of CASUAL_PRESENTER_CATALOG) {
      expect(CASUAL_PRESENTER_PERSONAS[presenter.id]).toMatchObject({
        styleGroup: presenter.styleGroup,
        focalPoint: presenter.focalPoint,
        lipSync: {
          preferredEngineId: presenter.lipSync.preferredEngineId,
          qualifications: presenter.lipSync.qualifications,
        },
      });
      expect(CASUAL_PRESENTER_ASSETS.find((asset) => asset.id === presenter.id)).toMatchObject({
        filename: presenter.filename,
        mediaType: "image/png",
        byteSize: presenter.byteSize,
        sha256: presenter.contentHash,
        rightsStatus: "cleared",
      });
    }
    expect(CASUAL_PRESENTER_SELECTABLE_IDS).toHaveLength(14);
    expect(CASUAL_PRESENTER_PERSONAS["presenter-portrait.casual-anime-finn-v1"].hiddenFromGallery).toBe(true);
    expect(CASUAL_PRESENTER_PERSONAS["presenter-portrait.casual-anime-finn-v2"].hiddenFromGallery).toBeUndefined();
  });

  it("features the requested woman, anime, man, and cartoon sequence first", () => {
    const ordered = CASUAL_PRESENTER_CATALOG
      .filter((entry) => entry.featuredRank !== undefined)
      .toSorted((left, right) => left.featuredRank! - right.featuredRank!);
    expect(ordered.map((entry) => entry.displayName)).toEqual(["Emma", "Yuki", "Noah", "Chloe"]);
  });
});
