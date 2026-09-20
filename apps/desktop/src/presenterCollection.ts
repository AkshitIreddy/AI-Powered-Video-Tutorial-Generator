import { CASUAL_PRESENTER_IDS } from "./casualPresenterLibrary";
import type { PresenterStyleGroup } from "./PresenterPicker";

/** Current curated fictional presenter designs; retained legacy IDs can still open saved projects. */
export const LEGACY_PRESENTER_STYLE_GROUPS = Object.freeze({
  "presenter-portrait.software-daniel-v1": "Realistic",
  "presenter-portrait.language-sofia-v1": "Realistic",
  "presenter-portrait.history-marcus-v1": "Realistic",
  "presenter-portrait.young-learners-lily-v1": "Realistic",
  "presenter-portrait.broadcast-elena-v1": "Realistic",
  "presenter-portrait.anime-astrid-v1": "Anime",
  "presenter-portrait.graphic-luca-v1": "Illustration",
  "presenter-portrait.clay-nora-v1": "Illustration",
  "presenter-portrait.watercolor-elisabeth-v1": "Illustration",
  "presenter-portrait.animated-theo-v1": "Cartoon",
  "presenter-portrait.retro-felix-v1": "Illustration",
  "presenter-portrait.holographic-selene-v1": "Illustration",
  "presenter-portrait.papercut-celia-v1": "Illustration",
  "presenter-portrait.ink-roman-v1": "Illustration",
  "presenter-portrait.oil-helena-v1": "Illustration",
  "presenter-portrait.vector-avery-v1": "Illustration",
  "presenter-portrait.cartoon-oliver-v1": "Cartoon",
  "presenter-portrait.charcoal-marta-v1": "Illustration",
  "presenter-portrait.cartoon-camille-v1": "Cartoon",
  "presenter-portrait.cartoon-elias-v1": "Cartoon",
  "presenter-portrait.anime-library-clara-v1": "Anime",
  "presenter-portrait.anime-botanical-julian-v1": "Illustration",
  "presenter-portrait.anime-seaside-mara-v1": "Anime",
  "presenter-portrait.anime-observatory-leon-v1": "Anime",
  "presenter-portrait.anime-maker-tess-v1": "Anime",
  "presenter-portrait.anime-music-evan-v1": "Anime",
  "presenter-portrait.anime-art-iris-v1": "Illustration",
  "presenter-portrait.anime-science-adrian-v1": "Anime",
  "presenter-portrait.gouache-maeve-v1": "Illustration",
  "presenter-portrait.ligne-claire-hugo-v1": "Illustration",
  "presenter-portrait.soft-clay-daphne-v1": "Illustration",
  "presenter-portrait.storybook-watercolor-arthur-v1": "Illustration",
} as const satisfies Readonly<Record<string, PresenterStyleGroup>>);

export const presenterCollection = new Set<string>([
  ...CASUAL_PRESENTER_IDS,
  ...Object.keys(LEGACY_PRESENTER_STYLE_GROUPS),
]);
