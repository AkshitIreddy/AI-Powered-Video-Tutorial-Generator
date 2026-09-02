import { useMemo, useState } from "react";
import { CatalogModule } from "./CatalogModule";
import {
  createDefaultCompatibilityContext,
  createDefaultRoutingProfile,
  defaultCatalogItems,
} from "./defaults";
import { resourcePolicyPresets } from "./resourcePolicy";
import type { CatalogItem, HardwareSnapshot } from "./types";
import "./catalog.css";

export interface CatalogIntegrationExampleProps {
  hardware: HardwareSnapshot;
  items?: readonly CatalogItem[];
  onModelSelected?: (item: CatalogItem) => void;
}

/**
 * Controlled integration seam for App.tsx or a settings route. Replace `items`
 * after each adapter sync; persist profile and policy changes in the host app.
 */
export function CatalogIntegrationExample({
  hardware,
  items = defaultCatalogItems,
  onModelSelected,
}: CatalogIntegrationExampleProps) {
  const [routingProfile, setRoutingProfile] = useState(() => createDefaultRoutingProfile());
  const [resourcePolicy, setResourcePolicy] = useState(resourcePolicyPresets.balanced);
  const baseContext = useMemo(
    () => createDefaultCompatibilityContext({ hardware, policy: resourcePolicy }),
    [hardware, resourcePolicy],
  );

  return (
    <CatalogModule
      items={items}
      hardware={hardware}
      compatibilityContext={baseContext}
      contextFor={(capability) => ({ ...baseContext, capability })}
      routingProfile={routingProfile}
      resourcePolicy={resourcePolicy}
      onRoutingProfileChange={setRoutingProfile}
      onResourcePolicyChange={setResourcePolicy}
      {...(onModelSelected === undefined ? {} : { onSelect: onModelSelected })}
    />
  );
}
