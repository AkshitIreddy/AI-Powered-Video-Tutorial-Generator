import type { ProviderBrandAsset } from "./types";
import huggingFaceLogo from "../assets/providers/hugging-face.svg";
import nvidiaLogo from "../assets/providers/nvidia.svg";

/**
 * Metadata references are intentionally separate from binary artwork. A brand may
 * render only after its exact asset and trademark guidance have been reviewed.
 */
export const providerBrandAssets: Readonly<Record<string, ProviderBrandAsset>> = {
  alystria: internalBrand("alystria", "Alystria", "catalog/brands/alystria.json"),
  local: internalBrand("local", "Local runtime", "catalog/brands/local-runtime.json"),
  cloud: internalBrand("cloud", "Cloud endpoint", "catalog/brands/cloud-endpoint.json"),
  "hugging-face": reviewedBrand({
    id: "hugging-face",
    displayName: "Hugging Face",
    metadataPath: "catalog/brands/hugging-face.json",
    assetPath: huggingFaceLogo,
    officialSourceUrl: "https://huggingface.co/brand",
    artworkLicense: "Official Hugging Face brand asset; usage governed by the provider brand page",
    attributionText: "Hugging Face name and logo belong to Hugging Face, Inc.",
  }),
  civitai: governedBrand({
    id: "civitai",
    displayName: "Civitai",
    metadataPath: "catalog/brands/civitai.json",
    officialSourceUrl: "https://github.com/civitai/civitai",
  }),
  nvidia: reviewedBrand({
    id: "nvidia",
    displayName: "NVIDIA",
    metadataPath: "catalog/brands/nvidia.json",
    assetPath: nvidiaLogo,
    officialSourceUrl: "https://www.nvidia.com/en-us/about-nvidia/legal-info/logo-brand-usage/",
    trademarkGuidelinesUrl: "https://www.nvidia.com/en-us/about-nvidia/legal-info/logo-brand-usage/",
    artworkLicense: "Official NVIDIA horizontal logo; governed by NVIDIA logo and brand guidelines",
    attributionText: "NVIDIA and the NVIDIA logo are trademarks of NVIDIA Corporation.",
  }),
};

export function getProviderBrandAsset(providerId: string): ProviderBrandAsset {
  return providerBrandAssets[providerId] ?? {
    id: `unregistered:${providerId}`,
    providerId,
    displayName: providerId,
    metadataPath: `catalog/brands/unregistered/${encodeURIComponent(providerId)}.json`,
    assetPath: null,
    officialSourceUrl: null,
    trademarkGuidelinesUrl: null,
    artworkLicense: null,
    attributionText: null,
    variant: "internal-generic",
    reviewState: "not-reviewed",
    reviewedAt: null,
    reviewAfter: null,
    mayRender: false,
    notes: ["No governed provider artwork has been reviewed for this provider."],
  };
}

function internalBrand(providerId: string, displayName: string, metadataPath: string): ProviderBrandAsset {
  return {
    id: providerId,
    providerId,
    displayName,
    metadataPath,
    assetPath: null,
    officialSourceUrl: null,
    trademarkGuidelinesUrl: null,
    artworkLicense: "Alystria internal asset",
    attributionText: null,
    variant: "internal-generic",
    reviewState: "approved",
    reviewedAt: null,
    reviewAfter: null,
    mayRender: false,
    notes: ["Rendered with an internal text monogram; no third-party trademark artwork is bundled."],
  };
}

function governedBrand(input: {
  id: string;
  displayName: string;
  metadataPath: string;
  officialSourceUrl: string;
  trademarkGuidelinesUrl?: string;
}): ProviderBrandAsset {
  return {
    id: input.id,
    providerId: input.id,
    displayName: input.displayName,
    metadataPath: input.metadataPath,
    assetPath: null,
    officialSourceUrl: input.officialSourceUrl,
    trademarkGuidelinesUrl: input.trademarkGuidelinesUrl ?? null,
    artworkLicense: null,
    attributionText: null,
    variant: "symbol",
    reviewState: "not-reviewed",
    reviewedAt: null,
    reviewAfter: null,
    mayRender: false,
    notes: [
      "The metadata points to a provider-controlled source only.",
      "No artwork is bundled and no partnership, endorsement, or official provider status is claimed.",
    ],
  };
}

function reviewedBrand(input: {
  id: string;
  displayName: string;
  metadataPath: string;
  assetPath: string;
  officialSourceUrl: string;
  trademarkGuidelinesUrl?: string;
  artworkLicense: string;
  attributionText: string;
}): ProviderBrandAsset {
  return {
    id: input.id,
    providerId: input.id,
    displayName: input.displayName,
    metadataPath: input.metadataPath,
    assetPath: input.assetPath,
    officialSourceUrl: input.officialSourceUrl,
    trademarkGuidelinesUrl: input.trademarkGuidelinesUrl ?? input.officialSourceUrl,
    artworkLicense: input.artworkLicense,
    attributionText: input.attributionText,
    variant: "full-color",
    reviewState: "approved",
    reviewedAt: "2026-09-02T00:00:00.000Z",
    reviewAfter: "2027-03-02T00:00:00.000Z",
    mayRender: true,
    notes: [
      "Bundled unchanged from the provider-controlled brand source.",
      "Shown only beside the provider's own catalog or connection; no partnership or endorsement is claimed.",
    ],
  };
}
