import { useState } from "react";
import { Cpu, LibraryBig, Route } from "lucide-react";
import { ModelLibrary, type ModelLibraryProps } from "./ModelLibrary";
import { ModelRoutingSettings } from "./ModelRoutingSettings";
import { ResourcePolicySettings } from "./ResourcePolicySettings";
import type { CatalogCapability, CompatibilityContext, HardwareSnapshot, ResourcePolicy, RoutingProfile } from "./types";

export type CatalogModuleView = "library" | "routing" | "resources";

export interface CatalogModuleProps extends ModelLibraryProps {
  routingProfile: RoutingProfile;
  resourcePolicy: ResourcePolicy;
  hardware: HardwareSnapshot;
  contextFor: (capability: CatalogCapability) => CompatibilityContext;
  onRoutingProfileChange: (profile: RoutingProfile) => void;
  onResourcePolicyChange: (policy: ResourcePolicy) => void;
  initialView?: CatalogModuleView;
}

const views = [
  { id: "library", label: "Model library", icon: LibraryBig },
  { id: "routing", label: "Capability routes", icon: Route },
  { id: "resources", label: "Resource policy", icon: Cpu },
] as const;

export function CatalogModule({
  routingProfile,
  resourcePolicy,
  hardware,
  contextFor,
  onRoutingProfileChange,
  onResourcePolicyChange,
  initialView = "library",
  ...libraryProps
}: CatalogModuleProps) {
  const [view, setView] = useState<CatalogModuleView>(initialView);
  return (
    <div className="aly-catalog-shell">
      <nav className="aly-catalog-tabs" aria-label="Model settings sections">
        {views.map(({ id, label, icon: Icon }) => (
          <button
            type="button"
            key={id}
            className={view === id ? "is-active" : undefined}
            aria-current={view === id ? "page" : undefined}
            onClick={() => setView(id)}
          >
            <Icon size={17} aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <main className="aly-catalog-view">
        {view === "library" && <ModelLibrary {...libraryProps} />}
        {view === "routing" && <ModelRoutingSettings profile={routingProfile} items={libraryProps.items} contextFor={contextFor} onChange={onRoutingProfileChange} />}
        {view === "resources" && <ResourcePolicySettings policy={resourcePolicy} hardware={hardware} onChange={onResourcePolicyChange} />}
      </main>
    </div>
  );
}
