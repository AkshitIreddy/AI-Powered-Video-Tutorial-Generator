import type { VisualCandidate } from "./visualCandidates";
import { useEffect, useState } from "react";
import { Check, ExternalLink, Image, LoaderCircle, ShieldCheck, TriangleAlert } from "lucide-react";

interface VisualCandidateReviewProps {
  candidates: readonly VisualCandidate[];
  resolve: (hash: string) => Promise<string>;
  onAccept: (candidate: VisualCandidate) => Promise<void>;
}

function isLicensed(candidate: VisualCandidate): boolean {
  return candidate.origin === "licensedMedia";
}

function riskLabel(value: string): string {
  return value.replaceAll("_", " ");
}

/** Images stay inactive until the author has inspected and chosen one. */
export function VisualCandidateReview({ candidates, resolve, onAccept }: VisualCandidateReviewProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = candidates.find((candidate) => candidate.id === selectedId) ?? candidates.at(-1);
  const [preview, setPreview] = useState<{ hash: string; url: string } | null>(null);
  const [loadError, setLoadError] = useState("");
  const [acceptError, setAcceptError] = useState("");
  const [accepting, setAccepting] = useState(false);
  const [portraitReviewed, setPortraitReviewed] = useState(false);
  const [decodedHash, setDecodedHash] = useState<string | null>(null);
  const selectedHash = selected?.artifactHash;
  useEffect(() => {
    let cancelled = false;
    setLoadError("");
    setPortraitReviewed(false);
    if (selectedHash) void resolve(selectedHash).then((url) => {
      if (!cancelled) setPreview({ hash: selectedHash, url });
    }).catch((error: unknown) => {
      if (!cancelled) setLoadError(error instanceof Error ? error.message : "This image could not be loaded.");
    });
    return () => { cancelled = true; };
  }, [selectedHash, resolve]);
  if (!selected) return null;
  const licensed = isLicensed(selected);
  const containsLicensedMedia = candidates.some(isLicensed);
  const resolved = preview !== null && preview.hash === selectedHash && !loadError;
  const ready = resolved && decodedHash === selectedHash;
  const cleared = selected.rights?.exportEligible === true;
  const source = licensed ? selected.licensedSource : undefined;
  const review = licensed ? selected.visualReview : undefined;
  const accept = async () => {
    setAccepting(true);
    setAcceptError("");
    try { await onAccept(selected); }
    catch (error) { setAcceptError(error instanceof Error ? error.message : "The image could not be accepted."); }
    finally { setAccepting(false); }
  };
  return <section className="visual-candidate-review" aria-label={containsLicensedMedia ? "Image candidates" : "Generated image candidates"}>
    <div className="visual-candidate-heading"><Image size={16} /><strong>{containsLicensedMedia ? "Review image candidates" : "Review generated images"}</strong><small>{candidates.length} candidate{candidates.length === 1 ? "" : "s"}</small></div>
    <div className="visual-candidate-tabs" role="group" aria-label="Image candidates">{candidates.map((candidate, index) => <button key={candidate.id} className={candidate.id === selected.id ? "active" : ""} onClick={() => { setSelectedId(candidate.id); setAcceptError(""); }} aria-pressed={candidate.id === selected.id} aria-label={`${candidate.origin === "licensedMedia" ? "Licensed" : "Generated"} image ${index + 1}`}>{index + 1}{candidate.status === "accepted" && <Check size={12} />}</button>)}</div>
    <div className="visual-candidate-image">{loadError ? <p role="alert">{loadError}</p> : resolved ? <img src={preview.url} alt={licensed ? `Licensed image candidate for ${selected.prompt}` : selected.prompt} onLoad={() => setDecodedHash(selected.artifactHash)} onError={() => setLoadError("The saved candidate image could not be decoded.")} /> : <LoaderCircle className="spin" aria-label="Loading image candidate" />}</div>
    <p className="visual-candidate-prompt">{selected.prompt}</p>
    {licensed && source && <div className="candidate-status"><ShieldCheck size={14} /> <strong>Licensed media</strong><dl><dt>Creator</dt><dd>{source.creator}</dd><dt>License</dt><dd>{source.licenseId}</dd><dt>Source</dt><dd><a href={source.sourceUrl} target="_blank" rel="noopener noreferrer">View original landing page <ExternalLink size={12} aria-hidden="true" /></a></dd><dt>Reuse</dt><dd>{selected.rights?.redistribution === "composedWorkOnly" ? "Allowed inside the finished tutorial" : "Redistribution allowed"}</dd></dl></div>}
    {licensed && review && <details open={review.risks.length > 0}><summary>Visual review {review.recommended ? "· recommended candidate" : ""}</summary><p>{review.rationale || "No additional rationale was supplied."}</p><dl><dt>Lesson fit</dt><dd>{review.lessonFit} / 100</dd><dt>Composition</dt><dd>{review.composition} / 100</dd><dt>Technical</dt><dd>{review.technicalQuality} / 100</dd><dt>Overall</dt><dd>{review.overall} / 100</dd><dt>Risks</dt><dd>{review.risks.length ? review.risks.map(riskLabel).join(", ") : "None flagged"}</dd></dl><p className="candidate-status"><TriangleAlert size={13} /> Automated review is guidance. Your explicit choice is still required.</p></details>}
    {!licensed && <details><summary>Generation details</summary><dl><dt>Model</dt><dd>{selected.model}</dd><dt>Provider</dt><dd>{selected.provider}</dd><dt>Seed</dt><dd>{selected.seed}</dd><dt>Use</dt><dd>{selected.role === "presenter" ? "Presenter portrait" : "Scene artwork"}</dd></dl></details>}
    {selected.role === "presenter" && selected.status === "ready" && <label className="candidate-portrait-review"><input type="checkbox" checked={portraitReviewed} onChange={(event) => setPortraitReviewed(event.target.checked)} /><span>I reviewed this fictional presenter’s identity, face, and resting mouth.</span></label>}
    {acceptError && <p role="alert" className="candidate-error">{acceptError}</p>}
    {!cleared && <p className="candidate-status">Preview only · usage rights have not been verified.</p>}
    {selected.status === "ready" ? <button className="primary-button full" disabled={!ready || !cleared || accepting || (selected.role === "presenter" && !portraitReviewed)} onClick={() => { void accept(); }}>{accepting ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}{accepting ? "Saving choice…" : selected.role === "presenter" ? "Use this presenter portrait" : licensed ? "Use this licensed image" : "Use this scene artwork"}</button> : <p className="candidate-status">{selected.status === "accepted" ? "This image is selected for the tutorial." : selected.rejectionReason ?? selected.error ?? `Candidate ${selected.status}.`}</p>}
  </section>;
}
