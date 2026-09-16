import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SceneEditCandidateReview } from "../SceneEditCandidateReview";
import type { SceneEditCandidate, SceneEditContent } from "../types";

const current: SceneEditContent = {
  title: "Binary search",
  narration: "Look at the middle and choose a side.",
  objective: "Describe binary search.",
  durationSeconds: 12,
};

const explanation: SceneEditCandidate = {
  id: "edit-explanation",
  sceneId: "scene-one",
  status: "ready",
  instruction: "Make the explanation more concrete.",
  focus: "explanation",
  proposed: {
    title: "Binary search halves the question",
    narration: "Check the middle value. That answer tells us which half can still contain the target.",
    objective: "Explain why each comparison removes half of the remaining values.",
    durationSeconds: 18,
  },
  originalHash: "a".repeat(64),
  createdAt: "2026-09-16T08:30:00Z",
  provider: "local-runtime",
  model: "scene-writer-v1",
};

const pacing: SceneEditCandidate = {
  ...explanation,
  id: "edit-pacing",
  focus: "pacing",
  instruction: "Tighten the scene.",
  proposed: {
    ...current,
    narration: "Check the middle. Keep only the half that can contain the target.",
    durationSeconds: 9,
    visualIntent: "Move the midpoint marker as the interval narrows.",
  },
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => { resolve = complete; });
  return { promise, resolve };
}

describe("SceneEditCandidateReview", () => {
  it("compares authored fields and selects among candidates", async () => {
    const user = userEvent.setup();
    render(<SceneEditCandidateReview current={current} candidates={[explanation, pacing]} onAccept={async () => undefined} onReject={async () => undefined} />);

    expect(screen.getByRole("heading", { name: "Review suggested wording" })).toBeInTheDocument();
    expect(screen.getByText("Binary search halves the question")).toBeInTheDocument();
    expect(screen.getByText("18 sec")).toBeInTheDocument();
    expect(screen.getAllByText("Changed")).toHaveLength(4);

    await user.click(screen.getByRole("button", { name: /Candidate 2: pacing/ }));
    expect(screen.getByText("Tighten the scene.")).toBeInTheDocument();
    expect(screen.getByText("Move the midpoint marker as the interval narrows.")).toBeInTheDocument();
    expect(screen.getByText("9 sec")).toBeInTheDocument();
    expect(screen.getAllByText("Unchanged")).toHaveLength(2);
  });

  it("shows async acceptance progress and the accepted result", async () => {
    const user = userEvent.setup();
    const pending = deferred();
    const accept = vi.fn(() => pending.promise);
    render(<SceneEditCandidateReview current={current} candidates={[explanation]} onAccept={accept} onReject={async () => undefined} />);

    await user.click(screen.getByRole("button", { name: "Accept change" }));
    expect(accept).toHaveBeenCalledWith(explanation);
    expect(screen.getByRole("button", { name: "Accepting…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reject change" })).toBeDisabled();
    pending.resolve();
    expect(await screen.findByText("This change was accepted.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Accept change" })).not.toBeInTheDocument();
  });

  it("supports rejection and exposes callback errors for retry", async () => {
    const user = userEvent.setup();
    const reject = vi.fn()
      .mockRejectedValueOnce(new Error("The scene changed while this candidate was open."))
      .mockResolvedValueOnce(undefined);
    render(<SceneEditCandidateReview current={current} candidates={[explanation]} onAccept={async () => undefined} onReject={reject} />);

    await user.click(screen.getByRole("button", { name: "Reject change" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The scene changed while this candidate was open.");
    await user.click(screen.getByRole("button", { name: "Try rejecting again" }));
    await waitFor(() => expect(screen.getByText("This change was rejected.")).toBeInTheDocument());
    expect(reject).toHaveBeenCalledTimes(2);
  });

  it("renders persisted terminal and failed states without decision buttons", () => {
    const { rerender } = render(<SceneEditCandidateReview current={current} candidates={[{ ...explanation, status: "accepted" }]} onAccept={async () => undefined} onReject={async () => undefined} />);
    expect(screen.getByText("This change was accepted.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Accept change" })).not.toBeInTheDocument();

    rerender(<SceneEditCandidateReview current={current} candidates={[{ ...explanation, status: "failed", error: "The writing model returned incomplete text." }]} onAccept={async () => undefined} onReject={async () => undefined} />);
    expect(screen.getByRole("alert")).toHaveTextContent("The writing model returned incomplete text.");
    expect(screen.getByText("This candidate is unavailable.")).toBeInTheDocument();
  });
});
