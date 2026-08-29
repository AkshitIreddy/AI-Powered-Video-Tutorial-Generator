import type { Dimensions, EntityId, IsoDateTime, Sha256 } from "./common.js";

export type StarterAssetKind =
  | "background" | "overlay" | "transition" | "font" | "music" | "sound-effect"
  | "presenter-style" | "presenter-portrait" | "lower-third" | "caption-style";

export interface StarterAssetLicense {
  status: "cleared" | "conditional" | "pending" | "unknown" | "restricted";
  expression: string;
  name: string;
  licenseUri?: string;
  copyrightNotice?: string;
  attributionRequired: boolean;
  attributionText?: string;
  redistributionAllowed: boolean;
  commercialUseAllowed: boolean;
  derivativesAllowed: boolean;
  exportAllowed: boolean;
  restrictions?: string[];
}

export interface StarterAssetProvenance {
  origin: "alystria-authored" | "third-party-open-source" | "system-font" | "generated" | "user-import" | "derived";
  creator: string;
  creationMethod: "procedural-code" | "hand-authored" | "recorded" | "font-distribution" | "generative-model" | "user-supplied" | "derived-edit";
  sourceUri?: string;
  sourceRevision?: string;
  tool?: string;
  model?: string;
  promptArtifactId?: EntityId;
  promptAvailability?: "artifact-recorded" | "conversation-retained" | "not-recorded" | "not-applicable";
  synthetic?: boolean;
  c2paStatus?: "present-embedded" | "present-sidecar" | "absent" | "invalid" | "unsupported" | "not-applicable";
  ingredientAssetIds?: EntityId[];
  recordedAt: IsoDateTime;
  reviewStatus: "verified" | "needs-review" | "quarantined";
  notes?: string;
}

export interface StarterAssetSource {
  delivery: "procedural" | "bundled-file" | "optional-download" | "installed-family" | "style-preset" | "placeholder";
  availability: "ready" | "optional" | "planned" | "unavailable";
  relativePath?: string;
  contentHash?: Sha256;
  byteSize?: number;
  downloadUri?: string;
  familyNames?: string[];
  fallbackAssetId?: EntityId;
}

export interface StarterAssetTechnicalSpec {
  mediaType: string;
  renderSafe: boolean;
  remoteFetchRequired: boolean;
  dimensions?: Dimensions;
  durationMs?: number;
  loopable?: boolean;
  sampleRate?: 44100 | 48000 | 96000;
  channels?: 1 | 2 | 6;
  integratedLufs?: number;
  fontWeights?: number[];
  variableFont?: boolean;
  scriptCoverage?: ("latin" | "latin-extended" | "devanagari" | "cyrillic" | "greek" | "arabic" | "cjk" | "math" | "symbols")[];
  rendererRecipe?: string;
  safeAreaPercent?: number;
  transparentBackground?: boolean;
}

export interface StarterAssetAccessibility {
  reducedMotionSafe: boolean;
  highContrastSafe: boolean;
  description?: string;
  transcriptLabel?: string;
}

export interface StarterAsset {
  id: EntityId;
  kind: StarterAssetKind;
  name: string;
  description: string;
  tags: string[];
  source: StarterAssetSource;
  license: StarterAssetLicense;
  provenance: StarterAssetProvenance;
  technical: StarterAssetTechnicalSpec;
  accessibility: StarterAssetAccessibility;
}

export interface StarterThemeDefaults {
  backgroundAssetId: EntityId;
  overlayAssetId?: EntityId;
  transitionAssetId: EntityId;
  displayFontAssetId: EntityId;
  bodyFontAssetId: EntityId;
  codeFontAssetId: EntityId;
  presenterStyleAssetId: EntityId;
  presenterPortraitAssetId?: EntityId;
  lowerThirdAssetId?: EntityId;
  captionStyleAssetId?: EntityId;
}

export interface StarterThemeAlternatives {
  backgroundAssetIds: EntityId[];
  transitionAssetIds: EntityId[];
  fontAssetIds: EntityId[];
  presenterStyleAssetIds: EntityId[];
  presenterPortraitAssetIds: EntityId[];
  musicAssetIds: EntityId[];
  soundEffectAssetIds: EntityId[];
}

export interface StarterThemePack {
  id: EntityId;
  themeId: "minimal" | "academic" | "modern-tech" | "notebook" | "documentary" | "playful" | "childrens-education" | "corporate-training" | "light" | "dark";
  name: string;
  description: string;
  defaults: StarterThemeDefaults;
  alternatives: StarterThemeAlternatives;
  audioDefaults: { musicEnabled: boolean; effectsEnabled: boolean; musicGainDb: number; effectsGainDb: number; duckingDb: number };
  presenterDefaults: { usage: "none" | "sparse" | "balanced" | "frequent"; placement: "left" | "right" | "alternating" | "contextual" | "full"; maximumCoveragePercent: number; allowUserPortrait: boolean };
}

export interface UserAssetSlot {
  id: EntityId;
  kind: "background" | "overlay" | "font" | "music" | "sound-effect" | "presenter-portrait" | "presenter-video" | "logo" | "lower-third" | "caption-style";
  name: string;
  description: string;
  acceptedMediaTypes: string[];
  acceptedExtensions?: string[];
  maximumBytes: number;
  multiple: boolean;
  rightsAttestationRequired: boolean;
  provenanceRequired: boolean;
  consentRequired: boolean;
  normalization: "image-srgb" | "video-rec709" | "audio-48khz" | "font-sanitized" | "data-only";
  minimumDimensions?: Dimensions;
  maximumDurationMs?: number;
  guidance?: string[];
}

export interface StarterKitManifest {
  schemaVersion: 1;
  id: EntityId;
  version: string;
  name: string;
  description: string;
  defaults: { musicEnabled: false; effectsEnabled: false; remoteFetchDuringRender: false; unknownRightsBlockExport: true };
  assets: StarterAsset[];
  themePacks: StarterThemePack[];
  userAssetSlots: UserAssetSlot[];
}

export interface StarterKitDiagnostic {
  code: string;
  severity: "warning" | "error" | "fatal";
  path: string;
  message: string;
}

/** Cross-record checks which JSON Schema cannot express. */
export function inspectStarterKit(manifest: StarterKitManifest): StarterKitDiagnostic[] {
  const diagnostics: StarterKitDiagnostic[] = [];
  const assetById = new Map<string, StarterAsset>();
  const seen = new Set<string>();
  const duplicate = (id: string, path: string, label: string): void => {
    if (seen.has(`${label}:${id}`)) diagnostics.push({ code: "starter.duplicate-id", severity: "fatal", path, message: `Duplicate ${label} id: ${id}` });
    seen.add(`${label}:${id}`);
  };
  manifest.assets.forEach((asset, index) => {
    duplicate(asset.id, `/assets/${index}/id`, "asset");
    assetById.set(asset.id, asset);
    if (asset.source.availability === "ready" && !asset.technical.renderSafe) diagnostics.push({ code: "starter.ready-asset-not-render-safe", severity: "fatal", path: `/assets/${index}/technical/renderSafe`, message: `Ready asset ${asset.id} is not render-safe` });
    if (asset.source.availability === "planned" && asset.license.exportAllowed) diagnostics.push({ code: "starter.placeholder-exportable", severity: "fatal", path: `/assets/${index}/license/exportAllowed`, message: `Placeholder ${asset.id} cannot be export-cleared before delivery and rights review` });
    if (asset.license.status !== "cleared" && asset.license.exportAllowed) diagnostics.push({ code: "starter.uncleared-export", severity: "fatal", path: `/assets/${index}/license`, message: `Uncleared asset ${asset.id} cannot permit export` });
    if (asset.technical.remoteFetchRequired) diagnostics.push({ code: "starter.remote-render-fetch", severity: "fatal", path: `/assets/${index}/technical/remoteFetchRequired`, message: `Starter asset ${asset.id} may not fetch remotely during render` });
  });
  const requireAsset = (id: string, expectedKind: StarterAssetKind | readonly StarterAssetKind[], path: string): void => {
    const asset = assetById.get(id);
    if (!asset) { diagnostics.push({ code: "starter.missing-asset", severity: "fatal", path, message: `Unknown starter asset: ${id}` }); return; }
    const expected = Array.isArray(expectedKind) ? expectedKind : [expectedKind];
    if (!expected.includes(asset.kind)) diagnostics.push({ code: "starter.wrong-asset-kind", severity: "error", path, message: `Asset ${id} has kind ${asset.kind}; expected ${expected.join(" or ")}` });
  };
  manifest.themePacks.forEach((pack, index) => {
    duplicate(pack.id, `/themePacks/${index}/id`, "theme pack");
    const base = `/themePacks/${index}`;
    requireAsset(pack.defaults.backgroundAssetId, ["background", "overlay"], `${base}/defaults/backgroundAssetId`);
    requireAsset(pack.defaults.transitionAssetId, "transition", `${base}/defaults/transitionAssetId`);
    requireAsset(pack.defaults.displayFontAssetId, "font", `${base}/defaults/displayFontAssetId`);
    requireAsset(pack.defaults.bodyFontAssetId, "font", `${base}/defaults/bodyFontAssetId`);
    requireAsset(pack.defaults.codeFontAssetId, "font", `${base}/defaults/codeFontAssetId`);
    requireAsset(pack.defaults.presenterStyleAssetId, "presenter-style", `${base}/defaults/presenterStyleAssetId`);
    if (pack.defaults.presenterPortraitAssetId) requireAsset(pack.defaults.presenterPortraitAssetId, "presenter-portrait", `${base}/defaults/presenterPortraitAssetId`);
    if (pack.defaults.overlayAssetId) requireAsset(pack.defaults.overlayAssetId, "overlay", `${base}/defaults/overlayAssetId`);
    if (pack.defaults.lowerThirdAssetId) requireAsset(pack.defaults.lowerThirdAssetId, "lower-third", `${base}/defaults/lowerThirdAssetId`);
    if (pack.defaults.captionStyleAssetId) requireAsset(pack.defaults.captionStyleAssetId, "caption-style", `${base}/defaults/captionStyleAssetId`);
    pack.alternatives.backgroundAssetIds.forEach((id, item) => requireAsset(id, ["background", "overlay"], `${base}/alternatives/backgroundAssetIds/${item}`));
    pack.alternatives.transitionAssetIds.forEach((id, item) => requireAsset(id, "transition", `${base}/alternatives/transitionAssetIds/${item}`));
    pack.alternatives.fontAssetIds.forEach((id, item) => requireAsset(id, "font", `${base}/alternatives/fontAssetIds/${item}`));
    pack.alternatives.presenterStyleAssetIds.forEach((id, item) => requireAsset(id, "presenter-style", `${base}/alternatives/presenterStyleAssetIds/${item}`));
    pack.alternatives.presenterPortraitAssetIds.forEach((id, item) => requireAsset(id, "presenter-portrait", `${base}/alternatives/presenterPortraitAssetIds/${item}`));
    pack.alternatives.musicAssetIds.forEach((id, item) => requireAsset(id, "music", `${base}/alternatives/musicAssetIds/${item}`));
    pack.alternatives.soundEffectAssetIds.forEach((id, item) => requireAsset(id, "sound-effect", `${base}/alternatives/soundEffectAssetIds/${item}`));
  });
  const requiredThemes = new Set(["minimal", "academic", "modern-tech", "notebook", "documentary", "playful", "childrens-education", "corporate-training", "light", "dark"]);
  manifest.themePacks.forEach((pack) => requiredThemes.delete(pack.themeId));
  for (const theme of requiredThemes) diagnostics.push({ code: "starter.missing-theme-pack", severity: "fatal", path: "/themePacks", message: `Missing starter pack for theme: ${theme}` });
  manifest.userAssetSlots.forEach((slot, index) => duplicate(slot.id, `/userAssetSlots/${index}/id`, "upload slot"));
  return diagnostics;
}
