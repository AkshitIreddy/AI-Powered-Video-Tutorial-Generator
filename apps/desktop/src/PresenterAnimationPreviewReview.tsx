import { Check, RefreshCw, Video } from "lucide-react";
import type { PresenterAnimationPreview } from "./native";
import "./PresenterAnimationPreviewReview.css";

export function PresenterAnimationPreviewReview({
  presenterName,
  preview,
  videoUrl,
  busy,
  onAccept,
  onTryAgain,
}: {
  presenterName: string;
  preview: PresenterAnimationPreview;
  videoUrl: string;
  busy: boolean;
  onAccept: () => Promise<void>;
  onTryAgain: () => Promise<void>;
}) {
  return <section className="presenter-animation-review" aria-label={`Animation preview for ${presenterName}`}>
    <div className="presenter-animation-review__heading">
      <span><Video size={17} aria-hidden="true" /></span>
      <div><strong>{presenterName} · animation preview</strong><small>5 seconds · local SoulX-FlashHead · no API usage</small></div>
    </div>
    <video controls preload="metadata" src={videoUrl} aria-label={`Play ${presenterName} animation preview`} />
    <p>Check the mouth, eyes and motion. Keep it only if the character still looks like your portrait.</p>
    <div className="presenter-animation-review__actions">
      <button type="button" className="secondary-button small" disabled={busy} onClick={() => { void onTryAgain(); }}><RefreshCw size={15} /> Try again</button>
      <button type="button" className="primary-button small" disabled={busy} onClick={() => { void onAccept(); }}><Check size={15} /> Use animation</button>
    </div>
    <small className="presenter-animation-review__identity">Exact portrait {preview.portraitArtifactHash.slice(0, 10)} · model revision {preview.modelRevision}</small>
  </section>;
}
