import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { ModelDownloadPhase, ModelDownloadStatus } from "../native";
import { useModelDownloads } from "../downloads/ModelDownloadProvider";
import {
  COMFYUI_RUNTIME_PACKAGE_ID,
  comfyuiRuntimeEntry,
  comfyuiRuntimeStatus,
  comfyuiVersionFromStatuses,
  isComfyuiRuntimePackage,
  shouldPromptForRuntime,
} from "../localRuntime";
import { RuntimeDownloadPrompt } from "../LocalRuntimePanel";
import { ProfileGallery } from "./ProfileGallery";
import { canAdvanceOnboarding, chapterIndex, isChapterConfigured, onboardingChapters } from "./state";
import type { OnboardingController } from "./useOnboardingController";
import type {
  ImportedProfileAsset,
  OnboardingCatalog,
  OnboardingChapterId,
  OnboardingSetupState,
  ProfilePortraitAsset,
} from "./types";
import "./OnboardingDialog.css";

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export interface OnboardingDialogProps {
  controller: OnboardingController;
  setupState?: OnboardingSetupState | undefined;
  catalog: OnboardingCatalog;
  productName?: string;
  brandMarkSrc?: string | undefined;
  allowSkip?: boolean;
  onAcceptProfileAsset?: ((file: File) => Promise<ImportedProfileAsset | ProfilePortraitAsset | null>) | undefined;
  headerAccessory?: ReactNode;
}

function toggleValue(values: readonly string[], value: string): string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function SelectionCard({
  type,
  name,
  value,
  checked,
  disabled,
  label,
  description,
  badge,
  icon,
  metadata,
  onChange,
}: {
  type: "radio" | "checkbox";
  name: string;
  value: string;
  checked: boolean;
  disabled?: boolean | undefined;
  label: string;
  description: string;
  badge?: string | undefined;
  icon?: ReactNode;
  metadata?: ReactNode;
  onChange: () => void;
}) {
  return (
    <label className={`aly-onboarding-choice${checked ? " aly-onboarding-choice--selected" : ""}${disabled ? " aly-onboarding-choice--disabled" : ""}`}>
      <input
        className="aly-onboarding-choice__input"
        type={type}
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
      />
      <span className="aly-onboarding-choice__indicator" aria-hidden="true" />
      {icon ? <span className="aly-onboarding-choice__icon" aria-hidden="true">{icon}</span> : null}
      <span className="aly-onboarding-choice__copy">
        <span className="aly-onboarding-choice__label-row">
          <span className="aly-onboarding-choice__label">{label}</span>
          {badge ? <span className="aly-onboarding-choice__badge">{badge}</span> : null}
        </span>
        <span className="aly-onboarding-choice__description">{description}</span>
        {metadata ? <span className="aly-onboarding-choice__metadata">{metadata}</span> : null}
      </span>
    </label>
  );
}

function formatModelBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(bytes >= 10 * 1024 ** 3 ? 0 : 1)} GB`;
  return `${Math.ceil(bytes / 1024 ** 2)} MB`;
}

function modelDownloadPhaseLabel(phase: ModelDownloadPhase | undefined): string {
  switch (phase) {
    case "downloading": return "Downloading";
    case "verifying": return "Verifying";
    case "installing": return "Installing";
    case "activating": return "Activating";
    case "ready":
    case "inUse": return "Ready";
    case "downloadedQuarantined": return "Downloaded · review required";
    case "failed": return "Needs attention";
    case "cancelled": return "Cancelled";
    case "cancelling": return "Cancelling";
    case "corrupt": return "Repair required";
    case "incompatible": return "Not compatible";
    case "repairing": return "Repairing";
    case "removing": return "Removing";
    case "removed": return "Removed";
    case "inspecting": return "Inspecting";
    case "licenseRequired": return "License review";
    case "manifestRequired":
    default: return "Ready to download";
  }
}

function completedDownload(status: ModelDownloadStatus | undefined): boolean {
  return status?.phase === "ready" || status?.phase === "inUse" || status?.phase === "downloadedQuarantined";
}

function isActiveModelDownloadPhase(phase: ModelDownloadPhase | undefined): boolean {
  return phase === "downloading"
    || phase === "verifying"
    || phase === "installing"
    || phase === "activating"
    || phase === "repairing"
    || phase === "cancelling"
    || phase === "removing"
    || phase === "inspecting";
}

type ModelDownloads = ReturnType<typeof useModelDownloads>;

function ModelChapter({
  controller,
  catalog,
  setup,
  downloads,
}: {
  controller: OnboardingController;
  catalog: OnboardingCatalog;
  setup: OnboardingSetupState;
  downloads: ModelDownloads;
}) {
  const { configuration } = controller.state;
  const runtimeEntry = comfyuiRuntimeEntry(downloads.catalog);
  const runtimeStatus = comfyuiRuntimeStatus(downloads.statuses);
  const comfyInstalled = comfyuiVersionFromStatuses(downloads.statuses) !== null;
  const runtimeBusy = downloads.queuedModelIds.includes(COMFYUI_RUNTIME_PACKAGE_ID)
    || downloads.startingModelIds.has(COMFYUI_RUNTIME_PACKAGE_ID)
    || isActiveModelDownloadPhase(runtimeStatus?.phase);
  const [runtimePrompt, setRuntimePrompt] = useState<{ modelId: string; modelName: string; totalBytes: number } | null>(null);
  const modelDownloadCatalog = downloads.catalog.filter((entry) => !isComfyuiRuntimePackage(entry.modelId));
  const selectedEntries = modelDownloadCatalog.filter((entry) => configuration.modelIds.includes(entry.modelId));
  const selectedStatuses = selectedEntries.map((entry) => downloads.statuses.find((status) => status.modelId === entry.modelId));
  const activeCount = selectedStatuses.filter((status) => isActiveModelDownloadPhase(status?.phase)).length;
  const completeCount = selectedStatuses.filter(completedDownload).length;
  const failedCount = selectedStatuses.filter((status) => status?.phase === "failed" || status?.phase === "corrupt").length;
  const needsStartCount = Math.max(0, selectedEntries.length - activeCount - completeCount - failedCount);
  const selectedDownloadBytes = selectedEntries
    .filter((entry, index) => !completedDownload(selectedStatuses[index]))
    .reduce((total, entry) => total + entry.totalBytes, 0);
  // Native packages are authoritative; newly installed runtime catalogs can
  // supply downloads before the descriptive discovery catalog is refreshed.
  const nativeOnlyModels: OnboardingCatalog["models"] = modelDownloadCatalog
    .filter((entry) => entry.available && !catalog.models.some((model) => model.id === entry.modelId))
    .map((entry) => ({ id: entry.modelId, name: entry.displayName, providerId: "local-runtime", medium: "other", description: entry.downloadOnlyReason, downloadBytes: entry.totalBytes, sizeConfidence: "exact" }));
  const orderedModels = [...catalog.models, ...nativeOnlyModels].sort((left, right) => {
    const rank = (model: OnboardingCatalog["models"][number]) => {
      const entry = downloads.catalog.find((candidate) => candidate.modelId === model.id);
      const status = downloads.statuses.find((candidate) => candidate.modelId === model.id);
      const installed = model.installed || setup.installedModelIds?.includes(model.id);
      const attached = setup.attachedModelIds?.includes(model.id);
      if (installed || attached || completedDownload(status)) return 0;
      if (entry?.available) return 1;
      return 2;
    };
    return rank(left) - rank(right);
  });
  const summary = downloads.loading && !downloads.catalog.length
    ? "Checking verified downloads…"
    : activeCount > 0
      ? `${activeCount} selected download${activeCount === 1 ? " is" : "s are"} running`
      : failedCount > 0
        ? `${failedCount} selected download${failedCount === 1 ? " needs" : "s need"} attention`
        : needsStartCount > 0
          ? `${formatModelBytes(selectedDownloadBytes)} ready to download`
          : selectedEntries.length > 0
            ? `${completeCount} selected pack${completeCount === 1 ? " is" : "s are"} already downloaded`
            : "No downloadable pack selected";

  return (
    <div className="aly-onboarding-models">
      <div className="aly-onboarding-download-summary" role="status">
        <strong>{summary}</strong>
        <span>
          Selecting a downloadable pack starts its verified installation immediately. Progress opens in a panel you can minimize while you keep working.
        </span>
        {downloads.error ? <button type="button" onClick={() => { void downloads.refresh(); }}>Download status failed to refresh · Try again</button> : null}
      </div>

      <section className="aly-onboarding-runtime-option" aria-labelledby="aly-onboarding-runtime-title">
        <div>
          <span className="section-kicker">Optional local image engine</span>
          <strong id="aly-onboarding-runtime-title">ComfyUI 0.9.2 portable runtime</strong>
          <small>
            {runtimeEntry
              ? `${formatModelBytes(runtimeEntry.totalBytes)} exact download · ${runtimeEntry.licenseId} · shared by every managed local image model.`
              : downloads.loading
                ? "Checking the verified runtime package…"
                : "The verified runtime package is unavailable in this build."}
          </small>
        </div>
        <span className={`aly-onboarding-runtime-option__state${comfyInstalled ? " is-ready" : ""}`}>
          {comfyInstalled ? "Ready" : runtimeBusy ? modelDownloadPhaseLabel(runtimeStatus?.phase) : "Optional"}
        </span>
        {comfyInstalled || runtimeBusy ? (
          <button type="button" className="aly-onboarding-download-panel-link" onClick={downloads.openPanel}>View downloads</button>
        ) : (
          <button
            type="button"
            className="aly-onboarding-download-panel-link"
            disabled={!runtimeEntry?.available || downloads.loading}
            onClick={() => {
              downloads.enqueue([COMFYUI_RUNTIME_PACKAGE_ID]);
              downloads.openPanel();
              controller.setOpen(false);
            }}
          >
            Download runtime
          </button>
        )}
      </section>

      <fieldset className="aly-onboarding-options aly-onboarding-options--models">
        <legend className="aly-onboarding-sr-only">Model toolkit</legend>
        {orderedModels.map((model) => {
          const installed = model.installed || setup.installedModelIds?.includes(model.id);
          const attached = setup.attachedModelIds?.includes(model.id);
          const entry = downloads.catalog.find((candidate) => candidate.modelId === model.id);
          const status = downloads.statuses.find((candidate) => candidate.modelId === model.id);
          const unavailable = !entry?.available && !installed && !attached && !completedDownload(status);
          const size = entry
            ? `${formatModelBytes(entry.totalBytes)} exact download`
            : model.downloadBytes
              ? `${model.sizeConfidence === "exact" ? "" : "~"}${formatModelBytes(model.downloadBytes)} download estimate`
              : "No verified installer yet";
          const footprint = model.installedBytes ? ` · ${formatModelBytes(model.installedBytes)} installed` : "";
          const queued = downloads.queuedModelIds.includes(model.id);
          const starting = downloads.startingModelIds.has(model.id);
          const badge = (() => {
            if (completedDownload(status)) return modelDownloadPhaseLabel(status?.phase);
            if (isActiveModelDownloadPhase(status?.phase)) return modelDownloadPhaseLabel(status?.phase);
            if (queued) return "Queued";
            if (starting) return "Starting…";
            if (installed) return "Installed";
            if (attached) return "Already attached";
            if (model.compatible === false) return "Not compatible";
            if (unavailable) return "Download unavailable";
            if (setup.selectedModelIds?.includes(model.id)) return "Selected · open progress";
            if (model.required) return "Required";
            return undefined;
          })();
          return (
            <SelectionCard
              key={model.id}
              type="checkbox"
              name="aly-onboarding-model"
              value={model.id}
              checked={configuration.modelIds.includes(model.id)}
              disabled={model.compatible === false || model.required || unavailable}
              label={model.name}
              description={model.description ?? `${model.medium} model from ${model.providerId}`}
              badge={badge}
              metadata={(
                <>
                  <span>{size}{footprint}{model.requirementReason ? ` · ${model.requirementReason}` : ""}</span>
                  {entry && entry.available && !completedDownload(status) ? (
                    <span className="aly-onboarding-choice__license-note">
                      Selecting downloads this pinned revision under the{" "}
                      <a href={entry.licenseUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>{entry.licenseId}</a>
                      {" "}license · exact record <code>{entry.licenseSha256.slice(0, 12)}…</code>
                    </span>
                  ) : null}
                </>
              )}
              onChange={() => {
                if (model.required || unavailable) return;
                const selected = configuration.modelIds.includes(model.id);
                if (!selected && entry?.available && !completedDownload(status) && shouldPromptForRuntime(model.id, comfyInstalled)) {
                  setRuntimePrompt({ modelId: model.id, modelName: model.name, totalBytes: entry.totalBytes });
                  return;
                }
                controller.updateConfiguration({ modelIds: toggleValue(configuration.modelIds, model.id) });
                if (!selected && entry?.available && !completedDownload(status)) {
                  downloads.enqueue([model.id]);
                  downloads.openPanel();
                  controller.setOpen(false);
                }
              }}
            />
          );
        })}
        {!orderedModels.length ? <p className="aly-onboarding-options__empty">No models were supplied by the application. You can configure them later.</p> : null}
      </fieldset>

      {selectedEntries.length ? <button type="button" className="aly-onboarding-download-panel-link" onClick={downloads.openPanel}>Open download progress</button> : null}
      {runtimePrompt ? <RuntimeDownloadPrompt
        modelName={runtimePrompt.modelName}
        modelTotalBytes={runtimePrompt.totalBytes}
        runtimeBytes={runtimeEntry?.totalBytes ?? 0}
        canDownload={runtimeEntry?.available === true}
        onConfirm={() => {
          controller.updateConfiguration({ modelIds: [...new Set([...configuration.modelIds, runtimePrompt.modelId])] });
          downloads.enqueue([COMFYUI_RUNTIME_PACKAGE_ID, runtimePrompt.modelId]);
          setRuntimePrompt(null);
          downloads.openPanel();
          controller.setOpen(false);
        }}
        onCancel={() => setRuntimePrompt(null)}
      /> : null}
    </div>
  );
}

function WelcomeChapter({ productName, brandMarkSrc, setup }: { productName: string; brandMarkSrc?: string | undefined; setup: OnboardingSetupState }) {
  const connected = setup.connectedProviderIds?.length ?? 0;
  const attached = new Set([...(setup.installedModelIds ?? []), ...(setup.attachedModelIds ?? [])]).size;
  const selected = new Set(setup.selectedModelIds ?? []).size;
  const configured = connected + attached + (setup.existingProfile?.displayName ? 1 : 0);
  return (
    <div className="aly-onboarding-welcome">
      <div className="aly-onboarding-welcome__mark" aria-hidden="true">{brandMarkSrc ? <img src={brandMarkSrc} alt="" /> : null}</div>
      <p className="aly-onboarding-welcome__lede">
        Configure {productName} around your creative goals, hardware, and preferred generation tools.
      </p>
      <ul className="aly-onboarding-welcome__promises">
        <li><strong>Your choices remain editable.</strong><span>Replay this guide or change individual settings later.</span></li>
        <li><strong>Downloads stay out of your way.</strong><span>Follow real progress in a panel you can minimize while you work.</span></li>
        <li><strong>Existing setup is preserved.</strong><span>Detected providers, models, and profile details are carried into this guide.</span></li>
      </ul>
      {configured ? <div className="aly-onboarding-welcome__detected" role="status"><strong>Your existing setup is already here.</strong><span>{connected} provider{connected === 1 ? "" : "s"} connected{attached > 0 ? ` · ${attached} model${attached === 1 ? "" : "s"} attached` : ""}{selected > 0 ? ` · ${selected} model selection${selected === 1 ? "" : "s"}` : ""}{setup.existingProfile?.displayName ? ` · profile ${setup.existingProfile.displayName}` : ""}</span></div> : null}
    </div>
  );
}

function HardwareChapter({
  setup,
  reviewed,
  onReviewedChange,
}: {
  setup: OnboardingSetupState;
  reviewed: boolean;
  onReviewedChange: (reviewed: boolean) => void;
}) {
  const hardware = setup.hardware;
  return (
    <div className="aly-onboarding-hardware">
      {hardware ? (
        <dl className="aly-onboarding-hardware__grid">
          <div><dt>Processor</dt><dd>{hardware.cpuLabel ?? "Detected"}</dd></div>
          <div><dt>System memory</dt><dd>{hardware.memoryGb ? `${hardware.memoryGb} GB` : "Not reported"}</dd></div>
          <div><dt>Graphics</dt><dd>{hardware.gpuLabel ?? "Not reported"}</dd></div>
          <div><dt>Video memory</dt><dd>{hardware.vramGb ? `${hardware.vramGb} GB` : "Not reported"}</dd></div>
          <div className="aly-onboarding-hardware__capability">
            <dt>Local generation</dt>
            <dd>{hardware.localGenerationSupported === true ? "Supported" : hardware.localGenerationSupported === false ? "Limited" : "Not assessed"}</dd>
          </div>
        </dl>
      ) : (
        <div className="aly-onboarding-hardware__empty" role="status">
          Hardware details are not available yet. You can continue and run detection later from Settings.
        </div>
      )}
      {hardware?.warnings?.length ? (
        <div className="aly-onboarding-hardware__warnings">
          <h3>Things to review</h3>
          <ul>{hardware.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
        </div>
      ) : null}
      <label className="aly-onboarding-hardware__confirmation">
        <input type="checkbox" checked={reviewed} onChange={(event) => onReviewedChange(event.target.checked)} />
        <span>I reviewed this system summary and understand that model availability can depend on memory and GPU capacity.</span>
      </label>
    </div>
  );
}

function ReadyChapter({ controller, catalog, downloads }: { controller: OnboardingController; catalog: OnboardingCatalog; downloads: ModelDownloads }) {
  const { configuration } = controller.state;
  const providerNames = catalog.providers.filter((provider) => configuration.providerIds.includes(provider.id)).map((provider) => provider.name);
  const modelNames = catalog.models.filter((model) => configuration.modelIds.includes(model.id)).map((model) => model.name);
  const selectedDownloadStatuses = downloads.statuses.filter((status) => configuration.modelIds.includes(status.modelId));
  const activeDownloads = selectedDownloadStatuses.filter((status) => isActiveModelDownloadPhase(status.phase)).length;
  const completedDownloads = selectedDownloadStatuses.filter((status) => completedDownload(status)).length;
  const failedDownloads = selectedDownloadStatuses.filter((status) => status.phase === "failed" || status.phase === "corrupt").length;
  const downloadSummary = activeDownloads > 0
    ? `${activeDownloads} continuing in the background`
    : failedDownloads > 0
      ? `${failedDownloads} need${failedDownloads === 1 ? "s" : ""} a retry`
      : completedDownloads > 0
        ? `${completedDownloads} verified on this computer`
        : "No verified download completed";
  return (
    <div className="aly-onboarding-ready">
      <dl className="aly-onboarding-ready__summary">
        <div><dt>Creative goals</dt><dd>{configuration.goals.length ? configuration.goals.join(", ") : "Decide later"}</dd></div>
        <div><dt>Runtime</dt><dd>{configuration.runtime ?? "Not selected"}</dd></div>
        <div><dt>Providers</dt><dd>{providerNames.length ? providerNames.join(", ") : "None selected"}</dd></div>
        <div><dt>Models</dt><dd>{modelNames.length ? modelNames.join(", ") : "Choose later"}</dd></div>
        <div><dt>Downloads</dt><dd>{downloadSummary}</dd></div>
        <div><dt>Profile</dt><dd>{configuration.profile.displayName || "Not configured"}</dd></div>
      </dl>
      <p className="aly-onboarding-ready__note">These choices stay editable. Active downloads keep their real progress, and a failed pack remains clearly marked for retry in Models & providers.</p>
    </div>
  );
}

function ChapterContent({
  chapterId,
  controller,
  catalog,
  setup,
  productName,
  brandMarkSrc,
  onAcceptProfileAsset,
  downloads,
}: {
  chapterId: OnboardingChapterId;
  controller: OnboardingController;
  catalog: OnboardingCatalog;
  setup: OnboardingSetupState;
  productName: string;
  brandMarkSrc?: string | undefined;
  onAcceptProfileAsset?: ((file: File) => Promise<ImportedProfileAsset | ProfilePortraitAsset | null>) | undefined;
  downloads: ModelDownloads;
}) {
  const { configuration } = controller.state;
  const fieldName = `aly-onboarding-${chapterId}`;

  switch (chapterId) {
    case "welcome":
      return <WelcomeChapter productName={productName} brandMarkSrc={brandMarkSrc} setup={setup} />;
    case "goal":
      return (
        <fieldset className="aly-onboarding-options">
          <legend className="aly-onboarding-sr-only">Creative goals</legend>
          {catalog.goals.map((goal) => (
            <SelectionCard
              key={goal.id}
              type="checkbox"
              name={fieldName}
              value={goal.id}
              checked={configuration.goals.includes(goal.id)}
              label={goal.label}
              description={goal.description}
              onChange={() => controller.updateConfiguration({ goals: toggleValue(configuration.goals, goal.id) })}
            />
          ))}
        </fieldset>
      );
    case "runtime":
      return (
        <fieldset className="aly-onboarding-options">
          <legend className="aly-onboarding-sr-only">Runtime preference</legend>
          {catalog.runtimes.map((runtime) => (
            <SelectionCard
              key={runtime.id}
              type="radio"
              name={fieldName}
              value={runtime.id}
              checked={configuration.runtime === runtime.id}
              label={runtime.label}
              description={runtime.description}
              badge={runtime.recommended ? "Recommended" : setup.detectedRuntime === runtime.id ? "Detected" : undefined}
              onChange={() => controller.updateConfiguration({ runtime: runtime.id })}
            />
          ))}
        </fieldset>
      );
    case "provider":
      return (
        <fieldset className="aly-onboarding-options aly-onboarding-options--providers">
          <legend className="aly-onboarding-sr-only">Generation providers</legend>
          {catalog.providers.map((provider) => {
            const connected = provider.connected || setup.connectedProviderIds?.includes(provider.id);
            return (
              <SelectionCard
                key={provider.id}
                type="checkbox"
                name={fieldName}
                value={provider.id}
                checked={configuration.providerIds.includes(provider.id)}
                label={provider.name}
                description={provider.description}
                icon={provider.icon}
                badge={connected ? "Connected" : provider.requiresCredential ? "Credential required" : undefined}
                onChange={() => controller.updateConfiguration({ providerIds: toggleValue(configuration.providerIds, provider.id) })}
              />
            );
          })}
          {!catalog.providers.length ? <p className="aly-onboarding-options__empty">No provider options were supplied by the application.</p> : null}
        </fieldset>
      );
    case "hardware":
      return <HardwareChapter setup={setup} reviewed={configuration.hardwareReviewed} onReviewedChange={(hardwareReviewed) => controller.updateConfiguration({ hardwareReviewed })} />;
    case "model":
      return <ModelChapter controller={controller} catalog={catalog} setup={setup} downloads={downloads} />;
    case "profile":
      return <ProfileGallery assets={catalog.portraits} profile={configuration.profile} onChange={(profile) => controller.updateConfiguration({ profile })} onAcceptAsset={onAcceptProfileAsset} />;
    case "ready":
      return <ReadyChapter controller={controller} catalog={catalog} downloads={downloads} />;
  }
}

export function OnboardingDialog({
  controller,
  setupState = {},
  catalog,
  productName = "AI Video Tutorial Generator",
  brandMarkSrc,
  allowSkip = true,
  onAcceptProfileAsset,
  headerAccessory,
}: OnboardingDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  const downloads = useModelDownloads();
  const chapter = onboardingChapters.find((candidate) => candidate.id === controller.state.activeChapterId) ?? onboardingChapters[0]!;
  const activeIndex = chapterIndex(chapter.id);
  const optional = chapter.optional === true;
  const canContinue = canAdvanceOnboarding(controller.state, setupState);
  const canNavigateForward = canContinue;
  const accessibleChapters = useMemo(
    () => new Set<OnboardingChapterId>([
      controller.state.activeChapterId,
      ...controller.state.visitedChapterIds,
      ...controller.state.completedChapterIds,
    ]),
    [controller.state.activeChapterId, controller.state.completedChapterIds, controller.state.visitedChapterIds],
  );

  useEffect(() => {
    if (controller.isOpen && !wasOpen.current) {
      previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    if (!controller.isOpen && wasOpen.current) previousFocus.current?.focus();
    wasOpen.current = controller.isOpen;
  }, [controller.isOpen]);

  useEffect(() => {
    if (controller.isOpen) headingRef.current?.focus();
  }, [chapter.id, controller.isOpen]);

  if (!controller.isOpen) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      controller.exit();
      return;
    }
    if (event.altKey && event.key === "ArrowLeft" && activeIndex > 0) {
      event.preventDefault();
      controller.back();
      return;
    }
    if (event.altKey && event.key === "ArrowRight" && canNavigateForward) {
      event.preventDefault();
      controller.next();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector)].filter((element) => !element.hidden);
    if (!focusable.length) {
      event.preventDefault();
      headingRef.current?.focus();
      return;
    }
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="aly-onboarding-dialog-layer">
      <div className="aly-onboarding-dialog__backdrop" aria-hidden="true" />
      <div
        ref={dialogRef}
        className="aly-onboarding-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onKeyDown={onKeyDown}
      >
        <aside className="aly-onboarding-dialog__rail" aria-label="Onboarding chapters">
          <div className="aly-onboarding-dialog__brand">
            <span className="aly-onboarding-dialog__brand-mark" aria-hidden="true">{brandMarkSrc ? <img src={brandMarkSrc} alt="" /> : null}</span>
            <span>{productName}</span>
          </div>
          <ol className="aly-onboarding-dialog__chapters">
            {onboardingChapters.map((item, index) => {
              const completed = controller.state.completedChapterIds.includes(item.id);
              const current = item.id === chapter.id;
              const available = accessibleChapters.has(item.id);
              return (
                <li key={item.id} className={`aly-onboarding-dialog__chapter${current ? " aly-onboarding-dialog__chapter--current" : ""}${completed ? " aly-onboarding-dialog__chapter--complete" : ""}`}>
                  <button
                    type="button"
                    className="aly-onboarding-dialog__chapter-button"
                    disabled={!available}
                    aria-current={current ? "step" : undefined}
                    onClick={() => controller.goTo(item.id)}
                  >
                    <span className="aly-onboarding-dialog__chapter-index" aria-hidden="true">{completed ? "✓" : index + 1}</span>
                    <span className="aly-onboarding-dialog__chapter-copy"><span>{item.eyebrow}</span><strong>{item.title}</strong></span>
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="aly-onboarding-dialog__rail-footer">
            <span>Progress</span>
            <strong>{activeIndex + 1} of {onboardingChapters.length}</strong>
          </div>
        </aside>

        <main className="aly-onboarding-dialog__main">
          <header className="aly-onboarding-dialog__header">
            <div className="aly-onboarding-dialog__heading-copy">
              <span className="aly-onboarding-dialog__eyebrow">{chapter.eyebrow}</span>
              <h2 ref={headingRef} id={titleId} className="aly-onboarding-dialog__title" tabIndex={-1}>{chapter.title}</h2>
              <p id={descriptionId} className="aly-onboarding-dialog__description">{chapter.description}</p>
            </div>
            <div className="aly-onboarding-dialog__header-actions">
              {headerAccessory}
              <button type="button" className="aly-onboarding-dialog__exit" aria-label="Exit onboarding" onClick={controller.exit}>×</button>
            </div>
          </header>

          <div className="aly-onboarding-dialog__content">
            <ChapterContent chapterId={chapter.id} controller={controller} catalog={catalog} setup={setupState} productName={productName} brandMarkSrc={brandMarkSrc} onAcceptProfileAsset={onAcceptProfileAsset} downloads={downloads} />
          </div>

          {controller.persistenceError ? (
            <p className="aly-onboarding-dialog__persistence-error" role="alert">Your latest onboarding choice could not be saved. You can retry by changing the selection again.</p>
          ) : null}
          {!canContinue ? <p className="aly-onboarding-dialog__requirement" role="status">Choose an option above to continue.</p> : null}

          <footer className="aly-onboarding-dialog__footer">
            <div className="aly-onboarding-dialog__secondary-actions">
              {allowSkip ? <button type="button" className="aly-onboarding-dialog__skip" onClick={controller.skip}>Skip setup</button> : null}
              {optional && !isChapterConfigured(chapter.id, controller.state.configuration, setupState) ? <span className="aly-onboarding-dialog__optional">Optional chapter</span> : null}
            </div>
            <div className="aly-onboarding-dialog__navigation">
              <button type="button" className="aly-onboarding-dialog__back" disabled={activeIndex === 0} onClick={controller.back}>Back</button>
              <button type="button" className="aly-onboarding-dialog__continue" disabled={!canNavigateForward} onClick={controller.next}>
                {chapter.id === "ready" ? `Enter ${productName}` : optional && !isChapterConfigured(chapter.id, controller.state.configuration, setupState) ? "Continue without this" : "Continue"}
              </button>
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}

export function OnboardingReplayButton({
  controller,
  children = "Replay onboarding",
  className = "aly-onboarding-replay",
}: {
  controller: OnboardingController;
  children?: ReactNode;
  className?: string;
}) {
  return <button type="button" className={className} onClick={controller.replay}>{children}</button>;
}
