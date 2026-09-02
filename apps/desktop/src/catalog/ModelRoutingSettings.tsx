import { ArrowDown, ArrowUp, Cloud, GripVertical, Plus, Route, Trash2 } from "lucide-react";
import { ProviderMark } from "./ProviderMark";
import {
  appendFallback,
  findCatalogItem,
  moveRouteSelection,
  removeRouteSelection,
  selectionFromCatalogItem,
  upsertCapabilityRoute,
  validateCapabilityRoute,
} from "./routing";
import type {
  CapabilityRoute,
  CatalogCapability,
  CatalogItem,
  CompatibilityContext,
  RoutingProfile,
} from "./types";

export interface ModelRoutingSettingsProps {
  profile: RoutingProfile;
  items: readonly CatalogItem[];
  contextFor: (capability: CatalogCapability) => CompatibilityContext;
  onChange: (profile: RoutingProfile) => void;
  now?: () => string;
}

export function ModelRoutingSettings({ profile, items, contextFor, onChange, now = () => new Date().toISOString() }: ModelRoutingSettingsProps) {
  const updateRoute = (route: CapabilityRoute) => onChange(upsertCapabilityRoute(profile, route, now()));

  return (
    <section className="aly-catalog-routing" aria-labelledby="aly-catalog-routing-title">
      <header className="aly-catalog-section-header">
        <div className="aly-catalog-section-icon"><Route aria-hidden="true" /></div>
        <div>
          <p className="aly-catalog-eyebrow">Capability routing</p>
          <h2 id="aly-catalog-routing-title">Primary models and deliberate fallbacks</h2>
          <p>Each chain is evaluated from top to bottom. Cloud fallbacks remain disabled until the user explicitly allows them.</p>
        </div>
      </header>

      <div className="aly-catalog-route-list">
        {profile.routes.map((route) => {
          const issues = validateCapabilityRoute(route, items, contextFor(route.capability));
          const candidates = items.filter((item) => item.classification.capabilities.includes(route.capability));
          return (
            <article className="aly-catalog-route-card" key={route.capability}>
              <header>
                <div>
                  <p className="aly-catalog-route-card__kicker">Pipeline capability</p>
                  <h3>{route.capability}</h3>
                </div>
                <label className="aly-catalog-switch">
                  <input type="checkbox" checked={route.enabled} onChange={(event) => updateRoute({ ...route, enabled: event.currentTarget.checked })} />
                  <span>{route.enabled ? "Route enabled" : "Route disabled"}</span>
                </label>
              </header>

              <ol className="aly-catalog-chain" aria-label={`${route.capability} fallback chain`}>
                {route.selections.map((selection, index) => {
                  const item = findCatalogItem(items, selection);
                  return (
                    <li key={`${selection.source}:${selection.sourceId}@${selection.revision ?? "latest"}`}>
                      <span className="aly-catalog-chain__grip"><GripVertical size={16} aria-hidden="true" /></span>
                      <span className="aly-catalog-chain__rank">{index === 0 ? "Primary" : `Fallback ${index}`}</span>
                      <ProviderMark providerId={selection.providerId} compact />
                      <span className="aly-catalog-chain__identity">
                        <strong>{item?.identity.name ?? selection.sourceId}</strong>
                        <small>{selection.revision ?? "Latest revision"} · {selection.source}</small>
                      </span>
                      {item?.execution.boundaries.includes("cloud") && <span className="aly-catalog-cloud-mark"><Cloud size={13} aria-hidden="true" /> Cloud</span>}
                      <span className="aly-catalog-chain__controls">
                        <button type="button" aria-label={`Move ${item?.identity.name ?? selection.sourceId} up`} disabled={index === 0} onClick={() => updateRoute(moveRouteSelection(route, index, index - 1))}><ArrowUp size={15} aria-hidden="true" /></button>
                        <button type="button" aria-label={`Move ${item?.identity.name ?? selection.sourceId} down`} disabled={index === route.selections.length - 1} onClick={() => updateRoute(moveRouteSelection(route, index, index + 1))}><ArrowDown size={15} aria-hidden="true" /></button>
                        <button type="button" aria-label={`Remove ${item?.identity.name ?? selection.sourceId}`} onClick={() => updateRoute(removeRouteSelection(route, index))}><Trash2 size={15} aria-hidden="true" /></button>
                      </span>
                    </li>
                  );
                })}
              </ol>

              {route.selections.length === 0 && <p className="aly-catalog-route-empty">No model configured. Add a compatible model to make this route operational.</p>}

              <div className="aly-catalog-route-actions">
                <label>
                  <span>Add model</span>
                  <select
                    value=""
                    onChange={(event) => {
                      const selected = candidates.find((item) => `${item.identity.source}:${item.identity.sourceId}@${item.identity.revision ?? "latest"}` === event.currentTarget.value);
                      if (selected) updateRoute(appendFallback(route, selectionFromCatalogItem(selected)));
                    }}
                  >
                    <option value="">Choose a compatible catalog item…</option>
                    {candidates.map((item) => <option key={`${item.identity.source}:${item.identity.sourceId}@${item.identity.revision ?? "latest"}`} value={`${item.identity.source}:${item.identity.sourceId}@${item.identity.revision ?? "latest"}`}>{item.identity.name} — {item.identity.source}</option>)}
                  </select>
                </label>
                <span className="aly-catalog-route-add"><Plus size={14} aria-hidden="true" /> Added models become the final fallback</span>
              </div>

              <label className="aly-catalog-consent">
                <input type="checkbox" checked={route.fallbackConsent} onChange={(event) => updateRoute({ ...route, fallbackConsent: event.currentTarget.checked })} />
                <span><strong>Allow automatic cloud fallback</strong><small>Jobs may leave this device and use connected-provider billing only when local choices cannot run.</small></span>
              </label>

              {issues.length > 0 && (
                <div className="aly-catalog-issue-box" role="status">
                  <strong>{issues.length} {issues.length === 1 ? "route issue" : "route issues"}</strong>
                  <ul>{issues.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message}</li>)}</ul>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
