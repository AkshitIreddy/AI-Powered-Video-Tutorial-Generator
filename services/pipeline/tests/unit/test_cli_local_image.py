from __future__ import annotations

import json
from pathlib import Path

from alystria.cli import main
from alystria.providers.comfyui_local import (
    COMFYUI_RUNTIME_REVISION,
    SDXL_MODEL_ID,
    ComfyBundleInstaller,
)


def _output(capsys: object) -> dict[str, object]:
    captured = capsys.readouterr()  # type: ignore[attr-defined]
    assert captured.err == ""
    assert captured.out.count("\n") == 1
    value = json.loads(captured.out)
    assert isinstance(value, dict)
    return value


def test_local_image_install_runs_pinned_installer_then_emits_preflight(
    tmp_path: Path, monkeypatch: object, capsys: object
) -> None:
    calls: list[tuple[str, str | None]] = []
    monkeypatch.setattr(  # type: ignore[attr-defined]
        ComfyBundleInstaller,
        "install_runtime",
        lambda self: calls.append(("runtime", None)),
    )
    monkeypatch.setattr(  # type: ignore[attr-defined]
        ComfyBundleInstaller,
        "install_bundle",
        lambda self, model_id: calls.append(("bundle", model_id)),
    )
    monkeypatch.setattr(  # type: ignore[attr-defined]
        ComfyBundleInstaller,
        "preflight",
        lambda self, model_id: {
            "runtimeReady": True,
            "modelId": model_id,
            "recipeId": "comfy-sdxl-1.0-portrait-v1",
            "executable": True,
            "files": [{"path": "model.safetensors", "verified": True}],
        },
    )

    exit_code = main(
        [
            "local-image",
            "install",
            "--runtime-root",
            str(tmp_path),
            "--model-id",
            SDXL_MODEL_ID,
        ]
    )

    assert exit_code == 0
    assert calls == [("runtime", None), ("bundle", SDXL_MODEL_ID)]
    assert _output(capsys) == {
        "ok": True,
        "operation": "install",
        "runtimeRoot": str(tmp_path.resolve()),
        "runtimeReady": True,
        "modelId": SDXL_MODEL_ID,
        "recipeId": "comfy-sdxl-1.0-portrait-v1",
        "executable": True,
        "files": [{"path": "model.safetensors", "verified": True}],
    }


def test_local_image_runtime_install_does_not_download_model_weights(
    tmp_path: Path, monkeypatch: object, capsys: object
) -> None:
    calls: list[str] = []
    monkeypatch.setattr(  # type: ignore[attr-defined]
        ComfyBundleInstaller,
        "install_runtime",
        lambda self: calls.append("runtime"),
    )
    monkeypatch.setattr(  # type: ignore[attr-defined]
        ComfyBundleInstaller,
        "install_bundle",
        lambda self, model_id: calls.append(f"bundle:{model_id}"),
    )
    monkeypatch.setattr(  # type: ignore[attr-defined]
        ComfyBundleInstaller,
        "preflight",
        lambda self, model_id: calls.append(f"preflight:{model_id}"),
    )

    exit_code = main(
        [
            "local-image",
            "install-runtime",
            "--runtime-root",
            str(tmp_path),
        ]
    )

    assert exit_code == 0
    assert calls == ["runtime"]
    assert _output(capsys) == {
        "ok": True,
        "operation": "install-runtime",
        "runtimeRoot": str(tmp_path.resolve()),
        "runtimeReady": True,
        "runtimeRevision": COMFYUI_RUNTIME_REVISION,
    }


def test_local_image_preflight_preserves_downloadable_candidate_status(
    tmp_path: Path, monkeypatch: object, capsys: object
) -> None:
    monkeypatch.setattr(  # type: ignore[attr-defined]
        ComfyBundleInstaller,
        "preflight",
        lambda self, model_id: {
            "runtimeReady": True,
            "modelId": model_id,
            "recipeId": None,
            "executable": False,
            "files": [],
        },
    )

    exit_code = main(
        [
            "local-image",
            "preflight",
            "--runtime-root",
            str(tmp_path),
            "--model-id",
            "local/flux.2-klein-4b-fp8",
        ]
    )

    assert exit_code == 0
    payload = _output(capsys)
    assert payload["modelId"] == "local/flux.2-klein-4b-fp8"
    assert payload["executable"] is False


def test_local_image_failure_is_one_bounded_json_result(
    tmp_path: Path, monkeypatch: object, capsys: object
) -> None:
    monkeypatch.setattr(  # type: ignore[attr-defined]
        ComfyBundleInstaller,
        "preflight",
        lambda self, model_id: (_ for _ in ()).throw(ValueError("unknown bundle")),
    )

    exit_code = main(
        [
            "local-image",
            "preflight",
            "--runtime-root",
            str(tmp_path),
            "--model-id",
            "local/not-allowlisted",
        ]
    )

    assert exit_code == 1
    payload = _output(capsys)
    assert payload["ok"] is False
    assert payload["error"] == {
        "code": "local_image_preflight_failed",
        "message": "unknown bundle",
    }
