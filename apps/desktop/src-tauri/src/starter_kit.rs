//! Typed desktop-side starter-kit trust boundary.
//!
//! JSON Schema is canonical; these closed serde records prevent a catalog from
//! smuggling executable fields into the privileged broker and add the relational
//! checks that schema alone cannot express.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StarterKitManifest {
    pub schema_version: u32,
    pub id: String,
    pub version: String,
    pub name: String,
    pub description: String,
    pub defaults: StarterKitDefaults,
    pub assets: Vec<StarterAsset>,
    pub theme_packs: Vec<StarterThemePack>,
    pub user_asset_slots: Vec<UserAssetSlot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StarterKitDefaults {
    pub music_enabled: bool,
    pub effects_enabled: bool,
    pub remote_fetch_during_render: bool,
    pub unknown_rights_block_export: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StarterAsset {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub description: String,
    pub tags: Vec<String>,
    pub source: StarterAssetSource,
    pub license: StarterAssetLicense,
    pub provenance: StarterAssetProvenance,
    pub technical: StarterAssetTechnical,
    pub accessibility: StarterAssetAccessibility,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StarterAssetSource {
    pub delivery: String,
    pub availability: String,
    pub relative_path: Option<String>,
    pub content_hash: Option<String>,
    pub byte_size: Option<u64>,
    pub download_uri: Option<String>,
    pub family_names: Option<Vec<String>>,
    pub fallback_asset_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StarterAssetLicense {
    pub status: String,
    pub expression: String,
    pub name: String,
    pub license_uri: Option<String>,
    pub copyright_notice: Option<String>,
    pub attribution_required: bool,
    pub attribution_text: Option<String>,
    pub redistribution_allowed: bool,
    pub commercial_use_allowed: bool,
    pub derivatives_allowed: bool,
    pub export_allowed: bool,
    pub restrictions: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StarterAssetProvenance {
    pub origin: String,
    pub creator: String,
    pub creation_method: String,
    pub source_uri: Option<String>,
    pub source_revision: Option<String>,
    pub tool: Option<String>,
    pub model: Option<String>,
    pub prompt_artifact_id: Option<String>,
    pub prompt_availability: Option<String>,
    pub synthetic: Option<bool>,
    pub c2pa_status: Option<String>,
    pub ingredient_asset_ids: Option<Vec<String>>,
    pub recorded_at: String,
    pub review_status: String,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StarterAssetTechnical {
    pub media_type: String,
    pub render_safe: bool,
    pub remote_fetch_required: bool,
    pub dimensions: Option<Dimensions>,
    pub duration_ms: Option<u64>,
    pub loopable: Option<bool>,
    pub sample_rate: Option<u32>,
    pub channels: Option<u8>,
    pub integrated_lufs: Option<f64>,
    pub font_weights: Option<Vec<u16>>,
    pub variable_font: Option<bool>,
    pub script_coverage: Option<Vec<String>>,
    pub renderer_recipe: Option<String>,
    pub safe_area_percent: Option<f64>,
    pub transparent_background: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Dimensions {
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StarterAssetAccessibility {
    pub reduced_motion_safe: bool,
    pub high_contrast_safe: bool,
    pub description: Option<String>,
    pub transcript_label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StarterThemePack {
    pub id: String,
    pub theme_id: String,
    pub name: String,
    pub description: String,
    pub defaults: StarterThemeDefaults,
    pub alternatives: StarterThemeAlternatives,
    pub audio_defaults: StarterAudioDefaults,
    pub presenter_defaults: StarterPresenterDefaults,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StarterThemeDefaults {
    pub background_asset_id: String,
    pub overlay_asset_id: Option<String>,
    pub transition_asset_id: String,
    pub display_font_asset_id: String,
    pub body_font_asset_id: String,
    pub code_font_asset_id: String,
    pub presenter_style_asset_id: String,
    pub presenter_portrait_asset_id: Option<String>,
    pub lower_third_asset_id: Option<String>,
    pub caption_style_asset_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StarterThemeAlternatives {
    pub background_asset_ids: Vec<String>,
    pub transition_asset_ids: Vec<String>,
    pub font_asset_ids: Vec<String>,
    pub presenter_style_asset_ids: Vec<String>,
    pub presenter_portrait_asset_ids: Vec<String>,
    pub music_asset_ids: Vec<String>,
    pub sound_effect_asset_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StarterAudioDefaults {
    pub music_enabled: bool,
    pub effects_enabled: bool,
    pub music_gain_db: f64,
    pub effects_gain_db: f64,
    pub ducking_db: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StarterPresenterDefaults {
    pub usage: String,
    pub placement: String,
    pub maximum_coverage_percent: f64,
    pub allow_user_portrait: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UserAssetSlot {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub description: String,
    pub accepted_media_types: Vec<String>,
    pub accepted_extensions: Option<Vec<String>>,
    pub maximum_bytes: u64,
    pub multiple: bool,
    pub rights_attestation_required: bool,
    pub provenance_required: bool,
    pub consent_required: bool,
    pub normalization: String,
    pub minimum_dimensions: Option<Dimensions>,
    pub maximum_duration_ms: Option<u64>,
    pub guidance: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StarterKitValidationIssue {
    pub code: &'static str,
    pub path: String,
    pub message: String,
}

impl StarterKitManifest {
    pub fn from_value(value: Value) -> Result<Self, serde_json::Error> {
        serde_json::from_value(value)
    }

    pub fn validate(&self) -> Vec<StarterKitValidationIssue> {
        let mut issues = Vec::new();
        if self.schema_version != 1 {
            issue(
                &mut issues,
                "starter.unsupported-schema",
                "/schemaVersion",
                format!("Unsupported starter-kit schema: {}", self.schema_version),
            );
        }
        if self.defaults.music_enabled
            || self.defaults.effects_enabled
            || self.defaults.remote_fetch_during_render
            || !self.defaults.unknown_rights_block_export
        {
            issue(&mut issues, "starter.unsafe-defaults", "/defaults", "Starter-kit safety defaults must keep audio opt-in, disable render-time fetches, and block unknown rights".into());
        }

        let mut assets = BTreeMap::new();
        for (index, asset) in self.assets.iter().enumerate() {
            if assets.insert(asset.id.as_str(), asset).is_some() {
                issue(
                    &mut issues,
                    "starter.duplicate-id",
                    format!("/assets/{index}/id"),
                    format!("Duplicate asset id: {}", asset.id),
                );
            }
            if asset.source.availability == "ready" && !asset.technical.render_safe {
                issue(
                    &mut issues,
                    "starter.ready-asset-not-render-safe",
                    format!("/assets/{index}/technical/renderSafe"),
                    format!("Ready asset is not render-safe: {}", asset.id),
                );
            }
            if asset.technical.remote_fetch_required {
                issue(
                    &mut issues,
                    "starter.remote-render-fetch",
                    format!("/assets/{index}/technical/remoteFetchRequired"),
                    format!("Remote render fetch is forbidden: {}", asset.id),
                );
            }
            if asset.license.status != "cleared" && asset.license.export_allowed {
                issue(
                    &mut issues,
                    "starter.uncleared-export",
                    format!("/assets/{index}/license"),
                    format!("Uncleared asset cannot permit export: {}", asset.id),
                );
            }
            if matches!(
                asset.source.delivery.as_str(),
                "bundled-file" | "optional-download"
            ) && !asset
                .source
                .content_hash
                .as_deref()
                .is_some_and(valid_sha256)
            {
                issue(
                    &mut issues,
                    "starter.missing-integrity",
                    format!("/assets/{index}/source/contentHash"),
                    format!("File-backed asset lacks a SHA-256: {}", asset.id),
                );
            }
            if asset.source.delivery == "bundled-file" && asset.source.relative_path.is_none() {
                issue(
                    &mut issues,
                    "starter.missing-path",
                    format!("/assets/{index}/source/relativePath"),
                    format!("Bundled asset lacks a relative path: {}", asset.id),
                );
            }
        }

        let mut themes = BTreeSet::new();
        let mut pack_ids = BTreeSet::new();
        for (index, pack) in self.theme_packs.iter().enumerate() {
            if !pack_ids.insert(pack.id.as_str()) {
                issue(
                    &mut issues,
                    "starter.duplicate-id",
                    format!("/themePacks/{index}/id"),
                    format!("Duplicate theme pack id: {}", pack.id),
                );
            }
            themes.insert(pack.theme_id.as_str());
            for (field, id, kinds) in pack.references() {
                match assets.get(id) {
                    None => issue(
                        &mut issues,
                        "starter.missing-asset",
                        format!("/themePacks/{index}/{field}"),
                        format!("Unknown starter asset: {id}"),
                    ),
                    Some(asset) if !kinds.contains(&asset.kind.as_str()) => issue(
                        &mut issues,
                        "starter.wrong-asset-kind",
                        format!("/themePacks/{index}/{field}"),
                        format!("Asset {id} has kind {}", asset.kind),
                    ),
                    Some(_) => {}
                }
            }
        }
        for required in [
            "minimal",
            "academic",
            "modern-tech",
            "notebook",
            "documentary",
            "playful",
            "childrens-education",
            "corporate-training",
            "light",
            "dark",
        ] {
            if !themes.contains(required) {
                issue(
                    &mut issues,
                    "starter.missing-theme-pack",
                    "/themePacks",
                    format!("Missing starter pack for theme: {required}"),
                );
            }
        }
        let mut slots = BTreeSet::new();
        for (index, slot) in self.user_asset_slots.iter().enumerate() {
            if !slots.insert(slot.id.as_str()) {
                issue(
                    &mut issues,
                    "starter.duplicate-upload-slot",
                    format!("/userAssetSlots/{index}/id"),
                    format!("Duplicate upload slot: {}", slot.id),
                );
            }
        }
        issues
    }
}

type Reference<'a> = (&'static str, &'a str, &'static [&'static str]);

impl StarterThemePack {
    fn references(&self) -> Vec<Reference<'_>> {
        let mut values = vec![
            (
                "defaults/backgroundAssetId",
                self.defaults.background_asset_id.as_str(),
                &["background", "overlay"][..],
            ),
            (
                "defaults/transitionAssetId",
                self.defaults.transition_asset_id.as_str(),
                &["transition"][..],
            ),
            (
                "defaults/displayFontAssetId",
                self.defaults.display_font_asset_id.as_str(),
                &["font"][..],
            ),
            (
                "defaults/bodyFontAssetId",
                self.defaults.body_font_asset_id.as_str(),
                &["font"][..],
            ),
            (
                "defaults/codeFontAssetId",
                self.defaults.code_font_asset_id.as_str(),
                &["font"][..],
            ),
            (
                "defaults/presenterStyleAssetId",
                self.defaults.presenter_style_asset_id.as_str(),
                &["presenter-style"][..],
            ),
        ];
        optional_ref(
            &mut values,
            "defaults/overlayAssetId",
            self.defaults.overlay_asset_id.as_deref(),
            &["overlay"],
        );
        optional_ref(
            &mut values,
            "defaults/presenterPortraitAssetId",
            self.defaults.presenter_portrait_asset_id.as_deref(),
            &["presenter-portrait"],
        );
        optional_ref(
            &mut values,
            "defaults/lowerThirdAssetId",
            self.defaults.lower_third_asset_id.as_deref(),
            &["lower-third"],
        );
        optional_ref(
            &mut values,
            "defaults/captionStyleAssetId",
            self.defaults.caption_style_asset_id.as_deref(),
            &["caption-style"],
        );
        list_refs(
            &mut values,
            "alternatives/backgroundAssetIds",
            &self.alternatives.background_asset_ids,
            &["background", "overlay"],
        );
        list_refs(
            &mut values,
            "alternatives/transitionAssetIds",
            &self.alternatives.transition_asset_ids,
            &["transition"],
        );
        list_refs(
            &mut values,
            "alternatives/fontAssetIds",
            &self.alternatives.font_asset_ids,
            &["font"],
        );
        list_refs(
            &mut values,
            "alternatives/presenterStyleAssetIds",
            &self.alternatives.presenter_style_asset_ids,
            &["presenter-style"],
        );
        list_refs(
            &mut values,
            "alternatives/presenterPortraitAssetIds",
            &self.alternatives.presenter_portrait_asset_ids,
            &["presenter-portrait"],
        );
        list_refs(
            &mut values,
            "alternatives/musicAssetIds",
            &self.alternatives.music_asset_ids,
            &["music"],
        );
        list_refs(
            &mut values,
            "alternatives/soundEffectAssetIds",
            &self.alternatives.sound_effect_asset_ids,
            &["sound-effect"],
        );
        values
    }
}

fn optional_ref<'a>(
    values: &mut Vec<Reference<'a>>,
    field: &'static str,
    id: Option<&'a str>,
    kinds: &'static [&'static str],
) {
    if let Some(id) = id {
        values.push((field, id, kinds));
    }
}

fn list_refs<'a>(
    values: &mut Vec<Reference<'a>>,
    field: &'static str,
    ids: &'a [String],
    kinds: &'static [&'static str],
) {
    values.extend(ids.iter().map(|id| (field, id.as_str(), kinds)));
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn issue(
    issues: &mut Vec<StarterKitValidationIssue>,
    code: &'static str,
    path: impl Into<String>,
    message: String,
) {
    issues.push(StarterKitValidationIssue {
        code,
        path: path.into(),
        message,
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unknown_fields_at_the_deserialization_boundary() {
        let result = StarterKitManifest::from_value(serde_json::json!({
            "schemaVersion": 1, "id": "starter.test", "version": "1.0.0", "name": "Test", "description": "Test",
            "defaults": { "musicEnabled": false, "effectsEnabled": false, "remoteFetchDuringRender": false, "unknownRightsBlockExport": true },
            "assets": [], "themePacks": [], "userAssetSlots": [], "postInstall": "run-me"
        }));
        assert!(result.is_err());
    }

    #[test]
    fn sha256_check_requires_lowercase_hex() {
        assert!(valid_sha256(&"a".repeat(64)));
        assert!(!valid_sha256(&"G".repeat(64)));
        assert!(!valid_sha256("abc"));
    }
}
