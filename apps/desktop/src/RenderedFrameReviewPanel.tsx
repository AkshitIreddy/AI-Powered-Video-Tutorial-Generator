import { Eye, CircleAlert } from "lucide-react";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function RenderedFrameReviewPanel({ value, generationId, mediaHash }: { value: unknown; generationId?: string | undefined; mediaHash?: string | undefined }) {
  const review = record(value);
  if (!review) return null;
  const current = Boolean(generationId && mediaHash && /^[a-f0-9]{64}$/.test(mediaHash) && review.generationId === generationId && review.renderArtifactHash === mediaHash);
  const frames = Array.isArray(review.sampledFrames) ? review.sampledFrames.map(record).filter((frame) => frame && typeof frame.timestampSeconds === "number" && Number.isFinite(frame.timestampSeconds) && frame.timestampSeconds >= 0).slice(0, 6) : [];
  const findings = Array.isArray(review.findings) ? review.findings.map(record).filter((finding) => finding && typeof finding.sceneId === "string" && typeof finding.timestampSeconds === "number" && Number.isFinite(finding.timestampSeconds) && finding.timestampSeconds >= 0 && typeof finding.rationale === "string" && ["critical", "major", "minor", "info"].includes(String(finding.severity).toLowerCase())).slice(0, 20) : [];
  const validReview = Array.isArray(review.sampledFrames) && frames.length === review.sampledFrames.length && frames.length > 0 && Array.isArray(review.findings) && findings.length === review.findings.length && typeof review.reportArtifactHash === "string" && /^[a-f0-9]{64}$/.test(review.reportArtifactHash);
  const reviewed = current && review.status === "reviewed" && validReview;
  const reason = review.reason === "no_explicit_vlm_route" ? "No image-review provider was selected for this tutorial." : review.reason === "private_project" ? "The selected profile does not support image review for these sources." : "An automated frame review is not available for this render.";
  return <section className="rendered-frame-review" aria-label="Rendered frame review">
    <h3><Eye size={16} /> Rendered frame review</h3>
    {!current ? <p>This review belongs to an earlier output. It does not assess the video currently shown.</p> : !reviewed ? <p>{reason} Review the video yourself before exporting.</p> : <>
      <p>{frames.length} sampled frames were reviewed in time order. This is a check for visible layout and presentation problems, not a review of every frame or proof that the lesson is correct.</p>
      <details><summary>{findings.length ? `${findings.length} observations to inspect` : "No problems flagged in the sampled frames"}</summary>
        <p>Sample times: {frames.map((frame) => formatSeconds(Number(frame?.timestampSeconds))).join(", ")}.</p>
        {findings.map((finding, index) => <article key={index}><strong><CircleAlert size={14} /> {formatSeconds(Number(finding?.timestampSeconds))} · {String(finding?.sceneId)}</strong><p>{String(finding?.rationale)}</p><small>{String(finding?.severity).toLowerCase()} · inspect in the video</small></article>)}
        {typeof review.providerId === "string" && typeof review.model === "string" && <p className="reviewer-source">Reviewed by {review.providerId} · {review.model}</p>}
      </details>
    </>}
  </section>;
}

function formatSeconds(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}
