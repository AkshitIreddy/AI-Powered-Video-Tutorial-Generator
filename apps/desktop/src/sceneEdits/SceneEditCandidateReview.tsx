import { useEffect, useMemo, useState } from "react";
import { Check, LoaderCircle, RotateCcw, X } from "lucide-react";
import type { SceneEditCandidate, SceneEditContent, SceneEditDecision, SceneEditDecisionState } from "./types";
import "./sceneEditCandidateReview.css";

export interface SceneEditCandidateReviewProps {
  current: SceneEditContent;
  candidates: readonly SceneEditCandidate[];
  onAccept: (candidate: SceneEditCandidate) => Promise<void>;
  onReject: (candidate: SceneEditCandidate) => Promise<void>;
}

const IDLE: SceneEditDecisionState = { phase: "idle" };

function message(error: unknown, decision: SceneEditDecision): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return decision === "accept"
    ? "This change could not be accepted. Try again."
    : "This change could not be rejected. Try again.";
}

function seconds(value: number): string {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} sec`;
}

function statusLabel(candidate: SceneEditCandidate, state: SceneEditDecisionState): string {
  if (state.phase === "accepted") return "Accepted";
  if (state.phase === "rejected") return "Rejected";
  if (state.phase === "saving") return state.decision === "accept" ? "Accepting" : "Rejecting";
  if (state.phase === "error") return "Action failed";
  return candidate.status.charAt(0).toUpperCase() + candidate.status.slice(1);
}

interface ComparisonRowProps {
  label: string;
  current: string;
  proposed: string;
}

function ComparisonRow({ label, current, proposed }: ComparisonRowProps) {
  const changed = current !== proposed;
  return <div className={`scene-edit-review__comparison${changed ? " is-changed" : ""}`}>
    <h4>{label}<span>{changed ? "Changed" : "Unchanged"}</span></h4>
    <div><strong>Current</strong><p>{current}</p></div>
    <div><strong>Proposed</strong><p>{proposed}</p></div>
  </div>;
}

export function SceneEditCandidateReview({ current, candidates, onAccept, onReject }: SceneEditCandidateReviewProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Record<string, SceneEditDecisionState>>({});
  const selected = useMemo(
    () => candidates.find((item) => item.id === selectedId) ?? candidates[0],
    [candidates, selectedId],
  );

  useEffect(() => {
    if (selectedId !== null && !candidates.some((item) => item.id === selectedId)) setSelectedId(null);
  }, [candidates, selectedId]);

  if (!selected) {
    return <section className="scene-edit-review" aria-label="Authored scene changes">
      <p className="scene-edit-review__empty">No authored scene changes are ready to review.</p>
    </section>;
  }

  const state = decisions[selected.id] ?? IDLE;
  const resolvedStatus = state.phase === "accepted" || state.phase === "rejected" ? state.phase : selected.status;
  const canDecide = resolvedStatus === "ready" && state.phase !== "saving";

  const decide = async (decision: SceneEditDecision) => {
    const candidate = selected;
    setDecisions((all) => ({ ...all, [candidate.id]: { phase: "saving", decision } }));
    try {
      await (decision === "accept" ? onAccept(candidate) : onReject(candidate));
      setDecisions((all) => ({ ...all, [candidate.id]: { phase: decision === "accept" ? "accepted" : "rejected" } }));
    } catch (error) {
      setDecisions((all) => ({ ...all, [candidate.id]: { phase: "error", decision, message: message(error, decision) } }));
    }
  };

  return <section className="scene-edit-review" aria-labelledby="scene-edit-review-title">
    <header className="scene-edit-review__header">
      <div><span>Authored scene change</span><h3 id="scene-edit-review-title">Review suggested wording</h3></div>
      <output className={`scene-edit-review__status is-${state.phase === "idle" ? selected.status : state.phase}`} aria-live="polite">
        {statusLabel(selected, state)}
      </output>
    </header>

    <div className="scene-edit-review__tabs" role="group" aria-label="Scene edit candidates">
      {candidates.map((item, index) => {
        const itemState = decisions[item.id] ?? IDLE;
        return <button
          type="button"
          key={item.id}
          className={item.id === selected.id ? "active" : ""}
          aria-pressed={item.id === selected.id}
          aria-label={`Candidate ${index + 1}: ${item.focus}; ${statusLabel(item, itemState)}`}
          onClick={() => setSelectedId(item.id)}
        >
          <span>{index + 1}</span>
          <span><strong>{item.focus === "explanation" ? "Clearer explanation" : "Adjusted pacing"}</strong><small>{statusLabel(item, itemState)}</small></span>
        </button>;
      })}
    </div>

    <div className="scene-edit-review__context">
      <p><strong>Request</strong>{selected.instruction}</p>
      <p><strong>Prepared by</strong>{selected.provider} · {selected.model}</p>
    </div>

    <div className="scene-edit-review__comparisons">
      <ComparisonRow label="Title" current={current.title} proposed={selected.proposed.title} />
      <ComparisonRow label="Learning objective" current={current.objective} proposed={selected.proposed.objective} />
      <ComparisonRow label="Narration" current={current.narration} proposed={selected.proposed.narration} />
      <ComparisonRow label="Duration" current={seconds(current.durationSeconds)} proposed={seconds(selected.proposed.durationSeconds)} />
    </div>

    {selected.proposed.visualIntent && <div className="scene-edit-review__visual-intent"><strong>Visual direction</strong><p>{selected.proposed.visualIntent}</p></div>}
    {selected.status === "failed" && <p className="scene-edit-review__error" role="alert">{selected.error ?? "This candidate could not be prepared."}</p>}
    {state.phase === "error" && <p className="scene-edit-review__error" role="alert">{state.message}</p>}

    {resolvedStatus === "ready" ? <div className="scene-edit-review__actions">
      <button type="button" className="secondary-button" disabled={!canDecide} aria-busy={state.phase === "saving" && state.decision === "reject"} onClick={() => { void decide("reject"); }}>
        {state.phase === "saving" && state.decision === "reject" ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : <X size={15} aria-hidden="true" />}
        {state.phase === "saving" && state.decision === "reject" ? "Rejecting…" : state.phase === "error" && state.decision === "reject" ? "Try rejecting again" : "Reject change"}
      </button>
      <button type="button" className="primary-button" disabled={!canDecide} aria-busy={state.phase === "saving" && state.decision === "accept"} onClick={() => { void decide("accept"); }}>
        {state.phase === "saving" && state.decision === "accept" ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : state.phase === "error" && state.decision === "accept" ? <RotateCcw size={15} aria-hidden="true" /> : <Check size={15} aria-hidden="true" />}
        {state.phase === "saving" && state.decision === "accept" ? "Accepting…" : state.phase === "error" && state.decision === "accept" ? "Try accepting again" : "Accept change"}
      </button>
    </div> : <p className={`scene-edit-review__result is-${resolvedStatus}`} role="status">
      {resolvedStatus === "accepted" ? <><Check size={15} aria-hidden="true" /> This change was accepted.</> : resolvedStatus === "rejected" ? <><X size={15} aria-hidden="true" /> This change was rejected.</> : <>This candidate is unavailable.</>}
    </p>}
  </section>;
}
