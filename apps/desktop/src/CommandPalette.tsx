import {
  Cpu,
  Film,
  FolderClock,
  Home,
  Library,
  Search,
  Settings2,
  SquareStack,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState, type KeyboardEvent } from "react";
import type { GlobalArea, ProjectRecord } from "./types";
import "./workbenchControls.css";

const PRODUCT_NAME = "AI Video Tutorial Generator";

const globalDestinations: ReadonlyArray<{ id: GlobalArea; label: string; icon: LucideIcon }> = [
  { id: "home", label: "Home", icon: Home },
  { id: "projects", label: "Projects", icon: FolderClock },
  { id: "templates", label: "Templates", icon: SquareStack },
  { id: "library", label: "Library", icon: Library },
  { id: "providers", label: "Models & providers", icon: Cpu },
  { id: "diagnostics", label: "Settings & diagnostics", icon: Settings2 },
];

type CommandResult =
  | { kind: "project"; project: ProjectRecord }
  | { kind: "destination"; destination: (typeof globalDestinations)[number] };

export interface CommandPaletteProps {
  projects: ProjectRecord[];
  onClose: () => void;
  onNavigate: (area: GlobalArea) => void;
  onOpen: (id: string) => void;
}

export function CommandPalette({ projects, onClose, onNavigate, onOpen }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredProjects = useMemo(
    () => projects.filter((project) => `${project.title} ${project.topic}`.toLocaleLowerCase().includes(normalizedQuery)),
    [normalizedQuery, projects],
  );
  const filteredDestinations = useMemo(
    () => globalDestinations.filter((item) => item.label.toLocaleLowerCase().includes(normalizedQuery)),
    [normalizedQuery],
  );
  const results = useMemo<CommandResult[]>(() => [
    ...filteredProjects.map((project) => ({ kind: "project" as const, project })),
    ...filteredDestinations.map((destination) => ({ kind: "destination" as const, destination })),
  ], [filteredDestinations, filteredProjects]);
  const selectedIndex = results.length ? Math.min(activeIndex, results.length - 1) : -1;
  const selectedId = selectedIndex >= 0 ? `command-result-${selectedIndex}` : undefined;

  const run = (result: CommandResult | undefined) => {
    if (!result) return;
    if (result.kind === "project") onOpen(result.project.id);
    else onNavigate(result.destination.id);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (!results.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex(selectedIndex >= results.length - 1 ? 0 : selectedIndex + 1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex(selectedIndex <= 0 ? results.length - 1 : selectedIndex - 1);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(results.length - 1);
      return;
    }
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      run(results[selectedIndex]);
    }
  };

  let optionIndex = 0;
  return (
    <div className="command-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="command-palette" role="dialog" aria-modal="true" aria-label="Search projects and areas">
        <label>
          <Search size={19} />
          <input
            autoFocus
            role="combobox"
            aria-label="Search projects and areas"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls="command-results"
            aria-activedescendant={selectedId}
            placeholder="Search projects or go to an area…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleKeyDown}
          />
          <kbd aria-hidden="true">esc</kbd>
        </label>
        <div id="command-results" className="command-results" role="listbox" aria-label="Command results">
          <small role="presentation">Projects</small>
          {filteredProjects.map((project) => {
            const index = optionIndex++;
            const selected = index === selectedIndex;
            return (
              <button
                id={`command-result-${index}`}
                key={`project-${project.id}`}
                type="button"
                role="option"
                aria-selected={selected}
                className={selected ? "active" : ""}
                tabIndex={-1}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => run({ kind: "project", project })}
              >
                <span className="command-icon"><Film size={16} /></span>
                <span><strong>{project.title}</strong><small>{project.status} · {project.updatedAt}</small></span>
                {selected && <kbd aria-hidden="true">↵</kbd>}
              </button>
            );
          })}
          <small role="presentation">Go to</small>
          {filteredDestinations.map((destination) => {
            const index = optionIndex++;
            const selected = index === selectedIndex;
            const Icon = destination.icon;
            return (
              <button
                id={`command-result-${index}`}
                key={`destination-${destination.id}`}
                type="button"
                role="option"
                aria-selected={selected}
                className={selected ? "active" : ""}
                tabIndex={-1}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => run({ kind: "destination", destination })}
              >
                <span className="command-icon"><Icon size={16} /></span>
                <span><strong>{destination.label}</strong><small>{PRODUCT_NAME} area</small></span>
                {selected && <kbd aria-hidden="true">↵</kbd>}
              </button>
            );
          })}
          {!results.length && <p className="command-results-empty" role="status">No projects or areas match “{query}”.</p>}
        </div>
      </div>
    </div>
  );
}

export default CommandPalette;
