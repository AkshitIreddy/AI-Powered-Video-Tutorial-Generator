export type SceneEditCandidateStatus = "ready" | "accepted" | "rejected" | "failed";

export type SceneEditFocus = "explanation" | "pacing";

export interface SceneEditContent {
  title: string;
  narration: string;
  objective: string;
  durationSeconds: number;
  visualIntent?: string;
}

export interface SceneEditCandidate {
  id: string;
  sceneId: string;
  status: SceneEditCandidateStatus;
  instruction: string;
  focus: SceneEditFocus;
  proposed: SceneEditContent;
  originalHash: string;
  createdAt: string;
  provider: string;
  model: string;
  error?: string;
}

export type SceneEditDecision = "accept" | "reject";

export type SceneEditDecisionState =
  | { phase: "idle" }
  | { phase: "saving"; decision: SceneEditDecision }
  | { phase: "accepted" }
  | { phase: "rejected" }
  | { phase: "error"; decision: SceneEditDecision; message: string };
