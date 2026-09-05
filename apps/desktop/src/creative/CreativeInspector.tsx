import { useState } from "react";
import { Aperture, Boxes, Image, Layers3, SlidersHorizontal, UserRoundCheck, WandSparkles } from "lucide-react";
import type { CreativeConfiguration } from "../types";

const SDXL_MODEL_ID = "local/sdxl-base-1.0";
const SDXL_OFFSET_LORA_ID = "local/sdxl-offset-lora-1.0";
const TUTORIAL_IMAGE_ROUTE = "tutorial-route";

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
      <button role="tab" aria-selected={tab === "presenter"} className={tab === "presenter" ? "active" : ""} onClick={() => setTab("presenter")}><UserRoundCheck size={15} /> Presenter recipe</button>
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
        <section className="creative-control-card"><span className="section-kicker">Designed scene</span><h4>Edit the authored layout in Design.</h4><p>Typography, colors, presenter placement and safe areas are applied by the real scene controls in the Design panel.</p></section>
      </> : <>
        <ImageModelSelect label="Image route" value={configuration.slide.imageModel} onChange={(imageModel) => updateSlide({ imageModel, ...(imageModel === SDXL_MODEL_ID ? {} : { loras: [] }) })} />
        <label className="creative-field"><span>Artwork direction</span><textarea rows={4} value={configuration.slide.prompt} onChange={(event) => updateSlide({ prompt: event.target.value })} /><small>Describe the background or visual metaphor. Titles, equations, captions and citations are added as editable app text.</small></label>
        <Toggle disabled={configuration.slide.imageModel !== SDXL_MODEL_ID} checked={configuration.slide.imageModel === SDXL_MODEL_ID && configuration.slide.loras.includes(SDXL_OFFSET_LORA_ID)} label="Official SDXL offset LoRA" detail="Optional pinned adapter at its measured 0.35 strength; available only for local SDXL." onChange={(enabled) => updateSlide({ loras: enabled ? [SDXL_OFFSET_LORA_ID] : [] })} />
        <ControlInput label="Seed" value={String(configuration.slide.seed)} onChange={(value) => updateSlide({ seed: seed(value) })} hint="The exact seed is sent to the selected image route and stored with the candidate." />
        <div className="creative-safety-note"><Aperture size={17} /><span><strong>Editable text stays authoritative</strong><small>Generated artwork cannot replace titles, equations, captions or citations.</small></span></div>
        <button className="primary-button full" onClick={onQueueVisualReview}><WandSparkles size={15} /> Generate scene artwork</button>
      </>}
    </div> : <div className="creative-inspector__body">
      <section className="creative-control-card presenter-workflow-card">
        <span className="section-kicker">Portrait generation</span>
        <h4>Generate a review candidate with the selected image route.</h4>
        <p>The portrait stays separate from the accepted presenter until you review and choose it.</p>
      </section>
      <ImageModelSelect label="Image route" value={configuration.presenter.baseModel} onChange={(baseModel) => updatePresenter({ baseModel, ...(baseModel === SDXL_MODEL_ID ? {} : { loras: [] }) })} />
      <label className="creative-field"><span>Portrait direction</span><textarea rows={4} value={configuration.presenter.prompt} onChange={(event) => updatePresenter({ prompt: event.target.value })} /></label>
      {configuration.presenter.baseModel === SDXL_MODEL_ID && <label className="creative-field"><span>Negative direction</span><textarea rows={3} value={configuration.presenter.negativePrompt} onChange={(event) => updatePresenter({ negativePrompt: event.target.value })} /><small>This local SDXL recipe sends the negative direction exactly as written.</small></label>}
      <Toggle disabled={configuration.presenter.baseModel !== SDXL_MODEL_ID} checked={configuration.presenter.baseModel === SDXL_MODEL_ID && configuration.presenter.loras.includes(SDXL_OFFSET_LORA_ID)} label="Official SDXL offset LoRA" detail="Optional pinned adapter at its measured 0.35 strength; available only for local SDXL." onChange={(enabled) => updatePresenter({ loras: enabled ? [SDXL_OFFSET_LORA_ID] : [] })} />
      <ControlInput label="Seed" value={String(configuration.presenter.seed)} onChange={(value) => updatePresenter({ seed: seed(value) })} hint="The exact seed is sent to the selected image route and stored with the candidate." />
      <button className="primary-button full" onClick={onGeneratePresenter}><WandSparkles size={15} /> Generate presenter portrait</button>
      <div className="creative-safety-note"><Aperture size={17} /><span><strong>Animation-ready target</strong><small>Front-facing adult, visible mouth and chin, no celebrity likeness, no unsupported identity claim. Prompt, model, LoRA, seed and license are stored with the candidate.</small></span></div>
    </div>}
  </div>;
}

function ControlInput({ label, value, onChange, hint }: { label: string; value: string; onChange: (value: string) => void; hint?: string }) {
  return <label className="creative-field"><span>{label}</span><input value={value} onChange={(event) => onChange(event.target.value)} />{hint && <small>{hint}</small>}</label>;
}

function ImageModelSelect({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const selected = value === SDXL_MODEL_ID ? SDXL_MODEL_ID : TUTORIAL_IMAGE_ROUTE;
  return <label className="creative-field"><span>{label}</span><select value={selected} onChange={(event) => onChange(event.target.value)}><option value={TUTORIAL_IMAGE_ROUTE}>Use tutorial image route</option><option value={SDXL_MODEL_ID}>Local SDXL 1.0</option></select><small>The tutorial route uses the connected provider chosen in Models &amp; providers.</small></label>;
}

function Toggle({ checked, label, detail, onChange, disabled = false }: { checked: boolean; label: string; detail: string; onChange: (checked: boolean) => void; disabled?: boolean }) {
  return <label className="creative-toggle"><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} /><span><strong>{label}</strong><small>{detail}</small></span><SlidersHorizontal size={15} /></label>;
}

function seed(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}
