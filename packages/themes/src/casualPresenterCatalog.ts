import type {
  StarterAsset,
  StarterAssetLicense,
  StarterAssetProvenance,
} from "@alystria/contracts";

export type CasualPresenterStyleGroup =
  | "Realistic"
  | "Anime"
  | "Cartoon"
  | "Character"
  | "Animal";

export type CasualPresenterId =
  | "presenter-portrait.casual-realistic-emma-v1"
  | "presenter-portrait.casual-anime-yuki-v1"
  | "presenter-portrait.casual-realistic-noah-v1"
  | "presenter-portrait.casual-cartoon-chloe-v1"
  | "presenter-portrait.casual-realistic-maya-v1"
  | "presenter-portrait.casual-anime-finn-v1"
  | "presenter-portrait.casual-anime-finn-v2"
  | "presenter-portrait.casual-anime-lena-v1"
  | "presenter-portrait.casual-cartoon-robot-pip-v1"
  | "presenter-portrait.animal-cat-milo-v1"
  | "presenter-portrait.animal-kitten-peaches-v1"
  | "presenter-portrait.animal-dog-buddy-v1"
  | "presenter-portrait.animal-puppy-poppy-v1"
  | "presenter-portrait.animal-tiger-tavi-v1"
  | "presenter-portrait.animal-lion-leo-v1";

export interface CasualPresenterPlan {
  readonly id: CasualPresenterId;
  readonly slug: string;
  readonly displayName: string;
  readonly styleGroup: CasualPresenterStyleGroup;
  /** Lower values appear first in the default presenter gallery. */
  readonly featuredRank?: number;
  /** Legacy portraits stay addressable for saved projects without appearing as new choices. */
  readonly galleryVisibility?: "selectable" | "legacy-hidden";
}

/**
 * Identity and gallery placement are stable before media review. These records are
 * deliberately not StarterAssets: an entry cannot become ready until its delivery
 * file, dimensions, rights, and provenance are verified. Lip-sync review remains a
 * separate capability state and never blocks use of a verified static portrait.
 */
export const CASUAL_PRESENTER_PLANS = [
  { id: "presenter-portrait.casual-realistic-emma-v1", slug: "casual-realistic-emma-v1", displayName: "Emma", styleGroup: "Realistic", featuredRank: 0 },
  { id: "presenter-portrait.casual-anime-yuki-v1", slug: "casual-anime-yuki-v1", displayName: "Yuki", styleGroup: "Anime", featuredRank: 1 },
  { id: "presenter-portrait.casual-realistic-noah-v1", slug: "casual-realistic-noah-v1", displayName: "Noah", styleGroup: "Realistic", featuredRank: 2 },
  { id: "presenter-portrait.casual-cartoon-chloe-v1", slug: "casual-cartoon-chloe-v1", displayName: "Chloe", styleGroup: "Cartoon", featuredRank: 3 },
  { id: "presenter-portrait.casual-realistic-maya-v1", slug: "casual-realistic-maya-v1", displayName: "Maya", styleGroup: "Realistic" },
  { id: "presenter-portrait.casual-anime-finn-v1", slug: "casual-anime-finn-v1", displayName: "Finn (legacy)", styleGroup: "Anime", galleryVisibility: "legacy-hidden" },
  { id: "presenter-portrait.casual-anime-finn-v2", slug: "casual-anime-finn-v2", displayName: "Finn", styleGroup: "Anime" },
  { id: "presenter-portrait.casual-anime-lena-v1", slug: "casual-anime-lena-v1", displayName: "Lena", styleGroup: "Anime" },
  { id: "presenter-portrait.casual-cartoon-robot-pip-v1", slug: "casual-cartoon-robot-pip-v1", displayName: "Pip", styleGroup: "Character" },
  { id: "presenter-portrait.animal-cat-milo-v1", slug: "animal-cat-milo-v1", displayName: "Milo", styleGroup: "Animal" },
  { id: "presenter-portrait.animal-kitten-peaches-v1", slug: "animal-kitten-peaches-v1", displayName: "Peaches", styleGroup: "Animal" },
  { id: "presenter-portrait.animal-dog-buddy-v1", slug: "animal-dog-buddy-v1", displayName: "Buddy", styleGroup: "Animal" },
  { id: "presenter-portrait.animal-puppy-poppy-v1", slug: "animal-puppy-poppy-v1", displayName: "Poppy", styleGroup: "Animal" },
  { id: "presenter-portrait.animal-tiger-tavi-v1", slug: "animal-tiger-tavi-v1", displayName: "Tavi", styleGroup: "Animal" },
  { id: "presenter-portrait.animal-lion-leo-v1", slug: "animal-lion-leo-v1", displayName: "Leo", styleGroup: "Animal" },
] as const satisfies readonly CasualPresenterPlan[];

export const CASUAL_PRESENTER_IDS = Object.freeze(
  CASUAL_PRESENTER_PLANS.map((presenter) => presenter.id),
);

export const CASUAL_PRESENTER_SELECTABLE_IDS = Object.freeze(
  CASUAL_PRESENTER_PLANS
    .filter((presenter) => !("galleryVisibility" in presenter) || presenter.galleryVisibility !== "legacy-hidden")
    .map((presenter) => presenter.id),
);

export type CasualPresenterLipSyncEngineId =
  | "soulx-flashhead-pro"
  | "liveportrait-musetalk-1.5"
  | "joyvasa-human"
  | "joyvasa-animal";

export type CasualPresenterLipSyncOutcome =
  | "reviewed-compatible"
  | "pending-review"
  | "incompatible";

export interface CasualPresenterLipSyncQualification {
  /** Exact model ID written to the local presenter worker receipt. */
  readonly engineId: CasualPresenterLipSyncEngineId;
  readonly displayName: string;
  readonly outcome: CasualPresenterLipSyncOutcome;
  readonly notes: string;
}

/**
 * A static portrait can be ready while every animation route is unavailable.
 * Qualification is deliberately per engine so a failed human-face model never
 * becomes a broad claim that an anime, character, or animal portrait cannot move.
 */
export interface CasualPresenterLipSyncReview {
  readonly preferredEngineId: CasualPresenterLipSyncEngineId;
  readonly qualifications: readonly CasualPresenterLipSyncQualification[];
}

export interface VerifiedCasualPresenterDetails {
  readonly label: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly style: string;
  readonly background: string;
  readonly focalPoint: string;
  readonly voiceDirection: string;
  readonly fileExtension: "png" | "webp";
  readonly mediaType: "image/png" | "image/webp";
  readonly contentHash: string;
  readonly byteSize: number;
  readonly width: number;
  readonly height: number;
  /** Present only when the bundled delivery file was derived from a retained source. */
  readonly sourceImageHash?: string;
  readonly c2paStatus: NonNullable<StarterAssetProvenance["c2paStatus"]>;
  readonly generationTool: string;
  readonly generationModel: string;
  readonly promptRecordPath: string;
  readonly recordedAt: StarterAssetProvenance["recordedAt"];
  readonly lipSync: CasualPresenterLipSyncReview;
}

export interface VerifiedCasualPresenter extends CasualPresenterPlan, VerifiedCasualPresenterDetails {
  readonly filename: `${string}.${"png" | "webp"}`;
  readonly relativePath: `apps/desktop/src/assets/presenters/${string}.${"png" | "webp"}`;
}

const USER_OWNED_GENERATED_LICENSE: StarterAssetLicense = {
  status: "cleared",
  expression: "LicenseRef-USER-OWNED",
  name: "User-owned generated starter asset",
  copyrightNotice: "Generated for the Alystria Studio project by the project owner",
  attributionRequired: false,
  redistributionAllowed: true,
  commercialUseAllowed: true,
  derivativesAllowed: true,
  exportAllowed: true,
  restrictions: ["Retain the embedded C2PA metadata and synthetic-origin provenance when the original file is redistributed."],
};

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function assertVerifiedDetails(plan: CasualPresenterPlan, details: VerifiedCasualPresenterDetails): void {
  if (!SHA256_PATTERN.test(details.contentHash) || (details.sourceImageHash !== undefined && !SHA256_PATTERN.test(details.sourceImageHash))) {
    throw new Error(`Casual presenter ${plan.id} needs verified lowercase SHA-256 hashes.`);
  }
  if (!Number.isSafeInteger(details.byteSize) || details.byteSize <= 0) {
    throw new Error(`Casual presenter ${plan.id} needs a verified positive byte size.`);
  }
  if (!Number.isSafeInteger(details.width) || details.width <= 0 || !Number.isSafeInteger(details.height) || details.height <= 0) {
    throw new Error(`Casual presenter ${plan.id} needs verified positive pixel dimensions.`);
  }
  if (details.fileExtension === "png" && details.mediaType !== "image/png" || details.fileExtension === "webp" && details.mediaType !== "image/webp") {
    throw new Error(`Casual presenter ${plan.id} has inconsistent extension and media type.`);
  }
  if (!details.lipSync.qualifications.length
    || new Set(details.lipSync.qualifications.map((entry) => entry.engineId)).size !== details.lipSync.qualifications.length
    || !details.lipSync.qualifications.some((entry) => entry.engineId === details.lipSync.preferredEngineId)
    || details.lipSync.qualifications.some((entry) => !entry.notes.trim())) {
    throw new Error(`Casual presenter ${plan.id} needs unique, documented lip-sync qualifications including its preferred engine.`);
  }
}

export function defineCasualPresenter(
  plan: CasualPresenterPlan,
  details: VerifiedCasualPresenterDetails,
): VerifiedCasualPresenter {
  assertVerifiedDetails(plan, details);
  return Object.freeze({
    ...plan,
    ...details,
    filename: `${plan.slug}.${details.fileExtension}`,
    relativePath: `apps/desktop/src/assets/presenters/${plan.slug}.${details.fileExtension}`,
  });
}

export function casualPresenterStarterAsset(presenter: VerifiedCasualPresenter): StarterAsset {
  return {
    id: presenter.id,
    kind: "presenter-portrait",
    name: presenter.label,
    description: presenter.description,
    tags: [...presenter.tags],
    source: {
      delivery: "bundled-file",
      availability: "ready",
      relativePath: presenter.relativePath,
      contentHash: presenter.contentHash,
      byteSize: presenter.byteSize,
    },
    license: USER_OWNED_GENERATED_LICENSE,
    provenance: {
      origin: presenter.sourceImageHash ? "derived" : "generated",
      creator: "Alystria Studio project owner",
      creationMethod: presenter.sourceImageHash ? "derived-edit" : "generative-model",
      tool: presenter.generationTool,
      model: presenter.generationModel,
      ...(presenter.sourceImageHash ? { sourceRevision: `Retained generated source sha256 ${presenter.sourceImageHash}` } : {}),
      promptAvailability: "artifact-recorded",
      synthetic: true,
      c2paStatus: presenter.c2paStatus,
      ingredientAssetIds: [],
      recordedAt: presenter.recordedAt,
      reviewStatus: "verified",
      notes: `Entirely fictional synthetic presenter; no real person is intended or depicted. Prompt record: ${presenter.promptRecordPath}. Lip-sync qualifications: ${presenter.lipSync.qualifications.map((entry) => `${entry.engineId} ${entry.outcome}`).join(", ")}.`,
    },
    technical: {
      mediaType: presenter.mediaType,
      renderSafe: true,
      remoteFetchRequired: false,
      dimensions: { width: presenter.width, height: presenter.height },
      safeAreaPercent: 5,
      transparentBackground: false,
    },
    accessibility: {
      reducedMotionSafe: true,
      highContrastSafe: true,
      description: presenter.description,
    },
  };
}

type CasualPresenterCatalogDetails = Omit<
  VerifiedCasualPresenterDetails,
  "fileExtension" | "mediaType" | "width" | "height" | "c2paStatus" | "generationTool" | "generationModel" | "promptRecordPath" | "recordedAt" | "lipSync"
>;

function catalogPresenter(id: CasualPresenterId, details: CasualPresenterCatalogDetails): VerifiedCasualPresenter {
  const plan = CASUAL_PRESENTER_PLANS.find((candidate) => candidate.id === id);
  if (!plan) throw new Error(`Missing casual presenter plan for ${id}.`);
  return defineCasualPresenter(plan, {
    ...details,
    fileExtension: "png",
    mediaType: "image/png",
    width: 1254,
    height: 1254,
    c2paStatus: "present-embedded",
    generationTool: "image_gen",
    generationModel: "OpenAI image_gen (model not exposed)",
    promptRecordPath: "docs/assets/casual-presenter-prompts-2026-09-20.json",
    recordedAt: "2026-09-20T00:00:00.000Z",
    lipSync: lipSyncReviewFor(plan),
  });
}

const MUSETALK_REVIEWED_IDS = new Set<CasualPresenterId>([
  "presenter-portrait.casual-realistic-emma-v1",
  "presenter-portrait.casual-realistic-noah-v1",
  "presenter-portrait.casual-realistic-maya-v1",
]);

const JOYVASA_REVIEWED_IDS = new Set<CasualPresenterId>([
  "presenter-portrait.casual-anime-yuki-v1",
  "presenter-portrait.casual-cartoon-chloe-v1",
  "presenter-portrait.casual-anime-lena-v1",
  "presenter-portrait.casual-anime-finn-v2",
  "presenter-portrait.casual-cartoon-robot-pip-v1",
  "presenter-portrait.animal-cat-milo-v1",
  "presenter-portrait.animal-kitten-peaches-v1",
  "presenter-portrait.animal-dog-buddy-v1",
  "presenter-portrait.animal-tiger-tavi-v1",
]);

const JOYVASA_REJECTED_IDS = new Set<CasualPresenterId>([
  "presenter-portrait.animal-puppy-poppy-v1",
  "presenter-portrait.animal-lion-leo-v1",
]);

function lipSyncReviewFor(plan: CasualPresenterPlan): CasualPresenterLipSyncReview {
  if (plan.id === "presenter-portrait.casual-anime-finn-v1") {
    return {
      preferredEngineId: "joyvasa-human",
      qualifications: [
        {
          engineId: "liveportrait-musetalk-1.5",
          displayName: "LivePortrait + MuseTalk 1.5",
          outcome: "incompatible",
          notes: "The MuseTalk result replaced the illustrated mouth style, so this legacy portrait was rejected for animation.",
        },
        {
          engineId: "joyvasa-human",
          displayName: "JoyVASA illustrated-human route",
          outcome: "incompatible",
          notes: "Bounded review found a fixed smile plus a second animated mouth at the chin shadow. Keep existing projects static or replace this portrait with Finn v2.",
        },
      ],
    };
  }
  const museTalk: CasualPresenterLipSyncQualification = MUSETALK_REVIEWED_IDS.has(plan.id)
    ? {
      engineId: "liveportrait-musetalk-1.5",
      displayName: "LivePortrait + MuseTalk 1.5",
      outcome: "reviewed-compatible",
      notes: "Identity, speech motion, and closed-mouth rest were visually accepted on a bounded 8.22-second reference clip on 2026-09-20. The runtime pack is still checked separately on each PC.",
    }
    : {
      engineId: "liveportrait-musetalk-1.5",
      displayName: "LivePortrait + MuseTalk 1.5",
      outcome: "incompatible",
      notes: plan.styleGroup === "Animal"
        ? "The human-face MuseTalk route is not valid for this animal portrait. Use a separately reviewed animal route."
        : plan.styleGroup === "Character"
          ? "The human-face MuseTalk route did not produce a valid result for this character portrait."
          : plan.id === "presenter-portrait.casual-anime-yuki-v1"
            ? "Dense visual review rejected Yuki's native MuseTalk render because a soft realistic lip patch broke the portrait's anime linework. Keep this static portrait off MuseTalk."
          : plan.id === "presenter-portrait.casual-anime-lena-v1"
            ? "Dense visual review rejected Lena's native MuseTalk render because an inpainted realistic lip-and-teeth patch broke the portrait's hand-painted anime style. Keep this static portrait off MuseTalk."
          : plan.id === "presenter-portrait.casual-cartoon-chloe-v1"
            ? "Dense visual review rejected Chloe's native MuseTalk render because the animated lips were visibly distorted. Keep this static portrait off MuseTalk."
          : plan.id === "presenter-portrait.casual-anime-finn-v2"
            ? "Finn v2 is qualified on the pinned JoyVASA illustrated-human route and has not been qualified for MuseTalk, so MuseTalk is not offered for this portrait."
          : "The MuseTalk result replaced the portrait's illustrated mouth style, so this route was rejected.",
    };
  if (MUSETALK_REVIEWED_IDS.has(plan.id)) {
    return { preferredEngineId: museTalk.engineId, qualifications: [museTalk] };
  }
  const usesAnimalRoute = plan.styleGroup === "Animal" || plan.id === "presenter-portrait.casual-cartoon-robot-pip-v1";
  const joyVasaReviewed = JOYVASA_REVIEWED_IDS.has(plan.id);
  const joyVasa: CasualPresenterLipSyncQualification = {
    engineId: usesAnimalRoute ? "joyvasa-animal" : "joyvasa-human",
    displayName: usesAnimalRoute ? "JoyVASA animal and character route" : "JoyVASA illustrated-human route",
    outcome: JOYVASA_REJECTED_IDS.has(plan.id) ? "incompatible" : joyVasaReviewed ? "reviewed-compatible" : "pending-review",
    notes: (JOYVASA_REJECTED_IDS.has(plan.id)
      ? "This portrait is available as a still image. Dense review rejected its current JoyVASA speech because repeated human-like lip and teeth strips distort the muzzle, even with reduced motion. Animation is disabled for this route."
      : joyVasaReviewed
      ? plan.id === "presenter-portrait.casual-anime-finn-v2"
        ? "Primary and held-out short narration renders on the pinned installed route preserved the illustrated face, placed speech at the real mouth, and returned to a closed mouth during detected silence on 2026-09-20. This is bounded evidence, not a claim about every phoneme."
        : plan.id === "presenter-portrait.casual-anime-yuki-v1"
          ? "Primary and held-out short narration renders on the pinned installed JoyVASA human route kept one coherent illustrated mouth, preserved the mouth corners and surrounding skin, and closed during a held-out 1.47–2.58-second silence in visual review on 2026-09-20. Expressions are broad and the mouth can remain slightly parted near speech onset; this does not guarantee sub-130 ms closures or every phoneme."
        : plan.id === "presenter-portrait.casual-anime-lena-v1"
          ? "Primary and held-out short narration renders on the pinned installed JoyVASA human route kept one coherent painted mouth without a soft human lip patch, preserved stable corners, and closed during a held-out 1.47–2.58-second silence in visual review on 2026-09-20. Openings can be broad; this does not guarantee tiny-gap closures or every phoneme."
        : plan.id === "presenter-portrait.casual-cartoon-chloe-v1"
          ? "Primary and held-out short narration renders on the pinned installed JoyVASA human route kept the mouth corners coherent, preserved sharp cartoon shading, and closed during silence in visual review on 2026-09-20. Peak teeth can look mildly jagged, so this is not a universal phoneme claim."
        : plan.styleGroup === "Animal"
          ? "The source-anchored animal route keeps the background and body still and uses restrained mouth movement. Short reviewed samples preserve identity and close during longer silence. Pink lips or teeth can still look humanized; preview each narration before export. This is not animal-natural or phoneme-perfect animation."
          : "The source-anchored character route keeps the background and body still and uses restrained mouth movement. A bright teeth bar or dark mechanical mouth seam can still appear; preview each narration before export."
      : "A pinned local route is under bounded visual review. It is not offered as compatible until exact artifacts and rest-mouth behavior are accepted.") + (joyVasaReviewed && !usesAnimalRoute ? " The corrected source-anchored route keeps the original background and body still while the face speaks; earlier full-frame wobble was rejected." : ""),
  };
  return { preferredEngineId: joyVasa.engineId, qualifications: [museTalk, joyVasa] };
}

/** Verified static portraits with engine-specific, independently truthful lip-sync qualifications. */
export const CASUAL_PRESENTER_CATALOG = Object.freeze([
  catalogPresenter("presenter-portrait.casual-realistic-emma-v1", {
    label: "Emma · casual home-studio tutor",
    description: "Fictional synthetic adult tutor with a natural photographic style and an approachable home-studio presence.",
    tags: ["presenter", "casual", "realistic", "home-studio", "bundled", "synthetic"],
    style: "Natural photographic portrait",
    background: "Warm home creative workspace",
    focalPoint: "50% 20%",
    voiceDirection: "Warm adult tutorial creator · conversational, clear, medium pace",
    contentHash: "27ac749dc0b30c2676d327e2a14fd05f873aee401d4b97bdd684eaab7c42a7f7",
    byteSize: 2199229,
  }),
  catalogPresenter("presenter-portrait.casual-anime-yuki-v1", {
    label: "Yuki · casual anime coding tutor",
    description: "Fictional synthetic adult anime tutor with crisp contemporary linework and a bright home coding workspace.",
    tags: ["presenter", "casual", "anime", "coding", "home-studio", "bundled", "synthetic"],
    style: "Contemporary hand-drawn anime",
    background: "Sunny home coding workspace",
    focalPoint: "50% 19%",
    voiceDirection: "Friendly adult coding tutor · attentive, precise, lightly energetic",
    contentHash: "54f695769e64273cc3a6e7f12742df8b8bfb7b6e844f302daabbf270e6a3aebb",
    byteSize: 2037428,
  }),
  catalogPresenter("presenter-portrait.casual-realistic-noah-v1", {
    label: "Noah · casual maker tutor",
    description: "Fictional synthetic adult maker and software tutor with a natural photographic style and relaxed workshop setting.",
    tags: ["presenter", "casual", "realistic", "maker", "software", "bundled", "synthetic"],
    style: "Natural photographic portrait",
    background: "Warm home maker workshop",
    focalPoint: "50% 19%",
    voiceDirection: "Friendly adult maker tutor · practical, thoughtful, medium pace",
    contentHash: "6f83257ec713c8d0df42ebb1506b9be32735bec9934aa5c2e946e24cbed8c0bd",
    byteSize: 2218368,
  }),
  catalogPresenter("presenter-portrait.casual-cartoon-chloe-v1", {
    label: "Chloe · cartoon science creator",
    description: "Fictional synthetic adult cartoon tutor with softly sculpted 3D styling and an energetic art-and-science room.",
    tags: ["presenter", "casual", "cartoon", "3d", "science", "art", "bundled", "synthetic"],
    style: "Softly sculpted 3D cartoon",
    background: "Colorful art and science room",
    focalPoint: "50% 18%",
    voiceDirection: "Bright adult science creator · lively, articulate, encouraging",
    contentHash: "4afecb9e0141a3bcb933aca577222adfa7819fd3dc49a9b437f1b1bc0f3437ca",
    byteSize: 2202377,
  }),
  catalogPresenter("presenter-portrait.casual-realistic-maya-v1", {
    label: "Maya · casual science tutor",
    description: "Fictional synthetic adult science and creativity tutor with a natural photographic style and bright home study.",
    tags: ["presenter", "casual", "realistic", "science", "creativity", "bundled", "synthetic"],
    style: "Natural photographic portrait",
    background: "Bright home science study",
    focalPoint: "50% 20%",
    voiceDirection: "Warm adult science tutor · curious, assured, conversational",
    contentHash: "62ee0fd94a0e92114e000e89a6420e9ce0c7726e5b4b8ec2165c041f2252e79b",
    byteSize: 2325687,
  }),
  catalogPresenter("presenter-portrait.casual-anime-finn-v1", {
    label: "Finn · legacy portrait (static only)",
    description: "Legacy fictional synthetic engineering tutor retained for existing projects and static use only.",
    tags: ["presenter", "casual", "anime", "retro", "engineering", "maker", "legacy", "static-only", "bundled", "synthetic"],
    style: "Retro 1990s cel anime",
    background: "Sunlit electronics workshop",
    focalPoint: "50% 19%",
    voiceDirection: "Confident adult engineering tutor · practical, concise, upbeat",
    contentHash: "98ff859669a316dcbf2f1b8edd30941b355ee244308a3b755ffd51e4630a8494",
    byteSize: 1850287,
  }),
  catalogPresenter("presenter-portrait.casual-anime-finn-v2", {
    label: "Finn · retro anime maker tutor",
    description: "Fictional synthetic adult engineering tutor with a clean front-facing cel-anime design in a sunlit electronics workshop.",
    tags: ["presenter", "casual", "anime", "retro", "engineering", "maker", "bundled", "synthetic"],
    style: "Retro 1990s cel anime",
    background: "Sunlit electronics workshop",
    focalPoint: "50% 19%",
    voiceDirection: "Confident adult engineering tutor · practical, concise, upbeat",
    contentHash: "74d2677cf5666de2bf2702da0ea24703d636dbcc121fa28735e20bfde86e43a1",
    byteSize: 1784995,
  }),
  catalogPresenter("presenter-portrait.casual-anime-lena-v1", {
    label: "Lena · hand-painted anime nature tutor",
    description: "Fictional synthetic adult natural-science tutor in a warm hand-painted anime conservatory.",
    tags: ["presenter", "casual", "anime", "hand-painted", "nature", "science", "bundled", "synthetic"],
    style: "Hand-painted anime illustration",
    background: "Conservatory learning nook",
    focalPoint: "50% 19%",
    voiceDirection: "Warm adult natural-science tutor · calm, observant, clear",
    contentHash: "280c530e69c08737698c0fff8b0a582ac76fb9799cf0ad6a780d540c68f667f1",
    byteSize: 2445372,
  }),
  catalogPresenter("presenter-portrait.casual-cartoon-robot-pip-v1", {
    label: "Pip · cartoon robot tutor",
    description: "Original fictional robot teaching assistant with a rounded 3D cartoon design and a cheerful electronics desk.",
    tags: ["presenter", "casual", "cartoon", "robot", "character", "maker", "bundled", "synthetic"],
    style: "Rounded 3D cartoon character",
    background: "Home electronics craft desk",
    focalPoint: "50% 18%",
    voiceDirection: "Bright teaching assistant · friendly, concise, gently playful",
    contentHash: "b0163d6e3250d345c97e1c261fa3ff69cf0dcab70f248cad27a06dfe5e818d29",
    byteSize: 2082833,
  }),
  catalogPresenter("presenter-portrait.animal-cat-milo-v1", {
    label: "Milo · cat science tutor",
    description: "Original fictional orange tabby tutor with polished animated styling and a cozy reading-and-science nook.",
    tags: ["presenter", "animal", "cat", "3d", "science", "reading", "bundled", "synthetic"],
    style: "Polished 3D animal character",
    background: "Cozy reading and science nook",
    focalPoint: "50% 17%",
    voiceDirection: "Warm character tutor · curious, welcoming, unhurried",
    contentHash: "f47095f9b54b54d53fecfa49a93241544869aa359d8ce3273b38a8575965bafd",
    byteSize: 2502495,
  }),
  catalogPresenter("presenter-portrait.animal-kitten-peaches-v1", {
    label: "Peaches · clay kitten tutor",
    description: "Original fictional kitten teaching mascot with a soft clay style and a pastel craft classroom.",
    tags: ["presenter", "animal", "kitten", "clay", "craft", "young-learners", "bundled", "synthetic"],
    style: "Soft clay animal character",
    background: "Pastel craft classroom",
    focalPoint: "50% 16%",
    voiceDirection: "Gentle character tutor · bright, encouraging, clearly paced",
    contentHash: "6cb3c5727c422ac6e717f64c8c345abb757f65c5399555e5c0058f7db3524ab1",
    byteSize: 2223881,
  }),
  catalogPresenter("presenter-portrait.animal-dog-buddy-v1", {
    label: "Buddy · dog workshop tutor",
    description: "Original fictional golden retriever tutor with polished animated styling and a sunny practical-learning corner.",
    tags: ["presenter", "animal", "dog", "3d", "workshop", "practical", "bundled", "synthetic"],
    style: "Polished 3D animal character",
    background: "Sunny home workshop",
    focalPoint: "50% 17%",
    voiceDirection: "Friendly character tutor · patient, practical, conversational",
    contentHash: "68fa5cd79ebb50e9b0a5b00d2c28d2d636bee695f0b579f1a36afaa62aa25062",
    byteSize: 2368887,
  }),
  catalogPresenter("presenter-portrait.animal-puppy-poppy-v1", {
    label: "Poppy · storybook puppy tutor",
    description: "Original fictional corgi puppy teaching mascot in a warm hand-painted storybook classroom.",
    tags: ["presenter", "animal", "puppy", "storybook", "craft", "young-learners", "bundled", "synthetic"],
    style: "Hand-painted storybook animal",
    background: "Cozy craft classroom",
    focalPoint: "50% 16%",
    voiceDirection: "Bright character tutor · cheerful, encouraging, clearly paced",
    contentHash: "704dce7be0612822ff0dc10ebfce8627cd808e63a0b3e158fa070fe19f8d633a",
    byteSize: 2495845,
  }),
  catalogPresenter("presenter-portrait.animal-tiger-tavi-v1", {
    label: "Tavi · tiger science tutor",
    description: "Original fictional tiger tutor with polished 3D styling and a warm natural-science study.",
    tags: ["presenter", "animal", "tiger", "3d", "science", "nature", "bundled", "synthetic"],
    style: "Polished 3D animal character",
    background: "Warm natural-science study",
    focalPoint: "50% 17%",
    voiceDirection: "Calm character tutor · confident, approachable, measured",
    contentHash: "e8fb1f4d917377a68d379ffd734463f97b20ef2238b7f9d32fff389c86000ae5",
    byteSize: 2523155,
  }),
  catalogPresenter("presenter-portrait.animal-lion-leo-v1", {
    label: "Leo · clay lion tutor",
    description: "Original fictional lion tutor with a tactile clay style and a softly simplified library study.",
    tags: ["presenter", "animal", "lion", "clay", "library", "humanities", "bundled", "synthetic"],
    style: "Soft sculpted clay animal",
    background: "Cozy library study",
    focalPoint: "50% 16%",
    voiceDirection: "Thoughtful character tutor · warm, measured, story-led",
    contentHash: "7694fb148894a41dcf4df55182bd803946a3d18f9a7a81daaf3cb3987411894e",
    byteSize: 2452101,
  }),
]);

export const CASUAL_PRESENTER_STARTER_ASSETS = Object.freeze(
  CASUAL_PRESENTER_CATALOG.map(casualPresenterStarterAsset),
);
