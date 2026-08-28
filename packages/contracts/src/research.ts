import type { BoundingBox, EntityId, IsoDateTime, Locale, Sha256 } from "./common.js";

export type AccessibilityNeed = "captions" | "descriptive-transcript" | "audio-description" | "reduced-motion" | "high-contrast" | "plain-language" | "screen-reader" | "none";
export interface LearnerProfile {
  id: EntityId; audience: string; ageBand?: "child" | "teen" | "adult" | "mixed" | "unspecified";
  knowledgeLevel: "novice" | "beginner" | "intermediate" | "advanced" | "expert";
  locale: Locale; goals?: string[]; priorKnowledge?: string[]; constraints?: string[]; accessibilityNeeds: AccessibilityNeed[];
}

export type SourceLocator =
  | { kind: "file"; localPath: string; value?: string; canonicalUri?: string }
  | { kind: "url" | "doi" | "isbn" | "arxiv" | "pmid" | "user-note" | "dataset" | "api-record"; value: string; canonicalUri?: string; localPath?: string };

export interface SourceVersion {
  id: EntityId; sourceId: EntityId; locator: SourceLocator; title: string; authors?: string[]; publisher?: string;
  publishedAt?: IsoDateTime; retrievedAt: IsoDateTime; contentHash: Sha256; mimeType?: string; language?: Locale;
  trust: "primary" | "authoritative" | "peer-reviewed" | "reputable-secondary" | "community" | "user-provided" | "unknown";
  storagePolicy: "copied" | "cached" | "transient" | "link-only" | "quarantined";
  rightsStatus: "cleared" | "attribution-required" | "link-only" | "unknown" | "restricted" | "expired";
  licenseExpression?: string; metadata?: import("./common.js").JsonValue;
}

export type EvidenceLocator = {
  method: "text-offset" | "page-box" | "time-range" | "table-cell" | "figure" | "section" | "record";
  startOffset?: number; endOffset?: number; page?: number; boundingBoxes?: BoundingBox[]; startMs?: number; endMs?: number; label?: string; recordId?: string;
};

export interface EvidenceChunk {
  id: EntityId; sourceVersionId: EntityId; text: string; locator: EvidenceLocator; headingPath?: string[];
  contentHash: Sha256; createdAt: IsoDateTime; embeddingArtifactId?: EntityId;
}

export type ClaimType = "fact" | "definition" | "causal" | "quantitative" | "procedural" | "interpretive" | "quotation" | "creative";
export interface AtomicClaim {
  id: EntityId; statement: string; claimType: ClaimType;
  verifiability: "externally-verifiable" | "source-dependent" | "subjective" | "creative";
  supportStatus: "unsupported" | "partially-supported" | "supported" | "contradicted" | "not-required";
  importance: "minor" | "major" | "critical"; supportIds?: EntityId[]; notes?: string;
}

export interface ClaimSupport {
  id: EntityId; claimId: EntityId; evidenceChunkId: EntityId; relationship: "entails" | "supports" | "contextualizes" | "qualifies" | "contradicts";
  assessment: number; rationale?: string; assessedBy: "human" | "model" | "rule"; assessedAt: IsoDateTime;
}

export interface LearningObjective {
  id: EntityId; statement: string; taxonomyLevel: "remember" | "understand" | "apply" | "analyze" | "evaluate" | "create";
  prerequisiteObjectiveIds?: EntityId[]; assessmentCriteria: string[];
}

export interface ConceptNode {
  id: EntityId; label: string; kind: "concept" | "skill" | "misconception" | "example" | "assessment";
  objectiveIds: EntityId[]; prerequisiteIds: EntityId[]; description?: string;
}

export interface LearningPlan {
  id: EntityId; learnerProfileId: EntityId; groundingMode: "creative" | "grounded" | "strict";
  objectives: LearningObjective[]; concepts: ConceptNode[]; misconceptions: string[]; estimatedDurationSeconds?: number; createdAt: IsoDateTime;
}

export interface ResearchBundle {
  learnerProfile: LearnerProfile; learningPlan: LearningPlan; sources: SourceVersion[]; evidence: EvidenceChunk[]; claims: AtomicClaim[]; supports: ClaimSupport[];
}
