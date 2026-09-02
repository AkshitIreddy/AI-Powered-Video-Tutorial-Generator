import type {
  HardwareSnapshot,
  ResourceAdaptation,
  ResourceDemand,
  ResourceFitResult,
  ResourcePolicy,
  WorkflowStageDemand,
} from "./types";

const GIB = 1024 ** 3;

export const resourcePolicyPresets: Readonly<Record<Exclude<ResourcePolicy["id"], "custom">, ResourcePolicy>> = {
  conservative: {
    id: "conservative",
    name: "Conservative",
    description: "Protect desktop responsiveness and serialize heavy AI work.",
    vramTargetFraction: 0.7,
    vramReserveBytes: 1.5 * GIB,
    ramTargetFraction: 0.75,
    ramReserveBytes: 6 * GIB,
    maxHeavyGpuJobs: 1,
    maxLightGpuJobs: 1,
    maxCpuJobs: 2,
    modelIdleTtlSeconds: 300,
    contextTokenCap: 16_384,
    imageMegapixelCap: 1.5,
    imageBatchCap: 1,
    temperaturePauseCelsius: 82,
    powerDrawPauseWatts: null,
    physicalPowerLimitWatts: null,
    offloadPreference: "automatic",
    quantizationPreference: "memory",
    allowDiskOffload: false,
    allowSharedGpuMemory: false,
    autoAdapt: true,
  },
  balanced: {
    id: "balanced",
    name: "Balanced",
    description: "Use most available acceleration while retaining a practical Windows reserve.",
    vramTargetFraction: 0.8,
    vramReserveBytes: 1 * GIB,
    ramTargetFraction: 0.8,
    ramReserveBytes: 4 * GIB,
    maxHeavyGpuJobs: 1,
    maxLightGpuJobs: 2,
    maxCpuJobs: 4,
    modelIdleTtlSeconds: 600,
    contextTokenCap: 32_768,
    imageMegapixelCap: 2.5,
    imageBatchCap: 2,
    temperaturePauseCelsius: 84,
    powerDrawPauseWatts: null,
    physicalPowerLimitWatts: null,
    offloadPreference: "automatic",
    quantizationPreference: "balanced",
    allowDiskOffload: false,
    allowSharedGpuMemory: false,
    autoAdapt: true,
  },
  performance: {
    id: "performance",
    name: "Performance",
    description: "Favor throughput with less headroom for other graphics workloads.",
    vramTargetFraction: 0.9,
    vramReserveBytes: 0.5 * GIB,
    ramTargetFraction: 0.9,
    ramReserveBytes: 2 * GIB,
    maxHeavyGpuJobs: 2,
    maxLightGpuJobs: 3,
    maxCpuJobs: 6,
    modelIdleTtlSeconds: 1_200,
    contextTokenCap: 65_536,
    imageMegapixelCap: 4,
    imageBatchCap: 4,
    temperaturePauseCelsius: 87,
    powerDrawPauseWatts: null,
    physicalPowerLimitWatts: null,
    offloadPreference: "automatic",
    quantizationPreference: "quality",
    allowDiskOffload: true,
    allowSharedGpuMemory: true,
    autoAdapt: true,
  },
};

export function createCustomResourcePolicy(base: ResourcePolicy = resourcePolicyPresets.balanced): ResourcePolicy {
  return { ...base, id: "custom", name: "Custom", description: "User-defined hardware and scheduling limits." };
}

export function normalizeResourcePolicy(policy: ResourcePolicy): ResourcePolicy {
  return {
    ...policy,
    vramTargetFraction: clamp(policy.vramTargetFraction, 0.1, 1),
    vramReserveBytes: finiteNonNegative(policy.vramReserveBytes),
    ramTargetFraction: clamp(policy.ramTargetFraction, 0.1, 1),
    ramReserveBytes: finiteNonNegative(policy.ramReserveBytes),
    maxHeavyGpuJobs: integerClamp(policy.maxHeavyGpuJobs, 0, 16),
    maxLightGpuJobs: integerClamp(policy.maxLightGpuJobs, 0, 32),
    maxCpuJobs: integerClamp(policy.maxCpuJobs, 1, 64),
    modelIdleTtlSeconds: integerClamp(policy.modelIdleTtlSeconds, 0, 86_400),
    contextTokenCap: integerClamp(policy.contextTokenCap, 256, 2_000_000),
    imageMegapixelCap: clamp(policy.imageMegapixelCap, 0.25, 64),
    imageBatchCap: integerClamp(policy.imageBatchCap, 1, 128),
    temperaturePauseCelsius: nullableClamp(policy.temperaturePauseCelsius, 50, 110),
    powerDrawPauseWatts: nullableClamp(policy.powerDrawPauseWatts, 10, 2_000),
    physicalPowerLimitWatts: nullableClamp(policy.physicalPowerLimitWatts, 10, 2_000),
  };
}

export function demandFromCatalogRequirements(input: {
  estimatedVramBytes: number | null;
  estimatedRamBytes: number | null;
  installedBytes: number | null;
}): ResourceDemand {
  return {
    vramBytes: input.estimatedVramBytes,
    ramBytes: input.estimatedRamBytes,
    diskBytes: input.installedBytes,
    heavyGpuJobs: input.estimatedVramBytes && input.estimatedVramBytes > 2 * GIB ? 1 : 0,
    lightGpuJobs: input.estimatedVramBytes && input.estimatedVramBytes <= 2 * GIB ? 1 : 0,
    cpuJobs: 1,
    contextTokens: null,
    imageMegapixels: null,
    imageBatch: null,
  };
}

export function combineWorkflowStageDemands(stages: readonly WorkflowStageDemand[]): ResourceDemand {
  if (stages.length === 0) return emptyDemand();
  const groups = new Map<string, WorkflowStageDemand[]>();
  for (const stage of stages) {
    const entries = groups.get(stage.concurrencyGroup) ?? [];
    entries.push(stage);
    groups.set(stage.concurrencyGroup, entries);
  }

  const groupDemands = [...groups.values()].map((group) => {
    const overlapping = group.filter((stage) => stage.canOverlap);
    const exclusive = group.filter((stage) => !stage.canOverlap);
    const overlapDemand = sumDemands(overlapping);
    const exclusivePeak = maxDemands(exclusive);
    return maxDemandPair(overlapDemand, exclusivePeak);
  });
  return maxDemands(groupDemands);
}

export function evaluateResourceFit(demandInput: ResourceDemand, hardware: HardwareSnapshot, policyInput: ResourcePolicy): ResourceFitResult {
  const policy = normalizeResourcePolicy(policyInput);
  const demand = sanitizeDemand(demandInput);
  const availableVramBytes = computeAvailableVram(hardware, policy);
  const availableRamBytes = Math.max(0, Math.min(hardware.systemRamFreeBytes, hardware.systemRamBytes * policy.ramTargetFraction) - policy.ramReserveBytes);
  const messages: string[] = [];
  const adaptations: ResourceAdaptation[] = [];
  let hardFailure = false;
  let pressure = false;
  let unknown = false;

  if (demand.vramBytes == null && demand.heavyGpuJobs + demand.lightGpuJobs > 0) {
    unknown = true;
    messages.push("The model did not publish a reliable VRAM estimate.");
  } else if (demand.vramBytes != null && availableVramBytes == null) {
    unknown = true;
    messages.push("Live GPU memory budget is unavailable; run a low-cost preflight before loading.");
  } else if (demand.vramBytes != null && availableVramBytes != null && demand.vramBytes > availableVramBytes) {
    pressure = true;
    const excess = demand.vramBytes - availableVramBytes;
    messages.push(`Projected VRAM exceeds the policy budget by ${formatBytes(excess)}.`);
    if (policy.quantizationPreference !== "quality") {
      adaptations.push({
        code: "quantize",
        label: "Use a smaller quantization",
        description: "Choose a compatible lower-precision model variant and re-estimate quality and memory.",
        estimatedVramSavingsBytes: Math.round(demand.vramBytes * 0.35),
        estimatedRamCostBytes: 0,
      });
    }
    if (policy.offloadPreference !== "none") {
      adaptations.push({
        code: "offload",
        label: "Offload model components",
        description: "Move compatible layers or components to system RAM. This saves VRAM and increases latency.",
        estimatedVramSavingsBytes: Math.round(demand.vramBytes * 0.3),
        estimatedRamCostBytes: Math.round(demand.vramBytes * 0.35),
      });
    }
    adaptations.push({
      code: "free-models",
      label: "Unload idle models",
      description: "Evict idle model weights before starting this stage, then restore them only when requested.",
      estimatedVramSavingsBytes: null,
      estimatedRamCostBytes: 0,
    });
    if (!policy.autoAdapt || excess > availableVramBytes * 0.75) hardFailure = true;
  }

  if (demand.ramBytes == null) {
    unknown = true;
    messages.push("The model did not publish a reliable system-memory estimate.");
  } else if (demand.ramBytes > availableRamBytes) {
    pressure = true;
    const excess = demand.ramBytes - availableRamBytes;
    messages.push(`Projected RAM exceeds the policy budget by ${formatBytes(excess)}.`);
    if (policy.allowDiskOffload) {
      adaptations.push({
        code: "offload",
        label: "Use disk-backed offload",
        description: "Offload compatible groups to the configured fast temporary drive. Expect a substantial latency cost.",
        estimatedVramSavingsBytes: null,
        estimatedRamCostBytes: -Math.round(demand.ramBytes * 0.25),
      });
    }
    if (!policy.autoAdapt || excess > Math.max(availableRamBytes, 1) * 0.5) hardFailure = true;
  }

  if (demand.heavyGpuJobs > policy.maxHeavyGpuJobs || demand.lightGpuJobs > policy.maxLightGpuJobs || demand.cpuJobs > policy.maxCpuJobs) {
    pressure = true;
    adaptations.push({
      code: "serialize-jobs",
      label: "Run stages sequentially",
      description: "Queue excess jobs and resume them at stage boundaries instead of overlapping resource peaks.",
      estimatedVramSavingsBytes: null,
      estimatedRamCostBytes: 0,
    });
    messages.push("Requested concurrency exceeds the selected resource policy.");
  }

  if (demand.contextTokens != null && demand.contextTokens > policy.contextTokenCap) {
    pressure = true;
    adaptations.push({
      code: "reduce-context",
      label: `Cap context at ${formatNumber(policy.contextTokenCap)} tokens`,
      description: "Chunk source material or use retrieval instead of allocating the full requested context.",
      estimatedVramSavingsBytes: null,
      estimatedRamCostBytes: 0,
    });
    messages.push(`Requested context (${formatNumber(demand.contextTokens)}) exceeds the policy cap.`);
  }

  if (demand.imageMegapixels != null && demand.imageMegapixels > policy.imageMegapixelCap) {
    pressure = true;
    adaptations.push({
      code: "reduce-resolution",
      label: `Generate at ${policy.imageMegapixelCap.toFixed(2)} MP or below`,
      description: "Generate a smaller image, then apply the configured finishing upscaler.",
      estimatedVramSavingsBytes: null,
      estimatedRamCostBytes: 0,
    });
    messages.push(`Requested image size (${demand.imageMegapixels.toFixed(2)} MP) exceeds the policy cap.`);
  }

  if (demand.imageBatch != null && demand.imageBatch > policy.imageBatchCap) {
    pressure = true;
    adaptations.push({
      code: "reduce-batch",
      label: `Split into batches of ${policy.imageBatchCap}`,
      description: "Preserve the requested candidate count while generating fewer images concurrently.",
      estimatedVramSavingsBytes: null,
      estimatedRamCostBytes: 0,
    });
    messages.push(`Requested image batch (${demand.imageBatch}) exceeds the policy cap.`);
  }

  return {
    level: hardFailure ? "red" : pressure ? "amber" : unknown ? "unknown" : "green",
    availableVramBytes,
    availableRamBytes,
    demand,
    adaptations: dedupeAdaptations(adaptations),
    messages,
  };
}

export function computeAvailableVram(hardware: HardwareSnapshot, policyInput: ResourcePolicy): number | null {
  const policy = normalizeResourcePolicy(policyInput);
  const candidates: number[] = [];
  if (hardware.dedicatedVramFreeBytes != null) candidates.push(hardware.dedicatedVramFreeBytes);
  if (hardware.dxgiBudgetBytes != null && hardware.dxgiCurrentUsageBytes != null) {
    candidates.push(Math.max(0, hardware.dxgiBudgetBytes - hardware.dxgiCurrentUsageBytes));
  }
  if (candidates.length === 0) return null;
  return Math.max(0, Math.min(...candidates) * policy.vramTargetFraction - policy.vramReserveBytes);
}

export function formatBytes(value: number | null): string {
  if (value == null) return "Unknown";
  if (value >= GIB) return `${(value / GIB).toFixed(value >= 10 * GIB ? 0 : 1)} GB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(0)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(0)} KB`;
  return `${Math.round(value)} B`;
}

function computeValue(values: readonly (number | null)[], mode: "sum" | "max"): number | null {
  const known = values.filter((value): value is number => value != null);
  if (known.length !== values.length) return null;
  return mode === "sum" ? known.reduce((sum, value) => sum + value, 0) : Math.max(0, ...known);
}

function sumDemands(stages: readonly ResourceDemand[]): ResourceDemand {
  return {
    vramBytes: computeValue(stages.map((stage) => stage.vramBytes), "sum"),
    ramBytes: computeValue(stages.map((stage) => stage.ramBytes), "sum"),
    diskBytes: computeValue(stages.map((stage) => stage.diskBytes), "sum"),
    heavyGpuJobs: stages.reduce((sum, stage) => sum + stage.heavyGpuJobs, 0),
    lightGpuJobs: stages.reduce((sum, stage) => sum + stage.lightGpuJobs, 0),
    cpuJobs: stages.reduce((sum, stage) => sum + stage.cpuJobs, 0),
    contextTokens: nullableMax(stages.map((stage) => stage.contextTokens)),
    imageMegapixels: nullableMax(stages.map((stage) => stage.imageMegapixels)),
    imageBatch: nullableMax(stages.map((stage) => stage.imageBatch)),
  };
}

function maxDemands(stages: readonly ResourceDemand[]): ResourceDemand {
  if (stages.length === 0) return emptyDemand();
  return {
    vramBytes: nullableMax(stages.map((stage) => stage.vramBytes)),
    ramBytes: nullableMax(stages.map((stage) => stage.ramBytes)),
    diskBytes: nullableMax(stages.map((stage) => stage.diskBytes)),
    heavyGpuJobs: Math.max(...stages.map((stage) => stage.heavyGpuJobs)),
    lightGpuJobs: Math.max(...stages.map((stage) => stage.lightGpuJobs)),
    cpuJobs: Math.max(...stages.map((stage) => stage.cpuJobs)),
    contextTokens: nullableMax(stages.map((stage) => stage.contextTokens)),
    imageMegapixels: nullableMax(stages.map((stage) => stage.imageMegapixels)),
    imageBatch: nullableMax(stages.map((stage) => stage.imageBatch)),
  };
}

function maxDemandPair(left: ResourceDemand, right: ResourceDemand): ResourceDemand {
  return maxDemands([left, right]);
}

function emptyDemand(): ResourceDemand {
  return {
    vramBytes: 0,
    ramBytes: 0,
    diskBytes: 0,
    heavyGpuJobs: 0,
    lightGpuJobs: 0,
    cpuJobs: 0,
    contextTokens: null,
    imageMegapixels: null,
    imageBatch: null,
  };
}

function sanitizeDemand(demand: ResourceDemand): ResourceDemand {
  return {
    vramBytes: nullableNonNegative(demand.vramBytes),
    ramBytes: nullableNonNegative(demand.ramBytes),
    diskBytes: nullableNonNegative(demand.diskBytes),
    heavyGpuJobs: integerClamp(demand.heavyGpuJobs, 0, 10_000),
    lightGpuJobs: integerClamp(demand.lightGpuJobs, 0, 10_000),
    cpuJobs: integerClamp(demand.cpuJobs, 0, 10_000),
    contextTokens: nullableInteger(demand.contextTokens),
    imageMegapixels: nullableNonNegative(demand.imageMegapixels),
    imageBatch: nullableInteger(demand.imageBatch),
  };
}

function dedupeAdaptations(adaptations: readonly ResourceAdaptation[]): ResourceAdaptation[] {
  const seen = new Set<ResourceAdaptation["code"]>();
  return adaptations.filter((adaptation) => {
    if (seen.has(adaptation.code)) return false;
    seen.add(adaptation.code);
    return true;
  });
}

function nullableMax(values: readonly (number | null)[]): number | null {
  const known = values.filter((value): value is number => value != null);
  return known.length === 0 ? null : Math.max(...known);
}

function nullableInteger(value: number | null): number | null {
  return value == null ? null : Math.max(0, Math.round(Number.isFinite(value) ? value : 0));
}

function nullableNonNegative(value: number | null): number | null {
  return value == null ? null : finiteNonNegative(value);
}

function finiteNonNegative(value: number): number {
  return Math.max(0, Number.isFinite(value) ? value : 0);
}

function nullableClamp(value: number | null, min: number, max: number): number | null {
  return value == null ? null : clamp(value, min, max);
}

function integerClamp(value: number, min: number, max: number): number {
  return Math.round(clamp(value, min, max));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}
