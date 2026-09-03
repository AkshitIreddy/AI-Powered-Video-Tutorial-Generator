import type { Insets } from "./contracts.js";

export interface GeometryRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface RenderedGeometryElement {
  readonly id: string;
  readonly kind: "text" | "container";
  readonly role: string;
  readonly text: string;
  readonly essential: boolean;
  readonly rect: GeometryRect;
  readonly fontSize: number | null;
  readonly lineCount: number;
  readonly declaredMaxLines: number | null;
  readonly plannedRect: GeometryRect | null;
  readonly overflowPolicy: string | null;
}

export interface GeometryIntersection {
  readonly firstId: string;
  readonly secondId: string;
  readonly firstText: string;
  readonly secondText: string;
  readonly rect: GeometryRect;
}

export interface StructuralGeometryFinding {
  readonly severity: "error" | "warning";
  readonly code:
    | "geometry.text-intersection"
    | "geometry.outside-frame"
    | "geometry.outside-safe-area"
    | "geometry.parent-overflow"
    | "geometry.container-overflow"
    | "geometry.line-limit";
  readonly elementIds: readonly string[];
  readonly message: string;
  readonly rects: readonly GeometryRect[];
}

export interface StructuralGeometrySnapshot {
  readonly frame: GeometryRect;
  readonly graphicsSafe: GeometryRect;
  readonly elements: readonly RenderedGeometryElement[];
  readonly intersections: readonly GeometryIntersection[];
  readonly findings: readonly StructuralGeometryFinding[];
}

interface GeometryInspectionPage {
  evaluate<R, A>(pageFunction: (argument: A) => R | Promise<R>, argument: A): Promise<R>;
}

export interface StructuralGeometryOptions {
  readonly width: number;
  readonly height: number;
  readonly safeArea?: Partial<Insets>;
  readonly epsilon?: number;
}

function intersection(left: GeometryRect, right: GeometryRect, epsilon: number): GeometryRect | null {
  const x = Math.max(left.x, right.x);
  const y = Math.max(left.y, right.y);
  const width = Math.min(left.x + left.width, right.x + right.width) - x;
  const height = Math.min(left.y + left.height, right.y + right.height) - y;
  return width > epsilon && height > epsilon ? { x, y, width, height } : null;
}

function contains(container: GeometryRect, child: GeometryRect, epsilon: number): boolean {
  return child.x >= container.x - epsilon
    && child.y >= container.y - epsilon
    && child.x + child.width <= container.x + container.width + epsilon
    && child.y + child.height <= container.y + container.height + epsilon;
}

function finding(
  severity: StructuralGeometryFinding["severity"],
  code: StructuralGeometryFinding["code"],
  elementIds: readonly string[],
  message: string,
  rects: readonly GeometryRect[],
): StructuralGeometryFinding {
  return { severity, code, elementIds, message, rects };
}

export function analyzeStructuralGeometry(
  frame: GeometryRect,
  graphicsSafe: GeometryRect,
  elements: readonly RenderedGeometryElement[],
  epsilon = 0.75,
): StructuralGeometrySnapshot {
  const findings: StructuralGeometryFinding[] = [];
  const textElements = elements.filter((item) => item.kind === "text" && item.rect.width > epsilon && item.rect.height > epsilon);
  const intersections: GeometryIntersection[] = [];
  for (let firstIndex = 0; firstIndex < textElements.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < textElements.length; secondIndex += 1) {
      const first = textElements[firstIndex]!;
      const second = textElements[secondIndex]!;
      const overlap = intersection(first.rect, second.rect, epsilon);
      if (!overlap) continue;
      intersections.push({ firstId: first.id, secondId: second.id, firstText: first.text, secondText: second.text, rect: overlap });
      findings.push(finding(
        "error",
        "geometry.text-intersection",
        [first.id, second.id],
        `Visible text intersects: “${first.text.slice(0, 72)}” and “${second.text.slice(0, 72)}”.`,
        [first.rect, second.rect, overlap],
      ));
    }
  }

  for (const element of elements) {
    if (!contains(frame, element.rect, epsilon)) {
      findings.push(finding("error", "geometry.outside-frame", [element.id], `${element.role} ${element.id} crosses the frame.`, [element.rect]));
    }
    if (element.essential && !contains(graphicsSafe, element.rect, epsilon)) {
      findings.push(finding("error", "geometry.outside-safe-area", [element.id], `Essential ${element.role} ${element.id} crosses the graphics-safe area.`, [element.rect, graphicsSafe]));
    }
    if (element.kind === "container" && element.plannedRect && !contains(element.plannedRect, element.rect, epsilon)) {
      findings.push(finding(
        "error",
        element.role === "diagram-node" ? "geometry.parent-overflow" : "geometry.container-overflow",
        [element.id],
        element.role === "diagram-node"
          ? `Diagram node ${element.id} leaves its parent stage; re-layout is required.`
          : `${element.role} ${element.id} exceeds its planned box; ${element.overflowPolicy ?? "recompose"} is required.`,
        [element.rect, element.plannedRect],
      ));
    }
    if (element.declaredMaxLines !== null && element.lineCount > element.declaredMaxLines) {
      findings.push(finding(
        "error",
        "geometry.line-limit",
        [element.id],
        `${element.role} ${element.id} renders ${element.lineCount} lines; the grammar permits ${element.declaredMaxLines}.`,
        [element.rect],
      ));
    }
  }

  return Object.freeze({ frame, graphicsSafe, elements, intersections, findings });
}

function safeRect(options: StructuralGeometryOptions): GeometryRect {
  const horizontal = Math.round(options.width * 0.05);
  const vertical = Math.round(options.height * 0.05);
  const top = options.safeArea?.top ?? vertical;
  const right = options.safeArea?.right ?? horizontal;
  const bottom = options.safeArea?.bottom ?? vertical;
  const left = options.safeArea?.left ?? horizontal;
  return { x: left, y: top, width: options.width - left - right, height: options.height - top - bottom };
}

/** Collects post-transform Chromium boxes after packaged fonts settle. */
export async function inspectStructuralGeometry(
  page: GeometryInspectionPage,
  options: StructuralGeometryOptions,
): Promise<StructuralGeometrySnapshot> {
  const collected = await page.evaluate(({ width, height }): RenderedGeometryElement[] => {
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
      return opacity > 0.01 && rect.right > 0 && rect.bottom > 0 && rect.left < width && rect.top < height;
    };
    const rectOf = (element: Element): GeometryRect => {
      const rect = element.getBoundingClientRect();
      return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
    };
    const parseRect = (value: string | null): GeometryRect | null => {
      if (!value) return null;
      const parts = value.split(",").map(Number);
      if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return null;
      return { x: parts[0]!, y: parts[1]!, width: parts[2]!, height: parts[3]! };
    };
    const directText = Array.from(document.querySelectorAll("svg text, svg foreignObject div"))
      .filter((element) => visible(element) && !element.closest("[aria-hidden='true']"));
    const textElements: RenderedGeometryElement[] = directText.map((element, index) => {
      const closestRole = element.closest<HTMLElement>("[data-layout-role], [data-semantic-role]");
      const role = element.getAttribute("data-layout-role")
        ?? closestRole?.dataset.layoutRole
        ?? closestRole?.dataset.semanticRole
        ?? "text";
      const container = element.closest<SVGGElement>("[data-layout-container]");
      const declared = Number.parseInt(container?.dataset.layoutMaxLines ?? "", 10);
      const lineCount = element.querySelectorAll(":scope > tspan").length || 1;
      const style = getComputedStyle(element);
      return {
        id: element.getAttribute("data-layout-box") || element.id || `text.${index}`,
        kind: "text",
        role,
        text: (element.textContent ?? "").replace(/\s+/gu, " ").trim(),
        essential: element.getAttribute("data-layout-essential") === "true" || Boolean(element.closest("[data-semantic-role]:not([data-semantic-role='decorative'])")),
        rect: rectOf(element),
        fontSize: Number.parseFloat(style.fontSize || "0") || null,
        lineCount,
        declaredMaxLines: Number.isFinite(declared) ? declared : null,
        plannedRect: null,
        overflowPolicy: null,
      };
    });
    const containers = Array.from(document.querySelectorAll("[data-layout-container]"))
      .filter(visible)
      .map((element, index): RenderedGeometryElement => {
        const child = element.querySelector("text, div") ?? element;
        const declared = Number.parseInt(element.getAttribute("data-layout-max-lines") ?? "", 10);
        return {
          id: element.getAttribute("data-layout-container") || `container.${index}`,
          kind: "container",
          role: child.getAttribute("data-layout-role") ?? "text-container",
          text: (child.textContent ?? "").replace(/\s+/gu, " ").trim(),
          essential: child.getAttribute("data-layout-essential") === "true",
          rect: rectOf(child),
          fontSize: Number.parseFloat(getComputedStyle(child).fontSize || "0") || null,
          lineCount: child.querySelectorAll(":scope > tspan").length || 1,
          declaredMaxLines: Number.isFinite(declared) ? declared : null,
          plannedRect: parseRect(element.getAttribute("data-layout-rect")),
          overflowPolicy: element.getAttribute("data-layout-overflow-policy"),
        };
      });
    const diagramStage = document.querySelector("[data-diagram-stage='true']");
    const diagramNodes = diagramStage ? Array.from(document.querySelectorAll("[data-signal-stage][data-layout-x][data-layout-y][data-layout-width][data-layout-height]"))
      .filter(visible)
      .map((element, index): RenderedGeometryElement => ({
        id: element.id || `diagram-node.${index}`,
        kind: "container",
        role: "diagram-node",
        text: (element.textContent ?? "").replace(/\s+/gu, " ").trim(),
        essential: true,
        rect: rectOf(element),
        fontSize: null,
        lineCount: 0,
        declaredMaxLines: null,
        plannedRect: rectOf(diagramStage),
        overflowPolicy: "re-layout",
      })) : [];
    return [...textElements, ...containers, ...diagramNodes];
  }, { width: options.width, height: options.height });
  return analyzeStructuralGeometry(
    { x: 0, y: 0, width: options.width, height: options.height },
    safeRect(options),
    collected,
    options.epsilon,
  );
}

export function geometryDebugOverlay(snapshot: StructuralGeometrySnapshot): string {
  const escape = (value: string) => value.replace(/[&<>"']/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
  const boxes = snapshot.elements.map((element) => `<g><rect x="${element.rect.x}" y="${element.rect.y}" width="${element.rect.width}" height="${element.rect.height}" fill="none" stroke="${element.essential ? "#c94b67" : "#df922e"}" stroke-width="1.5"/><text x="${element.rect.x + 3}" y="${Math.max(12, element.rect.y + 12)}" fill="#c94b67" font-size="11">${escape(element.id)}</text></g>`).join("");
  const overlaps = snapshot.intersections.map((item) => `<rect x="${item.rect.x}" y="${item.rect.y}" width="${item.rect.width}" height="${item.rect.height}" fill="#ff1744" fill-opacity="0.35" stroke="#ff1744" stroke-width="2"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${snapshot.frame.width}" height="${snapshot.frame.height}" viewBox="0 0 ${snapshot.frame.width} ${snapshot.frame.height}"><rect x="${snapshot.graphicsSafe.x}" y="${snapshot.graphicsSafe.y}" width="${snapshot.graphicsSafe.width}" height="${snapshot.graphicsSafe.height}" fill="none" stroke="#df922e" stroke-width="2" stroke-dasharray="8 6"/>${boxes}${overlaps}</svg>`;
}
