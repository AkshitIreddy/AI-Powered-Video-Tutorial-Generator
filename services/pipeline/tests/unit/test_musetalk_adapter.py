from __future__ import annotations

import importlib.util
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[4]
ADAPTER = ROOT / "services" / "pipeline" / "scripts" / "musetalk_v15_adapter.py"


def _adapter_module():
    spec = importlib.util.spec_from_file_location("test_musetalk_v15_adapter", ADAPTER)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_identity_composite_changes_only_the_feathered_lip_aperture() -> None:
    np = pytest.importorskip("numpy")
    pytest.importorskip("cv2")
    adapter = _adapter_module()
    source = np.zeros((100, 100, 3), dtype=np.uint8)
    generated = np.full_like(source, 255)

    result = adapter._identity_preserving_get_image(
        source,
        generated,
        [20, 10, 80, 90],
        upstream_get_image=lambda *_args, **_kwargs: generated,
        mode="raw",
        fp=object(),
    )

    assert result.shape == source.shape
    assert int(result[66, 50, 0]) >= 250
    assert int(result[20, 50, 0]) == 0
    assert int(result[90, 50, 0]) == 0
    assert int(result[66, 10, 0]) == 0


def test_webp_portrait_is_normalized_inside_attempt_workspace(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    adapter = _adapter_module()
    portrait = tmp_path / "portrait.webp"
    portrait.write_bytes(b"verified-webp-input")
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    decoded = SimpleNamespace(size=16)

    def write_png(path: str, image: object) -> bool:
        assert image is decoded
        Path(path).write_bytes(b"\x89PNG\r\n\x1a\nnormalized")
        return True

    fake_cv2 = SimpleNamespace(
        IMREAD_UNCHANGED=-1,
        imread=lambda path, mode: decoded if Path(path) == portrait and mode == -1 else None,
        imwrite=write_png,
    )
    monkeypatch.setitem(__import__("sys").modules, "cv2", fake_cv2)

    normalized = adapter._normalize_portrait_for_upstream(portrait, workspace)

    assert normalized == workspace / "portrait-normalized.png"
    assert portrait.read_bytes() == b"verified-webp-input"
    assert normalized.read_bytes().startswith(b"\x89PNG")
