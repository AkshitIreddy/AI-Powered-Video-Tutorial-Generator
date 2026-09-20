export type VisualCandidateStatus = "ready" | "accepted" | "rejected" | "failed";

export interface VisualCandidateRights {
  exportEligible: boolean;
  status?: string;
  license?: string;
  source?: string;
  attribution?: string;
  creator?: string;
  commercialUse?: "allowed";
  redistribution?: "allowed" | "composedWorkOnly";
  modelInput?: "allowed" | "reviewOnly" | "notAllowed";
}

export interface LicensedVisualSource {
  providerId: string;
  sourceAssetId: string;
  sourceUrl: string;
  creator: string;
  licenseId: string;
}

export interface VisualCandidateReviewRecord {
  judgeProviderId: string;
  judgeModel: string;
  lessonFit: number;
  composition: number;
  technicalQuality: number;
  overall: number;
  risks: string[];
  rationale: string;
  recommended: boolean;
  reviewRequired: true;
}

export interface VisualCandidate {
  id: string;
  sceneId: string;
  status: VisualCandidateStatus;
  artifactHash: string;
  mediaType: string;
  prompt: string;
  model: string;
  provider: string;
  seed: number;
  role: "scene" | "presenter";
  displayName?: string;
  createdAt: string;
  origin?: "aiGenerated" | "licensedMedia";
  error?: string;
  rejectionReason?: string;
  rights?: VisualCandidateRights;
  licensedSource?: LicensedVisualSource;
  visualReview?: VisualCandidateReviewRecord;
}

const IMAGE_MEDIA_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const CANDIDATE_STATUSES = new Set<VisualCandidateStatus>(["ready", "accepted", "rejected", "failed"]);
const LICENSED_RISKS = new Set(["faces", "irrelevant", "logos", "low_resolution", "pseudo_text", "unsafe", "watermark"]);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function boundedText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
}

function publicHttpsUrl(value: unknown): value is string {
  if (!boundedText(value, 2_000)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && Boolean(parsed.hostname) && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

function score(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 100;
}

function licensedDetails(candidate: Record<string, unknown>): boolean {
  const source = record(candidate.licensedSource);
  const rights = record(candidate.rights);
  const review = record(candidate.visualReview);
  if (!source || !rights || !review || candidate.role !== "scene") return false;
  if (!boundedText(source.providerId, 240) || source.providerId !== candidate.provider
    || typeof source.sourceAssetId !== "string" || !/^[a-f0-9]{64}$/u.test(source.sourceAssetId)
    || !publicHttpsUrl(source.sourceUrl)
    || !boundedText(source.creator, 500) || !boundedText(source.licenseId, 500)) return false;
  if (rights.status !== "verified" || rights.exportEligible !== true
    || rights.commercialUse !== "allowed"
    || !["allowed", "composedWorkOnly"].includes(String(rights.redistribution))
    || !["allowed", "reviewOnly", "notAllowed"].includes(String(rights.modelInput))
    || rights.source !== source.sourceUrl || rights.creator !== source.creator
    || rights.attribution !== source.creator || rights.license !== source.licenseId) return false;
  if (!boundedText(review.judgeProviderId, 240) || !boundedText(review.judgeModel, 500)
    || !score(review.lessonFit) || !score(review.composition)
    || !score(review.technicalQuality) || !score(review.overall)
    || !Array.isArray(review.risks) || review.risks.length > LICENSED_RISKS.size
    || !review.risks.every((risk) => typeof risk === "string" && LICENSED_RISKS.has(risk))
    || new Set(review.risks).size !== review.risks.length
    || typeof review.rationale !== "string" || review.rationale.length > 500
    || typeof review.recommended !== "boolean" || review.reviewRequired !== true) return false;
  return true;
}

export function visualCandidates(value: unknown): VisualCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is VisualCandidate => {
    const candidate = record(item);
    if (!candidate) return false;
    const origin = candidate.origin ?? "aiGenerated";
    const baseValid = boundedText(candidate.id, 240) && boundedText(candidate.sceneId, 240)
      && CANDIDATE_STATUSES.has(candidate.status as VisualCandidateStatus)
      && ["scene", "presenter"].includes(String(candidate.role))
      && typeof candidate.artifactHash === "string" && /^[a-f0-9]{64}$/u.test(candidate.artifactHash)
      && IMAGE_MEDIA_TYPES.has(String(candidate.mediaType))
      && typeof candidate.prompt === "string" && candidate.prompt.length <= 8_000
      && boundedText(candidate.model, 500) && boundedText(candidate.provider, 240)
      && Number.isSafeInteger(candidate.seed)
      && boundedText(candidate.createdAt, 100)
      && (origin === "aiGenerated" || origin === "licensedMedia");
    if (!baseValid || (candidate.role === "presenter" && !boundedText(candidate.displayName, 120))) return false;
    return origin === "licensedMedia" ? licensedDetails(candidate) : true;
  });
}
