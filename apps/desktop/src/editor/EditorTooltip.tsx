import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";

export type EditorTooltipPlacement = "above" | "below";

interface EditorTooltipBoxProps {
  anchor: HTMLElement | null;
  describedBy: string;
  placement: EditorTooltipPlacement;
  onMeasuredPlacement: (placement: EditorTooltipPlacement, left: number, top: number) => void;
  measured: { left: number; top: number } | null;
  children: ReactNode;
}

function EditorTooltipBox({ anchor, describedBy, placement, onMeasuredPlacement, measured, children }: EditorTooltipBoxProps) {
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const box = boxRef.current;
    const boxHeight = box?.offsetHeight ?? 48;
    const boxWidth = Math.min(264, box?.offsetWidth ?? 220);
    const wantAbove = placement === "above";
    const fitsAbove = rect.top >= boxHeight + 16;
    const nextPlacement: EditorTooltipPlacement = wantAbove && !fitsAbove ? "below" : !wantAbove && rect.bottom + boxHeight + 16 > window.innerHeight && rect.top >= boxHeight + 16 ? "above" : placement;
    const top = nextPlacement === "above" ? Math.max(8, rect.top - boxHeight - 10) : Math.min(window.innerHeight - boxHeight - 8, rect.bottom + 10);
    const left = Math.max(8, Math.min(window.innerWidth - boxWidth - 8, rect.left + rect.width / 2 - boxWidth / 2));
    onMeasuredPlacement(nextPlacement, left, top);
  }, [anchor, describedBy, placement, onMeasuredPlacement]);

  return (
    <div
      ref={boxRef}
      id={describedBy}
      role="tooltip"
      data-placement={measured ? placement : undefined}
      className="aly-editor-tooltip"
      style={measured ? { left: measured.left, top: measured.top, visibility: "visible" } : { visibility: "hidden" }}
    >
      {children}
    </div>
  );
}

export interface EditorTooltipProps {
  description: ReactNode;
  shortcut?: string | undefined;
  disabledReason?: string | undefined;
  disabled?: boolean | undefined;
  placement?: EditorTooltipPlacement | undefined;
  children: (anchor: { ref: (element: HTMLElement | null) => void; describedBy: string | undefined; handlers: {
    onMouseEnter: () => void;
    onMouseLeave: () => void;
    onFocus: () => void;
    onBlur: () => void;
    onKeyDown: (event: React.KeyboardEvent) => void;
  } }) => ReactNode;
}

export function EditorTooltip({ description, shortcut, disabledReason, disabled, placement = "above", children }: EditorTooltipProps) {
  const describedBy = useId();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [measured, setMeasured] = useState<{ left: number; top: number } | null>(null);
  const [livePlacement, setLivePlacement] = useState<EditorTooltipPlacement>(placement);
  const hoverTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
  }, []);

  useEffect(() => {
    if (!open) {
      setMeasured(null);
      setLivePlacement(placement);
      return;
    }
    const hideOnScroll = () => setOpen(false);
    window.addEventListener("scroll", hideOnScroll, true);
    window.addEventListener("resize", hideOnScroll);
    return () => {
      window.removeEventListener("scroll", hideOnScroll, true);
      window.removeEventListener("resize", hideOnScroll);
    };
  }, [open, placement]);

  const showSoon = (immediate: boolean) => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    if (immediate) {
      setOpen(true);
      return;
    }
    hoverTimer.current = window.setTimeout(() => setOpen(true), 220);
  };
  const hide = () => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    setOpen(false);
  };

  const body = (
    <>
      <span className="aly-editor-tooltip__body">{description}</span>
      {shortcut ? <kbd className="aly-editor-tooltip__shortcut">{shortcut}</kbd> : null}
      {disabled && disabledReason ? <span className="aly-editor-tooltip__disabled">{disabledReason}</span> : null}
    </>
  );

  return (
    <>
      {children({
        ref: setAnchor,
        describedBy: open ? describedBy : undefined,
        handlers: {
          onMouseEnter: () => showSoon(false),
          onMouseLeave: hide,
          onFocus: () => showSoon(true),
          onBlur: hide,
          onKeyDown: (event) => {
            if (event.key === "Escape") hide();
          },
        },
      })}
      {open && typeof document !== "undefined"
        ? createPortal(
            <EditorTooltipBox
              anchor={anchor}
              describedBy={describedBy}
              placement={livePlacement}
              measured={measured}
              onMeasuredPlacement={(nextPlacement, left, top) => {
                setLivePlacement((current) => (current === nextPlacement ? current : nextPlacement));
                setMeasured((current) => (current && current.left === left && current.top === top ? current : { left, top }));
              }}
            >
              {body}
            </EditorTooltipBox>,
            document.body,
          )
        : null}
    </>
  );
}

export interface EditorIconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "title"> {
  icon: LucideIcon;
  label: string;
  tooltip: ReactNode;
  shortcut?: string | undefined;
  disabledReason?: string | undefined;
  pressed?: boolean | undefined;
  iconSize?: number | undefined;
}

export function EditorIconButton({
  icon: Icon,
  label,
  tooltip,
  shortcut,
  disabledReason,
  pressed,
  iconSize = 16,
  disabled,
  className = "",
  ...buttonProps
}: EditorIconButtonProps) {
  return (
    <EditorTooltip description={tooltip} shortcut={shortcut} disabled={disabled} disabledReason={disabledReason}>
      {({ ref, describedBy, handlers }) => (
        <span
          className="aly-editor-iconbtn-wrap"
          ref={ref}
          {...(disabled ? { tabIndex: 0, role: "group", "aria-label": label, "aria-disabled": true, "aria-describedby": describedBy } : {})}
          onMouseEnter={handlers.onMouseEnter}
          onMouseLeave={handlers.onMouseLeave}
          onFocus={handlers.onFocus}
          onBlur={handlers.onBlur}
          onKeyDown={handlers.onKeyDown}
        >
          <button
            type="button"
            {...buttonProps}
            aria-label={label}
            aria-describedby={disabled ? undefined : describedBy}
            aria-pressed={pressed}
            disabled={disabled}
            className={`aly-editor-iconbtn${pressed ? " is-pressed" : ""}${className ? ` ${className}` : ""}`}
          >
            <Icon size={iconSize} aria-hidden="true" />
          </button>
        </span>
      )}
    </EditorTooltip>
  );
}
