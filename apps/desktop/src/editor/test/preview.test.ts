import { describe, expect, it } from "vitest";
import { previewCanvasScale, previewMediaShouldSeek, previewStyleAtFrame, textPreviewStyleAtFrame } from "../preview";
import { makeSampleProject } from "./fixtures";

function titleClip() {
  return makeSampleProject().tracks.find((track) => track.kind === "titles")!.clips[0]!;
}

describe("editor preview parity", () => {
  it("scales authored pixel offsets to each preview size", () => {
    const clip = titleClip();
    clip.transform = { ...clip.transform, x: 120, y: -60 };
    const half = previewCanvasScale({ width: 1920, height: 1080 }, { width: 960, height: 540 });
    const quarter = previewCanvasScale({ width: 1920, height: 1080 }, { width: 480, height: 270 });

    expect(half).toEqual({ x: 0.5, y: 0.5 });
    expect(previewStyleAtFrame(clip, 0, half).transform).toContain("translate(60px, -30px)");
    expect(previewStyleAtFrame(clip, 0, quarter).transform).toContain("translate(30px, -15px)");
  });

  it("lets playing media run continuously until drift exceeds the sync tolerance", () => {
    expect(previewMediaShouldSeek(2, 8, { playing: true, enteringPlayback: false, clipChanged: false, seeking: true, secondsSinceLastSeek: 3 })).toBe(false);
    expect(previewMediaShouldSeek(2, 8, { playing: true, enteringPlayback: false, clipChanged: true, seeking: true })).toBe(true);
    expect(previewMediaShouldSeek(2.06, 2.12, { playing: true, enteringPlayback: false, clipChanged: false, secondsSinceLastSeek: 1 })).toBe(false);
    expect(previewMediaShouldSeek(1.9, 2.12, { playing: true, enteringPlayback: false, clipChanged: false, secondsSinceLastSeek: 1 })).toBe(true);
    expect(previewMediaShouldSeek(1.9, 2.12, { playing: true, enteringPlayback: false, clipChanged: false, secondsSinceLastSeek: 0.3 })).toBe(false);
    expect(previewMediaShouldSeek(2.12, 2.12, { playing: true, enteringPlayback: true, clipChanged: false })).toBe(true);
    expect(previewMediaShouldSeek(2.12, 2.12, { playing: true, enteringPlayback: false, clipChanged: true })).toBe(true);
    expect(previewMediaShouldSeek(2.12, 2.12, { playing: false, enteringPlayback: false, clipChanged: false })).toBe(true);
  });

  it("matches top, center, and bottom export anchors without automatic wrapping", () => {
    const clip = titleClip();
    clip.transform = { ...clip.transform, x: 40, y: 20 };
    clip.textStyle = {
      fontFamily: "A saved custom family",
      fontSize: 64,
      fontWeight: 800,
      color: "#FF3355",
      backgroundColor: "#112233",
      align: "left",
      position: "top",
    };

    const topLeft = textPreviewStyleAtFrame(clip, 0, { x: 0.5, y: 0.5 });
    expect(topLeft).toMatchObject({
      left: "5%",
      top: "5%",
      color: "#FF3355",
      fontFamily: "Arial, 'DejaVu Sans', sans-serif",
      fontSize: "32px",
      fontWeight: 400,
      whiteSpace: "pre",
      width: "max-content",
      maxWidth: "none",
      padding: 0,
      transform: "translate(calc(0% + 20px), calc(0% + 10px))",
    });
    expect(topLeft.boxShadow).toBe("0 0 0 6px color-mix(in srgb, #112233 75%, transparent)");

    clip.textStyle = { ...clip.textStyle, align: "center", position: "center", backgroundColor: null };
    expect(textPreviewStyleAtFrame(clip, 0, { x: 0.25, y: 0.25 })).toMatchObject({
      left: "50%",
      top: "50%",
      fontSize: "16px",
      backgroundColor: "transparent",
      boxShadow: "none",
      transform: "translate(calc(-50% + 10px), calc(-50% + 5px))",
    });

    clip.textStyle = { ...clip.textStyle, align: "right", position: "bottom" };
    expect(textPreviewStyleAtFrame(clip, 0, { x: 0.25, y: 0.25 })).toMatchObject({
      left: "95%",
      top: "95%",
      transform: "translate(calc(-100% + 10px), calc(-100% + 5px))",
    });
  });
});
