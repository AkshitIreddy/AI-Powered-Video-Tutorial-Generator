import { ChevronDown } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import "./workbenchControls.css";

export interface InspectorSectionProps {
  title: string;
  children: ReactNode;
}

export function InspectorSection({ title, children }: InspectorSectionProps) {
  const [expanded, setExpanded] = useState(true);
  const generatedId = useId();
  const sectionId = `inspector-section-${generatedId.replaceAll(":", "")}`;
  const headingId = `${sectionId}-heading`;

  return (
    <section className="inspector-section" aria-labelledby={headingId}>
      <button
        id={headingId}
        type="button"
        className="inspector-section-title"
        aria-expanded={expanded}
        aria-controls={sectionId}
        onClick={() => setExpanded((current) => !current)}
      >
        <strong>{title}</strong>
        <ChevronDown className={expanded ? "expanded" : ""} size={14} aria-hidden="true" />
      </button>
      <div id={sectionId} className="inspector-section-content" hidden={!expanded}>{children}</div>
    </section>
  );
}

export default InspectorSection;
