import { useState } from "react";
import { Check, Search, Users, VideoOff, X } from "lucide-react";
import type { PresenterSelection } from "./types";
import "./PresenterPicker.css";

export type PresenterStyleGroup = "Realistic" | "Anime" | "Cartoon" | "Illustration" | "Character" | "Animal" | "Other";

export interface PresenterChoice {
  id: string;
  label: string;
  src: string;
  focalPoint: string;
  style?: string;
  background?: string;
  styleGroup?: PresenterStyleGroup;
  filterTags?: readonly string[];
  featuredRank?: number;
}

const STYLE_FILTERS: ReadonlyArray<{ value: "All styles" | PresenterStyleGroup; label: string }> = [
  { value: "All styles", label: "All styles" },
  { value: "Realistic", label: "Realistic" },
  { value: "Anime", label: "Anime" },
  { value: "Cartoon", label: "Cartoon" },
  { value: "Illustration", label: "Illustration" },
  { value: "Character", label: "Characters" },
  { value: "Animal", label: "Animals" },
  { value: "Other", label: "Other styles" },
];

export function PresenterPicker({ choices, value, onChange }: {
  choices: PresenterChoice[];
  value: PresenterSelection;
  onChange: (next: PresenterSelection) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"All styles" | PresenterStyleGroup>("All styles");
  const selectedIds = new Set(value.presenters.map((entry) => entry.portraitAssetId));
  const visible = choices.filter((choice) => {
    const searchable = `${choice.label} ${choice.style ?? ""} ${choice.background ?? ""} ${(choice.filterTags ?? []).join(" ")}`.toLowerCase();
    return searchable.includes(query.trim().toLowerCase()) && (filter === "All styles" || (choice.styleGroup ?? "Other") === filter);
  });
  const toggle = (id: string) => {
    const removing = selectedIds.has(id);
    if (!removing && value.presenters.length >= 4) return;
    onChange({ ...value, mode: "on", presenters: removing
      ? value.presenters.filter((entry) => entry.portraitAssetId !== id)
      : [...value.presenters, { presenterId: id, portraitAssetId: id }],
    sceneAssignments: removing ? value.sceneAssignments.filter((entry) => entry.presenterId !== id) : value.sceneAssignments });
  };
  return <section className="presenter-picker" aria-label="Choose your presenters">
    <div className="presenter-picker__modes" role="group" aria-label="Presenter mode">
      <button type="button" aria-pressed={value.mode === "off"} onClick={() => onChange({ ...value, mode: "off", sceneAssignments: [] })}><VideoOff size={20} /><span><strong>Just the lesson</strong><small>Visuals and narration, without an on-screen presenter.</small></span></button>
      <button type="button" aria-pressed={value.mode !== "off"} onClick={() => onChange({ ...value, mode: "on" })}><Users size={20} /><span><strong>Choose a cast</strong><small>One teacher or up to four speakers across your scenes.</small></span></button>
    </div>
    {value.mode !== "off" && <>
      <div className="presenter-picker__toolbar"><label><Search size={17} /><input aria-label="Search presenters" placeholder="Search names, styles, or settings" value={query} onChange={(event) => setQuery(event.target.value)} /></label><select aria-label="Presenter visual style" value={filter} onChange={(event) => setFilter(event.target.value as "All styles" | PresenterStyleGroup)}>{STYLE_FILTERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
      <div className="presenter-picker__gallery">{visible.map((choice) => <button type="button" key={choice.id} className={selectedIds.has(choice.id) ? "selected" : ""} aria-pressed={selectedIds.has(choice.id)} disabled={!selectedIds.has(choice.id) && value.presenters.length >= 4} aria-label={`Select ${choice.label}`} onClick={() => toggle(choice.id)}><img src={choice.src} alt="" loading="lazy" decoding="async" style={{ objectPosition: choice.focalPoint }} /><span className="presenter-picker__identity"><strong>{choice.label}</strong><small>{choice.background ?? choice.style ?? "Included fictional presenter"}</small></span><span className="presenter-picker__check" aria-hidden="true">{selectedIds.has(choice.id) && <Check size={15} />}</span></button>)}</div>
      {visible.length === 0 && <p role="status">No matching presenters. Try another name or style.</p>}
      <div className="presenter-picker__cast" aria-live="polite"><strong>{value.presenters.length ? `${value.presenters.length} ${value.presenters.length === 1 ? "presenter" : "presenters"} selected` : "Select at least one presenter to continue"}</strong><p>Speakers take turns across scenes, with at least one scene for every selected presenter. You can change each scene’s speaker before generation. This does not place several faces on screen at once.</p></div>
      {value.presenters.map((entry) => <div className="presenter-picker__voice" key={entry.presenterId}><span>{choices.find((choice) => choice.id === entry.portraitAssetId)?.label ?? entry.presenterId}</span><label>Voice override<input aria-label={`Voice for ${choices.find((choice) => choice.id === entry.portraitAssetId)?.label ?? entry.presenterId}`} placeholder="Use the selected narration voice" value={entry.voiceId ?? ""} onChange={(event) => onChange({ ...value, presenters: value.presenters.map((speaker) => speaker.presenterId === entry.presenterId ? { ...speaker, voiceId: event.target.value } : speaker) })} /><small>Optional voice name or ID from your narration provider.</small></label><button type="button" className="icon-button" aria-label={`Remove ${choices.find((choice) => choice.id === entry.portraitAssetId)?.label ?? entry.presenterId}`} onClick={() => toggle(entry.portraitAssetId)}><X size={16} /></button></div>)}
    </>}
  </section>;
}
