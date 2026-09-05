import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RenderedFrameReviewPanel } from "../RenderedFrameReviewPanel";

const hash = "a".repeat(64);
const reviewed = { generationId: "g1", renderArtifactHash: hash, reportArtifactHash: "b".repeat(64), status: "reviewed", sampledFrames: [{ timestampSeconds: 1, sceneId: "intro" }, { timestampSeconds: 18, sceneId: "trace" }], findings: [{ sceneId: "trace", timestampSeconds: 18, severity: "MAJOR", rationale: "The caption covers the highlighted comparison." }] };

describe("rendered frame review evidence", () => {
  it("shows actual observations and sparse-coverage limits for the matching video", () => {
    render(<RenderedFrameReviewPanel value={reviewed} generationId="g1" mediaHash={hash} />);
    expect(screen.getByText(/2 sampled frames were reviewed/)).toBeInTheDocument();
    expect(screen.getByText("The caption covers the highlighted comparison.")).toBeInTheDocument();
    expect(screen.getByText("0:18 · trace")).toBeInTheDocument();
  });
  it("never applies an earlier output's review to the current export", () => {
    render(<RenderedFrameReviewPanel value={reviewed} generationId="g1" mediaHash={"c".repeat(64)} />);
    expect(screen.getByText(/belongs to an earlier output/)).toBeInTheDocument();
    expect(screen.queryByText(/2 sampled frames/)).not.toBeInTheDocument();
  });
  it("treats absent review and malformed findings as unavailable, never a clean result", () => {
    const { rerender } = render(<RenderedFrameReviewPanel value={{ ...reviewed, status: "not_reviewed", reason: "no_explicit_vlm_route" }} generationId="g1" mediaHash={hash} />);
    expect(screen.getByText(/No image-review provider was selected/)).toBeInTheDocument();
    rerender(<RenderedFrameReviewPanel value={{ ...reviewed, findings: [null] }} generationId="g1" mediaHash={hash} />);
    expect(screen.getByText(/not available for this render/)).toBeInTheDocument();
    expect(screen.queryByText(/No problems flagged/)).not.toBeInTheDocument();
  });
});
