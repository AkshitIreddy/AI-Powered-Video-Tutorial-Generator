import { useMemo, useState } from "react";
import { Check, Download, ImagePlus, Images, LoaderCircle, Search, Shapes } from "lucide-react";
import { bundledAssets, type BundledAsset, type BundledAssetKind } from "./bundledAssets";
import "./bundledAssetLibrary.css";

export interface BundledAssetLibraryProps {
  onUse?: (asset: BundledAsset) => Promise<void>;
}

type KindFilter = "all" | BundledAssetKind;

export function BundledAssetLibrary({ onUse }: BundledAssetLibraryProps) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [category, setCategory] = useState("all");
  const [busyAssetId, setBusyAssetId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const categories = useMemo(
    () => [...new Set(bundledAssets.map((asset) => asset.category))].sort((left, right) => left.localeCompare(right)),
    [],
  );
  const visibleAssets = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return bundledAssets.filter((asset) => {
      if (kind !== "all" && asset.kind !== kind) return false;
      if (category !== "all" && asset.category !== category) return false;
      if (!needle) return true;
      return `${asset.label} ${asset.description} ${asset.category} ${asset.kind}`.toLocaleLowerCase().includes(needle);
    });
  }, [category, kind, query]);

  const addAssetToProject = async (asset: BundledAsset) => {
    if (!onUse || busyAssetId) return;
    setBusyAssetId(asset.id);
    setFeedback(null);
    try {
      await onUse(asset);
      setFeedback({
        tone: "success",
        message: `${asset.label} is in the project library.`,
      });
    } catch (error) {
      setFeedback({
        tone: "error",
        message: error instanceof Error && error.message ? error.message : `${asset.label} could not be added to the project.`,
      });
    } finally {
      setBusyAssetId(null);
    }
  };

  return (
    <section className="bundled-library" aria-labelledby="bundled-library-title">
      <div className="bundled-library__heading">
        <div className="bundled-library__eyebrow"><Images size={15} /> Included offline</div>
        <h2 id="bundled-library-title">Teaching images, ready before generation</h2>
        <p>Start with polished slide backgrounds and reusable teaching elements. They are part of the app, so browsing and using them needs no account, API key, or network request.</p>
        <div className="bundled-library__tally" aria-label={`${bundledAssets.length} included assets`}>
          <strong>{bundledAssets.length}</strong>
          <span>included assets</span>
        </div>
      </div>

      <div className="bundled-library__toolbar">
        <label className="bundled-library__search">
          <Search size={17} aria-hidden="true" />
          <input aria-label="Search included assets" value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Search science, computing, history…" />
        </label>
        <div className="bundled-library__kinds" aria-label="Asset kind">
          {(["all", "background", "element"] as const).map((value) => (
            <button key={value} type="button" className={kind === value ? "active" : ""} aria-pressed={kind === value} onClick={() => setKind(value)}>
              {value === "all" ? "All" : value === "background" ? "Slide backgrounds" : "Teaching elements"}
            </button>
          ))}
        </div>
        <label className="bundled-library__category">
          <span>Category</span>
          <select value={category} onChange={(event) => setCategory(event.currentTarget.value)}>
            <option value="all">Every subject</option>
            {categories.map((value) => <option value={value} key={value}>{value}</option>)}
          </select>
        </label>
      </div>

      {feedback && <div className={`bundled-library__feedback ${feedback.tone}`} role={feedback.tone === "error" ? "alert" : "status"}>{feedback.tone === "success" && <Check size={16} />}{feedback.message}</div>}

      {visibleAssets.length ? (
        <div className="bundled-library__grid" aria-live="polite">
          {visibleAssets.map((asset) => {
            const busy = busyAssetId === asset.id;
            return (
              <article className={`bundled-asset-card bundled-asset-card--${asset.kind}`} key={asset.id} aria-busy={busy}>
                <div className="bundled-asset-card__preview">
                  <img src={asset.url} alt={asset.description} loading="lazy" />
                  <span>{asset.kind === "element" ? <Shapes size={14} /> : <Images size={14} />}{asset.category}</span>
                </div>
                <div className="bundled-asset-card__body">
                  <div>
                    <h3>{asset.label}</h3>
                    <p>{asset.description}</p>
                  </div>
                  <small>{formatAssetSize(asset.byteSize)} · PNG · verified copy</small>
                  <div className="bundled-asset-card__actions">
                    {onUse && <button type="button" disabled={busyAssetId !== null} onClick={() => void addAssetToProject(asset)}>{busy ? <LoaderCircle className="spin" size={16} /> : <ImagePlus size={16} />}{busy ? "Adding…" : asset.kind === "background" ? "Use background" : "Use element"}</button>}
                    <a href={asset.url} download={asset.filename}><Download size={15} />Download</a>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="bundled-library__empty">
          <Search size={22} />
          <strong>No included assets match</strong>
          <span>Try another subject or show every asset.</span>
          <button type="button" onClick={() => { setQuery(""); setKind("all"); setCategory("all"); }}>Clear filters</button>
        </div>
      )}
    </section>
  );
}

function formatAssetSize(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default BundledAssetLibrary;
