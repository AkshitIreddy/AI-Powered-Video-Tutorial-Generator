import type { StudioAssetReference } from "./types";

import animeArtIris from "./assets/presenters/anime-art-iris-v1.webp";
import animeBotanicalJulian from "./assets/presenters/anime-botanical-julian-v1.webp";
import animeLibraryClara from "./assets/presenters/anime-library-clara-v1.webp";
import animeMakerTess from "./assets/presenters/anime-maker-tess-v1.webp";
import animeMusicEvan from "./assets/presenters/anime-music-evan-v1.webp";
import animeObservatoryLeon from "./assets/presenters/anime-observatory-leon-v1.webp";
import animeScienceAdrian from "./assets/presenters/anime-science-adrian-v1.webp";
import animeSeasideMara from "./assets/presenters/anime-seaside-mara-v1.webp";
import gouacheMaeve from "./assets/presenters/gouache-maeve-v1.webp";
import ligneClaireHugo from "./assets/presenters/ligne-claire-hugo-v1.webp";
import softClayDaphne from "./assets/presenters/soft-clay-daphne-v1.webp";
import storybookWatercolorArthur from "./assets/presenters/storybook-watercolor-arthur-v1.webp";

export interface NewPresenterPersona {
  readonly src: string;
  readonly focalPoint: string;
  readonly voiceDirection: string;
  readonly style: string;
  readonly background: string;
  readonly styleGroup: "Anime" | "Illustration";
  readonly filterTags: readonly string[];
}

export const NEW_PRESENTER_PERSONAS = {
  "presenter-portrait.anime-library-clara-v1": {
    src: animeLibraryClara,
    focalPoint: "50% 20%",
    voiceDirection: "Warm adult humanities tutor · articulate, composed, medium pace",
    style: "Contemporary anime",
    background: "Library",
    styleGroup: "Anime",
    filterTags: ["anime", "library", "humanities", "warm"],
  },
  "presenter-portrait.anime-botanical-julian-v1": {
    src: animeBotanicalJulian,
    focalPoint: "50% 20%",
    voiceDirection: "Curious adult natural-science tutor · reassuring, clear, medium pace",
    style: "Botanical illustration",
    background: "Botanical conservatory",
    styleGroup: "Illustration",
    filterTags: ["illustration", "botanical", "science", "daylight"],
  },
  "presenter-portrait.anime-seaside-mara-v1": {
    src: animeSeasideMara,
    focalPoint: "50% 20%",
    voiceDirection: "Patient adult classroom tutor · bright, open, conversational",
    style: "Slice-of-life anime",
    background: "Seaside classroom",
    styleGroup: "Anime",
    filterTags: ["anime", "seaside", "classroom", "bright"],
  },
  "presenter-portrait.anime-observatory-leon-v1": {
    src: animeObservatoryLeon,
    focalPoint: "50% 20%",
    voiceDirection: "Assured adult astronomy guide · thoughtful, measured, precise",
    style: "Retro science anime",
    background: "Space observatory",
    styleGroup: "Anime",
    filterTags: ["anime", "space", "astronomy", "dark"],
  },
  "presenter-portrait.anime-maker-tess-v1": {
    src: animeMakerTess,
    focalPoint: "50% 19%",
    voiceDirection: "Inventive adult maker tutor · energetic, practical, concise",
    style: "Technical anime",
    background: "Maker workshop",
    styleGroup: "Anime",
    filterTags: ["anime", "maker", "engineering", "workshop"],
  },
  "presenter-portrait.anime-music-evan-v1": {
    src: animeMusicEvan,
    focalPoint: "50% 20%",
    voiceDirection: "Attentive adult music tutor · warm, rhythmic, unhurried",
    style: "Classic cel anime",
    background: "Music studio",
    styleGroup: "Anime",
    filterTags: ["anime", "music", "studio", "classic"],
  },
  "presenter-portrait.anime-art-iris-v1": {
    src: animeArtIris,
    focalPoint: "50% 19%",
    voiceDirection: "Reflective adult art tutor · encouraging, descriptive, calm",
    style: "Painterly illustration",
    background: "Art studio",
    styleGroup: "Illustration",
    filterTags: ["illustration", "art", "painterly", "studio"],
  },
  "presenter-portrait.anime-science-adrian-v1": {
    src: animeScienceAdrian,
    focalPoint: "50% 20%",
    voiceDirection: "Precise adult science tutor · grounded, approachable, clear",
    style: "Near-future anime",
    background: "Modern science lab",
    styleGroup: "Anime",
    filterTags: ["anime", "science", "laboratory", "modern"],
  },
  "presenter-portrait.gouache-maeve-v1": {
    src: gouacheMaeve,
    focalPoint: "50% 20%",
    voiceDirection: "Poised adult editorial tutor · thoughtful, confident, measured",
    style: "Editorial gouache",
    background: "Editorial office",
    styleGroup: "Illustration",
    filterTags: ["illustration", "gouache", "editorial", "warm"],
  },
  "presenter-portrait.ligne-claire-hugo-v1": {
    src: ligneClaireHugo,
    focalPoint: "50% 20%",
    voiceDirection: "Congenial adult design tutor · precise, lively, conversational",
    style: "Ligne claire",
    background: "Architecture studio",
    styleGroup: "Illustration",
    filterTags: ["illustration", "ligne-claire", "architecture", "graphic"],
  },
  "presenter-portrait.soft-clay-daphne-v1": {
    src: softClayDaphne,
    focalPoint: "50% 19%",
    voiceDirection: "Reassuring adult design tutor · warm, clear, lightly animated",
    style: "Soft clay",
    background: "Design classroom",
    styleGroup: "Illustration",
    filterTags: ["illustration", "clay", "design", "tactile"],
  },
  "presenter-portrait.storybook-watercolor-arthur-v1": {
    src: storybookWatercolorArthur,
    focalPoint: "50% 20%",
    voiceDirection: "Patient adult natural-history guide · quietly adventurous, story-led",
    style: "Storybook watercolor",
    background: "Natural-history study",
    styleGroup: "Illustration",
    filterTags: ["illustration", "watercolor", "natural-history", "storybook"],
  },
} as const satisfies Readonly<Record<string, NewPresenterPersona>>;

const GENERATED_ATTRIBUTION =
  "Original fictional adult presenter generated with OpenAI image_gen for Alystria Studio; delivery WebP derived from the C2PA-bearing source PNG.";

export const NEW_PRESENTER_ASSETS: readonly StudioAssetReference[] = [
  { id: "presenter-portrait.anime-library-clara-v1", kind: "presenter", label: "Clara · anime library guide", source: "starter-pack", filename: "anime-library-clara-v1.webp", mediaType: "image/webp", byteSize: 69044, sha256: "56ec09bebaaa71b84e7d192b5708d0f6e3ff714c572d7fa0fc3a2d85c9457615", creator: "Alystria Studio image generation", license: "LicenseRef-USER-OWNED", attribution: GENERATED_ATTRIBUTION, rightsStatus: "cleared" },
  { id: "presenter-portrait.anime-botanical-julian-v1", kind: "presenter", label: "Julian · botanical illustration guide", source: "starter-pack", filename: "anime-botanical-julian-v1.webp", mediaType: "image/webp", byteSize: 127126, sha256: "74a548fd51eb1348253aa2154c4d69b35bb0c3af8184d4810dc4e964986d7238", creator: "Alystria Studio image generation", license: "LicenseRef-USER-OWNED", attribution: GENERATED_ATTRIBUTION, rightsStatus: "cleared" },
  { id: "presenter-portrait.anime-seaside-mara-v1", kind: "presenter", label: "Mara · seaside anime guide", source: "starter-pack", filename: "anime-seaside-mara-v1.webp", mediaType: "image/webp", byteSize: 66842, sha256: "274a5f3ccd2dd568b68d15bdf012af55e9867a1a6c8e147aea2f1d35f9fc3673", creator: "Alystria Studio image generation", license: "LicenseRef-USER-OWNED", attribution: GENERATED_ATTRIBUTION, rightsStatus: "cleared" },
  { id: "presenter-portrait.anime-observatory-leon-v1", kind: "presenter", label: "Leon · observatory anime guide", source: "starter-pack", filename: "anime-observatory-leon-v1.webp", mediaType: "image/webp", byteSize: 65690, sha256: "9532c44d98017f624cbe872529688d92cf9d1d542ce8e81298afd8b232ba777f", creator: "Alystria Studio image generation", license: "LicenseRef-USER-OWNED", attribution: GENERATED_ATTRIBUTION, rightsStatus: "cleared" },
  { id: "presenter-portrait.anime-maker-tess-v1", kind: "presenter", label: "Tess · maker anime guide", source: "starter-pack", filename: "anime-maker-tess-v1.webp", mediaType: "image/webp", byteSize: 75710, sha256: "7c5dbdda69adb9c08cb2caa26e6897ded22ad3ee2743880593f4ce0c4179e718", creator: "Alystria Studio image generation", license: "LicenseRef-USER-OWNED", attribution: GENERATED_ATTRIBUTION, rightsStatus: "cleared" },
  { id: "presenter-portrait.anime-music-evan-v1", kind: "presenter", label: "Evan · music studio anime guide", source: "starter-pack", filename: "anime-music-evan-v1.webp", mediaType: "image/webp", byteSize: 50434, sha256: "6b3bf506019a778002efa221cf79c35f0be219944d4981d0efb6271d33dd750f", creator: "Alystria Studio image generation", license: "LicenseRef-USER-OWNED", attribution: GENERATED_ATTRIBUTION, rightsStatus: "cleared" },
  { id: "presenter-portrait.anime-art-iris-v1", kind: "presenter", label: "Iris · painterly illustration guide", source: "starter-pack", filename: "anime-art-iris-v1.webp", mediaType: "image/webp", byteSize: 109468, sha256: "d85c304cbc6d5c994d831edf0306be5d0dbce12a16c1c94e442cbddca8a7de4b", creator: "Alystria Studio image generation", license: "LicenseRef-USER-OWNED", attribution: GENERATED_ATTRIBUTION, rightsStatus: "cleared" },
  { id: "presenter-portrait.anime-science-adrian-v1", kind: "presenter", label: "Adrian · science lab anime guide", source: "starter-pack", filename: "anime-science-adrian-v1.webp", mediaType: "image/webp", byteSize: 65006, sha256: "ae02790d162216ee10bd53cd607e53552f551836aaa2c87507d1601e880cb559", creator: "Alystria Studio image generation", license: "LicenseRef-USER-OWNED", attribution: GENERATED_ATTRIBUTION, rightsStatus: "cleared" },
  { id: "presenter-portrait.gouache-maeve-v1", kind: "presenter", label: "Maeve · editorial gouache guide", source: "starter-pack", filename: "gouache-maeve-v1.webp", mediaType: "image/webp", byteSize: 102602, sha256: "c27e363f620ecdf5f78902a0f6e2e30484bb975ac12e40fd18d40562b348203b", creator: "Alystria Studio image generation", license: "LicenseRef-USER-OWNED", attribution: GENERATED_ATTRIBUTION, rightsStatus: "cleared" },
  { id: "presenter-portrait.ligne-claire-hugo-v1", kind: "presenter", label: "Hugo · ligne claire guide", source: "starter-pack", filename: "ligne-claire-hugo-v1.webp", mediaType: "image/webp", byteSize: 63676, sha256: "dcac5ddfb8e1c4da51a9ed19b728500875a83715e617a06ee256f8f865385f14", creator: "Alystria Studio image generation", license: "LicenseRef-USER-OWNED", attribution: GENERATED_ATTRIBUTION, rightsStatus: "cleared" },
  { id: "presenter-portrait.soft-clay-daphne-v1", kind: "presenter", label: "Daphne · soft clay guide", source: "starter-pack", filename: "soft-clay-daphne-v1.webp", mediaType: "image/webp", byteSize: 77664, sha256: "a700a7d36346a1ab0c6d9c04df02c3bcb88fdcf0111d59eaf493d6cd01d4431b", creator: "Alystria Studio image generation", license: "LicenseRef-USER-OWNED", attribution: GENERATED_ATTRIBUTION, rightsStatus: "cleared" },
  { id: "presenter-portrait.storybook-watercolor-arthur-v1", kind: "presenter", label: "Arthur · storybook watercolor guide", source: "starter-pack", filename: "storybook-watercolor-arthur-v1.webp", mediaType: "image/webp", byteSize: 176662, sha256: "de50259fbcd2560ed93acaeaf3a7d66ce5ecf01203662f28b16e2dfaba528cb9", creator: "Alystria Studio image generation", license: "LicenseRef-USER-OWNED", attribution: GENERATED_ATTRIBUTION, rightsStatus: "cleared" },
];

export const NEW_PRESENTER_IDS = Object.freeze(Object.keys(NEW_PRESENTER_PERSONAS));
