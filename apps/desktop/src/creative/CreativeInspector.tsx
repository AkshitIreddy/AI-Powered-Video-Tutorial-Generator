import { useState } from "react";
import { Aperture, Boxes, Eye, Image, Layers3, ScanLine, SlidersHorizontal, UserRoundCheck, WandSparkles } from "lucide-react";
import type { CreativeConfiguration } from "../types";

interface CreativeInspectorProps {
  configuration: CreativeConfiguration;
  onChange: (configuration: CreativeConfiguration) => void;
  onQueueVisualReview: () => void;
  onGeneratePresenter: () => void;
}

export function CreativeInspector({ configuration, onChange, onQueueVisualReview, onGeneratePresenter }: CreativeInspectorProps) {
  const [tab, setTab] = useState<"slides" | "presenter">("slides");
  const updateSlide = (patch: Partial<CreativeConfiguration["slide"]>) => onChange({ ...configuration, slide: { ...configuration.slide, ...patch } });
  const updatePresenter = (patch: Partial<CreativeConfiguration["presenter"]>) => onChange({ ...configuration, presenter: { ...configuration.presenter, ...patch } });

  return <div className="creative-inspector">
    <div className="creative-inspector__tabs" role="tablist" aria-label="Creative generation controls">
      <button role="tab" aria-selected={tab === "slides"} className={tab === "slides" ? "active" : ""} onClick={() => setTab("slides")}><Layers3 size={15} /> Slides</button>
      <button role="tab" aria-selected={tab === "presenter"} className={tab === "presenter" ? "active" : ""} onClick={() => setTab("presenter")}><UserRoundCheck size={15} /> Presenter lab</button>
    </div>

    {tab === "slides" ? <div className="creative-inspector__body">
      <section className="creative-control-card creative-mode-card">
        <span className="section-kicker">Two visual schools</span>
        <div className="creative-mode-grid">
          <button className={configuration.slide.mode === "designed" ? "active" : ""} onClick={() => updateSlide({ mode: "designed" })}><Boxes size={19} /><strong>Designed layout</strong><small>Semantic cards, exact typography and editable geometry.</small></button>
          <button className={configuration.slide.mode === "illustrated" ? "active" : ""} onClick={() => updateSlide({ mode: "illustrated" })}><Image size={19} /><strong>Illustrated canvas</strong><small>Generated artwork under deterministic text and safe-area layers.</small></button>
        </div>
      </section>

      {configuration.slide.mode === "designed" ? <>
        <ControlSelect label="Layout system" value={configuration.slide.layoutSystem} onChange={(value) => updateSlide({ layoutSystem: value as CreativeConfiguration["slide"]["layoutSystem"] })} options={["editorial-grid", "teaching-cards", "cinematic", "custom"]} />
        <ControlSelect label="Information density" value={configuration.slide.density} onChange={(value) => updateSlide({ density: value as CreativeConfiguration["slide"]["density"] })} options={["focused", "balanced", "dense"]} />
        <Toggle checked={configuration.slide.alignmentGuides} label="Alignment and optical-centering guides" detail="Detect overlap, drift, uneven padding and off-center card content." onChange={(alignmentGuides) => updateSlide({ alignmentGuides })} />
        <Toggle checked={configuration.slide.safeAreas} label="Caption, presenter and title safe areas" detail="Reserve composition space before content is laid out." onChange={(safeAreas) => updateSlide({ safeAreas })} />
      </> : <>
        <ControlInput label="Image model route" value={configuration.slide.imageModel} onChange={(imageModel) => updateSlide({ imageModel })} hint="Search Hugging Face, Civitai, NVIDIA NIM, connected APIs or local installs in Models & providers." />
        <ControlInput label="LoRA stack" value={configuration.slide.loras.join(", ")} onChange={(value) => updateSlide({ loras: list(value) })} hint="Comma-separated, ordered, revision-pinned adapters." />
        <ControlInput label="Control / reference adapter" value={configuration.slide.controlAdapter} onChange={(controlAdapter) => updateSlide({ controlAdapter })} />
        <RangeControl label="Reference strength" value={configuration.slide.referenceStrength} min={0} max={100} suffix="%" onChange={(referenceStrength) => updateSlide({ referenceStrength })} />
        <ControlInput label="Seed" value={String(configuration.slide.seed)} onChange={(value) => updateSlide({ seed: Number.parseInt(value, 10) || 0 })} />
        <Toggle checked={configuration.slide.inpaintEnabled} label="Inpaint repair pass" detail="Mask only the rejected region; preserve accepted pixels and seed." onChange={(inpaintEnabled) => updateSlide({ inpaintEnabled })} />
        <ControlInput label="Upscale route" value={configuration.slide.upscaleModel} onChange={(upscaleModel) => updateSlide({ upscaleModel })} />
        <Toggle checked={configuration.slide.authoritativeTextLayer} label="Keep text deterministic" detail="AI artwork never rasterizes titles, equations, captions or citations." onChange={(authoritativeTextLayer) => updateSlide({ authoritativeTextLayer })} />
      </>}

      <section className="creative-control-card review-loop-card">
        <div><span className="section-kicker"><Eye size={13} /> Visual QA loop</span><h4>Review, propose, patch—never silently overwrite.</h4><p>Render the scene, ask the selected vision model for structured findings, and cap automatic patch proposals before a human accepts them.</p></div>
        <ControlInput label="Vision review model" value={configuration.slide.visualReviewModel} onChange={(visualReviewModel) => updateSlide({ visualReviewModel })} />
        <RangeControl label="Maximum patch proposals" value={configuration.slide.patchLimit} min={1} max={8} suffix="" onChange={(patchLimit) => updateSlide({ patchLimit })} />
        <button className="primary-button full" onClick={onQueueVisualReview}><ScanLine size={15} /> Queue visual review</button>
      </section>
    </div> : <div className="creative-inspector__body">
      <section className="creative-control-card presenter-workflow-card">
        <span className="section-kicker">Composable portrait workflow</span>
        <div className="segmented-creative" role="group" aria-label="Presenter generation workflow">
          {(["guided", "advanced", "graph"] as const).map((workflow) => <button className={configuration.presenter.workflow === workflow ? "active" : ""} key={workflow} onClick={() => updatePresenter({ workflow })}>{workflow}</button>)}
        </div>
        <p>{configuration.presenter.workflow === "guided" ? "The app chooses a compatible base, identity reference, detailer and upscaler while showing every choice." : configuration.presenter.workflow === "advanced" ? "Tune every adapter and refinement stage directly." : "Build a node graph with explicit inputs, masks, revisions and outputs."}</p>
      </section>
      <ControlInput label="Base model route" value={configuration.presenter.baseModel} onChange={(baseModel) => updatePresenter({ baseModel })} hint="Local checkpoint, Hugging Face/Civitai revision, NIM endpoint or connected image API." />
      <ControlInput label="Visual style" value={configuration.presenter.style} onChange={(style) => updatePresenter({ style })} />
      <label className="creative-field"><span>Portrait direction</span><textarea rows={4} value={configuration.presenter.prompt} onChange={(event) => updatePresenter({ prompt: event.target.value })} /></label>
      <label className="creative-field"><span>Negative direction</span><textarea rows={3} value={configuration.presenter.negativePrompt} onChange={(event) => updatePresenter({ negativePrompt: event.target.value })} /></label>
      <ControlInput label="LoRA stack" value={configuration.presenter.loras.join(", ")} onChange={(value) => updatePresenter({ loras: list(value) })} hint="Each adapter should retain source, license, weight and immutable revision." />
      <ControlInput label="Control pipeline" value={configuration.presenter.controlAdapter} onChange={(controlAdapter) => updatePresenter({ controlAdapter })} />
      <Toggle checked={configuration.presenter.referenceImageEnabled} label="Use an identity reference" detail="Reference images remain consent- and provenance-gated." onChange={(referenceImageEnabled) => updatePresenter({ referenceImageEnabled })} />
      <Toggle checked={configuration.presenter.faceDetailer} label="Face detail repair" detail="A bounded region pass after the base generation." onChange={(faceDetailer) => updatePresenter({ faceDetailer })} />
      <Toggle checked={configuration.presenter.inpaintEnabled} label="Mask and inpaint tools" detail="Repair hair, mouth, hands or wardrobe without replacing the whole portrait." onChange={(inpaintEnabled) => updatePresenter({ inpaintEnabled })} />
      <ControlInput label="Upscale route" value={configuration.presenter.upscaleModel} onChange={(upscaleModel) => updatePresenter({ upscaleModel })} />
      <Toggle checked={configuration.presenter.provenanceRequired} label="Require provenance before animation" detail="Store prompt, seed, revisions, rights and consent with the accepted portrait." onChange={(provenanceRequired) => updatePresenter({ provenanceRequired })} />
      <button className="primary-button full" onClick={onGeneratePresenter}><WandSparkles size={15} /> Create presenter candidate</button>
      <div className="creative-safety-note"><Aperture size={17} /><span><strong>Animation-safe framing</strong><small>Front-facing adult, visible mouth and chin, no celebrity likeness, no unsupported identity claim.</small></span></div>
    </div>}
  </div>;
}

function ControlInput({ label, value, onChange, hint }: { label: string; value: string; onChange: (value: string) => void; hint?: string }) {
  return <label className="creative-field"><span>{label}</span><input value={value} onChange={(event) => onChange(event.target.value)} />{hint && <small>{hint}</small>}</label>;
}

function ControlSelect({ label, value, options, onChange }: { label: string; value: string; options: readonly string[]; onChange: (value: string) => void }) {
  return <label className="creative-field"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option}>{option}</option>)}</select></label>;
}

function RangeControl({ label, value, min, max, suffix, onChange }: { label: string; value: number; min: number; max: number; suffix: string; onChange: (value: number) => void }) {
  return <label className="creative-field creative-range"><span>{label}<b>{value}{suffix}</b></span><input type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

function Toggle({ checked, label, detail, onChange }: { checked: boolean; label: string; detail: string; onChange: (checked: boolean) => void }) {
  return <label className="creative-toggle"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span><strong>{label}</strong><small>{detail}</small></span><SlidersHorizontal size={15} /></label>;
}

function list(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}
