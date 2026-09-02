import { Activity, Cpu, Gauge, HardDrive, MemoryStick, ShieldCheck, Thermometer } from "lucide-react";
import { createCustomResourcePolicy, formatBytes, normalizeResourcePolicy, resourcePolicyPresets } from "./resourcePolicy";
import type { HardwareSnapshot, ResourcePolicy } from "./types";

export interface ResourcePolicySettingsProps {
  policy: ResourcePolicy;
  hardware: HardwareSnapshot;
  onChange: (policy: ResourcePolicy) => void;
}

function numberValue(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function ResourcePolicySettings({ policy, hardware, onChange }: ResourcePolicySettingsProps) {
  const change = (patch: Partial<ResourcePolicy>) => onChange(normalizeResourcePolicy(createCustomResourcePolicy({ ...policy, ...patch })));
  const presets = Object.values(resourcePolicyPresets);

  return (
    <section className="aly-catalog-resources" aria-labelledby="aly-catalog-resource-title">
      <header className="aly-catalog-section-header">
        <div className="aly-catalog-section-icon"><Gauge aria-hidden="true" /></div>
        <div>
          <p className="aly-catalog-eyebrow">Resource guardrails</p>
          <h2 id="aly-catalog-resource-title">Protect the workstation while AI is working</h2>
          <p>These are application scheduling and admission controls. They do not change NVIDIA firmware, voltage, or board-level power limits.</p>
        </div>
      </header>

      <div className="aly-catalog-hardware-strip" aria-label="Detected hardware snapshot">
        <div><MemoryStick aria-hidden="true" /><span><small>System RAM free</small><strong>{formatBytes(hardware.systemRamFreeBytes)}</strong></span></div>
        <div><Activity aria-hidden="true" /><span><small>Dedicated VRAM free</small><strong>{formatBytes(hardware.dedicatedVramFreeBytes)}</strong></span></div>
        <div><Cpu aria-hidden="true" /><span><small>GPU</small><strong>{hardware.gpuNames.join(", ") || hardware.gpuVendor}</strong></span></div>
        <div><HardDrive aria-hidden="true" /><span><small>Snapshot</small><strong>{new Date(hardware.capturedAt).toLocaleString()}</strong></span></div>
      </div>

      <fieldset className="aly-catalog-presets">
        <legend>Safety preset</legend>
        <div>
          {presets.map((preset) => (
            <label key={preset.id} className={policy.id === preset.id ? "is-selected" : undefined}>
              <input type="radio" name="aly-resource-preset" checked={policy.id === preset.id} onChange={() => onChange(preset)} />
              <span><strong>{preset.name}</strong><small>{preset.description}</small></span>
            </label>
          ))}
          <label className={policy.id === "custom" ? "is-selected" : undefined}>
            <input type="radio" name="aly-resource-preset" checked={policy.id === "custom"} onChange={() => onChange(createCustomResourcePolicy(policy))} />
            <span><strong>Custom</strong><small>Fine-grained limits for this workstation.</small></span>
          </label>
        </div>
      </fieldset>

      <div className="aly-catalog-policy-grid">
        <PolicyGroup icon={<MemoryStick aria-hidden="true" />} title="Memory budgets" description="Keep explicit Windows and desktop-rendering headroom.">
          <RangeField label="VRAM target" value={policy.vramTargetFraction * 100} min={10} max={100} step={1} suffix="%" onChange={(value) => change({ vramTargetFraction: value / 100 })} />
          <NumberField label="Reserved VRAM" value={policy.vramReserveBytes / 1024 ** 3} min={0} max={64} step={0.25} suffix="GB" onChange={(value) => change({ vramReserveBytes: value * 1024 ** 3 })} />
          <RangeField label="RAM target" value={policy.ramTargetFraction * 100} min={10} max={100} step={1} suffix="%" onChange={(value) => change({ ramTargetFraction: value / 100 })} />
          <NumberField label="Reserved system RAM" value={policy.ramReserveBytes / 1024 ** 3} min={0} max={256} step={0.5} suffix="GB" onChange={(value) => change({ ramReserveBytes: value * 1024 ** 3 })} />
        </PolicyGroup>

        <PolicyGroup icon={<Activity aria-hidden="true" />} title="Scheduling" description="Limit overlapping work instead of trusting every runtime to self-police.">
          <NumberField label="Heavy GPU jobs" value={policy.maxHeavyGpuJobs} min={0} max={16} step={1} onChange={(value) => change({ maxHeavyGpuJobs: value })} />
          <NumberField label="Light GPU jobs" value={policy.maxLightGpuJobs} min={0} max={32} step={1} onChange={(value) => change({ maxLightGpuJobs: value })} />
          <NumberField label="CPU jobs" value={policy.maxCpuJobs} min={1} max={64} step={1} onChange={(value) => change({ maxCpuJobs: value })} />
          <NumberField label="Unload idle models after" value={policy.modelIdleTtlSeconds / 60} min={0} max={1440} step={1} suffix="min" onChange={(value) => change({ modelIdleTtlSeconds: value * 60 })} />
        </PolicyGroup>

        <PolicyGroup icon={<ShieldCheck aria-hidden="true" />} title="Generation caps" description="Bound context and image peaks before a model is loaded.">
          <NumberField label="Context-token cap" value={policy.contextTokenCap} min={256} max={2_000_000} step={256} onChange={(value) => change({ contextTokenCap: value })} />
          <NumberField label="Image megapixel cap" value={policy.imageMegapixelCap} min={0.25} max={64} step={0.25} suffix="MP" onChange={(value) => change({ imageMegapixelCap: value })} />
          <NumberField label="Image batch cap" value={policy.imageBatchCap} min={1} max={128} step={1} onChange={(value) => change({ imageBatchCap: value })} />
          <SelectField label="Quantization preference" value={policy.quantizationPreference} options={["automatic", "quality", "balanced", "memory"]} onChange={(value) => change({ quantizationPreference: value as ResourcePolicy["quantizationPreference"] })} />
        </PolicyGroup>

        <PolicyGroup icon={<Thermometer aria-hidden="true" />} title="Runtime response" description="Pause dispatch at thresholds; hardware telemetry support varies by runtime.">
          <NumberField label="Temperature pause" value={policy.temperaturePauseCelsius ?? 0} min={0} max={110} step={1} suffix="°C (0 disables)" onChange={(value) => change({ temperaturePauseCelsius: value === 0 ? null : value })} />
          <NumberField label="Power-draw pause" value={policy.powerDrawPauseWatts ?? 0} min={0} max={2000} step={5} suffix="W (0 disables)" onChange={(value) => change({ powerDrawPauseWatts: value === 0 ? null : value })} />
          <SelectField label="Offload preference" value={policy.offloadPreference} options={["automatic", "none", "model", "group", "sequential"]} onChange={(value) => change({ offloadPreference: value as ResourcePolicy["offloadPreference"] })} />
          <ToggleField label="Automatically apply safe adaptations" checked={policy.autoAdapt} onChange={(checked) => change({ autoAdapt: checked })} />
          <ToggleField label="Allow shared GPU memory" checked={policy.allowSharedGpuMemory} onChange={(checked) => change({ allowSharedGpuMemory: checked })} />
          <ToggleField label="Allow disk-backed offload" checked={policy.allowDiskOffload} onChange={(checked) => change({ allowDiskOffload: checked })} />
        </PolicyGroup>
      </div>
    </section>
  );
}

function PolicyGroup({ icon, title, description, children }: { icon: React.ReactNode; title: string; description: string; children: React.ReactNode }) {
  return <fieldset className="aly-catalog-policy-group"><legend>{icon}<span><strong>{title}</strong><small>{description}</small></span></legend>{children}</fieldset>;
}

function RangeField({ label, value, min, max, step, suffix, onChange }: { label: string; value: number; min: number; max: number; step: number; suffix: string; onChange: (value: number) => void }) {
  return <label className="aly-catalog-range"><span>{label}<output>{value.toLocaleString()} {suffix}</output></span><input type="range" value={value} min={min} max={max} step={step} onChange={(event) => onChange(numberValue(event.currentTarget.value, value))} /></label>;
}

function NumberField({ label, value, min, max, step, suffix, onChange }: { label: string; value: number; min: number; max: number; step: number; suffix?: string; onChange: (value: number) => void }) {
  return <label className="aly-catalog-number"><span>{label}</span><span><input type="number" value={value} min={min} max={max} step={step} onChange={(event) => onChange(numberValue(event.currentTarget.value, value))} />{suffix && <small>{suffix}</small>}</span></label>;
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: readonly string[]; onChange: (value: string) => void }) {
  return <label className="aly-catalog-number"><span>{label}</span><select value={value} onChange={(event) => onChange(event.currentTarget.value)}>{options.map((option) => <option value={option} key={option}>{option.replaceAll("-", " ")}</option>)}</select></label>;
}

function ToggleField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="aly-catalog-switch"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.currentTarget.checked)} /><span>{label}</span></label>;
}
