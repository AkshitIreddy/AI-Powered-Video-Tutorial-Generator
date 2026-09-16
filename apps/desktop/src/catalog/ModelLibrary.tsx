import { useEffect, useId, useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  Cloud,
  Database,
  HardDrive,
  Search,
  ShieldAlert,
  SlidersHorizontal,
} from "lucide-react";
import { ProviderMark } from "./ProviderMark";
import { filterCatalogItems, parseCatalogQuery, toggleFilterValue } from "./query";
import { formatBytes } from "./resourcePolicy";
import {
  catalogSources,
  emptyCatalogFilters,
  type CapabilityRouteSelection,
  type CatalogFilterState,
  type CatalogItem,
  type CatalogSort,
  type CompatibilityContext,
  type CompatibilityLevel,
} from "./types";
import { selectionFromCatalogItem } from "./routing";
import { isCloudWritingProfileCandidate } from "./writingProfile";

export interface ModelLibraryProps {
  items: readonly CatalogItem[];
  compatibilityContext: CompatibilityContext;
  onInspect?: (item: CatalogItem) => void;
  onSelect?: (item: CatalogItem) => void;
  onUseForWritingProfile?: (item: CatalogItem) => void;
  writingProfileProviderIds?: readonly string[];
  onAddToRoute?: (selection: CapabilityRouteSelection) => void;
  initialQuery?: string;
}

const compatibilityLabels: Readonly<Record<CompatibilityLevel, string>> = {
  ready: "Ready",
  "ready-with-changes": "Ready with changes",
  "needs-setup": "Needs setup",
  unknown: "Needs review",
  blocked: "Blocked",
};

const sourceLabels = {
  curated: "Curated",
  "hugging-face": "Hugging Face",
  civitai: "Civitai",
  "nvidia-nim": "NVIDIA NIM",
  cohere: "Cohere",
  "nvidia-ngc": "NVIDIA NGC",
  local: "Local",
  cloud: "Cloud",
} as const;

const RESULT_BATCH_SIZE = 6;

export function ModelLibrary({
  items,
  compatibilityContext,
  onInspect,
  onSelect,
  onUseForWritingProfile,
  writingProfileProviderIds,
  onAddToRoute,
  initialQuery = "",
}: ModelLibraryProps) {
  const searchId = useId();
  const [query, setQuery] = useState(initialQuery);
  const [sort, setSort] = useState<CatalogSort>("relevance");
  const [filters, setFilters] = useState<CatalogFilterState>(emptyCatalogFilters);
  const [showFilters, setShowFilters] = useState(false);
  const [visibleResultCount, setVisibleResultCount] = useState(RESULT_BATCH_SIZE);
  const parsed = useMemo(() => parseCatalogQuery(query), [query]);
  const results = useMemo(
    () => filterCatalogItems(items, { query, filters, sort, context: compatibilityContext }),
    [items, query, filters, sort, compatibilityContext],
  );
  const visibleResults = results.slice(0, visibleResultCount);

  useEffect(() => {
    setVisibleResultCount(RESULT_BATCH_SIZE);
  }, [items, query, filters, sort, compatibilityContext]);

  const updateFilter = <K extends keyof CatalogFilterState>(key: K, value: CatalogFilterState[K]) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  return (
    <section className="aly-catalog-library" aria-label="Model library">
      <div className="aly-catalog-toolbar">
        <div className="aly-catalog-searchbox">
          <Search size={18} aria-hidden="true" />
          <label className="aly-catalog-sr-only" htmlFor={searchId}>Search models</label>
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder='Search or try capability:image.generate vram<=12GB'
            aria-describedby={`${searchId}-help ${searchId}-errors`}
          />
          {query && <button type="button" className="aly-catalog-text-button" onClick={() => setQuery("")}>Clear</button>}
        </div>
        <button
          type="button"
          className="aly-catalog-button aly-catalog-button--quiet"
          aria-expanded={showFilters}
          aria-controls={`${searchId}-filters`}
          onClick={() => setShowFilters((visible) => !visible)}
        >
          <SlidersHorizontal size={17} aria-hidden="true" /> Filters <ChevronDown size={15} aria-hidden="true" />
        </button>
        <label className="aly-catalog-select-label">
          <span>Sort</span>
          <select value={sort} onChange={(event) => setSort(event.currentTarget.value as CatalogSort)}>
            <option value="relevance">Relevance</option>
            <option value="name">Name</option>
            <option value="updated">Recently updated</option>
            <option value="downloads">Most downloaded</option>
            <option value="likes">Most liked</option>
            <option value="vram">Lowest VRAM</option>
          </select>
        </label>
      </div>

      <p id={`${searchId}-help`} className="aly-catalog-query-help">
        Query fields include source, provider, capability, base, runtime, format, license, compatibility, VRAM, RAM, downloads, and likes. Prefix a term with − to exclude it.
      </p>
      <div id={`${searchId}-errors`} role="status" aria-live="polite">
        {parsed.errors.map((error) => <p className="aly-catalog-query-error" key={error.token}>{error.message}</p>)}
      </div>

      {showFilters && (
        <div className="aly-catalog-filter-panel" id={`${searchId}-filters`}>
          <fieldset>
            <legend>Sources</legend>
            <div className="aly-catalog-chip-group">
              {catalogSources.map((source) => (
                <label className="aly-catalog-check-chip" key={source}>
                  <input
                    type="checkbox"
                    checked={filters.sources.includes(source)}
                    onChange={() => updateFilter("sources", toggleFilterValue(filters.sources, source))}
                  />
                  <span>{sourceLabels[source]}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>Readiness</legend>
            <div className="aly-catalog-chip-group">
              {(Object.keys(compatibilityLabels) as CompatibilityLevel[]).map((level) => (
                <label className="aly-catalog-check-chip" key={level}>
                  <input
                    type="checkbox"
                    checked={filters.compatibility.includes(level)}
                    onChange={() => updateFilter("compatibility", toggleFilterValue(filters.compatibility, level))}
                  />
                  <span>{compatibilityLabels[level]}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="aly-catalog-filter-grid">
            <label><span>Maximum VRAM (GB)</span><input type="number" min="1" step="1" value={filters.maxVramBytes === null ? "" : filters.maxVramBytes / 1024 ** 3} onChange={(event) => updateFilter("maxVramBytes", event.currentTarget.value ? Number(event.currentTarget.value) * 1024 ** 3 : null)} /></label>
            <label><span>Maximum RAM (GB)</span><input type="number" min="1" step="1" value={filters.maxRamBytes === null ? "" : filters.maxRamBytes / 1024 ** 3} onChange={(event) => updateFilter("maxRamBytes", event.currentTarget.value ? Number(event.currentTarget.value) * 1024 ** 3 : null)} /></label>
            <label className="aly-catalog-switch"><input type="checkbox" checked={filters.installedOnly} onChange={(event) => updateFilter("installedOnly", event.currentTarget.checked)} /><span>Installed models only</span></label>
            <label className="aly-catalog-switch"><input type="checkbox" checked={filters.safeTensorsOnly} onChange={(event) => updateFilter("safeTensorsOnly", event.currentTarget.checked)} /><span>Safetensors confirmed</span></label>
          </div>
          <button type="button" className="aly-catalog-text-button" onClick={() => setFilters(emptyCatalogFilters)}>Reset all filters</button>
        </div>
      )}

      <div className="aly-catalog-results-heading">
        <p aria-live="polite"><strong>{results.length}</strong> {results.length === 1 ? "model" : "models"} <span>of {items.length} indexed</span></p>
        <span><strong>{items.filter((item) => item.execution.boundaries.includes("local")).length}</strong> local · Compatibility uses the current project, provider, and hardware policy.</span>
      </div>

      {results.length === 0 ? (
        <div className="aly-catalog-empty">
          <Database size={28} aria-hidden="true" />
          <h3>No models match this view</h3>
          <p>Clear a filter or broaden the query. Unknown hardware and license metadata are intentionally not treated as compatible.</p>
        </div>
      ) : (
        <ul className="aly-catalog-card-grid">
          {visibleResults.map(({ item, compatibility }) => {
            const canStageWritingProfile = Boolean(onUseForWritingProfile)
              && isCloudWritingProfileCandidate(item, writingProfileProviderIds ?? [item.identity.providerId]);
            return (
            <li className="aly-catalog-card" key={`${item.identity.source}:${item.identity.sourceId}@${item.identity.revision ?? "latest"}`}>
              <div className="aly-catalog-card__topline">
                <ProviderMark providerId={item.identity.providerId} />
                <span className={`aly-catalog-status aly-catalog-status--${compatibility.level}`}>
                  {compatibility.level === "ready" ? <CheckCircle2 size={14} aria-hidden="true" /> : <ShieldAlert size={14} aria-hidden="true" />}
                  {compatibilityLabels[compatibility.level]}
                </span>
              </div>
              <div className="aly-catalog-card__body">
                <p className="aly-catalog-card__publisher">{item.identity.publisher}</p>
                <h3>{item.identity.name}</h3>
                <p>{item.presentation.description || "No catalog description was supplied."}</p>
                <div className="aly-catalog-tag-row">
                  {item.classification.capabilities.slice(0, 3).map((capability) => <span key={capability}>{capability}</span>)}
                </div>
              </div>
              <dl className="aly-catalog-metrics">
                <div><dt>{compatibility.selectedBoundary === "cloud" ? <Cloud size={14} aria-hidden="true" /> : <HardDrive size={14} aria-hidden="true" />} Usable path</dt><dd>{compatibility.selectedBoundary ?? "None yet"}</dd></div>
                <div><dt>VRAM estimate</dt><dd>{formatBytes(item.requirements.estimatedVramBytes)}</dd></div>
                <div><dt>License</dt><dd>{item.license.identifier ?? item.license.status}</dd></div>
              </dl>
              {compatibility.reasons[0] && <p className="aly-catalog-card__reason">{compatibility.reasons[0].message}</p>}
              <div className="aly-catalog-card__actions">
                {onInspect && <button type="button" className="aly-catalog-button aly-catalog-button--quiet" onClick={() => onInspect(item)}>Inspect details</button>}
                {onAddToRoute && <button type="button" className="aly-catalog-button aly-catalog-button--quiet" disabled={!compatibility.canSelect} title={compatibility.canSelect ? "Add this ready item to a capability route" : "Resolve compatibility checks before routing this item"} onClick={() => onAddToRoute(selectionFromCatalogItem(item))}>Add to route</button>}
                {canStageWritingProfile && <button type="button" className="aly-catalog-button" disabled={!compatibility.canSelect} title={compatibility.canSelect ? "Stage this exact model in the active writing profile; use Save setup below to keep it" : "Connect the provider and resolve its compatibility checks before using it"} onClick={() => onUseForWritingProfile?.(item)}>Use in writing profile</button>}
                {onSelect && <button type="button" className="aly-catalog-button" disabled={!compatibility.canSelect} onClick={() => onSelect(item)}>Select model</button>}
              </div>
            </li>
          );})}
        </ul>
      )}
      {visibleResults.length < results.length && (
        <div className="aly-catalog-load-more">
          <p>Showing <strong>{visibleResults.length}</strong> of <strong>{results.length}</strong> matching models.</p>
          <button
            type="button"
            className="aly-catalog-button aly-catalog-button--quiet"
            onClick={() => setVisibleResultCount((count) => Math.min(count + RESULT_BATCH_SIZE, results.length))}
          >
            Show {Math.min(RESULT_BATCH_SIZE, results.length - visibleResults.length)} more
          </button>
        </div>
      )}
    </section>
  );
}
