import { describe, expect, it } from "vitest";
import { LEGACY_PRESENTER_STYLE_GROUPS, presenterCollection } from "../presenterCollection";

describe("presenter collection categories", () => {
  it("keeps every legacy curated presenter selectable with an explicit style group", () => {
    expect(Object.keys(LEGACY_PRESENTER_STYLE_GROUPS)).toHaveLength(32);
    expect(Object.keys(LEGACY_PRESENTER_STYLE_GROUPS).every((id) => presenterCollection.has(id))).toBe(true);
    expect(LEGACY_PRESENTER_STYLE_GROUPS["presenter-portrait.software-daniel-v1"]).toBe("Realistic");
    expect(LEGACY_PRESENTER_STYLE_GROUPS["presenter-portrait.anime-astrid-v1"]).toBe("Anime");
    expect(LEGACY_PRESENTER_STYLE_GROUPS["presenter-portrait.cartoon-oliver-v1"]).toBe("Cartoon");
  });

  it("adds fourteen current casual portraits and keeps the superseded Finn id resolvable", () => {
    expect(presenterCollection.size).toBe(47);
    expect(presenterCollection.has("presenter-portrait.casual-realistic-emma-v1")).toBe(true);
    expect(presenterCollection.has("presenter-portrait.casual-anime-finn-v1")).toBe(true);
    expect(presenterCollection.has("presenter-portrait.casual-anime-finn-v2")).toBe(true);
    expect(presenterCollection.has("presenter-portrait.animal-lion-leo-v1")).toBe(true);
  });
});
