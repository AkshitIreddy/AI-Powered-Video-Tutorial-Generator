import type { StructuralGeometryFinding } from "../src/geometry.js";

export type CompositionFamily =
  | "cinematic-scale"
  | "editorial-type"
  | "object-stage"
  | "diagram"
  | "split-evidence"
  | "document-focus"
  | "data-canvas"
  | "worked-example"
  | "presenter"
  | "assessment";

export interface VisualFrameObservation {
  readonly sceneId: string;
  readonly sampleId: string;
  readonly sampleLabel: string;
  readonly localFrame: number;
  readonly globalFrame: number;
  readonly kind: string;
  readonly family: CompositionFamily;
  readonly visibleWordCount: number;
  readonly textOutsideFrameCount: number;
  readonly textInsideUnsafeMarginCount: number;
  readonly overflowingContainerCount: number;
  readonly cardCount: number;
  readonly pillLikeShapeCount: number;
  readonly captionOverlayCount: number;
  readonly tinyTextCount: number;
  readonly lowContrastTextCount: number;
  readonly unmeasurableContrastTextCount: number;
  readonly minimumTextContrastRatio: number | null;
  readonly lumaStandardDeviation: number;
  readonly colorBucketCount: number;
  readonly edgeEnergy: number;
  readonly geometryElementCount: number;
  readonly geometryTextIntersectionCount: number;
  readonly geometryOutsideFrameCount: number;
  readonly geometryOutsideSafeAreaCount: number;
  readonly geometryContainerOverflowCount: number;
  readonly geometryLineLimitCount: number;
  readonly geometryFindings: readonly StructuralGeometryFinding[];
}

export interface TextContrastMeasurement {
  readonly index: number;
  readonly text: string;
  readonly status: "pass" | "fail" | "unmeasurable";
  readonly contrastRatio: number | null;
  readonly rawMinimumRatio?: number;
  readonly requiredRatio: 3 | 4.5;
  readonly sampleCount: number;
  readonly foreground: string;
  readonly reason?: string;
}

export interface RenderedTextContrastInspection {
  readonly normalPng: Buffer;
  readonly measurements: readonly TextContrastMeasurement[];
  readonly lowContrastTextCount: number;
  readonly unmeasurableContrastTextCount: number;
  readonly minimumTextContrastRatio: number | null;
}

interface BrowserTextSample {
  readonly index: number;
  readonly text: string;
  readonly kind: "svg" | "html";
  readonly rect: Readonly<{ x: number; y: number; width: number; height: number }>;
  readonly fontSize: number;
  readonly fontWeight: number;
  readonly foreground: string;
  readonly foregroundRgb: readonly [number, number, number, number] | null;
  readonly effectiveOpacity: number;
}

interface ContrastInspectionPage {
  evaluate<R, A>(pageFunction: (argument: A) => R | Promise<R>, argument: A): Promise<R>;
  screenshot(options: Readonly<{ type: "png"; animations: "disabled"; caret: "hide" }>): Promise<Buffer>;
}

/**
 * Measures text against the pixels Chromium actually composited behind it.
 *
 * Four captures differ only in text paint: normal, transparent backdrop,
 * black probe, and white probe. Geometry, backgrounds, gradients, images, and
 * sibling SVG shapes remain untouched. The black/white difference forms a
 * backdrop-independent glyph mask, while the transparent capture supplies the
 * exact background colour at each glyph location. Solid computed text colours are
 * then composited with inherited opacity and checked against WCAG AA's 4.5:1
 * normal-text or 3:1 large-text threshold. Unsupported paints (for example an
 * SVG gradient fill) remain explicitly unmeasurable so strict audits still
 * require a human review.
 */
export async function inspectRenderedTextContrast(page: ContrastInspectionPage): Promise<RenderedTextContrastInspection> {
  const samples = await page.evaluate((): BrowserTextSample[] => {
    const visible = (element: Element): boolean => {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      let opacity = 1;
      let current: Element | null = element;
      while (current) {
        const style = getComputedStyle(current);
        if (style.display === "none" || style.visibility === "hidden") return false;
        opacity *= Math.min(1, Math.max(0, Number.parseFloat(style.opacity || "1")));
        current = current.parentElement;
      }
      return opacity > 0.01;
    };
    const parseRgb = (value: string): [number, number, number, number] | null => {
      if (!/^rgba?\(/iu.test(value.trim())) return null;
      const tokens = value.match(/-?\d+(?:\.\d+)?%?/gu);
      if (!tokens || tokens.length < 3) return null;
      const channel = (token: string): number => token.endsWith("%")
        ? Math.min(255, Math.max(0, Number.parseFloat(token) * 2.55))
        : Math.min(255, Math.max(0, Number.parseFloat(token)));
      const alphaToken = tokens[3];
      const alpha = alphaToken === undefined
        ? 1
        : alphaToken.endsWith("%")
          ? Math.min(1, Math.max(0, Number.parseFloat(alphaToken) / 100))
          : Math.min(1, Math.max(0, Number.parseFloat(alphaToken)));
      return [channel(tokens[0]!), channel(tokens[1]!), channel(tokens[2]!), alpha];
    };
    const candidates = Array.from(document.querySelectorAll("svg text, svg tspan, svg foreignObject div, svg foreignObject span, svg foreignObject p, svg foreignObject code"))
      .filter((element) => {
        if (!visible(element)) return false;
        if (element.tagName.toLowerCase() === "text" && element.querySelector("tspan")) return false;
        const directText = Array.from(element.childNodes).some((node) => node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim()));
        return directText || element.children.length === 0;
      });

    return candidates.map((element, index) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const kind = element instanceof SVGTextContentElement ? "svg" : "html";
      const foreground = kind === "svg" ? style.fill : style.color;
      let effectiveOpacity = 1;
      let current: Element | null = element;
      while (current) {
        effectiveOpacity *= Math.min(1, Math.max(0, Number.parseFloat(getComputedStyle(current).opacity || "1")));
        if (current.tagName.toLowerCase() === "svg") break;
        current = current.parentElement;
      }
      if (kind === "svg") effectiveOpacity *= Math.min(1, Math.max(0, Number.parseFloat(style.fillOpacity || "1")));
      element.setAttribute("data-visual-audit-text-index", String(index));
      element.setAttribute("data-visual-audit-text-kind", kind);
      return {
        index,
        text: (element.textContent ?? "").replace(/\s+/gu, " ").trim().slice(0, 120),
        kind,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        fontSize: Number.parseFloat(style.fontSize || "0"),
        fontWeight: Number.parseFloat(style.fontWeight || "400") || 400,
        foreground,
        foregroundRgb: parseRgb(foreground),
        effectiveOpacity,
      };
    });
  }, undefined);

  const normalPng = await page.screenshot({ type: "png", animations: "disabled", caret: "hide" });
  try {
    await page.evaluate(() => {
      const style = document.createElement("style");
      style.id = "visual-audit-hide-text-paint";
      style.textContent = `
        [data-visual-audit-text-kind="svg"] { fill: transparent !important; stroke: transparent !important; }
        [data-visual-audit-text-kind="html"] { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; }
      `;
      document.head.append(style);
    }, undefined);
    const backdropPng = await page.screenshot({ type: "png", animations: "disabled", caret: "hide" });
    await page.evaluate(() => {
      const style = document.querySelector<HTMLStyleElement>("#visual-audit-hide-text-paint");
      if (!style) throw new Error("Missing visual audit text-paint probe");
      style.textContent = `
        [data-visual-audit-text-kind="svg"] { fill: #000000 !important; stroke: transparent !important; }
        [data-visual-audit-text-kind="html"] { color: #000000 !important; -webkit-text-fill-color: #000000 !important; text-shadow: none !important; }
      `;
    }, undefined);
    const blackProbePng = await page.screenshot({ type: "png", animations: "disabled", caret: "hide" });
    await page.evaluate(() => {
      const style = document.querySelector<HTMLStyleElement>("#visual-audit-hide-text-paint");
      if (!style) throw new Error("Missing visual audit text-paint probe");
      style.textContent = `
        [data-visual-audit-text-kind="svg"] { fill: #ffffff !important; stroke: transparent !important; }
        [data-visual-audit-text-kind="html"] { color: #ffffff !important; -webkit-text-fill-color: #ffffff !important; text-shadow: none !important; }
      `;
    }, undefined);
    const whiteProbePng = await page.screenshot({ type: "png", animations: "disabled", caret: "hide" });
    const measurements = await page.evaluate(async ({ backdropUrl, blackProbeUrl, whiteProbeUrl, nodes }): Promise<TextContrastMeasurement[]> => {
      const loadImage = async (url: string): Promise<HTMLImageElement> => {
        const image = new Image();
        image.src = url;
        await image.decode();
        return image;
      };
      const [backdropImage, blackProbeImage, whiteProbeImage] = await Promise.all([
        loadImage(backdropUrl), loadImage(blackProbeUrl), loadImage(whiteProbeUrl),
      ]);
      const canvas = document.createElement("canvas");
      canvas.width = backdropImage.naturalWidth;
      canvas.height = backdropImage.naturalHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Canvas 2D unavailable for text contrast inspection");
      context.drawImage(backdropImage, 0, 0);
      const backdrop = context.getImageData(0, 0, canvas.width, canvas.height).data;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(blackProbeImage, 0, 0);
      const blackProbe = context.getImageData(0, 0, canvas.width, canvas.height).data;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(whiteProbeImage, 0, 0);
      const whiteProbe = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = document.documentElement.clientHeight;
      const scaleX = canvas.width / Math.max(1, viewportWidth);
      const scaleY = canvas.height / Math.max(1, viewportHeight);
      const linearChannel = (part: number): number => {
        const value = part / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      };
      const luminance = (rgb: readonly number[]): number => linearChannel(rgb[0]!) * 0.2126
        + linearChannel(rgb[1]!) * 0.7152
        + linearChannel(rgb[2]!) * 0.0722;
      const contrast = (left: readonly number[], right: readonly number[]): number => {
        const a = luminance(left);
        const b = luminance(right);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      };

      return nodes.map((node) => {
        const requiredRatio: 3 | 4.5 = node.fontSize >= 24 || (node.fontSize >= 18.66 && node.fontWeight >= 700) ? 3 : 4.5;
        if (!node.foregroundRgb) {
          return { index: node.index, text: node.text, status: "unmeasurable", contrastRatio: null, requiredRatio, sampleCount: 0, foreground: node.foreground, reason: `Unsupported computed text paint: ${node.foreground || "empty"}` };
        }
        const startX = Math.max(0, Math.floor(node.rect.x * scaleX));
        const startY = Math.max(0, Math.floor(node.rect.y * scaleY));
        const endX = Math.min(canvas.width, Math.ceil((node.rect.x + node.rect.width) * scaleX));
        const endY = Math.min(canvas.height, Math.ceil((node.rect.y + node.rect.height) * scaleY));
        const ratios: number[] = [];
        const alpha = Math.min(1, Math.max(0, node.foregroundRgb[3] * node.effectiveOpacity));
        for (let y = startY; y < endY; y += 1) {
          for (let x = startX; x < endX; x += 1) {
            const offset = (y * canvas.width + x) * 4;
            const glyphCoverage = Math.max(
              Math.abs((blackProbe[offset] ?? 0) - (whiteProbe[offset] ?? 0)),
              Math.abs((blackProbe[offset + 1] ?? 0) - (whiteProbe[offset + 1] ?? 0)),
              Math.abs((blackProbe[offset + 2] ?? 0) - (whiteProbe[offset + 2] ?? 0)),
            );
            if (glyphCoverage < 1) continue;
            const background = [backdrop[offset] ?? 0, backdrop[offset + 1] ?? 0, backdrop[offset + 2] ?? 0];
            const compositedForeground = [
              node.foregroundRgb[0] * alpha + background[0]! * (1 - alpha),
              node.foregroundRgb[1] * alpha + background[1]! * (1 - alpha),
              node.foregroundRgb[2] * alpha + background[2]! * (1 - alpha),
            ];
            ratios.push(contrast(compositedForeground, background));
          }
        }
        if (ratios.length === 0) {
          return { index: node.index, text: node.text, status: "unmeasurable", contrastRatio: null, requiredRatio, sampleCount: 0, foreground: node.foreground, reason: "No rendered glyph pixels differed from the composited backdrop." };
        }
        // Evaluate the low tail so text crossing a gradient or multiple
        // surfaces still fails. The exact minimum is retained for evidence,
        // while the 5th percentile ignores a handful of rasterisation and
        // clipping-boundary pixels that are not representative of a glyph.
        ratios.sort((left, right) => left - right);
        const rawMinimumRatio = ratios[0]!;
        const contrastRatio = ratios[Math.min(ratios.length - 1, Math.floor(ratios.length * 0.05))]!;
        return {
          index: node.index,
          text: node.text,
          status: contrastRatio + 0.01 >= requiredRatio ? "pass" : "fail",
          contrastRatio,
          rawMinimumRatio,
          requiredRatio,
          sampleCount: ratios.length,
          foreground: node.foreground,
        };
      });
    }, {
      backdropUrl: `data:image/png;base64,${backdropPng.toString("base64")}`,
      blackProbeUrl: `data:image/png;base64,${blackProbePng.toString("base64")}`,
      whiteProbeUrl: `data:image/png;base64,${whiteProbePng.toString("base64")}`,
      nodes: samples,
    });
    const measuredRatios = measurements.flatMap((item) => item.contrastRatio === null ? [] : [item.contrastRatio]);
    return {
      normalPng,
      measurements,
      lowContrastTextCount: measurements.filter((item) => item.status === "fail").length,
      unmeasurableContrastTextCount: measurements.filter((item) => item.status === "unmeasurable").length,
      minimumTextContrastRatio: measuredRatios.length ? Math.min(...measuredRatios) : null,
    };
  } finally {
    await page.evaluate(() => {
      document.querySelector("#visual-audit-hide-text-paint")?.remove();
      document.querySelectorAll("[data-visual-audit-text-index]").forEach((element) => {
        element.removeAttribute("data-visual-audit-text-index");
        element.removeAttribute("data-visual-audit-text-kind");
      });
    }, undefined);
  }
}

export interface VisualQualityFinding {
  readonly severity: "error" | "warning";
  readonly code: string;
  readonly sceneId?: string;
  readonly sampleId?: string;
  readonly message: string;
}

const FAMILY_BY_KIND: Readonly<Record<string, CompositionFamily>> = {
  title: "cinematic-scale",
  "section-intro": "editorial-type",
  definition: "object-stage",
  bullets: "editorial-type",
  comparison: "split-evidence",
  diagram: "diagram",
  timeline: "diagram",
  formula: "object-stage",
  derivation: "worked-example",
  graph: "data-canvas",
  code: "document-focus",
  walkthrough: "document-focus",
  diff: "document-focus",
  "file-tree": "document-focus",
  terminal: "document-focus",
  "execution-trace": "worked-example",
  "variable-state": "worked-example",
  chart: "data-canvas",
  table: "data-canvas",
  map: "data-canvas",
  "image-focus": "object-stage",
  "image-comparison": "split-evidence",
  "document-focus": "document-focus",
  "ui-demo": "object-stage",
  "screen-recording": "object-stage",
  simulation: "data-canvas",
  presenter: "presenter",
  "presenter-slide": "presenter",
  quote: "editorial-type",
  question: "editorial-type",
  "worked-example": "worked-example",
  quiz: "assessment",
  recap: "editorial-type",
  summary: "editorial-type",
  sources: "document-focus",
  outro: "cinematic-scale",
};

const WORD_BUDGET_BY_KIND: Readonly<Record<string, number>> = {
  code: 145,
  walkthrough: 145,
  diff: 145,
  terminal: 145,
  table: 120,
  sources: 180,
  "document-focus": 130,
};

const CARD_ALLOWANCE_BY_KIND: Readonly<Record<string, number>> = {
  comparison: 2,
  quiz: 4,
  "ui-demo": 2,
  simulation: 2,
  "presenter-slide": 1,
};

export function compositionFamilyForKind(kind: string): CompositionFamily {
  return FAMILY_BY_KIND[kind] ?? "object-stage";
}

function finding(
  severity: VisualQualityFinding["severity"],
  code: string,
  message: string,
  sceneId?: string,
  sampleId?: string,
): VisualQualityFinding {
  if (sceneId === undefined) return { severity, code, message };
  if (sampleId === undefined) return { severity, code, message, sceneId };
  return { severity, code, message, sceneId, sampleId };
}

function firstObservationPerScene(observations: readonly VisualFrameObservation[]): readonly VisualFrameObservation[] {
  const seen = new Set<string>();
  return observations.filter((observation) => {
    if (seen.has(observation.sceneId)) return false;
    seen.add(observation.sceneId);
    return true;
  });
}

function geometryCount(
  observation: VisualFrameObservation,
  code: StructuralGeometryFinding["code"],
): number {
  switch (code) {
    case "geometry.text-intersection": return observation.geometryTextIntersectionCount;
    case "geometry.outside-frame": return observation.geometryOutsideFrameCount;
    case "geometry.outside-safe-area": return observation.geometryOutsideSafeAreaCount;
    case "geometry.container-overflow": return observation.geometryContainerOverflowCount;
    case "geometry.line-limit": return observation.geometryLineLimitCount;
  }
}

/**
 * Hard visual-quality policy. It intentionally catches structural repetition,
 * not subjective palette choices, so it remains stable across theme packs.
 */
export function auditVisualObservations(observations: readonly VisualFrameObservation[]): readonly VisualQualityFinding[] {
  const findings: VisualQualityFinding[] = [];
  const sceneObservations = firstObservationPerScene(observations);
  if (sceneObservations.length < 8) {
    findings.push(finding("error", "coverage.too-small", `Audit needs at least 8 representative scenes; received ${sceneObservations.length}.`));
  }

  for (let index = 2; index < sceneObservations.length; index += 1) {
    const a = sceneObservations[index - 2];
    const b = sceneObservations[index - 1];
    const c = sceneObservations[index];
    if (a && b && c && a.family === b.family && b.family === c.family) {
      findings.push(finding("error", "composition.repeated-three", `Three adjacent scenes reuse ${c.family}; vary the visual beat before export.`, c.sceneId));
    }
  }

  let dashboardLikeCount = 0;
  const dashboardScenes = new Set<string>();
  for (const observation of observations) {
    const wordBudget = WORD_BUDGET_BY_KIND[observation.kind] ?? 92;
    const cardAllowance = CARD_ALLOWANCE_BY_KIND[observation.kind] ?? 1;
    const dashboardLike = observation.cardCount >= 3 || (observation.cardCount >= 2 && observation.pillLikeShapeCount >= 4);
    if (dashboardLike) dashboardScenes.add(observation.sceneId);

    const geometrySample = `${observation.sampleLabel} sample (local frame ${observation.localFrame}, global frame ${observation.globalFrame})`;
    const recordedGeometryCodes = new Set<StructuralGeometryFinding["code"]>();
    for (const geometryFinding of observation.geometryFindings) {
      recordedGeometryCodes.add(geometryFinding.code);
      findings.push(finding(
        "error",
        geometryFinding.code,
        `${geometrySample}: ${geometryFinding.message}`,
        observation.sceneId,
        observation.sampleId,
      ));
    }
    for (const code of [
      "geometry.text-intersection",
      "geometry.outside-frame",
      "geometry.outside-safe-area",
      "geometry.container-overflow",
      "geometry.line-limit",
    ] as const) {
      const count = geometryCount(observation, code);
      if (count > 0 && !recordedGeometryCodes.has(code)) {
        findings.push(finding(
          "error",
          code,
          `${geometrySample}: ${count} structural geometry violation(s) were measured after packaged fonts settled.`,
          observation.sceneId,
          observation.sampleId,
        ));
      }
    }

    if (observation.captionOverlayCount > 0) {
      findings.push(finding("error", "captions.clean-master", "Default audit frame contains an open/burned caption overlay; clean master plus SRT/VTT sidecars must be the default.", observation.sceneId, observation.sampleId));
    }
    if (observation.textOutsideFrameCount > 0) {
      findings.push(finding("error", "text.outside-frame", `${observation.textOutsideFrameCount} visible text node(s) cross the frame boundary.`, observation.sceneId, observation.sampleId));
    }
    if (observation.textInsideUnsafeMarginCount > 0) {
      findings.push(finding("error", "text.unsafe-margin", `${observation.textInsideUnsafeMarginCount} essential text node(s) violate the 5% graphics-safe margin.`, observation.sceneId, observation.sampleId));
    }
    if (observation.overflowingContainerCount > 0) {
      findings.push(finding("error", "text.container-overflow", `${observation.overflowingContainerCount} HTML text container(s) clip or overflow.`, observation.sceneId, observation.sampleId));
    }
    if (observation.visibleWordCount > wordBudget) {
      findings.push(finding("error", "text.excessive", `${observation.visibleWordCount} visible words exceed the ${wordBudget}-word ${observation.kind} budget; narration should not be duplicated onscreen.`, observation.sceneId, observation.sampleId));
    }
    if (observation.cardCount > cardAllowance) {
      findings.push(finding("error", "composition.card-grid", `${observation.cardCount} card surfaces exceed the ${cardAllowance}-card allowance for ${observation.kind}; this reads as dashboard UI.`, observation.sceneId, observation.sampleId));
    }
    if (observation.pillLikeShapeCount > 8) {
      findings.push(finding("error", "composition.pill-density", `${observation.pillLikeShapeCount} compact rounded shapes create tag/pill visual noise.`, observation.sceneId, observation.sampleId));
    }
    if (observation.tinyTextCount > 0) {
      findings.push(finding("warning", "text.tiny", `${observation.tinyTextCount} text node(s) render below the 16px review threshold at 720p.`, observation.sceneId, observation.sampleId));
    }
    if (observation.lowContrastTextCount > 0) {
      findings.push(finding("warning", "text.contrast", `${observation.lowContrastTextCount} text node(s) fail composited WCAG AA contrast.`, observation.sceneId, observation.sampleId));
    }
    if (observation.unmeasurableContrastTextCount > 0) {
      findings.push(finding("warning", "text.contrast-unmeasurable", `${observation.unmeasurableContrastTextCount} text node(s) use paint that could not be measured and need manual contrast review.`, observation.sceneId, observation.sampleId));
    }
    if (observation.lumaStandardDeviation < 18 || observation.colorBucketCount < 14 || observation.edgeEnergy < 3.5) {
      findings.push(finding("warning", "frame.visual-flatness", `Low visual variation (luma σ ${observation.lumaStandardDeviation.toFixed(1)}, ${observation.colorBucketCount} color buckets, edge ${observation.edgeEnergy.toFixed(1)}).`, observation.sceneId, observation.sampleId));
    }
  }

  dashboardLikeCount = dashboardScenes.size;
  if (dashboardLikeCount > Math.max(2, Math.floor(sceneObservations.length * 0.2))) {
    findings.push(finding("error", "composition.dashboard-repetition", `${dashboardLikeCount}/${sceneObservations.length} audited scenes use dashboard-like card grids; maximum is 20%.`));
  }

  for (let index = 1; index < sceneObservations.length; index += 1) {
    const previous = sceneObservations[index - 1];
    const current = sceneObservations[index];
    if (previous && current && previous.cardCount >= 3 && current.cardCount >= 3) {
      findings.push(finding("error", "composition.adjacent-card-grids", "Adjacent scenes both use dense card grids; replace at least one with a diagram, object stage, or editorial composition.", current.sceneId));
    }
  }

  return findings;
}
