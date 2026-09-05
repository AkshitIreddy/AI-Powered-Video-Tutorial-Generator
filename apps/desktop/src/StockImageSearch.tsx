import { useEffect, useState } from "react";
import { Search } from "lucide-react";

import { stockSearchRoutes, type StockProvider } from "./stockSearchRoutes";

export function StockImageSearch({ policy, sceneId, suggestedQuery, busy, onSearch }: { policy: unknown; sceneId: string; suggestedQuery: string; busy: boolean; onSearch: (provider: StockProvider, query: string) => Promise<void> }) {
  const { providers, hasReviewer } = stockSearchRoutes(policy);
  const [query, setQuery] = useState(suggestedQuery.slice(0, 240));
  const [selected, setSelected] = useState<StockProvider>("openverse");
  useEffect(() => { setQuery(suggestedQuery.slice(0, 240)); }, [sceneId, suggestedQuery]);
  const provider = providers.includes(selected) ? selected : providers[0];
  const configured = Boolean(provider) && hasReviewer;
  return <section className="creative-control-card stock-image-search" aria-label="Find stock photos">
    <span className="section-kicker">Photographs for the lesson</span>
    <h4>Find an existing picture</h4>
    <p>Search licensed photographs, then let your image reviewer check relevance and visible defects. You choose which candidate to use.</p>
    {!configured ? <p className="inspector-note">Choose optional Stock photos and Image review routes in your model profile before creating this tutorial. Included artwork is always available in Library.</p> : <>
      <label className="creative-field"><span>Photo library</span><select value={provider} disabled={busy} onChange={(event) => setSelected(event.target.value as StockProvider)}>{providers.map((id) => <option key={id} value={id}>{id === "openverse" ? "Openverse · public domain" : "Pexels · credited photos"}</option>)}</select></label>
      <label className="creative-field"><span>Photo search</span><input value={query} maxLength={240} disabled={busy} onChange={(event) => setQuery(event.target.value)} /></label>
      <p className="inspector-note">The approved services receive this search and lesson context. Up to eight previews are checked; up to three choices stay in your project with their credits.</p>
      <button className="secondary-button full" disabled={busy || !query.trim()} onClick={() => { if (provider) void onSearch(provider, query.trim()); }}><Search size={15} />{busy ? "Finding pictures…" : "Find and review photos"}</button>
    </>}
  </section>;
}
