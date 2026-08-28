import type { FontStack, MotionSystem, SpacingScale, TypographyScale } from "./types.js";

/**
 * All named third-party fonts below use the SIL Open Font License. They are only family
 * references: Alystria's runtime font manager resolves packaged, user-installed, or system
 * fonts and never fetches a remote stylesheet while rendering.
 */
export const FONT_FAMILIES = {
  bricolage: ["Bricolage Grotesque", "Atkinson Hyperlegible Next", "Arial", "sans-serif"],
  atkinson: ["Atkinson Hyperlegible Next", "Atkinson Hyperlegible", "Arial", "sans-serif"],
  sourceSerif: ["Source Serif 4", "Noto Serif", "Georgia", "serif"],
  sourceSans: ["Source Sans 3", "Atkinson Hyperlegible Next", "Arial", "sans-serif"],
  fraunces: ["Fraunces", "Source Serif 4", "Georgia", "serif"],
  nunito: ["Nunito Sans", "Atkinson Hyperlegible Next", "Arial", "sans-serif"],
  schoolbell: ["Patrick Hand", "Comic Sans MS", "cursive"],
  lexend: ["Lexend", "Atkinson Hyperlegible Next", "Arial", "sans-serif"],
  ibmPlex: ["IBM Plex Sans", "Atkinson Hyperlegible Next", "Arial", "sans-serif"],
  ibmPlexSerif: ["IBM Plex Serif", "Source Serif 4", "Georgia", "serif"],
  notoSans: ["Noto Sans", "Atkinson Hyperlegible Next", "Arial", "sans-serif"],
  notoSerif: ["Noto Serif", "Source Serif 4", "Georgia", "serif"],
  jetbrains: ["JetBrains Mono", "Cascadia Mono", "Consolas", "monospace"],
  math: ["STIX Two Math", "Cambria Math", "Noto Sans Math", "serif"],
} as const;

export function createFontStack(
  families: readonly string[],
  weight: number,
  lineHeight: number,
  letterSpacingEm = 0,
  textTransform: FontStack["textTransform"] = "none",
  fontFeatureSettings: readonly string[] = ["kern", "liga"],
): FontStack {
  return {
    families,
    weight,
    lineHeight,
    letterSpacingEm,
    textTransform,
    fontFeatureSettings,
  };
}

export function createTypography(input: {
  display: readonly string[];
  heading: readonly string[];
  body: readonly string[];
  utility?: readonly string[];
  displayWeight?: number;
  headingWeight?: number;
  bodyWeight?: number;
  utilityWeight?: number;
  displayTracking?: number;
  headingTracking?: number;
  maxMeasureCh?: number;
  sizes?: Partial<TypographyScale["sizeRem"]>;
}): TypographyScale {
  return {
    display: createFontStack(input.display, input.displayWeight ?? 700, 0.96, input.displayTracking ?? -0.035),
    heading: createFontStack(input.heading, input.headingWeight ?? 650, 1.08, input.headingTracking ?? -0.018),
    body: createFontStack(input.body, input.bodyWeight ?? 450, 1.5),
    utility: createFontStack(input.utility ?? FONT_FAMILIES.atkinson, input.utilityWeight ?? 600, 1.2, 0.045, "uppercase", ["kern", "tnum"]),
    caption: createFontStack(input.body, 600, 1.3, 0.005),
    code: createFontStack(FONT_FAMILIES.jetbrains, 450, 1.45, -0.012, "none", ["kern", "liga", "calt", "zero"]),
    math: createFontStack(FONT_FAMILIES.math, 500, 1.3, 0, "none", ["kern", "liga", "ssty"]),
    sizeRem: {
      hero: input.sizes?.hero ?? 4.5,
      title: input.sizes?.title ?? 2.7,
      heading: input.sizes?.heading ?? 1.55,
      body: input.sizes?.body ?? 1,
      annotation: input.sizes?.annotation ?? 0.82,
      caption: input.sizes?.caption ?? 1.04,
    },
    maxMeasureCh: input.maxMeasureCh ?? 68,
  };
}

export function createSpacing(
  density: SpacingScale["density"],
  options: Partial<Omit<SpacingScale, "density">> = {},
): SpacingScale {
  const densityFactor = density === "airy" ? 1.16 : density === "compact" ? 0.88 : 1;
  const scaled = (value: number): number => Math.round(value * densityFactor * 100) / 100;
  return {
    unitPx: options.unitPx ?? 8,
    xxs: options.xxs ?? scaled(4),
    xs: options.xs ?? scaled(8),
    sm: options.sm ?? scaled(12),
    md: options.md ?? scaled(20),
    lg: options.lg ?? scaled(32),
    xl: options.xl ?? scaled(52),
    xxl: options.xxl ?? scaled(80),
    scenePaddingInline: options.scenePaddingInline ?? scaled(72),
    scenePaddingBlock: options.scenePaddingBlock ?? scaled(56),
    safeAreaPercent: options.safeAreaPercent ?? 5,
    contentGap: options.contentGap ?? scaled(28),
    radiusSmall: options.radiusSmall ?? 6,
    radiusMedium: options.radiusMedium ?? 12,
    radiusLarge: options.radiusLarge ?? 20,
    borderWidth: options.borderWidth ?? 1,
    shadowBlur: options.shadowBlur ?? 24,
    density,
  };
}

export function createMotion(
  tempo: MotionSystem["tempo"],
  options: Partial<Omit<MotionSystem, "tempo" | "durationMs" | "easing" | "reducedMotion">> & {
    durationMs?: Partial<MotionSystem["durationMs"]>;
    easing?: Partial<MotionSystem["easing"]>;
  } = {},
): MotionSystem {
  const factor = tempo === "deliberate" ? 1.25 : tempo === "measured" ? 1.05 : tempo === "energetic" ? 0.78 : 0.9;
  const duration = (value: number): number => Math.round(value * factor);
  return {
    tempo,
    durationMs: {
      instant: options.durationMs?.instant ?? 90,
      fast: options.durationMs?.fast ?? duration(180),
      standard: options.durationMs?.standard ?? duration(360),
      slow: options.durationMs?.slow ?? duration(620),
      scene: options.durationMs?.scene ?? duration(900),
    },
    easing: {
      enter: options.easing?.enter ?? "cubic-bezier(0.16, 1, 0.3, 1)",
      exit: options.easing?.exit ?? "cubic-bezier(0.7, 0, 0.84, 0)",
      move: options.easing?.move ?? "cubic-bezier(0.65, 0, 0.35, 1)",
      emphasis: options.easing?.emphasis ?? "cubic-bezier(0.34, 1.56, 0.64, 1)",
    },
    staggerMs: options.staggerMs ?? duration(72),
    maxSimultaneousMotions: options.maxSimultaneousMotions ?? 4,
    ambientMotion: options.ambientMotion ?? "minimal",
    reducedMotion: {
      replaceTransformsWithOpacity: true,
      maximumDurationMs: 120,
      disableAmbient: true,
    },
  };
}
