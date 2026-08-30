import type { RenderManifest, RenderTarget } from "./contracts.js";
import { FRAME_RATES, secondsToTicks } from "./timebase.js";

export function fixtureTarget(overrides: Partial<RenderTarget> = {}): RenderTarget {
  return {
    name: "landscape",
    width: 1280,
    height: 720,
    pixelRatio: 1,
    frameRate: FRAME_RATES.thirty,
    colorSpace: "srgb-rec709",
    ...overrides,
  };
}

export function fixtureManifest(target = fixtureTarget()): RenderManifest {
  return {
    id: "fixture-karatsuba",
    schemaVersion: 1,
    rendererVersion: "2.0.0-rc.0",
    target,
    outputDirectory: "./render-output",
    captionDeliveryMode: "sidecar",
    metadata: { fixture: "true", locale: "en" },
    scenes: [
      {
        id: "scene-title",
        kind: "title",
        durationTicks: secondsToTicks(5),
        seed: "karatsuba-title-v1",
        accessibilityDescription: "Opening title for a lesson about Karatsuba multiplication",
        content: {
          eyebrow: "Algorithms / Divide and conquer",
          title: "Three multiplications beat four",
          body: "Karatsuba's insight turns one expensive operation into a smaller recursive pattern.",
          accent: "#5658e8",
          items: ["Split", "Recombine", "Reduce complexity"],
        },
        captions: [
          { id: "caption-1", startTick: secondsToTicks(0.5), endTick: secondsToTicks(4.6), text: "What if one multiplication could simply disappear?", position: "bottom" },
        ],
      },
    ],
  };
}
