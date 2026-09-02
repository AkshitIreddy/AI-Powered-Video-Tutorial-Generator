import { describe, expect, it } from "vitest";
import {
  combineWorkflowStageDemands,
  computeAvailableVram,
  evaluateResourceFit,
  normalizeResourcePolicy,
  resourcePolicyPresets,
} from "../resourcePolicy";
import type { ResourceDemand, WorkflowStageDemand } from "../types";
import { GIB, hardwareFixture } from "./fixtures";

const demand: ResourceDemand = {
  vramBytes: 4 * GIB,
  ramBytes: 8 * GIB,
  diskBytes: 10 * GIB,
  heavyGpuJobs: 1,
  lightGpuJobs: 0,
  cpuJobs: 1,
  contextTokens: 8_000,
  imageMegapixels: 1,
  imageBatch: 1,
};

describe("resource policy", () => {
  it("normalizes every user-controlled boundary", () => {
    const normalized = normalizeResourcePolicy({
      ...resourcePolicyPresets.balanced,
      vramTargetFraction: 4,
      ramTargetFraction: -2,
      maxHeavyGpuJobs: 100,
      maxCpuJobs: 0,
      contextTokenCap: 12,
      imageBatchCap: 999,
      temperaturePauseCelsius: 200,
    });
    expect(normalized.vramTargetFraction).toBe(1);
    expect(normalized.ramTargetFraction).toBe(0.1);
    expect(normalized.maxHeavyGpuJobs).toBe(16);
    expect(normalized.maxCpuJobs).toBe(1);
    expect(normalized.contextTokenCap).toBe(256);
    expect(normalized.imageBatchCap).toBe(128);
    expect(normalized.temperaturePauseCelsius).toBe(110);
  });

  it("uses the tighter DXGI/free-memory budget and reserves policy headroom", () => {
    const hardware = hardwareFixture({ dedicatedVramFreeBytes: 12 * GIB, dxgiBudgetBytes: 10 * GIB, dxgiCurrentUsageBytes: 2 * GIB });
    const policy = { ...resourcePolicyPresets.balanced, vramTargetFraction: 0.75, vramReserveBytes: 1 * GIB };
    expect(computeAvailableVram(hardware, policy)).toBe(5 * GIB);
  });

  it("proposes explicit context, resolution, batch, and concurrency adaptations", () => {
    const result = evaluateResourceFit({ ...demand, heavyGpuJobs: 3, contextTokens: 100_000, imageMegapixels: 8, imageBatch: 12 }, hardwareFixture(), resourcePolicyPresets.balanced);
    expect(result.level).toBe("amber");
    expect(result.adaptations.map((adaptation) => adaptation.code)).toEqual(expect.arrayContaining(["serialize-jobs", "reduce-context", "reduce-resolution", "reduce-batch"]));
  });

  it("returns red when memory excess cannot be automatically adapted", () => {
    const result = evaluateResourceFit(
      { ...demand, vramBytes: 20 * GIB, ramBytes: 50 * GIB },
      hardwareFixture({ dedicatedVramFreeBytes: 8 * GIB, dxgiBudgetBytes: 8 * GIB, dxgiCurrentUsageBytes: 1 * GIB, systemRamFreeBytes: 12 * GIB }),
      { ...resourcePolicyPresets.balanced, autoAdapt: false },
    );
    expect(result.level).toBe("red");
    expect(result.messages.join(" ")).toMatch(/VRAM.*RAM/);
  });

  it("sums overlapping stages but takes the peak of exclusive stages", () => {
    const stage = (id: string, vram: number, canOverlap: boolean): WorkflowStageDemand => ({
      ...demand,
      id,
      label: id,
      concurrencyGroup: "render",
      canOverlap,
      vramBytes: vram,
    });
    const combined = combineWorkflowStageDemands([stage("a", 3 * GIB, true), stage("b", 4 * GIB, true), stage("c", 9 * GIB, false)]);
    expect(combined.vramBytes).toBe(9 * GIB);
    expect(combined.heavyGpuJobs).toBe(2);
  });
});
