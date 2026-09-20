import { Component, useEffect, useMemo, useState, type ErrorInfo, type ReactNode } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { bundledAssets } from "./bundledAssets";
import { projectAssetResolve } from "./native";
import academicPaper from "./assets/backgrounds/academic-evidence-paper-v1.png";
import modernSignal from "./assets/backgrounds/modern-tech-signal-v1.png";
import playfulPaper from "./assets/backgrounds/playful-paper-cut-v1.png";
import {
  SceneView,
  compileScene,
  sceneSpecFromStoryboard,
  type SceneTheme,
} from "@alystria/scenes";
import { compileTheme, type ResolvedTheme, type ThemePackId } from "@alystria/themes";
import type { ProjectRecord, Scene } from "./types";
import { customizedSceneTheme } from "./sceneThemeCustomization";

interface SharedScenePreviewProps {
  scene: Scene;
  project: ProjectRecord;
  fallback: ReactNode;
  tick?: number;
}

export function SharedScenePreview({ scene, project, fallback, tick }: SharedScenePreviewProps) {
  return <PreviewBoundary key={`${project.id}:${scene.id}`} resetKey={scene} fallback={fallback}><CompiledScenePreview scene={scene} project={project} fallback={fallback} {...(tick === undefined ? {} : { tick })} /></PreviewBoundary>;
}

function CompiledScenePreview({ scene, project, tick }: SharedScenePreviewProps) {
  const selectedBackground = project.customization?.backgroundMode === "image" ? project.customization.assets.find((asset) => asset.id === project.customization?.backgroundAssetId) : undefined;
  const imageId = scene.visualAssetId ?? selectedBackground?.id;
  const imageHash = scene.visualArtifactHash ?? selectedBackground?.sha256;
  const [image, setImage] = useState<{ hash: string; url: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    let blobUrl: string | undefined;
    const controller = new AbortController();
    if (imageId && imageHash && /^[a-f0-9]{64}$/u.test(imageHash)) void (async () => {
      const starter: Record<string, string> = { "background.academic-evidence-paper-v1": academicPaper, "background.modern-tech-signal-v1": modernSignal, "background.playful-paper-cut-v1": playfulPaper };
      let source = bundledAssets.find((asset) => asset.sha256 === imageHash)?.url ?? starter[imageId];
      if (!source && project.nativeProjectId && project.nativeProjectDirectory) source = convertFileSrc((await projectAssetResolve({ projectId: project.nativeProjectId, projectDirectory: project.nativeProjectDirectory, artifactHash: imageHash })).path);
      if (!source || cancelled) return;
      const response = await fetch(source, { signal: controller.signal });
      if (!response.ok) throw new Error("Preview artwork could not be read.");
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > 24 * 1024 * 1024) throw new Error("Preview artwork is too large.");
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)), (byte) => byte.toString(16).padStart(2, "0")).join("");
      if (digest !== imageHash) throw new Error("Preview artwork failed its saved content hash.");
      if (cancelled) return;
      blobUrl = URL.createObjectURL(new Blob([buffer], { type: response.headers.get("content-type") ?? "image/png" }));
      setImage({ hash: imageHash, url: blobUrl });
    })().catch(() => { if (!cancelled) setImage(null); });
    return () => { cancelled = true; controller.abort(); if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [imageId, imageHash, project.nativeProjectId, project.nativeProjectDirectory]);
  const preview = useMemo(() => {
    const spec = sceneSpecFromStoryboard({
      ...scene.authored,
      id: safeSceneId(scene.id),
      kind: scene.kind,
      type: scene.kind,
      title: scene.title,
      narration: scene.narration,
      durationTicks: Math.max(1, Math.round(scene.duration * 240_000)),
      seed: stableSeed(`${project.id}:${scene.id}`),
      objectiveIds: [scene.objective],
      accessibilityDescription: `${scene.title}. ${scene.objective}`,
      onScreenText: scene.authored?.onScreenText ?? [scene.objective],
      ...(imageId && imageHash ? { visualAssets: [...(scene.authored?.visualAssets ?? []).filter((asset) => asset.role !== "background"), { assetId: imageId, sha256: imageHash, role: "background" as const, alt: selectedBackground?.label ?? `Artwork for ${scene.title}`, fit: "cover" as const, treatment: scene.visualAssetId ? "aperture" as const : "full-frame" as const }] } : {}),
    }, { seedScope: project.id });
    if (!spec) return null;
    const compiled = compileScene(spec, {
      width: 1920,
      height: 1080,
      fps: 30,
      pixelRatio: 1,
      safeAreaPercent: 0.05,
      reducedMotion: project.customization?.reducedMotion ?? false,
      locale: localeCode(project.locale),
    });
    const resolvedTheme = compileTheme(themeId(project.theme), {
      locale: localeCode(project.locale),
      contrastPolicy: "reject",
    });
    return { compiled, theme: customizedSceneTheme(sceneTheme(resolvedTheme), project.customization) };
  }, [project.id, project.locale, project.theme, project.customization, scene, imageId, imageHash, selectedBackground?.label]);

  if (!preview) return <div className="shared-scene-preview preview-not-authored"><strong>{scene.title}</strong><p>{scene.objective}</p><small>This scene type needs an authored visual before animation preview.</small></div>;
  return (
      <div className="shared-scene-preview" data-testid="shared-scene-preview">
        <SceneView
          scene={preview.compiled}
          frame={{ tick: tick ?? preview.compiled.spec.durationTicks, reducedMotion: tick === undefined || project.customization?.reducedMotion === true }}
          theme={preview.theme}
          resolveAsset={(asset) => image && image.hash === asset.sha256 ? image.url : undefined}
        />
      </div>
  );
}

class PreviewBoundary extends Component<{ fallback: ReactNode; children: ReactNode; resetKey?: Scene }, { failed: boolean }> {
  public override state = { failed: false };

  public static getDerivedStateFromError() {
    return { failed: true };
  }

  public override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Shared scene preview fell back to the local preview.", error, info.componentStack);
  }

  public override componentDidUpdate(previous: Readonly<{ resetKey?: Scene }>) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false });
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
