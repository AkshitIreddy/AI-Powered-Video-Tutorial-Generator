import { getProviderBrandAsset } from "./brands";

export interface ProviderMarkProps {
  providerId: string;
  compact?: boolean;
}

export function ProviderMark({ providerId, compact = false }: ProviderMarkProps) {
  const brand = getProviderBrandAsset(providerId);
  const initials = brand.displayName
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <span className="aly-catalog-provider" data-provider={brand.providerId} title={`Provider: ${brand.displayName}`}>
      {brand.mayRender && brand.assetPath ? (
        <img className="aly-catalog-provider__art" src={brand.assetPath} alt="" />
      ) : (
        <span className="aly-catalog-provider__monogram" aria-hidden="true">{initials || "AI"}</span>
      )}
      {!compact && <span className="aly-catalog-provider__name">{brand.displayName}</span>}
      <span className="aly-catalog-sr-only">
        {brand.mayRender ? "Governed provider artwork" : "Text identifier; no provider artwork bundled"}
      </span>
    </span>
  );
}
