import { describe, expect, it } from "vitest";
import {
  LEGACY_PRESENTER_STYLE_GROUPS,
  newCastPresenterCollection,
  presenterCollection,
} from "../presenterCollection";

describe("presenter collection categories", () => {
  it("keeps every legacy presenter resolvable without offering it to a new cast", () => {
    expect(Object.keys(LEGACY_PRESENTER_STYLE_GROUPS)).toHaveLength(32);
    expect(Object.keys(LEGACY_PRESENTER_STYLE_GROUPS).every((id) => presenterCollection.has(id))).toBe(true);
    expect(Object.keys(LEGACY_PRESENTER_STYLE_GROUPS).every((id) => !newCastPresenterCollection.has(id))).toBe(true);
    expect(LEGACY_PRESENTER_STYLE_GROUPS["presenter-portrait.software-daniel-v1"]).toBe("Realistic");
    expect(LEGACY_PRESENTER_STYLE_GROUPS["presenter-portrait.anime-astrid-v1"]).toBe("Anime");
    expect(LEGACY_PRESENTER_STYLE_GROUPS["presenter-portrait.cartoon-oliver-v1"]).toBe("Cartoon");
  });

  it("offers fourteen current portraits while retaining superseded ids for resolution", () => {
    expect(presenterCollection.size).toBe(48);
    expect(presenterCollection.has("presenter-portrait.casual-realistic-emma-v1")).toBe(true);
    expect(presenterCollection.has("presenter-portrait.casual-anime-finn-v1")).toBe(true);
    expect(presenterCollection.has("presenter-portrait.casual-anime-finn-v2")).toBe(true);
    expect(presenterCollection.has("presenter-portrait.animal-lion-leo-v1")).toBe(true);
    expect(newCastPresenterCollection.size).toBe(14);
    expect(newCastPresenterCollection.has("presenter-portrait.casual-realistic-emma-v1")).toBe(true);
    expect(newCastPresenterCollection.has("presenter-portrait.casual-anime-finn-v1")).toBe(false);
    expect(newCastPresenterCollection.has("presenter-portrait.animal-kitten-peaches-v1")).toBe(false);
  });
});
