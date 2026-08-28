import { BUILT_IN_THEME_PACKS } from "./packs.js";
import type {
  BrandKit,
  ColorHex,
  CompileThemeOptions,
  ContrastAudit,
  ContrastCheck,
  ContrastLevel,
  FontStack,
  ResolvedTheme,
  SupportedTutorialLocale,
  ThemeDiagnostic,
  ThemePack,
  ThemePackId,
  ThemePalette,
  ThemeValidationResult,
  TypographyScale,
} from "./types.js";
import { THEME_PACK_IDS, ThemeValidationError } from "./types.js";

const COLOR_PATTERN = /^#[0-9A-F]{6}$/u;
const FAMILY_PATTERN = /^(?!.*(?:url\s*\(|@import|[;{}]))[^\u0000-\u001F\u007F]{1,100}$/iu;
const BRAND_ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9._:-]{2,127}$/u;
const SAFE_SELECTOR_PATTERN = /^(?::root|\[data-[a-z0-9-]+=(?:"[a-z0-9._:-]+"|'[a-z0-9._:-]+')\])$/u;
const PALETTE_KEYS: readonly (keyof ThemePalette)[] = [
  "canvas", "canvasAlt", "surface", "surfaceRaised", "ink", "inkMuted", "inkSubtle",
  "accent", "accentStrong", "accentSoft", "accentSecondary", "evidence", "review", "critical",
  "success", "line", "lineStrong", "shadow", "onAccent", "captionBackground", "captionInk",
  "presenterMatte", "codeBackground", "codeInk",
];

const BUILT_INS_BY_ID = new Map<ThemePackId, ThemePack>(
  BUILT_IN_THEME_PACKS.map((theme) => [theme.id, theme]),
);

const CONTRAST_SPECS: readonly {
  id: string;
  foreground: keyof ThemePalette;
  background: keyof ThemePalette;
  requiredRatio: number;
  level: ContrastLevel;
  largeText: boolean;
}[] = [
  { id: "body-on-canvas", foreground: "ink", background: "canvas", requiredRatio: 4.5, level: "AA", largeText: false },
  { id: "body-on-surface", foreground: "ink", background: "surface", requiredRatio: 4.5, level: "AA", largeText: false },
  { id: "muted-on-canvas", foreground: "inkMuted", background: "canvas", requiredRatio: 4.5, level: "AA", largeText: false },
  { id: "text-on-accent", foreground: "onAccent", background: "accent", requiredRatio: 4.5, level: "AA", largeText: false },
  { id: "caption", foreground: "captionInk", background: "captionBackground", requiredRatio: 7, level: "AAA", largeText: false },
  { id: "code", foreground: "codeInk", background: "codeBackground", requiredRatio: 7, level: "AAA", largeText: false },
  { id: "focus-boundary", foreground: "lineStrong", background: "canvas", requiredRatio: 3, level: "AA", largeText: true },
  { id: "evidence-label", foreground: "evidence", background: "canvas", requiredRatio: 3, level: "AA", largeText: true },
  { id: "critical-label", foreground: "critical", background: "canvas", requiredRatio: 3, level: "AA", largeText: true },
];

function cloneTheme(theme: ThemePack): ThemePack {
  return structuredClone(theme);
}

function canonicalLocale(locale: string | undefined): string {
  const candidate = (locale ?? "en").trim().replaceAll("_", "-");
  if (candidate.length === 0 || candidate.length > 64 || !/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/u.test(candidate)) {
    throw new ThemeValidationError("The tutorial locale is invalid.", [{
      code: "theme.locale.invalid",
      severity: "error",
      path: "locale",
      message: `Expected a BCP 47-style locale, received ${JSON.stringify(locale)}.`,
    }]);
  }
  try {
    return Intl.getCanonicalLocales(candidate)[0] ?? candidate.toLowerCase();
  } catch {
    return candidate.toLowerCase();
  }
}

export function resolveTutorialLocale(locale: string | undefined): SupportedTutorialLocale | "other" {
  const language = canonicalLocale(locale).split("-")[0]?.toLowerCase();
  if (language === "en" || language === "es" || language === "hi") return language;
  return "other";
}

function uniqueFamilies(families: readonly string[]): readonly string[] {
  return [...new Set(families.map((family) => family.trim()).filter(Boolean))];
}

function localizeFontStack(stack: FontStack, locale: string, role: keyof TypographyScale): FontStack {
  const supported = resolveTutorialLocale(locale);
  let prefix: readonly string[] = [];
  if (supported === "hi") {
    prefix = role === "display" || role === "heading" || role === "math"
      ? ["Noto Serif Devanagari", "Nirmala UI"]
      : role === "code"
        ? ["Noto Sans Devanagari", "Nirmala UI"]
        : ["Noto Sans Devanagari", "Nirmala UI", "Mangal"];
  } else if (supported === "other") {
    prefix = role === "display" || role === "heading" || role === "math"
      ? ["Noto Serif"]
      : ["Noto Sans"];
  }
  return { ...stack, families: uniqueFamilies([...prefix, ...stack.families]) };
}

export function resolveLocaleTypography(typography: TypographyScale, locale: string): TypographyScale {
  return {
    ...typography,
    display: localizeFontStack(typography.display, locale, "display"),
    heading: localizeFontStack(typography.heading, locale, "heading"),
    body: localizeFontStack(typography.body, locale, "body"),
    utility: localizeFontStack(typography.utility, locale, "utility"),
    caption: localizeFontStack(typography.caption, locale, "caption"),
    code: localizeFontStack(typography.code, locale, "code"),
    math: localizeFontStack(typography.math, locale, "math"),
  };
}

function applyBrandKit(theme: ThemePack, kit: BrandKit): ThemePack {
  const typography = theme.typography;
  const override = kit.typography;
  const withFamilies = (stack: FontStack, families: readonly string[] | undefined, weight: number | undefined): FontStack => ({
    ...stack,
    families: families === undefined ? stack.families : uniqueFamilies([...families, ...stack.families]),
    weight: weight ?? stack.weight,
  });

  return {
    ...theme,
    name: `${kit.name} · ${theme.name}`,
    palette: { ...theme.palette, ...kit.palette },
    typography: {
      ...typography,
      display: withFamilies(typography.display, override?.displayFamilies, override?.displayWeight),
      heading: withFamilies(typography.heading, override?.headingFamilies, override?.headingWeight),
      body: withFamilies(typography.body, override?.bodyFamilies, override?.bodyWeight),
      utility: withFamilies(typography.utility, override?.utilityFamilies, undefined),
      caption: withFamilies(typography.caption, override?.bodyFamilies, override?.bodyWeight),
      code: withFamilies(typography.code, override?.codeFamilies, undefined),
    },
    spacing: { ...theme.spacing, ...kit.spacing },
    visualBible: {
      ...theme.visualBible,
      signatureMotif: kit.signatureMotif ?? theme.visualBible.signatureMotif,
      continuityRules: kit.requiredAttribution === undefined
        ? theme.visualBible.continuityRules
        : [...theme.visualBible.continuityRules, `Keep the brand attribution visible: ${kit.requiredAttribution}`],
    },
  };
}

function channelToLinear(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(color: ColorHex): number {
  const [red, green, blue] = [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
  ];
  return 0.2126 * channelToLinear(red) + 0.7152 * channelToLinear(green) + 0.0722 * channelToLinear(blue);
}

export function contrastRatio(foreground: ColorHex, background: ColorHex): number {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

export function auditThemeContrast(palette: ThemePalette): ContrastAudit {
  const checks: ContrastCheck[] = CONTRAST_SPECS.map((spec) => {
    const foreground = palette[spec.foreground];
    const background = palette[spec.background];
    const ratio = Math.round(contrastRatio(foreground, background) * 100) / 100;
    return {
      id: spec.id,
      foregroundToken: spec.foreground,
      backgroundToken: spec.background,
      foreground,
      background,
      ratio,
      requiredRatio: spec.requiredRatio,
      level: spec.level,
      largeText: spec.largeText,
      passed: ratio >= spec.requiredRatio,
    };
  });
  const failures = checks.filter((check) => !check.passed);
  return {
    passed: failures.length === 0,
    checks,
    minimumRatio: Math.min(...checks.map((check) => check.ratio)),
    failures,
  };
}

function bestAccessibleForeground(background: ColorHex): ColorHex {
  const dark = "#111318" as ColorHex;
  const light = "#FFFFFF" as ColorHex;
  return contrastRatio(dark, background) >= contrastRatio(light, background) ? dark : light;
}

function repairContrast(theme: ThemePack): { theme: ThemePack; diagnostics: ThemeDiagnostic[] } {
  const palette = { ...theme.palette };
  const diagnostics: ThemeDiagnostic[] = [];
  let audit = auditThemeContrast(palette);
  for (const failure of audit.failures) {
    const foregroundToken = failure.foregroundToken;
    let replacement = bestAccessibleForeground(failure.background);
    if (foregroundToken === "inkMuted" || foregroundToken === "lineStrong" || foregroundToken === "evidence" || foregroundToken === "critical") {
      replacement = palette.ink;
    }
    palette[foregroundToken] = replacement;
    diagnostics.push({
      code: "theme.contrast.repaired",
      severity: "warning",
      path: `palette.${foregroundToken}`,
      message: `${foregroundToken} was changed to ${replacement} because its ${failure.ratio}:1 contrast did not meet ${failure.requiredRatio}:1.`,
    });
  }
  audit = auditThemeContrast(palette);
  return { theme: { ...theme, palette }, diagnostics };
}

function pushNumberDiagnostic(
  diagnostics: ThemeDiagnostic[],
  path: string,
  value: number,
  minimum: number,
  maximum: number,
): void {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    diagnostics.push({ code: "theme.number.range", severity: "error", path, message: `Expected a finite value from ${minimum} to ${maximum}; received ${String(value)}.` });
  }
}

export function validateThemePack(theme: ThemePack): ThemeValidationResult {
  const diagnostics: ThemeDiagnostic[] = [];
  if (!THEME_PACK_IDS.includes(theme.id)) {
    diagnostics.push({ code: "theme.id.unknown", severity: "error", path: "id", message: `Unknown built-in theme ID: ${String(theme.id)}.` });
  }
  if (theme.name.trim().length < 2 || theme.description.trim().length < 20) {
    diagnostics.push({ code: "theme.metadata.incomplete", severity: "error", path: "name", message: "Theme name and description must be meaningful." });
  }
  for (const key of PALETTE_KEYS) {
    const value = theme.palette[key];
    if (!COLOR_PATTERN.test(value)) {
      diagnostics.push({ code: "theme.color.invalid", severity: "error", path: `palette.${key}`, message: `${String(value)} is not an uppercase six-digit hex color.` });
    }
  }

  const fontRoles: readonly (keyof Pick<TypographyScale, "display" | "heading" | "body" | "utility" | "caption" | "code" | "math">)[] = ["display", "heading", "body", "utility", "caption", "code", "math"];
  for (const role of fontRoles) {
    const stack = theme.typography[role];
    if (stack.families.length === 0) {
      diagnostics.push({ code: "theme.font.empty", severity: "error", path: `typography.${role}.families`, message: "A local font stack must include at least one family." });
    }
    for (const family of stack.families) {
      if (!FAMILY_PATTERN.test(family)) {
        diagnostics.push({ code: "theme.font.unsafe", severity: "error", path: `typography.${role}.families`, message: `Unsafe or malformed font family: ${JSON.stringify(family)}.` });
      }
    }
    pushNumberDiagnostic(diagnostics, `typography.${role}.weight`, stack.weight, 100, 950);
    pushNumberDiagnostic(diagnostics, `typography.${role}.lineHeight`, stack.lineHeight, 0.8, 2.5);
    pushNumberDiagnostic(diagnostics, `typography.${role}.letterSpacingEm`, stack.letterSpacingEm, -0.15, 0.3);
  }
  for (const [key, value] of Object.entries(theme.typography.sizeRem)) {
    pushNumberDiagnostic(diagnostics, `typography.sizeRem.${key}`, value, 0.5, 12);
  }
  pushNumberDiagnostic(diagnostics, "typography.maxMeasureCh", theme.typography.maxMeasureCh, 30, 100);

  for (const [key, value] of Object.entries(theme.spacing)) {
    if (key !== "density") pushNumberDiagnostic(diagnostics, `spacing.${key}`, value as number, 0, key === "safeAreaPercent" ? 20 : 300);
  }
  for (const [key, value] of Object.entries(theme.motion.durationMs)) {
    pushNumberDiagnostic(diagnostics, `motion.durationMs.${key}`, value, 0, 10000);
  }
  for (const [key, value] of Object.entries(theme.motion.easing)) {
    if (!/^cubic-bezier\((-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\)$/u.test(value)) {
      diagnostics.push({ code: "theme.easing.invalid", severity: "error", path: `motion.easing.${key}`, message: `Unsupported deterministic easing: ${value}.` });
    }
  }
  const bibleLists: readonly (keyof Pick<ThemePack["visualBible"], "composition" | "typographyHierarchy" | "colorUsage" | "imageTreatment" | "continuityRules" | "accessibilityRules" | "noGo">)[] = ["composition", "typographyHierarchy", "colorUsage", "imageTreatment", "continuityRules", "accessibilityRules", "noGo"];
  for (const key of bibleLists) {
    if (theme.visualBible[key].length < 2 || theme.visualBible[key].some((item) => item.trim().length < 8)) {
      diagnostics.push({ code: "theme.visual-bible.thin", severity: "error", path: `visualBible.${key}`, message: "Visual-bible guidance must include at least two specific rules." });
    }
  }
  const audit = auditThemeContrast(theme.palette);
  for (const failure of audit.failures) {
    diagnostics.push({
      code: "theme.contrast.failed",
      severity: "error",
      path: `palette.${failure.foregroundToken}`,
      message: `${failure.id} is ${failure.ratio}:1; it requires at least ${failure.requiredRatio}:1.`,
    });
  }
  return { valid: diagnostics.every((item) => item.severity !== "error"), diagnostics };
}

export function validateBrandKit(kit: BrandKit): ThemeValidationResult {
  const diagnostics: ThemeDiagnostic[] = [];
  if (!BRAND_ID_PATTERN.test(kit.id)) {
    diagnostics.push({ code: "brand.id.invalid", severity: "error", path: "id", message: "Brand-kit IDs must be stable 3–128 character identifiers." });
  }
  if (kit.name.trim().length < 2 || kit.name.length > 120) {
    diagnostics.push({ code: "brand.name.invalid", severity: "error", path: "name", message: "Brand-kit names must contain 2–120 characters." });
  }
  if (!THEME_PACK_IDS.includes(kit.baseThemeId)) {
    diagnostics.push({ code: "brand.base-theme.invalid", severity: "error", path: "baseThemeId", message: "The brand kit must derive from a built-in theme." });
  }
  for (const [key, value] of Object.entries(kit.palette ?? {})) {
    if (!PALETTE_KEYS.includes(key as keyof ThemePalette) || typeof value !== "string" || !COLOR_PATTERN.test(value)) {
      diagnostics.push({ code: "brand.color.invalid", severity: "error", path: `palette.${key}`, message: "Palette overrides must use known tokens and uppercase six-digit hex colors." });
    }
  }
  const familyOverrides = [
    kit.typography?.displayFamilies, kit.typography?.headingFamilies, kit.typography?.bodyFamilies,
    kit.typography?.utilityFamilies, kit.typography?.codeFamilies,
  ].filter((value): value is readonly string[] => value !== undefined);
  for (const families of familyOverrides) {
    if (families.length === 0 || families.some((family) => !FAMILY_PATTERN.test(family))) {
      diagnostics.push({ code: "brand.font.invalid", severity: "error", path: "typography", message: "Brand fonts must be non-empty local family names; CSS and remote URLs are not accepted." });
    }
  }
  for (const [key, value] of Object.entries(kit.typography ?? {})) {
    if (key.endsWith("Weight")) pushNumberDiagnostic(diagnostics, `typography.${key}`, value as number, 100, 950);
  }
  for (const [key, value] of Object.entries(kit.spacing ?? {})) {
    if (key !== "density") pushNumberDiagnostic(diagnostics, `spacing.${key}`, value as number, 0, 300);
  }
  for (const [path, value] of [["logoAssetId", kit.logoAssetId], ["presenterMarkAssetId", kit.presenterMarkAssetId]] as const) {
    if (value !== undefined && !BRAND_ID_PATTERN.test(value)) {
      diagnostics.push({ code: "brand.asset.invalid", severity: "error", path, message: "Brand asset references must be opaque stable IDs, not paths or URLs." });
    }
  }
  return { valid: diagnostics.every((item) => item.severity !== "error"), diagnostics };
}

function fontFamilyCss(families: readonly string[]): string {
  return families.map((family) => /^(?:serif|sans-serif|monospace|cursive|system-ui)$/u.test(family)
    ? family
    : `"${family.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`).join(", ");
}

function cssTokenName(value: string): string {
  return value.replace(/[A-Z]/gu, (match) => `-${match.toLowerCase()}`);
}

export function createThemeCssVariables(theme: ThemePack): Readonly<Record<string, string>> {
  const variables: Record<string, string> = {};
  for (const key of PALETTE_KEYS) variables[`--aly-color-${cssTokenName(key)}`] = theme.palette[key];
  for (const role of ["display", "heading", "body", "utility", "caption", "code", "math"] as const) {
    const stack = theme.typography[role];
    variables[`--aly-font-${role}`] = fontFamilyCss(stack.families);
    variables[`--aly-font-${role}-weight`] = String(stack.weight);
    variables[`--aly-font-${role}-line-height`] = String(stack.lineHeight);
    variables[`--aly-font-${role}-tracking`] = `${stack.letterSpacingEm}em`;
  }
  for (const [key, value] of Object.entries(theme.typography.sizeRem)) variables[`--aly-type-${cssTokenName(key)}`] = `${value}rem`;
  variables["--aly-type-measure"] = `${theme.typography.maxMeasureCh}ch`;
  for (const [key, value] of Object.entries(theme.spacing)) {
    if (key === "density") variables["--aly-density"] = String(value);
    else if (key === "safeAreaPercent") variables["--aly-space-safe-area"] = `${value}%`;
    else variables[`--aly-space-${cssTokenName(key)}`] = `${value}px`;
  }
  for (const [key, value] of Object.entries(theme.motion.durationMs)) variables[`--aly-motion-${cssTokenName(key)}`] = `${value}ms`;
  for (const [key, value] of Object.entries(theme.motion.easing)) variables[`--aly-ease-${cssTokenName(key)}`] = value;
  variables["--aly-motion-stagger"] = `${theme.motion.staggerMs}ms`;
  variables["--aly-diagram-connector-width"] = `${theme.rules.diagrams.connectorWidth}px`;
  variables["--aly-icon-stroke-width"] = String(theme.rules.icons.strokeWidth);
  variables["--aly-caption-width"] = `${theme.rules.captions.widthPercent}%`;
  return Object.freeze(Object.fromEntries(Object.entries(variables).sort(([left], [right]) => left.localeCompare(right))));
}

export function serializeThemeCss(variables: Readonly<Record<string, string>>, selector = ":root"): string {
  if (!SAFE_SELECTOR_PATTERN.test(selector)) {
    throw new ThemeValidationError("The requested CSS selector is unsafe.", [{ code: "theme.selector.unsafe", severity: "error", path: "selector", message: "Only :root or a quoted data-attribute selector is accepted." }]);
  }
  const declarations = Object.entries(variables)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `  ${key}: ${value};`)
    .join("\n");
  return `${selector} {\n${declarations}\n}\n`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(",")}}`;
}

function fnv1a64(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

export function getBuiltInTheme(id: ThemePackId): ThemePack {
  const theme = BUILT_INS_BY_ID.get(id);
  if (theme === undefined) throw new ThemeValidationError(`Unknown theme: ${id}.`, [{ code: "theme.not-found", severity: "error", path: "id", message: `No built-in theme exists with ID ${id}.` }]);
  return cloneTheme(theme);
}

export function listBuiltInThemes(): readonly ThemePack[] {
  return BUILT_IN_THEME_PACKS.map(cloneTheme);
}

export function compileTheme(source: ThemePackId | ThemePack, options: CompileThemeOptions = {}): ResolvedTheme {
  const sourceTheme = typeof source === "string" ? getBuiltInTheme(source) : cloneTheme(source);
  const locale = canonicalLocale(options.locale);
  const diagnostics: ThemeDiagnostic[] = [];
  let theme = sourceTheme;

  if (options.brandKit !== undefined) {
    const brandValidation = validateBrandKit(options.brandKit);
    if (!brandValidation.valid) throw new ThemeValidationError("The brand kit is invalid.", brandValidation.diagnostics);
    if (options.brandKit.baseThemeId !== sourceTheme.id) {
      throw new ThemeValidationError("The brand kit targets a different base theme.", [{
        code: "brand.base-theme.mismatch", severity: "error", path: "brandKit.baseThemeId",
        message: `Brand kit ${options.brandKit.id} targets ${options.brandKit.baseThemeId}, not ${sourceTheme.id}.`,
      }]);
    }
    theme = applyBrandKit(theme, options.brandKit);
  }
  theme = { ...theme, typography: resolveLocaleTypography(theme.typography, locale) };

  const structural = validateThemePack(theme);
  const structuralErrors = structural.diagnostics.filter((item) => item.code !== "theme.contrast.failed");
  if (structuralErrors.some((item) => item.severity === "error")) {
    throw new ThemeValidationError("The theme pack is structurally invalid.", structuralErrors);
  }

  let audit = auditThemeContrast(theme.palette);
  const policy = options.contrastPolicy ?? "repair";
  if (!audit.passed && policy === "reject") {
    throw new ThemeValidationError("The theme does not satisfy its contrast gates.", structural.diagnostics.filter((item) => item.code === "theme.contrast.failed"));
  }
  if (!audit.passed && policy === "repair") {
    const repaired = repairContrast(theme);
    theme = repaired.theme;
    diagnostics.push(...repaired.diagnostics);
    audit = auditThemeContrast(theme.palette);
  } else if (!audit.passed) {
    diagnostics.push(...structural.diagnostics.filter((item) => item.code === "theme.contrast.failed").map((item) => ({ ...item, severity: "warning" as const })));
  }

  const cssVariables = createThemeCssVariables(theme);
  const selector = options.selector ?? `[data-aly-theme="${theme.id}"]`;
  const cssText = serializeThemeCss(cssVariables, selector);
  const fingerprint = fnv1a64(stableStringify({ theme, locale, cssVariables }));
  return {
    ...theme,
    locale,
    sourceThemeId: sourceTheme.id,
    ...(options.brandKit === undefined ? {} : { brandKitId: options.brandKit.id }),
    contrastAudit: audit,
    diagnostics,
    cssVariables,
    cssText,
    fingerprint,
  };
}
