import { describe, expect, it } from "vitest";
import {
  appendFallback,
  moveRouteSelection,
  removeRouteSelection,
  resolveCapabilityRoute,
  selectionFromCatalogItem,
  validateCapabilityRoute,
} from "../routing";
import type { CapabilityRoute } from "../types";
import { catalogFixture, contextFixture } from "./fixtures";

describe("capability routing", () => {
  const local = catalogFixture({
    name: "Local image",
    source: "local",
    sourceId: "local/image",
    availability: "installed",
    localInstall: { path: "E:\\models\\local-image", fingerprint: "sha", installedAt: null, lastVerifiedAt: null, status: "verified" },
  });
  const cloud = catalogFixture({ name: "Cloud image", source: "cloud", sourceId: "cloud/image", providerId: "cloud-provider", boundaries: ["cloud"], runtimes: [] });

  it("reports duplicates, missing entries, and cloud fallbacks without consent", () => {
    const localSelection = selectionFromCatalogItem(local);
    const route: CapabilityRoute = {
      capability: "image.generate",
      enabled: true,
      fallbackConsent: false,
      selections: [localSelection, localSelection, selectionFromCatalogItem(cloud), { source: "local", sourceId: "missing", revision: null, providerId: "local" }],
    };
    const codes = validateCapabilityRoute(route, [local, cloud], contextFixture()).map((issue) => issue.code);
    expect(codes).toEqual(expect.arrayContaining(["duplicate-selection", "cloud-fallback-without-consent", "missing-item"]));
  });

  it("falls through a blocked primary to a ready local fallback", () => {
    const blocked = catalogFixture({ name: "Wrong capability", sourceId: "wrong", capabilities: ["audio.tts"] });
    const route: CapabilityRoute = {
      capability: "image.generate",
      enabled: true,
      fallbackConsent: false,
      selections: [selectionFromCatalogItem(blocked), selectionFromCatalogItem(local)],
    };
    const resolution = resolveCapabilityRoute(route, [blocked, local], contextFixture());
    expect(resolution.status).toBe("resolved");
    expect(resolution.item?.identity.name).toBe("Local image");
    expect(resolution.attempted).toHaveLength(2);
  });

  it("will not choose a cloud fallback until consent is enabled", () => {
    const missingPrimary = { source: "local", sourceId: "missing", revision: null, providerId: "local" } as const;
    const route: CapabilityRoute = { capability: "image.generate", enabled: true, fallbackConsent: false, selections: [missingPrimary, selectionFromCatalogItem(cloud)] };
    expect(resolveCapabilityRoute(route, [cloud], contextFixture()).status).toBe("blocked");
    expect(resolveCapabilityRoute({ ...route, fallbackConsent: true }, [cloud], contextFixture()).item?.identity.name).toBe("Cloud image");
  });

  it("keeps route mutations immutable, ordered, and duplicate-free", () => {
    const base: CapabilityRoute = { capability: "image.generate", enabled: true, fallbackConsent: false, selections: [selectionFromCatalogItem(local)] };
    const appended = appendFallback(base, selectionFromCatalogItem(cloud));
    expect(appended.selections).toHaveLength(2);
    expect(appendFallback(appended, selectionFromCatalogItem(cloud))).toBe(appended);
    const moved = moveRouteSelection(appended, 1, 0);
    expect(moved.selections[0]?.sourceId).toBe("cloud/image");
    expect(removeRouteSelection(moved, 1).selections.map((selection) => selection.sourceId)).toEqual(["cloud/image"]);
    expect(base.selections).toHaveLength(1);
  });
});
