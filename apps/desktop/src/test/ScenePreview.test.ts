import { describe, expect, it } from "vitest";
import { customizedSceneTheme } from "../sceneThemeCustomization";
import type { SceneTheme } from "@alystria/scenes";
import type { CanvasCustomization } from "../types";

const base: SceneTheme = {
  id: "base",
  name: "Base",
  paper: "#F7F8FC",
  ink: "#151827",
  mutedInk: "#596077",
  primary: "#5658E8",
  secondary: "#168F88",
  accent: "#F0D35E",
  warning: "#DF922E",
  critical: "#C94B67",
  surface: "#FFFFFF",
  surfaceRaised: "#EEF0F8",
  line: "#D7DBE9",
  codeBackground: "#171A29",
  codeInk: "#F4F5FA",
  fontDisplay: '"Bricolage Grotesque", "Segoe UI", sans-serif',
  fontBody: '"Atkinson Hyperlegible Next", "Segoe UI", sans-serif',
  fontMono: '"JetBrains Mono", "Cascadia Code", monospace',
  radius: 22,
};

describe("scene preview theme customization", () => {
  it("keeps the compiled theme for an assets-only native promotion record", () => {
    const assetsOnly = {
      assets: [{
        id: "asset-generated",
        kind: "background",
        label: "Accepted background",
        source: "generated",
        creator: "local model",
        license: "Open RAIL",
        attribution: "Generated locally",
        rightsStatus: "cleared",
      }],
    } as unknown as CanvasCustomization;

    expect(() => customizedSceneTheme(base, assetsOnly)).not.toThrow();
    expect(customizedSceneTheme(base, assetsOnly)).toEqual(base);
    expect(assetsOnly.assets).toHaveLength(1);
  });

  it("respects complete user palette, typography, and radius choices", () => {
    const customized = customizedSceneTheme(base, {
      colors: { paper: "#101820", ink: "#F2F4F8", accent: "#FFAA33", evidence: "#22BB99" },
      displayFont: "Fraunces",
      bodyFont: "Inter",
      cornerRadius: 12,
    } as CanvasCustomization);

    expect(customized).toMatchObject({
      paper: "#101820",
      ink: "#F2F4F8",
      primary: "#FFAA33",
      secondary: "#22BB99",
      radius: 12,
    });
    expect(customized.fontDisplay).toContain("Fraunces");
    expect(customized.fontBody).toContain("Inter");
  });

  it("applies typography and radius without changing an omitted palette", () => {
    const customized = customizedSceneTheme(base, {
      displayFont: "Fraunces",
      bodyFont: "Inter",
      cornerRadius: 9,
    } as CanvasCustomization);

    expect(customized).toMatchObject({
      paper: base.paper,
      ink: base.ink,
      primary: base.primary,
      secondary: base.secondary,
      mutedInk: base.mutedInk,
      surface: base.surface,
      surfaceRaised: base.surfaceRaised,
      line: base.line,
      codeBackground: base.codeBackground,
      codeInk: base.codeInk,
      radius: 9,
    });
    expect(customized.fontDisplay).toContain("Fraunces");
    expect(customized.fontBody).toContain("Inter");
  });

  it("applies a partial palette without changing omitted typography or radius", () => {
    const customized = customizedSceneTheme(base, {
      colors: { accent: "#AA3377" },
    } as unknown as CanvasCustomization);

    expect(customized.primary).toBe("#AA3377");
    expect(customized.paper).toBe(base.paper);
    expect(customized.ink).toBe(base.ink);
    expect(customized.secondary).toBe(base.secondary);
    expect(customized.surfaceRaised).not.toBe(base.surfaceRaised);
    expect(customized.fontDisplay).toBe(base.fontDisplay);
    expect(customized.fontBody).toBe(base.fontBody);
    expect(customized.radius).toBe(base.radius);
  });
});
