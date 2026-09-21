import { useMemo } from "react";
import {
  createDefaultCompatibilityContext,
  defaultCatalogItems,
} from "./defaults";
import { resourcePolicyPresets } from "./resourcePolicy";
import type { CatalogItem, CompatibilityContext, HardwareSnapshot } from "./types";
import { ModelLibrary, type CatalogActivationActionState, type CatalogDownloadActionState } from "./ModelLibrary";
import "./catalog.css";

export interface CatalogIntegrationExampleProps {
  hardware: HardwareSnapshot;
  items?: readonly CatalogItem[];
  onModelDownload?: (item: CatalogItem) => void;
  downloadState?: (item: CatalogItem) => CatalogDownloadActionState;
  onModelActivate?: (item: CatalogItem) => void;
  activationState?: (item: CatalogItem) => CatalogActivationActionState | null;
  onUseForWritingProfile?: (item: CatalogItem) => void;
  writingProfileProviderIds?: readonly string[];
  verifiedManagedPackages?: CompatibilityContext["verifiedManagedPackages"];
}

/**
 * Controlled integration seam for the app's model catalog. Native-backed model
 * profiles and downloads are owned by the surrounding Models page; this view
 * only discovers models and evaluates their fit against a fixed display policy.
 */
export function CatalogIntegrationExample({
  hardware,
  items = defaultCatalogItems,
  onModelDownload,
  downloadState,
  onModelActivate,
  activationState,
  onUseForWritingProfile,
  writingProfileProviderIds,
  verifiedManagedPackages,
}: CatalogIntegrationExampleProps) {
  const baseContext = useMemo(
    () => ({
      ...createDefaultCompatibilityContext({ hardware, policy: resourcePolicyPresets.balanced }),
      ...(verifiedManagedPackages ? { verifiedManagedPackages } : {}),
    }),
    [hardware, verifiedManagedPackages],
  );

  return (
    <ModelLibrary
      items={items}
      compatibilityContext={baseContext}
      {...(onModelDownload === undefined ? {} : { onDownload: onModelDownload })}
      {...(downloadState === undefined ? {} : { downloadState })}
      {...(onModelActivate === undefined ? {} : { onActivate: onModelActivate })}
      {...(activationState === undefined ? {} : { activationState })}
      {...(onUseForWritingProfile === undefined
        ? {}
        : { onUseForWritingProfile, writingProfileProviderIds })}
    />
  );
}
