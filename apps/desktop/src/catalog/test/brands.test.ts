import { describe, expect, it } from "vitest";
import { getProviderBrandAsset } from "../brands";

describe("provider brand governance", () => {
  it.each(["openai", "anthropic", "gemini", "elevenlabs"])("bundles reviewed official artwork for %s", (providerId) => {
    const brand = getProviderBrandAsset(providerId);
    expect(brand.providerId).toBe(providerId);
    expect(brand.reviewState).toBe("approved");
    expect(brand.mayRender).toBe(true);
    expect(brand.assetPath).toMatch(/(?:\.svg$|^data:image\/svg\+xml)/u);
    expect(brand.officialSourceUrl).toMatch(/^https:\/\//u);
    expect(brand.trademarkGuidelinesUrl).toMatch(/^https:\/\//u);
    expect(brand.attributionText).toBeTruthy();
  });

  it("keeps unknown provider artwork out of the renderer", () => {
    const brand = getProviderBrandAsset("unreviewed-provider");
    expect(brand.reviewState).toBe("not-reviewed");
    expect(brand.mayRender).toBe(false);
    expect(brand.assetPath).toBeNull();
  });
});
