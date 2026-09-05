import type { ProviderBrandAsset } from "./types";
import huggingFaceLogo from "../assets/providers/hugging-face.svg";
import nvidiaLogo from "../assets/providers/nvidia.svg";
import cohereLogo from "../assets/providers/cohere.svg";
import openAiLogo from "../assets/providers/openai.svg";
import anthropicLogo from "../assets/providers/anthropic.svg";
import geminiLogo from "../assets/providers/gemini.svg";
import elevenLabsLogo from "../assets/providers/elevenlabs.svg";

/**
 * Metadata references are intentionally separate from binary artwork. A brand may
 * render only after its exact asset and trademark guidance have been reviewed.
 */
export const providerBrandAssets: Readonly<Record<string, ProviderBrandAsset>> = {
  alystria: internalBrand("alystria", "AI Video Tutorial Generator", "catalog/brands/alystria.json"),
  local: internalBrand("local", "Local runtime", "catalog/brands/local-runtime.json"),
  cloud: internalBrand("cloud", "Cloud endpoint", "catalog/brands/cloud-endpoint.json"),
  openai: reviewedBrand({
    id: "openai",
    displayName: "OpenAI",
    metadataPath: "catalog/brands/openai.json",
    assetPath: openAiLogo,
    officialSourceUrl: "https://cdn.openai.com/brand/openai-logos.zip",
    trademarkGuidelinesUrl: "https://openai.com/brand/",
    artworkLicense: "Official OpenAI black wordmark; use is governed by OpenAI Marks usage terms",
    attributionText: "OpenAI and the OpenAI logo are trademarks of OpenAI.",
    variant: "wordmark",
  }),
  anthropic: reviewedBrand({
    id: "anthropic",
    displayName: "Anthropic",
    metadataPath: "catalog/brands/anthropic.json",
    assetPath: anthropicLogo,
    officialSourceUrl: "https://www.anthropic.com/press-kit",
    trademarkGuidelinesUrl: "https://www.anthropic.com/legal/commercial-terms",
    artworkLicense: "Official Anthropic slate symbol from the Anthropic press kit",
    attributionText: "Anthropic and its symbol belong to Anthropic PBC.",
    variant: "symbol",
  }),
  gemini: reviewedBrand({
    id: "gemini",
    displayName: "Google Gemini",
    metadataPath: "catalog/brands/gemini.json",
    assetPath: geminiLogo,
    officialSourceUrl: "https://ai.google.dev/_static/googledevai/images/gemini-api-logo.svg",
    trademarkGuidelinesUrl: "https://about.google/brand-resource-center/guidance/",
    artworkLicense: "Official Gemini API product logo; use is governed by Google API and brand terms",
    attributionText: "Google, Gemini, and the Gemini API logo are trademarks of Google LLC.",
    variant: "wordmark",
  }),
  elevenlabs: reviewedBrand({
    id: "elevenlabs",
    displayName: "ElevenLabs",
    metadataPath: "catalog/brands/elevenlabs.json",
    assetPath: elevenLabsLogo,
    officialSourceUrl: "https://elevenlabs.io/press",
    trademarkGuidelinesUrl: "https://elevenlabs.io/terms-of-use",
    artworkLicense: "Official ElevenLabs black wordmark from the provider press page",
    attributionText: "ElevenLabs and its logo belong to Eleven Labs, Inc.",
    variant: "wordmark",
  }),
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
  cohere: reviewedBrand({
    id: "cohere",
    displayName: "Cohere",
    metadataPath: "catalog/brands/cohere.json",
    assetPath: cohereLogo,
    officialSourceUrl: "https://cohere.com/newsroom",
    artworkLicense: "Official Cohere press-kit symbol; usage governed by Cohere brand and trademark terms",
    attributionText: "Cohere name and symbol belong to Cohere Technologies, Inc.",
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
    artworkLicense: "AI Video Tutorial Generator internal asset",
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
  variant?: ProviderBrandAsset["variant"];
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
    variant: input.variant ?? "full-color",
    reviewState: "approved",
    reviewedAt: "2026-09-05T00:00:00.000Z",
    reviewAfter: "2027-03-05T00:00:00.000Z",
    mayRender: true,
    notes: [
      "Bundled unchanged from the provider-controlled brand source.",
      "Shown only beside the provider's own catalog or connection; no partnership or endorsement is claimed.",
    ],
  };
}
