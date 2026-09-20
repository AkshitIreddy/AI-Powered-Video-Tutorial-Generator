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
  type CatalogAvailability,
  type CatalogCapability,
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
  onDownload?: (item: CatalogItem) => void;
  downloadState?: (item: CatalogItem) => CatalogDownloadActionState;
  onSelect?: (item: CatalogItem) => void;
  onUseForWritingProfile?: (item: CatalogItem) => void;
  writingProfileProviderIds?: readonly string[];
  onAddToRoute?: (selection: CapabilityRouteSelection) => void;
  initialQuery?: string;
}

export interface CatalogDownloadActionState {
  label: string;
  disabled: boolean;
  detail?: string;
  progressPercent?: number;
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

const capabilityLabels: Readonly<Record<CatalogCapability, string>> = {
  "llm.text": "Writing",
  "llm.structured": "Structured output",
  "research.web": "Web research",
  "vlm.review": "Visual review",
  "vlm.chat": "Image chat",
  "media.licensed.search": "Licensed media",
  "retrieval.embed": "Semantic search",
  "image.generate": "Image generation",
  "image.edit": "Image editing",
  "image.inpaint": "Image repair",
  "image.control": "Guided images",
  "image.reference": "Reference images",
  "image.upscale": "Image upscaling",
  "video.generate": "Video generation",
  "audio.tts": "Text to speech",
  "audio.transcribe": "Transcription",
  "audio.align": "Speech alignment",
  "presenter.generate": "Presenter creation",
  "portrait.animate": "Portrait animation",
  "lipsync.generate": "Lip sync",
};

const availabilityLabels: Readonly<Record<CatalogAvailability, string>> = {
  available: "Available",
  installed: "Installed",
  downloadable: "Download available",
  gated: "Terms required",
  unavailable: "Unavailable",
  unknown: "Not verified",
};

const RESULT_BATCH_SIZE = 6;

export function ModelLibrary({
  items,
  compatibilityContext,
  onDownload,
  downloadState,
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
  const filteredResults = useMemo(
    () => filterCatalogItems(items, { query, filters, sort, context: compatibilityContext }),
    [items, query, filters, sort, compatibilityContext],
  );
  const results = useMemo(() => {
    if (query.trim() || sort !== "relevance") return filteredResults;
    return [...filteredResults].sort((left, right) => defaultActionRank(
      left.item,
      left.compatibility.canSelect,
      onDownload,
      downloadState,
      onUseForWritingProfile,
      writingProfileProviderIds,
    ) - defaultActionRank(
      right.item,
      right.compatibility.canSelect,
      onDownload,
      downloadState,
      onUseForWritingProfile,
      writingProfileProviderIds,
    ));
  }, [filteredResults, query, sort, onDownload, downloadState, onUseForWritingProfile, writingProfileProviderIds]);
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
            const isLocalModel = item.execution.boundaries.includes("local");
            const resolvedDownloadState = isLocalModel && (onDownload || downloadState)
              ? downloadState?.(item) ?? defaultDownloadState(item)
              : null;
            const primaryAction = choosePrimaryAction({
              resolvedDownloadState,
              canStageWritingProfile,
              canSelect: compatibility.canSelect,
              hasRouteAction: Boolean(onAddToRoute),
              hasSelectAction: Boolean(onSelect),
            });
            const actionClass = (action: CatalogCardAction) => `aly-catalog-button${primaryAction === action ? "" : " aly-catalog-button--quiet"}`;
            const cardFacts = catalogCardFacts(item, compatibility.level, isLocalModel);
            const technicalFacts = catalogTechnicalFacts(item, isLocalModel);
            const hasTechnicalDetails = technicalFacts.length > 0 || Boolean(compatibility.reasons[0] || resolvedDownloadState?.detail);
            const showDownloadStatus = Boolean(resolvedDownloadState
              && (resolvedDownloadState.disabled || resolvedDownloadState.progressPercent !== undefined));
            const hasVisibleActions = Boolean((resolvedDownloadState && !resolvedDownloadState.disabled) || onAddToRoute || canStageWritingProfile || onSelect);
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
                  {item.classification.capabilities.slice(0, 3).map((capability) => <span key={capability}>{capabilityLabels[capability]}</span>)}
                </div>
              </div>
              <dl className="aly-catalog-metrics">
                {cardFacts.map((fact) => <div key={fact.label}><dt>{fact.icon === "cloud" ? <Cloud size={14} aria-hidden="true" /> : fact.icon === "local" ? <HardDrive size={14} aria-hidden="true" /> : null}{fact.label}</dt><dd>{fact.value}</dd></div>)}
              </dl>
              {showDownloadStatus && resolvedDownloadState && (
                <div className={`aly-catalog-download-state${resolvedDownloadState.progressPercent === undefined ? "" : " is-active"}`} role="status">
                  <span><strong>{downloadStatusLabel(resolvedDownloadState)}</strong><small>{downloadStateSummary(resolvedDownloadState)}</small></span>
                  {resolvedDownloadState.progressPercent !== undefined && (
                    <progress
                      aria-label={`${item.identity.name} download progress`}
                      max={100}
                      value={Math.max(0, Math.min(100, resolvedDownloadState.progressPercent))}
                    />
                  )}
                </div>
              )}
              {hasTechnicalDetails && (
                <details className="aly-catalog-card__details">
                  <summary><span><strong>Technical details</strong><small>{isLocalModel ? "Package, version, and setup" : "Version and provider setup"}</small></span><ChevronDown size={16} aria-hidden="true" /></summary>
                  <div className="aly-catalog-card__details-body">
                    {technicalFacts.length > 0 && <dl>{technicalFacts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>}
                    {compatibility.reasons[0] && <section><h4>Setup check</h4><p>{compatibility.reasons[0].message}</p></section>}
                    {resolvedDownloadState?.detail && <section><h4>Package note</h4><p>{resolvedDownloadState.detail}</p></section>}
                  </div>
                </details>
              )}
              {hasVisibleActions && (
                <div className="aly-catalog-card__actions">
                  {resolvedDownloadState && !resolvedDownloadState.disabled && <button type="button" className={actionClass("download")} disabled={!onDownload} onClick={() => onDownload?.(item)}>{downloadActionLabel(resolvedDownloadState)}</button>}
                  {onAddToRoute && <button type="button" className={actionClass("route")} disabled={!compatibility.canSelect} title={compatibility.canSelect ? "Add this ready item to a capability route" : "Resolve compatibility checks before routing this item"} onClick={() => onAddToRoute(selectionFromCatalogItem(item))}>Add to route</button>}
                  {canStageWritingProfile && <button type="button" className={actionClass("writing")} disabled={!compatibility.canSelect} title={compatibility.canSelect ? "Stage this exact model in the active writing profile; use Save setup below to keep it" : "Connect the provider and resolve its compatibility checks before using it"} onClick={() => onUseForWritingProfile?.(item)}>Use in writing profile</button>}
                  {onSelect && <button type="button" className={actionClass("select")} disabled={!compatibility.canSelect} onClick={() => onSelect(item)}>Select model</button>}
                </div>
              )}
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

type CatalogCardAction = "download" | "route" | "writing" | "select";
type CatalogCardFact = { label: string; value: string; icon?: "cloud" | "local" };

function catalogCardFacts(item: CatalogItem, compatibilityLevel: CompatibilityLevel, isLocalModel: boolean): CatalogCardFact[] {
  const license = item.license.identifier ?? (item.license.status === "custom" ? "Custom terms" : "Not verified");
  if (!isLocalModel) {
    return [
      { label: "Access", value: "Cloud API", icon: "cloud" },
      { label: "Availability", value: availabilityLabels[item.availability] },
      { label: "Setup", value: compatibilityLabels[compatibilityLevel] },
    ];
  }

  return [
    { label: "Availability", value: availabilityLabels[item.availability], icon: "local" },
    ...(item.requirements.estimatedVramBytes === null ? [] : [{ label: "VRAM", value: formatBytes(item.requirements.estimatedVramBytes) }]),
    { label: "License", value: license },
  ];
}

function catalogTechnicalFacts(item: CatalogItem, isLocalModel: boolean): CatalogCardFact[] {
  return [
    ...(item.identity.revision ? [{ label: "Revision", value: item.identity.revision }] : []),
    ...(isLocalModel && item.requirements.downloadBytes !== null ? [{ label: "Download", value: formatBytes(item.requirements.downloadBytes) }] : []),
    ...(isLocalModel && item.requirements.installedBytes !== null ? [{ label: "Installed size", value: formatBytes(item.requirements.installedBytes) }] : []),
    ...(isLocalModel && item.execution.runtimes.length > 0 ? [{ label: "Runtime", value: item.execution.runtimes.join(", ") }] : []),
    ...(isLocalModel && item.identity.immutableHash ? [{ label: "Manifest SHA-256", value: item.identity.immutableHash }] : []),
    ...(isLocalModel && item.localInstall?.path ? [{ label: "Installed path", value: item.localInstall.path }] : []),
    ...(isLocalModel && item.localInstall?.fingerprint ? [{ label: "Install fingerprint", value: item.localInstall.fingerprint }] : []),
  ];
}

function choosePrimaryAction({
  resolvedDownloadState,
  canStageWritingProfile,
  canSelect,
  hasRouteAction,
  hasSelectAction,
}: {
  resolvedDownloadState: CatalogDownloadActionState | null;
  canStageWritingProfile: boolean;
  canSelect: boolean;
  hasRouteAction: boolean;
  hasSelectAction: boolean;
}): CatalogCardAction | null {
  if (resolvedDownloadState && !resolvedDownloadState.disabled) return "download";
  if (canStageWritingProfile && canSelect) return "writing";
  if (hasSelectAction && canSelect) return "select";
  if (hasRouteAction && canSelect) return "route";
  return null;
}

function downloadStateSummary(state: CatalogDownloadActionState): string {
  if (state.progressPercent !== undefined) {
    const percent = Math.round(Math.max(0, Math.min(100, state.progressPercent)));
    return percent >= 100 ? "Download complete · checking files" : `${percent}% downloaded`;
  }
  if (/installed|ready|verified/i.test(state.label)) return "Available on this device";
  if (state.disabled) return "Open technical details for the setup reason";
  return "Managed package available";
}

function downloadStatusLabel(state: CatalogDownloadActionState): string {
  if (state.progressPercent !== undefined && state.progressPercent >= 100) return "Verifying package";
  const phase = state.label.split("·", 1)[0]?.replace(/\s+\d+%.*$/u, "").trim();
  return phase || "Download status";
}

function downloadActionLabel(state: CatalogDownloadActionState): string {
  return /·\s*view progress/iu.test(state.label) ? "View progress" : state.label;
}

function defaultDownloadState(item: CatalogItem): CatalogDownloadActionState {
  if (item.availability === "installed" || item.localInstall?.status === "verified") {
    return { label: "Installed", disabled: true, detail: "This model is installed and verified on this device." };
  }
  if (item.availability === "downloadable") {
    return { label: "Download", disabled: false };
  }
  return {
    label: "Download unavailable",
    disabled: true,
    detail: "No verified download package is available for this catalog entry.",
  };
}

function defaultActionRank(
  item: CatalogItem,
  canSelect: boolean,
  onDownload: ModelLibraryProps["onDownload"],
  downloadState: ModelLibraryProps["downloadState"],
  onUseForWritingProfile: ModelLibraryProps["onUseForWritingProfile"],
  writingProfileProviderIds: ModelLibraryProps["writingProfileProviderIds"],
): number {
  if (item.execution.boundaries.includes("local") && (onDownload || downloadState)) {
    const state = downloadState?.(item) ?? defaultDownloadState(item);
    return /unavailable/i.test(state.label) ? 4 : 0;
  }
  if (onUseForWritingProfile && isCloudWritingProfileCandidate(item, writingProfileProviderIds ?? [item.identity.providerId])) {
    return canSelect ? 1 : 3;
  }
  return canSelect ? 2 : 4;
}
