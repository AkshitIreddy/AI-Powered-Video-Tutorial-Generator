/**
 * The theme contract is deliberately data-only. Stored projects may reference these values,
 * but may never carry executable CSS, JavaScript, remote font URLs, or renderer code.
 */

export const THEME_PACK_IDS = [
  "minimal",
  "academic",
  "modern-tech",
  "notebook",
  "documentary",
  "playful",
  "childrens-education",
  "corporate-training",
  "light",
  "dark",
] as const;

export type ThemePackId = (typeof THEME_PACK_IDS)[number];
export type SupportedTutorialLocale = "en" | "es" | "hi";
export type ColorHex = `#${string}`;

export interface FontStack {
  /** Ordered local family names. Remote URLs are intentionally unsupported. */
  readonly families: readonly string[];
  readonly weight: number;
  readonly italic?: boolean;
  readonly lineHeight: number;
  readonly letterSpacingEm: number;
  readonly textTransform: "none" | "uppercase" | "lowercase";
  readonly fontFeatureSettings: readonly string[];
}

export interface TypographyScale {
  readonly display: FontStack;
  readonly heading: FontStack;
  readonly body: FontStack;
  readonly utility: FontStack;
  readonly caption: FontStack;
  readonly code: FontStack;
  readonly math: FontStack;
  readonly sizeRem: {
    readonly hero: number;
    readonly title: number;
    readonly heading: number;
    readonly body: number;
    readonly annotation: number;
    readonly caption: number;
  };
  readonly maxMeasureCh: number;
}

export interface ThemePalette {
  readonly canvas: ColorHex;
  readonly canvasAlt: ColorHex;
  readonly surface: ColorHex;
  readonly surfaceRaised: ColorHex;
  readonly ink: ColorHex;
  readonly inkMuted: ColorHex;
  readonly inkSubtle: ColorHex;
  readonly accent: ColorHex;
  readonly accentStrong: ColorHex;
  readonly accentSoft: ColorHex;
  readonly accentSecondary: ColorHex;
  readonly evidence: ColorHex;
  readonly review: ColorHex;
  readonly critical: ColorHex;
  readonly success: ColorHex;
  readonly line: ColorHex;
  readonly lineStrong: ColorHex;
  readonly shadow: ColorHex;
  readonly onAccent: ColorHex;
  readonly captionBackground: ColorHex;
  readonly captionInk: ColorHex;
  readonly presenterMatte: ColorHex;
  readonly codeBackground: ColorHex;
  readonly codeInk: ColorHex;
}

export interface SpacingScale {
  readonly unitPx: number;
  readonly xxs: number;
  readonly xs: number;
  readonly sm: number;
  readonly md: number;
  readonly lg: number;
  readonly xl: number;
  readonly xxl: number;
  readonly scenePaddingInline: number;
  readonly scenePaddingBlock: number;
  readonly safeAreaPercent: number;
  readonly contentGap: number;
  readonly radiusSmall: number;
  readonly radiusMedium: number;
  readonly radiusLarge: number;
  readonly borderWidth: number;
  readonly shadowBlur: number;
  readonly density: "airy" | "balanced" | "compact";
}

export interface MotionSystem {
  readonly tempo: "deliberate" | "measured" | "lively" | "energetic";
  readonly durationMs: {
    readonly instant: number;
    readonly fast: number;
    readonly standard: number;
    readonly slow: number;
    readonly scene: number;
  };
  readonly easing: {
    readonly enter: string;
    readonly exit: string;
    readonly move: string;
    readonly emphasis: string;
  };
  readonly staggerMs: number;
  readonly maxSimultaneousMotions: number;
  readonly ambientMotion: "none" | "minimal" | "subtle" | "expressive";
  readonly reducedMotion: {
    readonly replaceTransformsWithOpacity: boolean;
    readonly maximumDurationMs: number;
    readonly disableAmbient: boolean;
  };
}

export interface IllustrationRules {
  readonly mode: "none" | "line" | "editorial" | "collage" | "geometric" | "hand-drawn" | "character-led" | "photographic";
  readonly geometry: string;
  readonly lineTreatment: string;
  readonly colorTreatment: string;
  readonly depthTreatment: string;
  readonly texture: string;
  readonly subjectGuidance: string;
  readonly avoid: readonly string[];
}

export interface IconRules {
  readonly family: "outline" | "solid" | "duotone" | "hand-drawn" | "technical";
  readonly strokeWidth: number;
  readonly cornerStyle: "sharp" | "soft" | "round";
  readonly container: "none" | "circle" | "rounded-square" | "label";
  readonly opticalSizePx: number;
  readonly usage: string;
}

export interface DiagramRules {
  readonly nodeShape: "rectangle" | "rounded-rectangle" | "capsule" | "circle" | "mixed";
  readonly connector: "orthogonal" | "curved" | "straight" | "hand-drawn";
  readonly connectorWidth: number;
  readonly arrowStyle: "open" | "filled" | "dot" | "none";
  readonly hierarchy: string;
  readonly annotation: string;
  readonly grid: "none" | "subtle" | "visible" | "paper";
  readonly maximumColors: number;
}

export interface CaptionRules {
  readonly position: "bottom-safe" | "lower-third" | "adaptive" | "top-safe";
  readonly maxLines: 1 | 2 | 3;
  readonly maxCharactersPerLine: number;
  readonly widthPercent: number;
  readonly alignment: "left" | "center";
  readonly treatment: "solid-panel" | "soft-panel" | "underline" | "document-label" | "speech-card";
  readonly speakerLabel: "never" | "when-needed" | "always";
  readonly soundDescriptionStyle: "bracketed" | "italic" | "labelled";
}

export interface TransitionRules {
  readonly default: "cut" | "crossfade" | "thread-wipe" | "page-turn" | "push" | "dip-to-color" | "iris";
  readonly section: "cut" | "crossfade" | "thread-wipe" | "page-turn" | "push" | "dip-to-color" | "iris";
  readonly emphasis: "cut" | "crossfade" | "thread-wipe" | "page-turn" | "push" | "dip-to-color" | "iris";
  readonly continuityDevice: string;
  readonly avoid: readonly string[];
}

export interface PresenterRules {
  readonly framing: "head-and-shoulders" | "waist-up" | "full-body" | "picture-in-picture" | "cutout";
  readonly placement: "left" | "right" | "alternating" | "contextual";
  readonly maximumSceneCoveragePercent: number;
  readonly backdrop: "matte" | "environmental" | "transparent" | "soft-gradient" | "paper";
  readonly lowerThird: "none" | "minimal" | "editorial" | "playful" | "corporate";
  readonly entry: string;
  readonly gestures: string;
  readonly usage: string;
}

export interface ThemeBehaviorRules {
  readonly illustration: IllustrationRules;
  readonly icons: IconRules;
  readonly diagrams: DiagramRules;
  readonly captions: CaptionRules;
  readonly transitions: TransitionRules;
  readonly presenter: PresenterRules;
}

export interface VisualBible {
  readonly thesis: string;
  readonly audiencePromise: string;
  readonly signatureMotif: string;
  readonly composition: readonly string[];
  readonly typographyHierarchy: readonly string[];
  readonly colorUsage: readonly string[];
  readonly imageTreatment: readonly string[];
  readonly continuityRules: readonly string[];
  readonly accessibilityRules: readonly string[];
  readonly noGo: readonly string[];
}

export interface ThemePack {
  readonly id: ThemePackId;
  readonly name: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly intendedFor: readonly string[];
  readonly palette: ThemePalette;
  readonly typography: TypographyScale;
  readonly spacing: SpacingScale;
  readonly motion: MotionSystem;
  readonly rules: ThemeBehaviorRules;
  readonly visualBible: VisualBible;
}

export interface BrandTypographyOverride {
  readonly displayFamilies?: readonly string[];
  readonly headingFamilies?: readonly string[];
  readonly bodyFamilies?: readonly string[];
  readonly utilityFamilies?: readonly string[];
  readonly codeFamilies?: readonly string[];
  readonly displayWeight?: number;
  readonly headingWeight?: number;
  readonly bodyWeight?: number;
}

export interface BrandSpacingOverride {
  readonly density?: SpacingScale["density"];
  readonly radiusSmall?: number;
  readonly radiusMedium?: number;
  readonly radiusLarge?: number;
  readonly scenePaddingInline?: number;
  readonly scenePaddingBlock?: number;
}

export interface BrandKit {
  readonly id: string;
  readonly name: string;
  readonly baseThemeId: ThemePackId;
  readonly palette?: Partial<ThemePalette>;
  readonly typography?: BrandTypographyOverride;
  readonly spacing?: BrandSpacingOverride;
  readonly logoAssetId?: string;
  readonly presenterMarkAssetId?: string;
  readonly signatureMotif?: string;
  readonly requiredAttribution?: string;
}

export type ContrastLevel = "AA" | "AAA";

export interface ContrastCheck {
  readonly id: string;
  readonly foregroundToken: keyof ThemePalette;
  readonly backgroundToken: keyof ThemePalette;
  readonly foreground: ColorHex;
  readonly background: ColorHex;
  readonly ratio: number;
  readonly requiredRatio: number;
  readonly level: ContrastLevel;
  readonly largeText: boolean;
  readonly passed: boolean;
}

export interface ContrastAudit {
  readonly passed: boolean;
  readonly checks: readonly ContrastCheck[];
  readonly minimumRatio: number;
  readonly failures: readonly ContrastCheck[];
}

export interface ThemeDiagnostic {
  readonly code: string;
  readonly severity: "warning" | "error";
  readonly path: string;
  readonly message: string;
}

export interface ThemeValidationResult {
  readonly valid: boolean;
  readonly diagnostics: readonly ThemeDiagnostic[];
}

export type ContrastPolicy = "reject" | "repair" | "report";

export interface CompileThemeOptions {
  readonly locale?: string;
  readonly brandKit?: BrandKit;
  readonly contrastPolicy?: ContrastPolicy;
  readonly selector?: string;
}

export interface ResolvedTheme extends ThemePack {
  readonly locale: string;
  readonly sourceThemeId: ThemePackId;
  readonly brandKitId?: string;
  readonly contrastAudit: ContrastAudit;
  readonly diagnostics: readonly ThemeDiagnostic[];
  readonly cssVariables: Readonly<Record<string, string>>;
  readonly cssText: string;
  readonly fingerprint: string;
}

export class ThemeValidationError extends Error {
  public readonly diagnostics: readonly ThemeDiagnostic[];

  public constructor(message: string, diagnostics: readonly ThemeDiagnostic[]) {
    super(message);
    this.name = "ThemeValidationError";
    this.diagnostics = diagnostics;
  }
}
