import { describe, expect, it } from "vitest";
import {
  BUILT_IN_THEME_PACKS,
  THEME_PACK_IDS,
  ThemeValidationError,
  auditThemeContrast,
  compileTheme,
  contrastRatio,
  createThemeCssVariables,
  getBuiltInTheme,
  listBuiltInThemes,
  resolveLocaleTypography,
  serializeThemeCss,
  validateBrandKit,
  validateThemePack,
} from "../src/index.js";
import type { BrandKit, ColorHex } from "../src/index.js";
import { createThemeSpecimenData, createThemeSpecimenHtml } from "../src/specimen.js";

describe("built-in theme catalog", () => {
  it("contains the exact ten required hand-authored packs in stable order", () => {
    expect(BUILT_IN_THEME_PACKS.map((theme) => theme.id)).toEqual(THEME_PACK_IDS);
    expect(BUILT_IN_THEME_PACKS).toHaveLength(10);
    expect(new Set(BUILT_IN_THEME_PACKS.map((theme) => theme.visualBible.signatureMotif)).size).toBe(10);
    expect(new Set(BUILT_IN_THEME_PACKS.map((theme) => theme.description)).size).toBe(10);
  });

  it.each(BUILT_IN_THEME_PACKS.map((theme) => [theme.id, theme] as const))(
    "%s passes structure, visual-bible, and contrast validation",
    (_id, theme) => {
      const validation = validateThemePack(theme);
      expect(validation.diagnostics, JSON.stringify(validation.diagnostics, null, 2)).toEqual([]);
      expect(validation.valid).toBe(true);
      expect(auditThemeContrast(theme.palette).passed).toBe(true);
      expect(theme.visualBible.noGo.length).toBeGreaterThanOrEqual(4);
      expect(theme.rules.illustration.avoid.length).toBeGreaterThanOrEqual(3);
      expect(theme.rules.transitions.avoid.length).toBeGreaterThanOrEqual(3);
    },
  );

  it("returns defensive copies of catalog values", () => {
    const first = listBuiltInThemes();
    const second = listBuiltInThemes();
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first[0]).not.toBe(second[0]);
    expect(getBuiltInTheme("light")).not.toBe(getBuiltInTheme("light"));
  });
});

describe("contrast math", () => {
  it("matches WCAG reference values", () => {
    expect(contrastRatio("#000000" as ColorHex, "#FFFFFF" as ColorHex)).toBeCloseTo(21, 8);
    expect(contrastRatio("#777777" as ColorHex, "#FFFFFF" as ColorHex)).toBeCloseTo(4.478, 2);
  });
});

describe("theme compiler", () => {
  it("is byte-deterministic for the same input", () => {
    const first = compileTheme("light", { locale: "en-US", contrastPolicy: "reject" });
    const second = compileTheme("light", { locale: "en-US", contrastPolicy: "reject" });
    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.cssText).toBe(second.cssText);
    expect(Object.keys(first.cssVariables)).toEqual([...Object.keys(first.cssVariables)].sort());
    expect(first.cssText).not.toContain("undefined");
    expect(first.cssText.endsWith("\n")).toBe(true);
  });

  it("adds Devanagari fallbacks without removing the chosen Latin families", () => {
    const english = compileTheme("academic", { locale: "en", contrastPolicy: "reject" });
    const hindi = compileTheme("academic", { locale: "hi-IN", contrastPolicy: "reject" });
    expect(english.typography.heading.families[0]).toBe("Source Serif 4");
    expect(hindi.typography.heading.families.slice(0, 2)).toEqual(["Noto Serif Devanagari", "Nirmala UI"]);
    expect(hindi.typography.heading.families).toContain("Source Serif 4");
    expect(hindi.typography.body.families[0]).toBe("Noto Sans Devanagari");
    expect(hindi.locale).toBe("hi-IN");
  });

  it("keeps English and Spanish typography Latin Extended and stable", () => {
    const base = getBuiltInTheme("minimal").typography;
    expect(resolveLocaleTypography(base, "en-GB")).toEqual(base);
    expect(resolveLocaleTypography(base, "es-MX")).toEqual(base);
  });

  it("applies safe brand overrides while preserving fallback stacks and rules", () => {
    const kit: BrandKit = {
      id: "brand.acme",
      name: "Acme Learning",
      baseThemeId: "light",
      palette: { accent: "#204EA3", accentStrong: "#173A78", accentSoft: "#E4ECFB" },
      typography: { displayFamilies: ["Acme Display"], displayWeight: 800, bodyFamilies: ["Acme Sans"] },
      spacing: { radiusMedium: 4, density: "compact" },
      signatureMotif: "An angled cobalt rule connects every decision to its outcome.",
      requiredAttribution: "Acme Learning",
    };
    const compiled = compileTheme("light", { locale: "es-ES", brandKit: kit, contrastPolicy: "reject" });
    expect(compiled.brandKitId).toBe("brand.acme");
    expect(compiled.name).toBe("Acme Learning · Light");
    expect(compiled.palette.accent).toBe("#204EA3");
    expect(compiled.typography.display.families.slice(0, 2)).toEqual(["Acme Display", "Bricolage Grotesque"]);
    expect(compiled.typography.body.families).toContain("Atkinson Hyperlegible Next");
    expect(compiled.spacing.radiusMedium).toBe(4);
    expect(compiled.spacing.density).toBe("compact");
    expect(compiled.visualBible.continuityRules.at(-1)).toContain("Acme Learning");
  });

  it("repairs unsafe custom contrast deterministically and reports the repair", () => {
    const kit: BrandKit = {
      id: "brand.pale",
      name: "Pale Accent",
      baseThemeId: "light",
      palette: { accent: "#FFF3A8", onAccent: "#FFFFFF" },
    };
    const result = compileTheme("light", { brandKit: kit, contrastPolicy: "repair" });
    expect(result.palette.onAccent).toBe("#111318");
    expect(result.contrastAudit.passed).toBe(true);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "theme.contrast.repaired")).toBe(true);
  });

  it("rejects custom contrast failures in strict mode", () => {
    const kit: BrandKit = { id: "brand.pale", name: "Pale Accent", baseThemeId: "light", palette: { accent: "#FFF3A8", onAccent: "#FFFFFF" } };
    expect(() => compileTheme("light", { brandKit: kit, contrastPolicy: "reject" })).toThrow(ThemeValidationError);
  });

  it("refuses CSS-bearing font names, URL-like asset references, and selector injection", () => {
    const kit = {
      id: "brand.unsafe",
      name: "Unsafe Brand",
      baseThemeId: "light",
      typography: { bodyFamilies: ["Inter; color: red"] },
      logoAssetId: "https://example.com/logo.svg",
    } as unknown as BrandKit;
    const result = validateBrandKit(kit);
    expect(result.valid).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toContain("brand.font.invalid");
    expect(result.diagnostics.map((item) => item.code)).toContain("brand.asset.invalid");
    expect(() => serializeThemeCss(createThemeCssVariables(getBuiltInTheme("light")), ":root; body")).toThrow(ThemeValidationError);
  });

  it("rejects malformed locale input", () => {
    expect(() => compileTheme("light", { locale: "en;url(bad)" })).toThrow(ThemeValidationError);
  });
});

describe("specimen", () => {
  it("exposes all ten packs as data and as a dependency-free responsive document", () => {
    const data = createThemeSpecimenData("hi");
    const html = createThemeSpecimenHtml("en");
    expect(data).toHaveLength(10);
    expect(data.every((theme) => theme.palette.length === 6 && theme.contrastMinimum >= 3)).toBe(true);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Ten visual<br>bibles, one system.");
    expect(html.match(/class="theme-card"/gu)).toHaveLength(10);
    expect(html).toContain("@media(prefers-reduced-motion:reduce)");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("http://");
    expect(html).not.toContain("https://");
  });
});
