import {
  CASUAL_PRESENTER_CATALOG,
  type CasualPresenterId,
  type CasualPresenterLipSyncReview,
  type CasualPresenterStyleGroup,
} from "@alystria/themes";
import type { StudioAssetReference } from "./types";

import animalCatMilo from "./assets/presenters/animal-cat-milo-v1.png";
import animalDogBuddy from "./assets/presenters/animal-dog-buddy-v1.png";
import animalKittenPeaches from "./assets/presenters/animal-kitten-peaches-v1.png";
import animalLionLeo from "./assets/presenters/animal-lion-leo-v1.png";
import animalPuppyPoppy from "./assets/presenters/animal-puppy-poppy-v1.png";
import animalTigerTavi from "./assets/presenters/animal-tiger-tavi-v1.png";
import casualAnimeFinn from "./assets/presenters/casual-anime-finn-v1.png";
import casualAnimeLena from "./assets/presenters/casual-anime-lena-v1.png";
import casualAnimeYuki from "./assets/presenters/casual-anime-yuki-v1.png";
import casualCartoonChloe from "./assets/presenters/casual-cartoon-chloe-v1.png";
import casualCartoonRobotPip from "./assets/presenters/casual-cartoon-robot-pip-v1.png";
import casualRealisticEmma from "./assets/presenters/casual-realistic-emma-v1.png";
import casualRealisticMaya from "./assets/presenters/casual-realistic-maya-v1.png";
import casualRealisticNoah from "./assets/presenters/casual-realistic-noah-v1.png";

const SOURCE_BY_ID = {
  "presenter-portrait.casual-realistic-emma-v1": casualRealisticEmma,
  "presenter-portrait.casual-anime-yuki-v1": casualAnimeYuki,
  "presenter-portrait.casual-realistic-noah-v1": casualRealisticNoah,
  "presenter-portrait.casual-cartoon-chloe-v1": casualCartoonChloe,
  "presenter-portrait.casual-realistic-maya-v1": casualRealisticMaya,
  "presenter-portrait.casual-anime-finn-v1": casualAnimeFinn,
  "presenter-portrait.casual-anime-lena-v1": casualAnimeLena,
  "presenter-portrait.casual-cartoon-robot-pip-v1": casualCartoonRobotPip,
  "presenter-portrait.animal-cat-milo-v1": animalCatMilo,
  "presenter-portrait.animal-kitten-peaches-v1": animalKittenPeaches,
  "presenter-portrait.animal-dog-buddy-v1": animalDogBuddy,
  "presenter-portrait.animal-puppy-poppy-v1": animalPuppyPoppy,
  "presenter-portrait.animal-tiger-tavi-v1": animalTigerTavi,
  "presenter-portrait.animal-lion-leo-v1": animalLionLeo,
} as const satisfies Readonly<Record<CasualPresenterId, string>>;

export interface CasualPresenterPersona {
  readonly src: string;
  readonly focalPoint: string;
  readonly voiceDirection: string;
  readonly style: string;
  readonly background: string;
  readonly styleGroup: CasualPresenterStyleGroup;
  readonly filterTags: readonly string[];
  readonly featuredRank?: number;
  readonly lipSync: CasualPresenterLipSyncReview;
}

const GENERATED_ATTRIBUTION =
  "Original fictional presenter generated with OpenAI image_gen for Alystria Studio; source PNG retains embedded C2PA provenance.";

export const CASUAL_PRESENTER_PERSONAS = Object.freeze(Object.fromEntries(
  CASUAL_PRESENTER_CATALOG.map((presenter) => [presenter.id, {
    src: SOURCE_BY_ID[presenter.id],
    focalPoint: presenter.focalPoint,
    voiceDirection: presenter.voiceDirection,
    style: presenter.style,
    background: presenter.background,
    styleGroup: presenter.styleGroup,
    filterTags: presenter.tags,
    ...(presenter.featuredRank === undefined ? {} : { featuredRank: presenter.featuredRank }),
    lipSync: presenter.lipSync,
  }]),
)) as Readonly<Record<CasualPresenterId, CasualPresenterPersona>>;

export const CASUAL_PRESENTER_ASSETS: readonly StudioAssetReference[] = Object.freeze(
  CASUAL_PRESENTER_CATALOG.map((presenter): StudioAssetReference => ({
    id: presenter.id,
    kind: "presenter",
    label: presenter.label,
    source: "starter-pack",
    filename: presenter.filename,
    mediaType: presenter.mediaType,
    byteSize: presenter.byteSize,
    sha256: presenter.contentHash,
    creator: "Alystria Studio image generation",
    license: "LicenseRef-USER-OWNED",
    attribution: GENERATED_ATTRIBUTION,
    rightsStatus: "cleared",
  })),
);

export const CASUAL_PRESENTER_IDS: readonly CasualPresenterId[] = Object.freeze(
  CASUAL_PRESENTER_CATALOG.map((presenter) => presenter.id),
);
