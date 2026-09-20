"""Developer-only bridge from the reviewed SoulX candidate into Sandbox Models.

This file is intentionally outside the packaged ``alystria-pipeline`` CLI. End
users install only from the pinned public archives and wheelhouse declared by
the bundled manifest.
"""

from __future__ import annotations

import argparse
import importlib
import json
import sys
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
PIPELINE_SOURCE = REPOSITORY_ROOT / "services" / "pipeline" / "src"
sys.path.insert(0, str(PIPELINE_SOURCE))


def main() -> int:
    installer = importlib.import_module("alystria.presenter_runtime_install")
    parser = argparse.ArgumentParser(
        description="Stage the exact reviewed SoulX candidate without activating it."
    )
    parser.add_argument("--models-root", required=True, type=Path)
    parser.add_argument("--candidate-root", required=True, type=Path)
    parser.add_argument("--trusted-runtime-root", required=True, type=Path)
    arguments = parser.parse_args()
    try:
        result = installer.stage_candidate(
            arguments.models_root,
            arguments.candidate_root,
            arguments.trusted_runtime_root,
            developer_mode=True,
        )
        payload = {
            "ok": True,
            **result,
            "operation": "stage-reviewed-candidate",
            "activationRequested": False,
        }
    except (OSError, ValueError, installer.PresenterRuntimeInstallError) as error:
        payload = {
            "ok": False,
            "operation": "stage-reviewed-candidate",
            "error": str(error)[:500],
        }
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    return 0 if payload["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
