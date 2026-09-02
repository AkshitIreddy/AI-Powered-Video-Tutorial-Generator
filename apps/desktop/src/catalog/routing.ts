import { compareCompatibility, evaluateCatalogCompatibility } from "./compatibility";
import type {
  CapabilityRoute,
  CapabilityRouteSelection,
  CatalogCapability,
  CatalogItem,
  CompatibilityContext,
  RouteResolution,
  RouteValidationIssue,
  RoutingProfile,
} from "./types";

export function catalogSelectionKey(selection: CapabilityRouteSelection): string {
  return `${selection.source}:${selection.sourceId}@${selection.revision ?? "latest"}`;
}

export function catalogItemKey(item: CatalogItem): string {
  return catalogSelectionKey({
    source: item.identity.source,
    sourceId: item.identity.sourceId,
    revision: item.identity.revision,
    providerId: item.identity.providerId,
  });
}

export function selectionFromCatalogItem(item: CatalogItem): CapabilityRouteSelection {
  return {
    source: item.identity.source,
    sourceId: item.identity.sourceId,
    revision: item.identity.revision,
    providerId: item.identity.providerId,
  };
}

export function validateRoutingProfile(
  profile: RoutingProfile,
  catalog: readonly CatalogItem[],
  contextFor: (capability: CatalogCapability) => CompatibilityContext,
): RouteValidationIssue[] {
  return profile.routes.flatMap((route) => validateCapabilityRoute(route, catalog, contextFor(route.capability)));
}

export function validateCapabilityRoute(
  route: CapabilityRoute,
  catalog: readonly CatalogItem[],
  context: CompatibilityContext,
): RouteValidationIssue[] {
  if (!route.enabled) return [];
  const issues: RouteValidationIssue[] = [];
  const seen = new Set<string>();
  if (route.selections.length === 0) {
    issues.push(issue(route.capability, null, "empty-route", `No model is configured for ${route.capability}.`));
    return issues;
  }

  route.selections.forEach((selection, index) => {
    const key = catalogSelectionKey(selection);
    if (seen.has(key)) {
      issues.push(issue(route.capability, index, "duplicate-selection", `${selection.sourceId} appears more than once in this fallback chain.`));
      return;
    }
    seen.add(key);
    const item = findCatalogItem(catalog, selection);
    if (!item) {
      issues.push(issue(route.capability, index, "missing-item", `${selection.sourceId} at revision ${selection.revision ?? "latest"} is not in the current catalog.`));
      return;
    }
    if (!item.classification.capabilities.includes(route.capability)) {
      issues.push(issue(route.capability, index, "capability-mismatch", `${item.identity.name} does not provide ${route.capability}.`));
      return;
    }
    const compatibility = evaluateCatalogCompatibility(item, { ...context, capability: route.capability });
    if (compatibility.level === "blocked") {
      issues.push(issue(route.capability, index, "compatibility-blocked", compatibility.reasons.filter((reason) => reason.severity === "error").map((reason) => reason.message).join(" ")));
    }
    if (index > 0 && item.execution.boundaries.includes("cloud") && !route.fallbackConsent) {
      issues.push(issue(route.capability, index, "cloud-fallback-without-consent", `Cloud fallback ${item.identity.name} requires explicit fallback consent.`));
    }
  });
  return issues;
}

export function resolveCapabilityRoute(
  route: CapabilityRoute,
  catalog: readonly CatalogItem[],
  context: CompatibilityContext,
): RouteResolution {
  const issues = validateCapabilityRoute(route, catalog, context);
  const attempted = route.selections.map((selection) => {
    const item = findCatalogItem(catalog, selection);
    const compatibility = item ? evaluateCatalogCompatibility(item, { ...context, capability: route.capability }) : null;
    return { selection, item, compatibility };
  });
  if (!route.enabled || route.selections.length === 0) {
    return { status: "blocked", selection: null, item: null, compatibility: null, attempted, issues };
  }

  const candidates = attempted.filter((entry) => {
    if (!entry.item || !entry.compatibility) return false;
    if (entry.compatibility.level === "blocked" || entry.compatibility.level === "unknown") return false;
    const index = route.selections.indexOf(entry.selection);
    return index === 0 || !entry.item.execution.boundaries.includes("cloud") || route.fallbackConsent;
  });
  const ready = candidates.find((entry) => entry.compatibility?.level === "ready")
    ?? candidates.find((entry) => entry.compatibility?.level === "ready-with-changes");
  if (ready?.item && ready.compatibility) {
    return { status: "resolved", selection: ready.selection, item: ready.item, compatibility: ready.compatibility, attempted, issues };
  }
  const setupCandidate = candidates
    .filter((entry) => entry.compatibility?.level === "needs-setup")
    .sort((left, right) => compareCompatibility(left.compatibility!, right.compatibility!))[0];
  if (setupCandidate?.item && setupCandidate.compatibility) {
    return { status: "needs-setup", selection: setupCandidate.selection, item: setupCandidate.item, compatibility: setupCandidate.compatibility, attempted, issues };
  }
  return { status: "blocked", selection: null, item: null, compatibility: null, attempted, issues };
}

export function setPrimaryRouteSelection(route: CapabilityRoute, selection: CapabilityRouteSelection): CapabilityRoute {
  return {
    ...route,
    selections: [selection, ...route.selections.filter((entry) => catalogSelectionKey(entry) !== catalogSelectionKey(selection))],
  };
}

export function appendFallback(route: CapabilityRoute, selection: CapabilityRouteSelection): CapabilityRoute {
  if (route.selections.some((entry) => catalogSelectionKey(entry) === catalogSelectionKey(selection))) return route;
  return { ...route, selections: [...route.selections, selection] };
}

export function removeRouteSelection(route: CapabilityRoute, index: number): CapabilityRoute {
  return { ...route, selections: route.selections.filter((_, selectionIndex) => selectionIndex !== index) };
}

export function moveRouteSelection(route: CapabilityRoute, fromIndex: number, toIndex: number): CapabilityRoute {
  if (fromIndex < 0 || fromIndex >= route.selections.length || toIndex < 0 || toIndex >= route.selections.length || fromIndex === toIndex) return route;
  const selections = [...route.selections];
  const [selection] = selections.splice(fromIndex, 1);
  if (!selection) return route;
  selections.splice(toIndex, 0, selection);
  return { ...route, selections };
}

export function upsertCapabilityRoute(profile: RoutingProfile, route: CapabilityRoute, updatedAt: string): RoutingProfile {
  const exists = profile.routes.some((entry) => entry.capability === route.capability);
  return {
    ...profile,
    routes: exists
      ? profile.routes.map((entry) => entry.capability === route.capability ? route : entry)
      : [...profile.routes, route],
    updatedAt,
  };
}

export function findCatalogItem(catalog: readonly CatalogItem[], selection: CapabilityRouteSelection): CatalogItem | null {
  return catalog.find((item) =>
    item.identity.source === selection.source
    && item.identity.sourceId === selection.sourceId
    && (selection.revision == null || item.identity.revision === selection.revision)
    && item.identity.providerId === selection.providerId
  ) ?? null;
}

function issue(
  routeCapability: CatalogCapability,
  selectionIndex: number | null,
  code: RouteValidationIssue["code"],
  message: string,
): RouteValidationIssue {
  return { routeCapability, selectionIndex, code, message };
}
