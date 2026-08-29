from __future__ import annotations

import json
import shutil
from collections.abc import Callable
from pathlib import Path

import pytest

from alystria.generation.audio_assets import resolve_audio_customization
from alystria.project import ProjectStore

REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
STARTER_AUDIO_ROOT = REPOSITORY_ROOT / "assets" / "starter" / "audio"


def _snapshot(
    *,
    music_id: str | None = None,
    sfx_id: str | None = None,
    media_assets: list[dict[str, object]] | None = None,
    provenance: list[dict[str, object]] | None = None,
) -> dict[str, object]:
    return {
        "customization": {
            "audio": {
                "musicAssetId": music_id,
                "sfxAssetId": sfx_id,
                "musicLevel": 12,
                "sfxLevel": 28,
                "narrationDucking": 72,
            }
        },
        "mediaAssets": media_assets or [],
        "assetProvenance": provenance or [],
    }


def _imported_asset(
    store: ProjectStore,
    *,
    asset_id: str,
    kind: str,
    media_type: str = "audio/wav",
) -> tuple[dict[str, object], dict[str, object]]:
    artifact = store.add_artifact_bytes(
        b"RIFF\x00\x00\x00\x00WAVEfmt " + asset_id.encode(),
        media_type=media_type,
        original_name="owned.wav",
        metadata={"rightsStatus": "owned", "licenseId": "USER-OWNED"},
    )
    return (
        {
            "id": asset_id,
            "kind": kind,
            "artifactHash": artifact.hash,
            "mediaType": media_type,
            "state": "promoted",
        },
        {
            "id": f"prov-{asset_id}",
            "assetId": asset_id,
            "contentHash": artifact.hash,
            "exportEligible": True,
            "blockers": [],
        },
    )


def test_audio_is_off_without_an_explicit_selection(tmp_path: Path) -> None:
    with ProjectStore.create(tmp_path / "Project", name="Project") as store:
        assert resolve_audio_customization(store, {})["inputs"] == []
        assert resolve_audio_customization(store, _snapshot())["inputs"] == []


def test_project_audio_selection_resolves_only_through_cas_and_provenance(
    tmp_path: Path,
) -> None:
    with ProjectStore.create(tmp_path / "Project", name="Project") as store:
        music, music_proof = _imported_asset(store, asset_id="asset_music", kind="music")
        sfx, sfx_proof = _imported_asset(
            store, asset_id="asset_sfx", kind="soundEffect", media_type="audio/flac"
        )
        result = resolve_audio_customization(
            store,
            _snapshot(
                music_id="asset_music",
                sfx_id="asset_sfx",
                media_assets=[music, sfx],
                provenance=[music_proof, sfx_proof],
            ),
        )

        assert result["mix"] == {"musicDuckingDb": -12.96}
        assert result["inputs"] == [
            {
                "assetId": "asset_music",
                "artifactHash": music["artifactHash"],
                "mediaType": "audio/wav",
                "role": "music",
                "source": "project",
                "gainDb": -18.42,
                "schedule": "full-program-loop",
            },
            {
                "assetId": "asset_sfx",
                "artifactHash": sfx["artifactHash"],
                "mediaType": "audio/flac",
                "role": "sfx",
                "source": "project",
                "gainDb": -11.06,
                "schedule": "scene-emphasis",
            },
        ]


@pytest.mark.parametrize(
    ("mutation", "match"),
    [
        (lambda _asset, proof: proof.update(exportEligible=False), "not cleared"),
        (lambda _asset, proof: proof.update(contentHash="0" * 64), "hash does not match"),
        (lambda asset, _proof: asset.update(kind="backgroundImage"), "wrong media kind"),
        (lambda asset, _proof: asset.update(mediaType="image/png"), "media type does not match"),
    ],
)
def test_project_audio_selection_fails_closed(
    tmp_path: Path,
    mutation: Callable[[dict[str, object], dict[str, object]], None],
    match: str,
) -> None:
    with ProjectStore.create(tmp_path / "Project", name="Project") as store:
        asset, proof = _imported_asset(store, asset_id="asset_music", kind="music")
        mutation(asset, proof)
        with pytest.raises(ValueError, match=match):
            resolve_audio_customization(
                store,
                _snapshot(
                    music_id="asset_music",
                    media_assets=[asset],
                    provenance=[proof],
                ),
            )


def test_starter_audio_is_catalog_resolved_hash_verified_and_promoted(
    tmp_path: Path,
) -> None:
    with ProjectStore.create(tmp_path / "Project", name="Project") as store:
        result = resolve_audio_customization(
            store,
            _snapshot(
                music_id="starter.audio.music.focus-loop",
                sfx_id="starter.audio.sfx.emphasis-a",
            ),
            starter_audio_root=STARTER_AUDIO_ROOT,
        )
        assert [item["source"] for item in result["inputs"]] == ["starter", "starter"]
        assert [item["role"] for item in result["inputs"]] == ["music", "sfx"]
        for item in result["inputs"]:
            digest = str(item["artifactHash"])
            assert store.cas.verify(digest)
            row = store.connection.execute(
                "SELECT media_type, metadata_json FROM artifacts WHERE hash = ?", (digest,)
            ).fetchone()
            assert row is not None and row["media_type"] == "audio/wav"
            metadata = json.loads(row["metadata_json"])
            assert metadata["rightsStatus"] == "owned"
            assert metadata["licenseId"] == "MIT"


def test_starter_audio_requires_runtime_and_rejects_tampered_bytes(tmp_path: Path) -> None:
    with ProjectStore.create(tmp_path / "Project", name="Project") as store:
        with pytest.raises(ValueError, match="runtime is not installed"):
            resolve_audio_customization(
                store,
                _snapshot(music_id="starter.audio.music.focus-loop"),
            )

        copied = tmp_path / "starter-audio"
        shutil.copytree(STARTER_AUDIO_ROOT, copied)
        selected = copied / "music" / "focus-loop.wav"
        selected.write_bytes(selected.read_bytes() + b"tampered")
        with pytest.raises(ValueError, match=r"size does not match|hash does not match"):
            resolve_audio_customization(
                store,
                _snapshot(music_id="starter.audio.music.focus-loop"),
                starter_audio_root=copied,
            )


def test_legacy_studio_ids_resolve_to_current_catalog_entries(tmp_path: Path) -> None:
    with ProjectStore.create(tmp_path / "Project", name="Project") as store:
        result = resolve_audio_customization(
            store,
            _snapshot(music_id="music-light-pulse", sfx_id="sfx-technical"),
            starter_audio_root=STARTER_AUDIO_ROOT,
        )
        assert [item["assetId"] for item in result["inputs"]] == [
            "starter.audio.music.focus-loop",
            "starter.audio.sfx.emphasis-b",
        ]
