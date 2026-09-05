import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { VisualCandidateReview } from "../VisualCandidateReview";
import { visualCandidates, type VisualCandidate } from "../visualCandidates";

const candidate: VisualCandidate = { id: "candidate-one", sceneId: "scene-one", status: "ready", artifactHash: "a".repeat(64), mediaType: "image/png", prompt: "An original closed-mouth teacher portrait", model: "sdxl-base", provider: "local-runtime", seed: 72, role: "presenter", createdAt: "2026-09-05T12:00:00Z", rights: { exportEligible: true } };

const licensedCandidate: VisualCandidate = {
  id: "stock-one",
  sceneId: "scene-one",
  status: "ready",
  artifactHash: "b".repeat(64),
  mediaType: "image/jpeg",
  prompt: "A calm visual explanation of a binary-search interval",
  model: "pexels-search-v1",
  provider: "pexels",
  seed: 0,
  role: "scene",
  createdAt: "2026-09-05T12:02:00Z",
  origin: "licensedMedia",
  rights: {
    status: "verified",
    license: "Pexels",
    source: "https://www.pexels.com/photo/1234/",
    attribution: "A. Photographer",
    creator: "A. Photographer",
    commercialUse: "allowed",
    redistribution: "composedWorkOnly",
    modelInput: "reviewOnly",
    exportEligible: true,
  },
  licensedSource: {
    providerId: "pexels",
    sourceAssetId: "c".repeat(64),
    sourceUrl: "https://www.pexels.com/photo/1234/",
    creator: "A. Photographer",
    licenseId: "Pexels",
  },
  visualReview: {
    judgeProviderId: "google-gemini",
    judgeModel: "gemini-2.5-flash",
    lessonFit: 89,
    composition: 84,
    technicalQuality: 91,
    overall: 88,
    risks: ["faces"],
    rationale: "The subject leaves clear room for editable teaching graphics.",
    recommended: true,
    reviewRequired: true,
  },
};

describe("generated image review", () => {
  it("does not expose old queued placeholders or unverified active content as images", () => {
    expect(visualCandidates([{ ...candidate, mediaType: "image/svg+xml" }, { ...candidate, status: "queued_for_configured_generator" }, { ...candidate, artifactHash: "../secret" }])).toEqual([]);
    expect(visualCandidates([candidate])).toEqual([candidate]);
  });

  it("requires a loaded portrait and explicit author review before acceptance", async () => {
    const accept = vi.fn(async () => undefined);
    render(<VisualCandidateReview candidates={[candidate]} resolve={async () => "asset://portrait.png"} onAccept={accept} />);
    fireEvent.load(await screen.findByRole("img", { name: candidate.prompt }));
    const button = screen.getByRole("button", { name: "Use this presenter portrait" });
    expect(button).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(button);
    await waitFor(() => expect(accept).toHaveBeenCalledWith(candidate));
  });

  it("never accepts an image whose durable bytes cannot be resolved", async () => {
    const accept = vi.fn(async () => undefined);
    render(<VisualCandidateReview candidates={[{ ...candidate, role: "scene" }]} resolve={async () => { throw new Error("Media hash no longer matches"); }} onAccept={accept} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Media hash no longer matches");
    expect(screen.getByRole("button", { name: "Use this scene artwork" })).toBeDisabled();
    expect(accept).not.toHaveBeenCalled();
  });

  it("reviews licensed media from local CAS while showing its source and judge record", async () => {
    const accept = vi.fn(async () => undefined);
    const resolve = vi.fn(async () => "asset://local-cas/stock-one.jpg");
    const parsed = visualCandidates([licensedCandidate]);
    expect(parsed).toEqual([licensedCandidate]);
    render(<VisualCandidateReview candidates={parsed} resolve={resolve} onAccept={accept} />);

    expect(screen.getByRole("region", { name: "Image candidates" })).toHaveTextContent("Review image candidates");
    expect(screen.getByText("A. Photographer")).toBeInTheDocument();
    expect(screen.getByText("Pexels")).toBeInTheDocument();
    expect(screen.getByText("faces")).toBeInTheDocument();
    expect(screen.getByText("The subject leaves clear room for editable teaching graphics.")).toBeInTheDocument();
    const source = screen.getByRole("link", { name: /View original landing page/ });
    expect(source).toHaveAttribute("href", licensedCandidate.licensedSource!.sourceUrl);
    expect(source).toHaveAttribute("rel", "noopener noreferrer");
    expect(resolve).toHaveBeenCalledWith(licensedCandidate.artifactHash);

    const image = await screen.findByRole("img", { name: `Licensed image candidate for ${licensedCandidate.prompt}` });
    expect(image).toHaveAttribute("src", "asset://local-cas/stock-one.jpg");
    expect(image).not.toHaveAttribute("src", licensedCandidate.licensedSource!.sourceUrl);
    const button = screen.getByRole("button", { name: "Use this licensed image" });
    expect(button).toBeDisabled();
    fireEvent.load(image);
    await userEvent.click(button);
    await waitFor(() => expect(accept).toHaveBeenCalledWith(licensedCandidate));
  });

  it("uses a general heading for a mixed generated and licensed review set", () => {
    render(<VisualCandidateReview candidates={[candidate, licensedCandidate]} resolve={async () => "asset://local-cas/image.png"} onAccept={async () => undefined} />);
    expect(screen.getByText("Review image candidates")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generated image 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Licensed image 2" })).toBeInTheDocument();
  });

  it("rejects tampered licensed records and unsafe source-link schemes", () => {
    const unsafe = structuredClone(licensedCandidate);
    unsafe.licensedSource!.sourceUrl = "javascript:alert(1)";
    unsafe.rights!.source = "javascript:alert(1)";
    const mismatched = structuredClone(licensedCandidate);
    mismatched.rights!.creator = "Different creator";
    const missingReview = structuredClone(licensedCandidate);
    delete missingReview.visualReview;
    expect(visualCandidates([unsafe, mismatched, missingReview])).toEqual([]);
  });

  it("shows a rejected stock candidate as review evidence without an acceptance action", async () => {
    const rejected = { ...licensedCandidate, status: "rejected" as const, rejectionReason: "Blocked by the licensed-media visual review" };
    render(<VisualCandidateReview candidates={[rejected]} resolve={async () => "asset://local-cas/rejected.jpg"} onAccept={async () => undefined} />);
    expect(await screen.findByRole("img")).toBeInTheDocument();
    expect(screen.getByText("Blocked by the licensed-media visual review")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use this licensed image" })).not.toBeInTheDocument();
  });
});
