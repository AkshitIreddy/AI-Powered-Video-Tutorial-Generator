from __future__ import annotations

from pathlib import Path

from alystria.jobs.keys import ActionKey, DependencyGraph
from alystria.project import ProjectStore


def test_action_key_is_canonical_but_preserves_ordered_inputs() -> None:
    first = ActionKey("render", "2", {"b": 2, "a": 1}, ("one", "two"), seed=42)
    same = ActionKey("render", "2", {"a": 1, "b": 2}, ("one", "two"), seed=42)
    reordered = ActionKey("render", "2", {"a": 1, "b": 2}, ("two", "one"), seed=42)
    assert first.digest == same.digest
    assert first.digest != reordered.digest


def test_dependency_invalidation_is_transitive_and_scoped(tmp_path: Path) -> None:
    with ProjectStore.create(tmp_path / "project", name="Graph") as store:
        graph = DependencyGraph(store.connection, store.manifest.project_id)
        graph.record_node("pronunciation", "p1")
        graph.record_node("narration:1", "n1", upstream_keys=["pronunciation"])
        graph.record_node("captions:1", "c1", upstream_keys=["narration:1"])
        graph.record_node("scene:2", "s2")
        assert graph.invalidate_from(["pronunciation"]) == [
            "captions:1",
            "narration:1",
            "pronunciation",
        ]
        assert graph.stale_nodes() == ["captions:1", "narration:1", "pronunciation"]
