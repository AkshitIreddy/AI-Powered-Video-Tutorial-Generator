import type { SceneTheme } from "@alystria/scenes";
import type { ProjectRecord } from "./types";

/** Match the closed palette projection used by the final renderer. */
export function customizedSceneTheme(base: SceneTheme, customization: ProjectRecord["customization"]): SceneTheme {
  if (!customization) return base;
  // Native candidate promotion may legitimately create an assets-only
  // customization record when the project had no visual-bible choices yet.
  // Normalize only the theme fields here so accepted asset references survive
  // while every omitted user choice continues to use the compiled theme.
  const hasThemeCustomization = Boolean(
    customization.colors
    || customization.displayFont?.trim()
    || customization.bodyFont?.trim()
    || typeof customization.cornerRadius === "number",
  );
  if (!hasThemeCustomization) return base;
  const mix = (first: string, second: string, amount: number) => `#${[1, 3, 5].map((offset) => {
    const left = Number.parseInt(first.slice(offset, offset + 2), 16);
    const right = Number.parseInt(second.slice(offset, offset + 2), 16);
    return Math.round(left + (right - left) * amount).toString(16).padStart(2, "0");
  }).join("")}`.toUpperCase();
  let palette: Partial<SceneTheme> = {};
  if (customization.colors) {
    const paper = customization.colors.paper ?? base.paper;
    const ink = customization.colors.ink ?? base.ink;
    const primary = customization.colors.accent ?? base.primary;
    const secondary = customization.colors.evidence ?? base.secondary;
    if (![paper, ink, primary, secondary].every((value) => /^#[0-9a-f]{6}$/iu.test(value))) return base;
    palette = {
      paper, ink, primary, secondary,
      mutedInk: mix(ink, paper, .34), surface: mix(paper, ink, .035),
      surfaceRaised: mix(paper, primary, .075), line: mix(paper, ink, .17),
      codeBackground: mix(ink, paper, .045), codeInk: paper,
    };
  }
  return {
    ...base,
    ...palette,
    radius: typeof customization.cornerRadius === "number" && Number.isFinite(customization.cornerRadius) && customization.cornerRadius >= 0
      ? customization.cornerRadius
      : base.radius,
    fontDisplay: customization.displayFont?.trim()
      ? fontStack([customization.displayFont, "Segoe UI", "sans-serif"])
      : base.fontDisplay,
    fontBody: customization.bodyFont?.trim()
      ? fontStack([customization.bodyFont, "Segoe UI", "sans-serif"])
      : base.fontBody,
  };
}

function fontStack(families: readonly string[]): string {
  return families.map((family) => family.includes(" ") ? `"${family}"` : family).join(", ");
}
