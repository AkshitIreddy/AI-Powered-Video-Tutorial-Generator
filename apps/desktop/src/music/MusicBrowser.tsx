import { Check, ExternalLink, LoaderCircle, Music2, Pause, Play, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { MusicCandidate, MusicMood } from "./types";
import "./music.css";

const moodOptions: ReadonlyArray<{ id: MusicMood; label: string }> = [
  { id: "curious", label: "Curious" },
  { id: "focused", label: "Focused" },
  { id: "calm", label: "Calm" },
  { id: "hopeful", label: "Hopeful" },
  { id: "playful", label: "Playful" },
  { id: "reflective", label: "Reflective" },
  { id: "energetic", label: "Energetic" },
];

export interface MusicBrowserProps {
  topic: string;
  candidates: readonly MusicCandidate[];
  busy?: boolean;
  onSearch: (input: { topic: string; mood: MusicMood; alternatives: number }) => void | Promise<void>;
  onAccept: (candidate: MusicCandidate) => void | Promise<void>;
  onReject: (candidate: MusicCandidate) => void | Promise<void>;
  resolvePreview?: (candidate: MusicCandidate) => Promise<string>;
}

function durationLabel(seconds: number | null): string {
  if (seconds === null) return "Duration unavailable";
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export function MusicBrowser({ topic, candidates, busy = false, onSearch, onAccept, onReject, resolvePreview }: MusicBrowserProps) {
  const [query, setQuery] = useState(topic);
  const [mood, setMood] = useState<MusicMood>("curious");
  const [preview, setPreview] = useState<{ id: string; url: string } | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => setQuery(topic), [topic]);
  useEffect(() => () => {
    audioRef.current?.pause();
  }, []);

  const togglePreview = async (candidate: MusicCandidate) => {
    if (preview?.id === candidate.id && audioRef.current) {
      if (audioRef.current.paused) await audioRef.current.play();
      else audioRef.current.pause();
      setPreviewing(audioRef.current.paused ? null : candidate.id);
      return;
    }
    if (!resolvePreview) return;
    audioRef.current?.pause();
    const url = await resolvePreview(candidate);
    const audio = new Audio(url);
    audio.volume = 0.28;
    audio.onended = () => setPreviewing(null);
    audio.onpause = () => setPreviewing(null);
    audioRef.current = audio;
    setPreview({ id: candidate.id, url });
    await audio.play();
    setPreviewing(candidate.id);
  };

  const ready = candidates.filter((candidate) => candidate.status === "ready");
  const accepted = candidates.find((candidate) => candidate.status === "accepted");

  return <section className="music-browser" aria-label="Find background music">
    <header className="music-browser__header">
      <div><span className="section-kicker">Optional soundtrack</span><h4><Music2 size={17} /> Find a music bed</h4></div>
      <span className="music-browser__source">Openverse · CC0 / CC BY</span>
    </header>
    <p className="music-browser__intro">Search openly licensed instrumental tracks for this tutorial. Results are downloaded into the project for review; nothing replaces the current music until you choose it.</p>
    <label className="music-browser__query"><span>Tutorial topic or musical direction</span><input value={query} maxLength={240} onChange={(event) => setQuery(event.target.value)} placeholder="e.g. curious astronomy, gentle technology" /></label>
    <div className="music-browser__moods" role="group" aria-label="Music mood">
      {moodOptions.map((option) => <button key={option.id} type="button" className={mood === option.id ? "active" : ""} aria-pressed={mood === option.id} onClick={() => setMood(option.id)}>{option.label}</button>)}
    </div>
    <button className="primary-button music-browser__search" type="button" disabled={busy || !query.trim()} onClick={() => { void onSearch({ topic: query.trim(), mood, alternatives: 3 }); }}>
      {busy ? <LoaderCircle className="spin" size={15} /> : <Search size={15} />}{busy ? "Searching and checking licenses…" : "Find free music"}
    </button>
    {accepted && <div className="music-browser__accepted"><Check size={15} /><span><strong>{accepted.title}</strong> is selected. Its attribution will travel with the project and export manifest.</span></div>}
    {ready.length > 0 && <div className="music-browser__results" aria-label="Music candidates">
      {ready.map((candidate, index) => <article className="music-browser__candidate" key={candidate.id}>
        <div className="music-browser__rank">{String(index + 1).padStart(2, "0")}</div>
        <div className="music-browser__candidate-copy">
          <strong>{candidate.title}</strong>
          <span>{candidate.creator} · {durationLabel(candidate.durationSeconds)} · {candidate.license}</span>
          <details className="music-browser__provenance"><summary>Rights &amp; source</summary><small>{candidate.attribution}</small><div className="music-browser__links"><a href={candidate.sourceUrl} target="_blank" rel="noreferrer">Source <ExternalLink size={12} /></a><a href={candidate.licenseUrl} target="_blank" rel="noreferrer">License <ExternalLink size={12} /></a></div></details>
        </div>
        <div className="music-browser__actions">
          <button type="button" className="music-browser__icon-action" disabled={!resolvePreview} aria-label={`${previewing === candidate.id ? "Pause" : "Preview"} ${candidate.title}`} data-tooltip={previewing === candidate.id ? "Pause preview" : "Preview track"} onClick={() => { void togglePreview(candidate); }}>{previewing === candidate.id ? <Pause size={16} /> : <Play size={16} />}</button>
          <button type="button" className="music-browser__icon-action" aria-label={`Skip ${candidate.title}`} data-tooltip="Skip this track" onClick={() => { void onReject(candidate); }}><X size={15} /></button>
          <button type="button" className="music-browser__icon-action music-browser__icon-action--primary" aria-label={`Use ${candidate.title}`} data-tooltip="Use this track" onClick={() => { void onAccept(candidate); }}><Check size={15} /></button>
        </div>
      </article>)}
    </div>}
    <p className="music-browser__rights">Openverse indexes third-party license claims. Confirm the source page and creator before publishing; Alystria preserves both links and blocks licenses with noncommercial or no-derivatives terms.</p>
  </section>;
}
