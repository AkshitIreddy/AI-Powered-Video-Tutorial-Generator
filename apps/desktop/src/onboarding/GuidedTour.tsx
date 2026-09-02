import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { computeSpotlightRect, computeTourPanelPosition, safeTourIndex } from "./tour";
import type { GuidedTourProps, SpotlightRect } from "./types";

type SpotlightStyle = CSSProperties & {
  "--aly-onboarding-spotlight-top": string;
  "--aly-onboarding-spotlight-left": string;
  "--aly-onboarding-spotlight-width": string;
  "--aly-onboarding-spotlight-height": string;
  "--aly-onboarding-spotlight-radius": string;
};

const emptySpotlight: SpotlightRect = { top: 0, left: 0, width: 0, height: 0, borderRadius: 16 };

function defaultResolveTarget(selector: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(selector);
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
}: GuidedTourProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const index = safeTourIndex(steps, activeIndex);
  const step = steps[index];
  const [spotlight, setSpotlight] = useState<SpotlightRect>(emptySpotlight);
  const [targetMissing, setTargetMissing] = useState(false);

  useLayoutEffect(() => {
    if (!open || !step) return;
    const measure = () => {
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const target = step.target ? resolveTarget(step.target) : null;
      const rect = target?.getBoundingClientRect() ?? null;
      setTargetMissing(Boolean(step.target && !target));
      setSpotlight(computeSpotlightRect(rect, viewport, step.padding ?? 10, spotlightRadius));
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    const target = step.target ? resolveTarget(step.target) : null;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (target) observer?.observe(target);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      observer?.disconnect();
    };
  }, [open, resolveTarget, spotlightRadius, step]);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();
    return () => previousFocus.current?.focus();
  }, [open]);

  const panelPosition = useMemo(() => computeTourPanelPosition(
    spotlight,
    { width: typeof window === "undefined" ? 1280 : window.innerWidth, height: typeof window === "undefined" ? 720 : window.innerHeight },
    step?.target ? step.placement : "center",
  ), [spotlight, step]);

  if (!open || !step) return null;

  const finalStep = index === steps.length - 1;
  const spotlightStyle: SpotlightStyle = {
    "--aly-onboarding-spotlight-top": `${spotlight.top}px`,
    "--aly-onboarding-spotlight-left": `${spotlight.left}px`,
    "--aly-onboarding-spotlight-width": `${spotlight.width}px`,
    "--aly-onboarding-spotlight-height": `${spotlight.height}px`,
    "--aly-onboarding-spotlight-radius": `${spotlight.borderRadius}px`,
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onExit();
      return;
    }
    if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      onActiveIndexChange(index - 1);
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      if (finalStep) onComplete();
      else onActiveIndexChange(index + 1);
    }
  };

  return (
    <div
      className={`aly-onboarding-tour${reducedMotion ? " aly-onboarding-tour--reduced-motion" : ""}`}
      data-reduced-motion={reducedMotion ? "true" : "false"}
      data-target-missing={targetMissing ? "true" : "false"}
      style={spotlightStyle}
    >
      <div className="aly-onboarding-tour__shade" aria-hidden="true" />
      {!targetMissing && step.target ? <div className="aly-onboarding-tour__spotlight" aria-hidden="true" /> : null}
      {!step.allowTargetInteraction ? <div className="aly-onboarding-tour__interaction-guard" aria-hidden="true" /> : null}
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
          <span className="aly-onboarding-tour__progress-track" aria-hidden="true">
            <span className="aly-onboarding-tour__progress-value" style={{ width: `${((index + 1) / steps.length) * 100}%` }} />
          </span>
        </div>
        <h2 id={titleId} className="aly-onboarding-tour__title">{step.title}</h2>
        <p id={descriptionId} className="aly-onboarding-tour__description">{step.description}</p>
        {targetMissing ? <p className="aly-onboarding-tour__notice" role="status">This area is not available on the current screen. You can continue safely.</p> : null}
        <div className="aly-onboarding-tour__actions">
          <button type="button" className="aly-onboarding-tour__exit" onClick={onExit}>Exit tour</button>
          <div className="aly-onboarding-tour__navigation">
            <button type="button" className="aly-onboarding-tour__back" disabled={index === 0} onClick={() => onActiveIndexChange(index - 1)}>Back</button>
            <button type="button" className="aly-onboarding-tour__next" onClick={() => finalStep ? onComplete() : onActiveIndexChange(index + 1)}>
              {finalStep ? "Finish tour" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
