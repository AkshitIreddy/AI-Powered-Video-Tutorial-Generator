import { Component, useMemo, type ErrorInfo, type ReactNode } from "react";
import {
  SceneView,
  compileScene,
  specimenFor,
  type BuiltinSceneKind,
  type SceneSpec,
  type SceneTheme,
} from "@alystria/scenes";
import { compileTheme, type ResolvedTheme, type ThemePackId } from "@alystria/themes";
import type { ProjectRecord, Scene } from "./types";

interface SharedScenePreviewProps {
  scene: Scene;
  project: ProjectRecord;
  fallback: ReactNode;
}

export function SharedScenePreview({ scene, project, fallback }: SharedScenePreviewProps) {
  const preview = useMemo(() => {
    const specimen = specimenFor(scene.kind as BuiltinSceneKind);
    const spec: SceneSpec = {
      ...specimen,
      id: safeSceneId(scene.id),
      durationTicks: Math.max(1, scene.duration) * 240_000,
      seed: stableSeed(`${project.id}:${scene.id}`),
      objectiveIds: [scene.objective],
      accessibilityDescription: `${scene.title}. ${scene.objective}`,
      content: { ...specimen.content, title: scene.title },
    } as SceneSpec;
    const compiled = compileScene(spec, {
      width: 1920,
      height: 1080,
      fps: 30,
      pixelRatio: 1,
      safeAreaPercent: 0.05,
      reducedMotion: true,
      locale: localeCode(project.locale),
    });
    const resolvedTheme = compileTheme(themeId(project.theme), {
      locale: localeCode(project.locale),
      contrastPolicy: "reject",
    });
    return { compiled, theme: sceneTheme(resolvedTheme) };
  }, [project.id, project.locale, project.theme, scene]);

  return (
    <PreviewBoundary fallback={fallback}>
      <div className="shared-scene-preview" data-testid="shared-scene-preview">
        <SceneView
          scene={preview.compiled}
          frame={{ tick: preview.compiled.spec.durationTicks, reducedMotion: true }}
          theme={preview.theme}
        />
      </div>
    </PreviewBoundary>
  );
}

class PreviewBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  public override state = { failed: false };

  public static getDerivedStateFromError() {
    return { failed: true };
  }

  public override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Shared scene preview fell back to the local preview.", error, info.componentStack);
  }

  public override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function safeSceneId(value: string): string {
  const normalized = value.replace(/[^a-zA-Z0-9._:-]/gu, "-");
  return /^[a-zA-Z]/u.test(normalized) ? normalized : `scene-${normalized}`;
}

function stableSeed(value: string): number {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function localeCode(locale: ProjectRecord["locale"]): "en" | "es" | "hi" {
  if (locale === "Spanish") return "es";
  if (locale === "Hindi") return "hi";
  return "en";
}

function themeId(theme: string): ThemePackId {
  const normalized = theme.toLowerCase();
  if (normalized.includes("graphite")) return "dark";
  if (normalized.includes("atlas")) return "documentary";
  return "light";
}

function sceneTheme(theme: ResolvedTheme): SceneTheme {
  return {
    id: theme.id,
    name: theme.name,
    paper: theme.palette.canvas,
    ink: theme.palette.ink,
    mutedInk: theme.palette.inkMuted,
    primary: theme.palette.accent,
    secondary: theme.palette.evidence,
    accent: theme.palette.accentSecondary,
    warning: theme.palette.review,
    critical: theme.palette.critical,
    surface: theme.palette.surface,
    surfaceRaised: theme.palette.surfaceRaised,
    line: theme.palette.line,
    codeBackground: theme.palette.codeBackground,
    codeInk: theme.palette.codeInk,
    fontDisplay: fontStack(theme.typography.display.families),
    fontBody: fontStack(theme.typography.body.families),
    fontMono: fontStack(theme.typography.code.families),
    radius: theme.spacing.radiusMedium,
  };
}

function fontStack(families: readonly string[]): string {
  return families.map((family) => family.includes(" ") ? `"${family}"` : family).join(", ");
}
