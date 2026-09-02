from __future__ import annotations

import importlib.util
from pathlib import Path

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
