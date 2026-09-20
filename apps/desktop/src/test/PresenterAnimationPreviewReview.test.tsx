import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PresenterAnimationPreviewReview } from "../PresenterAnimationPreviewReview";

const preview = {
  schemaVersion: 1 as const,
  id: "presenter-preview-proof",
  status: "ready" as const,
  baseRevisionId: "revision-1",
  profileId: "profile-nova",
  portraitArtifactId: "asset-nova",
  portraitArtifactHash: "a".repeat(64),
  narrationArtifactHash: "b".repeat(64),
  outputArtifactHash: "c".repeat(64),
  mediaType: "video/mp4" as const,
  byteSize: 1_024,
  durationMs: 5_080,
  engineId: "soulx-flashhead-pro" as const,
  modelRevision: "soulx-code-a+weights-b",
  workerContractId: "alystria.soulx-flashhead.worker.v1" as const,
  seed: 42,
  createdAt: "2026-09-21T00:00:00Z",
};

describe("PresenterAnimationPreviewReview", () => {
  it("shows the playable exact preview with simple accept and retry actions", async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn().mockResolvedValue(undefined);
    const onTryAgain = vi.fn().mockResolvedValue(undefined);
    render(<PresenterAnimationPreviewReview presenterName="Nova" preview={preview} videoUrl="asset://preview.mp4" busy={false} onAccept={onAccept} onTryAgain={onTryAgain} />);
    expect(screen.getByLabelText("Play Nova animation preview")).toHaveAttribute("src", "asset://preview.mp4");
    expect(screen.getByText(/check the mouth, eyes and motion/i)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /use animation/i }));
    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onTryAgain).toHaveBeenCalledTimes(1);
  });
});
