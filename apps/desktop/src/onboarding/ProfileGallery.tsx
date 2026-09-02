import { useId, useRef, useState, type ChangeEvent } from "react";
import type { ImportedProfileAsset, ProfileGalleryProps, ProfilePortraitAsset } from "./types";

function normalizeImportedAsset(
  value: ImportedProfileAsset | ProfilePortraitAsset | null,
): ProfilePortraitAsset | null {
  if (!value) return null;
  if ("asset" in value) return value.accepted ? value.asset : null;
  return value;
}

export function ProfileGallery({
  assets,
  profile,
  onChange,
  onAcceptAsset,
  acceptedFileTypes = "image/png,image/jpeg,image/webp",
  disabled = false,
  heading = "Choose a profile portrait",
  description = "Select a studio portrait or add an image from your device.",
}: ProfileGalleryProps) {
  const nameId = useId();
  const descriptionId = useId();
  const nameHintId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importedAsset, setImportedAsset] = useState<ProfilePortraitAsset | null>(null);
  const [importStatus, setImportStatus] = useState<"idle" | "loading" | "accepted" | "rejected" | "error">("idle");
  const [importError, setImportError] = useState("");
  const visibleAssets = importedAsset && !assets.some((asset) => asset.id === importedAsset.id)
    ? [...assets, importedAsset]
    : assets;

  const choosePortrait = (portraitAssetId: string) => {
    onChange({ ...profile, portraitAssetId });
  };

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !onAcceptAsset) return;

    setImportStatus("loading");
    setImportError("");
    try {
      const accepted = normalizeImportedAsset(await onAcceptAsset(file));
      if (!accepted) {
        setImportStatus("rejected");
        return;
      }
      setImportedAsset(accepted);
      setImportStatus("accepted");
      choosePortrait(accepted.id);
    } catch (error) {
      setImportStatus("error");
      setImportError(error instanceof Error ? error.message : "The portrait could not be imported.");
    }
  };

  return (
    <section className="aly-onboarding-profile" aria-labelledby={`${nameId}-heading`}>
      <div className="aly-onboarding-profile__header">
        <div>
          <h3 id={`${nameId}-heading`} className="aly-onboarding-profile__title">{heading}</h3>
          <p id={descriptionId} className="aly-onboarding-profile__description">{description}</p>
        </div>
        {onAcceptAsset ? (
          <div className="aly-onboarding-profile__import">
            <input
              ref={fileInputRef}
              className="aly-onboarding-profile__file-input"
              type="file"
              accept={acceptedFileTypes}
              disabled={disabled || importStatus === "loading"}
              onChange={(event) => void importFile(event)}
              aria-label="Import a profile portrait"
            />
            <button
              type="button"
              className="aly-onboarding-profile__import-button"
              disabled={disabled || importStatus === "loading"}
              onClick={() => fileInputRef.current?.click()}
            >
              {importStatus === "loading" ? "Importing…" : "Add portrait"}
            </button>
          </div>
        ) : null}
      </div>

      <fieldset className="aly-onboarding-profile__gallery" aria-describedby={descriptionId} disabled={disabled}>
        <legend className="aly-onboarding-profile__legend">Available portraits</legend>
        <div className="aly-onboarding-profile__grid">
          {visibleAssets.map((asset) => {
            const selected = profile.portraitAssetId === asset.id;
            return (
              <label
                key={asset.id}
                className={`aly-onboarding-profile__portrait${selected ? " aly-onboarding-profile__portrait--selected" : ""}${asset.disabled ? " aly-onboarding-profile__portrait--disabled" : ""}`}
              >
                <input
                  className="aly-onboarding-profile__portrait-radio"
                  type="radio"
                  name={`${nameId}-portrait`}
                  value={asset.id}
                  checked={selected}
                  disabled={asset.disabled}
                  onChange={() => choosePortrait(asset.id)}
                />
                <span className="aly-onboarding-profile__portrait-frame" aria-hidden="true">
                  <img className="aly-onboarding-profile__portrait-image" src={asset.src} alt="" />
                  <span className="aly-onboarding-profile__portrait-check">✓</span>
                </span>
                <span className="aly-onboarding-profile__portrait-copy">
                  <span className="aly-onboarding-profile__portrait-label">{asset.label}</span>
                  {asset.style ? <span className="aly-onboarding-profile__portrait-style">{asset.style}</span> : null}
                </span>
                <span className="aly-onboarding-sr-only">{asset.alt}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="aly-onboarding-profile__name-field">
        <label className="aly-onboarding-profile__name-label" htmlFor={nameId}>Display name</label>
        <input
          id={nameId}
          className="aly-onboarding-profile__name-input"
          type="text"
          value={profile.displayName}
          maxLength={80}
          autoComplete="name"
          aria-describedby={nameHintId}
          disabled={disabled}
          onChange={(event) => onChange({ ...profile, displayName: event.target.value })}
        />
        <span id={nameHintId} className="aly-onboarding-profile__name-hint">This appears in the account area. It is not sent to providers automatically.</span>
      </div>

      <div className="aly-onboarding-profile__status" role="status" aria-live="polite">
        {importStatus === "accepted" ? "Portrait added and selected." : null}
        {importStatus === "rejected" ? "That portrait was not accepted. Choose another file." : null}
        {importStatus === "error" ? importError : null}
      </div>
    </section>
  );
}
