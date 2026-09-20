import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MusicBrowser } from "./MusicBrowser";
import { parseMusicCandidates, type MusicCandidate } from "./types";

const candidate: MusicCandidate = {
  id: "music_123",
  status: "ready",
  artifactHash: "a".repeat(64),
  mediaType: "audio/wav",
  title: "Curious motion",
  creator: "Ada Artist",
  durationSeconds: 62,
  provider: "openverse",
  sourceUrl: "https://source.test/track",
  license: "CC-BY-4.0",
  licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  attribution: '"Curious motion" by Ada Artist · CC BY 4.0',
  mood: "curious",
  matchScore: 54,
};

describe("MusicBrowser", () => {
  it("submits the tutorial topic and selected mood, then exposes review actions", () => {
    const onSearch = vi.fn();
    const onAccept = vi.fn();
    const onReject = vi.fn();
    render(<MusicBrowser topic="How stars form" candidates={[candidate]} onSearch={onSearch} onAccept={onAccept} onReject={onReject} />);

    fireEvent.click(screen.getByRole("button", { name: "Focused" }));
    fireEvent.click(screen.getByRole("button", { name: "Find free music" }));
    expect(onSearch).toHaveBeenCalledWith({ topic: "How stars form", mood: "focused", alternatives: 3 });
    expect(screen.getByText("Ada Artist · 1:02 · CC-BY-4.0")).toBeInTheDocument();

    expect(screen.getByText("Rights & source")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview Curious motion" })).toHaveAttribute("data-tooltip", "Preview track");
    fireEvent.click(screen.getByRole("button", { name: "Use Curious motion" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip Curious motion" }));
    expect(onAccept).toHaveBeenCalledWith(candidate);
    expect(onReject).toHaveBeenCalledWith(candidate);
  });

  it("parses only bounded durable candidate records", () => {
    expect(parseMusicCandidates([candidate, { ...candidate, id: "bad", sourceUrl: "http://unsafe.test" }])).toEqual([candidate]);
    expect(parseMusicCandidates(null)).toEqual([]);
  });
});
