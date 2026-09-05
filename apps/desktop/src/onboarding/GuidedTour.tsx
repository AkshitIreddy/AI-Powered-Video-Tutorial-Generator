import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { computeSpotlightRect, computeTourPanelPosition, guidedTourCompletionKey, safeTourIndex } from "./tour";
import type { GuidedTourCompletion, GuidedTourProps, SpotlightRect } from "./types";
import "./GuidedTour.css";

type SpotlightStyle = CSSProperties & {
  "--aly-onboarding-spotlight-top": string;
  "--aly-onboarding-spotlight-left": string;
  "--aly-onboarding-spotlight-width": string;
  "--aly-onboarding-spotlight-height": string;
  "--aly-onboarding-spotlight-radius": string;
};

interface MeasuredSize {
  width: number;
  height: number;
}

const emptySpotlight: SpotlightRect = { top: 0, left: 0, width: 0, height: 0, borderRadius: 16 };
const initialPanelSize: MeasuredSize = { width: 360, height: 240 };

function defaultResolveTarget(selector: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(selector);
}

function sameRect(left: SpotlightRect, right: SpotlightRect): boolean {
  return left.top === right.top
    && left.left === right.left
    && left.width === right.width
    && left.height === right.height
    && left.borderRadius === right.borderRadius;
}

function elementStateIsComplete(
  completion: Extract<GuidedTourCompletion, { type: "element-state" }>,
  resolveTarget: (selector: string) => HTMLElement | null,
): boolean {
  const element = resolveTarget(completion.selector);
  if ((completion.state ?? "present") === "absent") return !element;
  if (!element) return false;
  if (!completion.attribute) return true;
  const value = element.getAttribute(completion.attribute);
  return completion.value === undefined ? value !== null : value === completion.value;
}

function withDescription(element: HTMLElement, descriptionId: string): () => void {
  const previous = element.getAttribute("aria-describedby");
  const ids = new Set((previous ?? "").split(/\s+/u).filter(Boolean));
  ids.add(descriptionId);
  element.setAttribute("aria-describedby", [...ids].join(" "));
  element.classList.add("aly-onboarding-tour-target");
  return () => {
    element.classList.remove("aly-onboarding-tour-target");
    if (previous === null) element.removeAttribute("aria-describedby");
    else element.setAttribute("aria-describedby", previous);
  };
}

function isOutsideViewport(rect: DOMRect, viewport: MeasuredSize, margin = 24): boolean {
  return rect.bottom < margin
    || rect.right < margin
    || rect.top > viewport.height - margin
    || rect.left > viewport.width - margin;
}

function shadeRectStyle(top: number, left: number, width: number, height: number): CSSProperties {
  return {
    inset: "auto",
    top: `${Math.max(0, top)}px`,
    left: `${Math.max(0, left)}px`,
    width: `${Math.max(0, width)}px`,
    height: `${Math.max(0, height)}px`,
  };
}

export function GuidedTour({
  open,
  steps,
  activeIndex,
  onActiveIndexChange,
  onExit,
  onComplete,
  reducedMotion = false,
  resolveTarget = defaultResolveTarget,
  spotlightRadius = 16,
  completedStepIds = [],
  onStepComplete,
  onStepEnter,
}: GuidedTourProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const completedInternally = useRef(new Set<string>());
  const reportedCompletions = useRef(new Set<string>());
  const index = safeTourIndex(steps, activeIndex);
  const step = steps[index];
  const [spotlight, setSpotlight] = useState<SpotlightRect>(emptySpotlight);
  const [targetElement, setTargetElement] = useState<HTMLElement | null>(null);
  const [targetMissing, setTargetMissing] = useState(false);
  const [viewport, setViewport] = useState<MeasuredSize>(() => ({
    width: typeof window === "undefined" ? 1280 : window.innerWidth,
    height: typeof window === "undefined" ? 720 : window.innerHeight,
  }));
  const [panelSize, setPanelSize] = useState<MeasuredSize>(initialPanelSize);
  const [domRevision, setDomRevision] = useState(0);

  useLayoutEffect(() => {
    if (!open || !step) return;
    let observedTarget: HTMLElement | null = null;
    let frame = 0;
    let scrolledForStep = false;
    let scheduleMeasure = () => {};
    const targetResize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => scheduleMeasure());
    const panelResize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => scheduleMeasure());

    const measure = () => {
      frame = 0;
      const nextViewport = { width: window.innerWidth, height: window.innerHeight };
      setViewport((current) => current.width === nextViewport.width && current.height === nextViewport.height ? current : nextViewport);

      const nextTarget = step.target ? resolveTarget(step.target) : null;
      if (nextTarget !== observedTarget) {
        if (observedTarget) targetResize?.unobserve(observedTarget);
        observedTarget = nextTarget;
        if (observedTarget) targetResize?.observe(observedTarget);
        setTargetElement(observedTarget);
      }
      setTargetMissing(Boolean(step.target && !nextTarget));

      if (nextTarget) {
        const targetRect = nextTarget.getBoundingClientRect();
        if (!scrolledForStep && isOutsideViewport(targetRect, nextViewport)) {
          scrolledForStep = true;
          nextTarget.scrollIntoView?.({
            behavior: reducedMotion ? "auto" : "smooth",
            block: "center",
            inline: "nearest",
          });
        }
        const nextSpotlight = computeSpotlightRect(targetRect, nextViewport, step.padding ?? 10, spotlightRadius);
        setSpotlight((current) => sameRect(current, nextSpotlight) ? current : nextSpotlight);
      } else {
        const nextSpotlight = computeSpotlightRect(null, nextViewport, step.padding ?? 10, spotlightRadius);
        setSpotlight((current) => sameRect(current, nextSpotlight) ? current : nextSpotlight);
      }

      const panelRect = panelRef.current?.getBoundingClientRect();
      if (panelRect && panelRect.width > 0 && panelRect.height > 0) {
        const nextSize = { width: panelRect.width, height: panelRect.height };
        setPanelSize((current) => current.width === nextSize.width && current.height === nextSize.height ? current : nextSize);
      }
    };

    scheduleMeasure = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(measure);
    };

    const mutationObserver = typeof MutationObserver === "undefined"
      ? null
      : new MutationObserver((records) => {
        const hasRelevantChange = records.some((record) => {
          const element = record.target instanceof Element ? record.target : record.target.parentElement;
          return !element?.closest(".aly-onboarding-tour");
        });
        if (!hasRelevantChange) return;
        setDomRevision((revision) => revision + 1);
        scheduleMeasure();
      });
    const completionAttribute = step.completion?.type === "element-state" ? step.completion.attribute : undefined;
    mutationObserver?.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [...new Set(["aria-current", "aria-expanded", "aria-pressed", "data-state", "hidden", "class", completionAttribute].filter((item): item is string => Boolean(item)))],
    });
    if (panelRef.current) panelResize?.observe(panelRef.current);
    measure();
    window.addEventListener("resize", scheduleMeasure);
    window.addEventListener("scroll", scheduleMeasure, true);
    window.visualViewport?.addEventListener("resize", scheduleMeasure);
    window.visualViewport?.addEventListener("scroll", scheduleMeasure);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", scheduleMeasure);
      window.removeEventListener("scroll", scheduleMeasure, true);
      window.visualViewport?.removeEventListener("resize", scheduleMeasure);
      window.visualViewport?.removeEventListener("scroll", scheduleMeasure);
      mutationObserver?.disconnect();
      targetResize?.disconnect();
      panelResize?.disconnect();
    };
  }, [open, reducedMotion, resolveTarget, spotlightRadius, step]);

  useLayoutEffect(() => {
    if (!open || !targetElement) return;
    return withDescription(targetElement, descriptionId);
  }, [descriptionId, open, targetElement]);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => previousFocus.current?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const dismissFromPage = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || panelRef.current?.contains(event.target as Node)) return;
      event.preventDefault();
      onExit();
    };
    document.addEventListener("keydown", dismissFromPage);
    return () => document.removeEventListener("keydown", dismissFromPage);
  }, [onExit, open]);

  useEffect(() => {
    if (!open || !step) return;
    panelRef.current?.focus({ preventScroll: true });
    onStepEnter?.(step, index);
  }, [index, onStepEnter, open, step]);

  const markStepComplete = useCallback(() => {
    if (!step) return;
    const key = guidedTourCompletionKey(step);
    if (completedInternally.current.has(key)) return;
    completedInternally.current.add(key);
    setDomRevision((revision) => revision + 1);
  }, [step]);

  useEffect(() => {
    if (!open || !step || !targetElement || step.completion?.type !== "target-event") return;
    const eventName = step.completion.event ?? "click";
    targetElement.addEventListener(eventName, markStepComplete);
    return () => targetElement.removeEventListener(eventName, markStepComplete);
  }, [markStepComplete, open, step, targetElement]);

  const actionComplete = (() => {
    // Reading the revision makes element-state completion reactive to route,
    // drawer, dialog and attribute updates observed above.
    void domRevision;
    if (!step?.completion) return true;
    const key = guidedTourCompletionKey(step);
    if (completedInternally.current.has(key) || completedStepIds.includes(key) || completedStepIds.includes(step.id)) return true;
    return step.completion.type === "element-state" && elementStateIsComplete(step.completion, resolveTarget);
  })();

  useEffect(() => {
    if (!step?.completion || !actionComplete) return;
    const key = guidedTourCompletionKey(step);
    if (!reportedCompletions.current.has(key)) {
      reportedCompletions.current.add(key);
      onStepComplete?.(step, index);
    }
    if (!step.completion.autoAdvance) return;
    const timeout = window.setTimeout(() => {
      if (index === steps.length - 1) onComplete();
      else onActiveIndexChange(index + 1);
    }, reducedMotion ? 0 : 360);
    return () => window.clearTimeout(timeout);
  }, [actionComplete, index, onActiveIndexChange, onComplete, onStepComplete, reducedMotion, step, steps.length]);

  const panelPosition = useMemo(() => computeTourPanelPosition(
    spotlight,
    viewport,
    step?.target ? step.placement : "center",
    panelSize,
  ), [panelSize, spotlight, step, viewport]);

  if (!open || !step) return null;

  const finalStep = index === steps.length - 1;
  const canInteractWithTarget = Boolean(targetElement && (step.allowTargetInteraction || step.completion?.type === "target-event"));
  const spotlightStyle: SpotlightStyle = {
    "--aly-onboarding-spotlight-top": `${spotlight.top}px`,
    "--aly-onboarding-spotlight-left": `${spotlight.left}px`,
    "--aly-onboarding-spotlight-width": `${spotlight.width}px`,
    "--aly-onboarding-spotlight-height": `${spotlight.height}px`,
    "--aly-onboarding-spotlight-radius": `${spotlight.borderRadius}px`,
  };
  const hasVisibleSpotlight = !targetMissing && Boolean(step.target) && spotlight.width > 0 && spotlight.height > 0;
  const shadeRects = hasVisibleSpotlight
    ? [
      shadeRectStyle(0, 0, viewport.width, spotlight.top),
      shadeRectStyle(spotlight.top, 0, spotlight.left, spotlight.height),
      shadeRectStyle(spotlight.top, spotlight.left + spotlight.width, viewport.width - spotlight.left - spotlight.width, spotlight.height),
      shadeRectStyle(spotlight.top + spotlight.height, 0, viewport.width, viewport.height - spotlight.top - spotlight.height),
    ]
    : [shadeRectStyle(0, 0, viewport.width, viewport.height)];

  const advance = () => {
    if (!actionComplete) return;
    if (finalStep) onComplete();
    else onActiveIndexChange(index + 1);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onExit();
      return;
    }
    if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      onActiveIndexChange(index - 1);
    }
    if (event.key === "ArrowRight" && actionComplete) {
      event.preventDefault();
      advance();
    }
  };

  const completionMessage = step.completion
    ? actionComplete
      ? step.completion.completedLabel ?? "Done — this step is complete."
      : targetMissing
        ? "Finding this control on the current screen…"
        : step.completion.label
    : null;

  return (
    <div
      className={`aly-onboarding-tour${reducedMotion ? " aly-onboarding-tour--reduced-motion" : ""}`}
      data-reduced-motion={reducedMotion ? "true" : "false"}
      data-target-missing={targetMissing ? "true" : "false"}
      data-action-complete={actionComplete ? "true" : "false"}
      style={spotlightStyle}
    >
      {shadeRects.map((style, shadeIndex) => <div key={shadeIndex} className="aly-onboarding-tour__shade" style={style} aria-hidden="true" />)}
      {hasVisibleSpotlight ? <div className="aly-onboarding-tour__spotlight" aria-hidden="true" /> : null}
      {hasVisibleSpotlight && !canInteractWithTarget
        ? <div className="aly-onboarding-tour__interaction-guard" style={shadeRectStyle(spotlight.top, spotlight.left, spotlight.width, spotlight.height)} aria-hidden="true" />
        : null}
      <div
        ref={panelRef}
        className={`aly-onboarding-tour__panel aly-onboarding-tour__panel--${panelPosition.placement}`}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        style={{ top: panelPosition.top, left: panelPosition.left }}
        onKeyDown={handleKeyDown}
      >
        <div className="aly-onboarding-tour__progress" aria-label={`Step ${index + 1} of ${steps.length}`}>
          <span className="aly-onboarding-tour__progress-count">{index + 1} / {steps.length}</span>
          <span
            className="aly-onboarding-tour__progress-track"
            role="progressbar"
            aria-label="Tour progress"
            aria-valuemin={1}
            aria-valuemax={steps.length}
            aria-valuenow={index + 1}
          >
            <span className="aly-onboarding-tour__progress-value" style={{ width: `${((index + 1) / steps.length) * 100}%` }} />
          </span>
        </div>
        <h2 id={titleId} className="aly-onboarding-tour__title">{step.title}</h2>
        <p id={descriptionId} className="aly-onboarding-tour__description">{step.description}</p>
        {completionMessage ? (
          <div className={`aly-onboarding-tour__task${actionComplete ? " aly-onboarding-tour__task--complete" : ""}`} role="status" aria-live="polite">
            <span aria-hidden="true">{actionComplete ? "✓" : "→"}</span>
            <strong>{actionComplete ? "Completed" : "Your turn"}</strong>
            <p>{completionMessage}</p>
          </div>
        ) : null}
        {targetMissing ? <p className="aly-onboarding-tour__notice" role="status">This step is waiting for its real control. Return to the relevant workspace or use Back; progress will not be marked complete.</p> : null}
        {targetElement ? (
          <button
            type="button"
            className="aly-onboarding-tour__focus-target"
            onClick={() => targetElement.focus({ preventScroll: true })}
          >
            Focus highlighted control
          </button>
        ) : null}
        <div className="aly-onboarding-tour__actions">
          <button type="button" className="aly-onboarding-tour__exit" onClick={onExit}>Exit tour</button>
          <div className="aly-onboarding-tour__navigation">
            <button type="button" className="aly-onboarding-tour__back" disabled={index === 0} onClick={() => onActiveIndexChange(index - 1)}>Back</button>
            <button type="button" className="aly-onboarding-tour__next" disabled={!actionComplete} onClick={advance}>
              {finalStep ? "Finish tour" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
