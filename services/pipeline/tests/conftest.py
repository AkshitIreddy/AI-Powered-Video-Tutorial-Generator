from __future__ import annotations

import os
import sys
from pathlib import Path

SOURCE_ROOT = Path(__file__).parents[1] / "src"
if str(SOURCE_ROOT) not in sys.path:
    sys.path.insert(0, str(SOURCE_ROOT))

# The production service fails closed when no signed runtime pack is present.
# Tests deliberately opt into the deterministic fixture renderer instead of
# receiving it as a silent fallback.
os.environ.setdefault("ALYSTRIA_RENDERER_MODE", "fixture")
