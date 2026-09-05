export type StockProvider = "openverse" | "pexels";

export function stockSearchRoutes(policy: unknown): { providers: StockProvider[]; hasReviewer: boolean } {
  if (!policy || typeof policy !== "object" || !("routes" in policy) || !Array.isArray(policy.routes)) return { providers: [], hasReviewer: false };
  const routes = policy.routes.filter((route): route is { capability: unknown; providerIds: unknown } => Boolean(route) && typeof route === "object" && "capability" in route && "providerIds" in route);
  const stock = routes.find((route) => route.capability === "media.licensed.search");
  const providers = Array.isArray(stock?.providerIds) ? stock.providerIds.filter((id): id is StockProvider => id === "openverse" || id === "pexels") : [];
  return { providers: [...new Set(providers)], hasReviewer: routes.some((route) => route.capability === "vlm.chat" && Array.isArray(route.providerIds) && route.providerIds.length > 0) };
}
