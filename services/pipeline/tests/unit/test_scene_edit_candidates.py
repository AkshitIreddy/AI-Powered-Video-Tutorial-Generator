from __future__ import annotations

import copy
from pathlib import Path
from typing import Any

import pytest

from alystria.jobs.runtime import CancellationRequested
from alystria.project import ProjectStore
from alystria.scene_edit_candidates import (
    SceneEditProviderResult,
    SceneEditUsageIdentity,
    accept_scene_edit_candidate,
    generate_scene_edit_candidates,
    reject_scene_edit_candidate,
)


class Context:
    task_key = "scene-edit-task"

    def __init__(self) -> None:
        self.checks = 0
        self.progress: list[tuple[float, str | None]] = []
        self.accepted: list[dict[str, Any]] = []

    def check_cancelled(self) -> None:
        self.checks += 1

    def set_progress(self, progress: float, *, message: str | None = None) -> None:
        self.progress.append((progress, message))

    def record_provider_acceptance(self, **values: Any) -> dict[str, Any]:
        self.accepted.append(values)
        return values


class CancellingContext(Context):
    def check_cancelled(self) -> None:
        super().check_cancelled()
        if self.checks >= 2:
            raise CancellationRequested("cancelled after the provider response")


class Provider:
    def __init__(self, proposals: list[dict[str, Any]]) -> None:
        self.proposals = proposals
        self.calls: list[dict[str, Any]] = []

    def propose_scene_edit(
        self,
        scene: dict[str, Any],
        *,
        instruction: str,
        focus: str,
        alternative_index: int,
        preservation_locks: tuple[str, ...],
    ) -> SceneEditProviderResult:
        self.calls.append(
            {
                "scene": scene,
                "instruction": instruction,
                "focus": focus,
                "alternativeIndex": alternative_index,
                "locks": preservation_locks,
            }
        )
        return SceneEditProviderResult(
            proposal=copy.deepcopy(self.proposals[alternative_index]),
            idempotency_key=f"provider-key-{alternative_index}",
            usage=SceneEditUsageIdentity(
                "approved-writing-provider",
                "writing-model-v1",
                request_id=f"request-{alternative_index}",
                actual_cost_micros=17,
                units={"outputTokens": 42},
            ),
        )


def _proposal(
    suffix: str = "clearer",
    *,
    narration: str | None = None,
    objective: str | None = None,
    duration_seconds: int = 10,
) -> dict[str, Any]:
    return {
        # Provider-supplied identity-like fields are deliberately ignored.
        "id": "provider-must-not-own-this",
        "title": f"Binary search, {suffix}",
        "narration": narration or f"A {suffix} explanation narrows the interval one half at a time.",
        "objective": objective or "Show how the search interval shrinks.",
        "durationSeconds": duration_seconds,
        "visualIntent": "Show the active interval shrinking without changing the accepted artwork.",
    }


def _project(tmp_path: Path) -> ProjectStore:
    return ProjectStore.create(
        tmp_path / "scene-edit-candidates",
        name="Scene edit candidates",
        initial_snapshot={
            "projectId": "temporary",
            "title": "Scene edit candidates",
            "scenes": [
                {
                    "id": "scene-one",
                    "title": "Binary search",
                    "narration": "The interval becomes smaller after each comparison.",
                    "objective": "Show how the search interval shrinks.",
                    "durationTicks": 2_400_000,
                    "visualIntent": "Show one search interval.",
                    "visualAssetId": "accepted-artwork",
                    "authored": {
                        "id": "scene-one",
                        "type": "diagram",
                        "title": "Binary search",
                        "narration": "The interval becomes smaller after each comparison.",
                        "visualIntent": "Show one search interval.",
                        "durationTicks": 2_400_000,
                        "onScreenText": ["Remaining interval"],
                    },
                }
            ],
            "payload": {
                "storyboard": {
                    "scenes": [
                        {
                            "id": "scene-one",
                            "type": "diagram",
                            "title": "Binary search",
                            "narration": "The interval becomes smaller after each comparison.",
                            "visualIntent": "Show one search interval.",
                            "durationTicks": 2_400_000,
                            "onScreenText": ["Remaining interval"],
                        }
                    ]
                }
            },
        },
    )


def _params(head_id: str, **overrides: Any) -> dict[str, Any]:
    return {
        "expectedHeadRevisionId": head_id,
        "sceneId": "scene-one",
        "focus": "explanation",
        "instruction": "Use a concrete explanation.",
        "preservationLocks": ["learningobjective"],
        "alternatives": 2,
        **overrides,
    }


def test_generation_persists_authored_candidates_without_changing_scene(tmp_path: Path) -> None:
    with _project(tmp_path) as store:
        initial = store.head_revision()
        assert initial is not None
        provider = Provider([_proposal("with a number line"), _proposal("with an analogy")])
        context = Context()

        result = generate_scene_edit_candidates(
            store, provider, context, _params(initial.revision_id)
        )

        current = store.head_revision()
        assert current is not None
        assert current.snapshot["scenes"] == initial.snapshot["scenes"]
        assert result["acceptedSceneUnchanged"] is True
        assert result["readyCount"] == 2
        candidates = current.snapshot["sceneEditCandidates"]
        assert [item["id"] for item in candidates] == result["candidateIds"]
        assert all(item["id"].startswith("scene_edit_") for item in candidates)
        assert all(item["id"] != "provider-must-not-own-this" for item in candidates)
        assert all(item["status"] == "ready" for item in candidates)
        assert all(item["proposed"]["durationSeconds"] == 10 for item in candidates)
        assert all(len(item["originalHash"]) == 64 for item in candidates)
        assert len(context.accepted) == 2
        assert context.accepted[0]["provider"] == "approved-writing-provider"


def test_acceptance_is_undoable_and_supersedes_an_accepted_scene_proposal(
    tmp_path: Path,
) -> None:
    with _project(tmp_path) as store:
        initial = store.head_revision()
        assert initial is not None
        first_generation = generate_scene_edit_candidates(
            store,
            Provider([_proposal("first")]),
            Context(),
            _params(initial.revision_id, alternatives=1),
        )
        first_accept = accept_scene_edit_candidate(
            store,
            {
                "expectedHeadRevisionId": first_generation["headRevisionId"],
                "candidateId": first_generation["candidateIds"][0],
            },
        )
        accepted_once = store.head_revision()
        assert accepted_once is not None
        accepted_scene = accepted_once.snapshot["scenes"][0]
        assert accepted_scene["title"] == "Binary search, first"
        assert accepted_scene["narration"].startswith("A first explanation")
        assert accepted_scene["objective"] == "Show how the search interval shrinks."
        assert accepted_scene["durationTicks"] == 2_400_000
        assert accepted_scene["visualAssetId"] == "accepted-artwork"
        assert accepted_scene["authored"] == {
            "id": "scene-one",
            "type": "diagram",
            "title": "Binary search, first",
            "narration": "A first explanation narrows the interval one half at a time.",
            "visualIntent": "Show the active interval shrinking without changing the accepted artwork.",
            "durationTicks": 2_400_000,
            "onScreenText": ["Remaining interval"],
        }
        assert accepted_once.snapshot["payload"]["storyboard"]["scenes"][0] == (
            accepted_scene["authored"]
        )

        second_generation = generate_scene_edit_candidates(
            store,
            Provider([_proposal("second", duration_seconds=12)]),
            Context(),
            _params(first_accept["headRevisionId"], alternatives=1, preservationLocks=[]),
        )
        second_accept = accept_scene_edit_candidate(
            store,
            {
                "expectedHeadRevisionId": second_generation["headRevisionId"],
                "candidateId": second_generation["candidateIds"][0],
            },
        )

        current = store.head_revision()
        assert current is not None
        statuses = {item["id"]: item["status"] for item in current.snapshot["sceneEditCandidates"]}
        assert statuses[first_generation["candidateIds"][0]] == "rejected"
        assert statuses[second_generation["candidateIds"][0]] == "accepted"
        assert current.snapshot["scenes"][0]["durationTicks"] == 2_880_000
        assert current.snapshot["scenes"][0]["authored"]["durationTicks"] == 2_880_000
        assert current.snapshot["payload"]["storyboard"]["scenes"][0][
            "durationTicks"
        ] == 2_880_000
        navigation = store.connection.execute(
            "SELECT undo_stack_json FROM revision_navigation WHERE singleton=1"
        ).fetchone()
        assert navigation is not None
        assert second_generation["headRevisionId"] in navigation["undo_stack_json"]
        assert second_accept["changedFields"] == [
            "durationSeconds",
            "narration",
            "title",
        ]


def test_accepting_another_alternative_from_the_same_batch_supersedes_the_first(
    tmp_path: Path,
) -> None:
    with _project(tmp_path) as store:
        initial = store.head_revision()
        assert initial is not None
        generated = generate_scene_edit_candidates(
            store,
            Provider([_proposal("first choice"), _proposal("second choice")]),
            Context(),
            _params(initial.revision_id),
        )
        accepted_first = accept_scene_edit_candidate(
            store,
            {
                "expectedHeadRevisionId": generated["headRevisionId"],
                "candidateId": generated["candidateIds"][0],
            },
        )
        accept_scene_edit_candidate(
            store,
            {
                "expectedHeadRevisionId": accepted_first["headRevisionId"],
                "candidateId": generated["candidateIds"][1],
            },
        )

        current = store.head_revision()
        assert current is not None
        statuses = {
            item["id"]: item["status"] for item in current.snapshot["sceneEditCandidates"]
        }
        assert statuses[generated["candidateIds"][0]] == "rejected"
        assert statuses[generated["candidateIds"][1]] == "accepted"
        assert current.snapshot["scenes"][0]["title"] == "Binary search, second choice"


def test_rejection_is_durable_and_does_not_edit_the_scene(tmp_path: Path) -> None:
    with _project(tmp_path) as store:
        initial = store.head_revision()
        assert initial is not None
        generated = generate_scene_edit_candidates(
            store,
            Provider([_proposal()]),
            Context(),
            _params(initial.revision_id, alternatives=1),
        )
        rejected = reject_scene_edit_candidate(
            store,
            {
                "expectedHeadRevisionId": generated["headRevisionId"],
                "candidateId": generated["candidateIds"][0],
                "reason": "Does not fit this lesson.",
            },
        )

        current = store.head_revision()
        assert current is not None
        candidate = current.snapshot["sceneEditCandidates"][0]
        assert rejected["status"] == "rejected"
        assert candidate["status"] == "rejected"
        assert candidate["rejectionReason"] == "Does not fit this lesson."
        assert current.snapshot["scenes"] == initial.snapshot["scenes"]


def test_acceptance_preserves_seconds_duration_representation(tmp_path: Path) -> None:
    store = ProjectStore.create(
        tmp_path / "seconds-duration",
        name="Seconds duration",
        initial_snapshot={
            "scenes": [
                {
                    "id": "scene-one",
                    "title": "Before",
                    "narration": "A complete narration before the proposed edit.",
                    "objective": "Keep the same learning objective.",
                    "duration": 9.5,
                }
            ]
        },
    )
    with store:
        initial = store.head_revision()
        assert initial is not None
        proposal = _proposal("seconds", duration_seconds=12)
        proposal["objective"] = "Keep the same learning objective."
        generated = generate_scene_edit_candidates(
            store,
            Provider([proposal]),
            Context(),
            _params(initial.revision_id, alternatives=1),
        )
        accept_scene_edit_candidate(
            store,
            {
                "expectedHeadRevisionId": generated["headRevisionId"],
                "candidateId": generated["candidateIds"][0],
            },
        )
        scene = store.head_revision().snapshot["scenes"][0]  # type: ignore[union-attr]
        assert scene["duration"] == 12
        assert "durationTicks" not in scene


def test_stale_heads_and_changed_source_scene_are_rejected(tmp_path: Path) -> None:
    with _project(tmp_path) as store:
        initial = store.head_revision()
        assert initial is not None
        with pytest.raises(ValueError, match="became stale"):
            generate_scene_edit_candidates(
                store,
                Provider([_proposal()]),
                Context(),
                _params("rev_stale", alternatives=1),
            )

        generated = generate_scene_edit_candidates(
            store,
            Provider([_proposal()]),
            Context(),
            _params(initial.revision_id, alternatives=1),
        )
        generated_head = store.head_revision()
        assert generated_head is not None
        edited_snapshot = copy.deepcopy(generated_head.snapshot)
        edited_snapshot["scenes"][0]["title"] = "Changed after generation"
        edited = store.create_revision(
            snapshot=edited_snapshot,
            kind="edit",
            message="Concurrent scene edit",
            expected_head=generated_head.revision_id,
        )
        with pytest.raises(ValueError, match="source scene changed"):
            accept_scene_edit_candidate(
                store,
                {
                    "expectedHeadRevisionId": edited.revision_id,
                    "candidateId": generated["candidateIds"][0],
                },
            )
        with pytest.raises(ValueError, match="became stale"):
            reject_scene_edit_candidate(
                store,
                {
                    "expectedHeadRevisionId": generated_head.revision_id,
                    "candidateId": generated["candidateIds"][0],
                },
            )


def test_cancellation_after_provider_response_creates_no_revision(tmp_path: Path) -> None:
    with _project(tmp_path) as store:
        initial = store.head_revision()
        assert initial is not None
        with pytest.raises(CancellationRequested):
            generate_scene_edit_candidates(
                store,
                Provider([_proposal()]),
                CancellingContext(),
                _params(initial.revision_id, alternatives=1),
            )
        assert store.head_revision().revision_id == initial.revision_id  # type: ignore[union-attr]


@pytest.mark.parametrize(
    ("locks", "proposal", "message"),
    [
        (
            ["narration"],
            _proposal(narration="This changes narration despite its preservation lock."),
            "Narration preservation lock",
        ),
        (
            ["learningobjective"],
            _proposal(objective="Teach an entirely different objective."),
            "exact objective",
        ),
        (["timing"], _proposal(duration_seconds=11), "exact scene duration"),
    ],
)
def test_preservation_locks_reject_conflicting_provider_output(
    tmp_path: Path,
    locks: list[str],
    proposal: dict[str, Any],
    message: str,
) -> None:
    with _project(tmp_path) as store:
        initial = store.head_revision()
        assert initial is not None
        with pytest.raises(ValueError, match=message):
            generate_scene_edit_candidates(
                store,
                Provider([proposal]),
                Context(),
                _params(initial.revision_id, alternatives=1, preservationLocks=locks),
            )
        assert store.head_revision().revision_id == initial.revision_id  # type: ignore[union-attr]


@pytest.mark.parametrize(
    "proposal",
    [
        {"title": "Missing required authored fields"},
        _proposal(duration_seconds=10) | {"narration": "x" * 4_001},
        _proposal(duration_seconds=10) | {"durationTicks": 2_400_000},
        _proposal(duration_seconds=10) | {"durationSeconds": 10_801},
    ],
)
def test_malformed_provider_output_is_atomic(tmp_path: Path, proposal: dict[str, Any]) -> None:
    with _project(tmp_path) as store:
        initial = store.head_revision()
        assert initial is not None
        with pytest.raises(ValueError):
            generate_scene_edit_candidates(
                store,
                Provider([proposal]),
                Context(),
                _params(initial.revision_id, alternatives=1, preservationLocks=[]),
            )
        assert store.head_revision().revision_id == initial.revision_id  # type: ignore[union-attr]


def test_scene_must_exist_exactly_once_and_request_bounds_are_enforced(tmp_path: Path) -> None:
    with _project(tmp_path) as store:
        initial = store.head_revision()
        assert initial is not None
        with pytest.raises(ValueError, match="does not exist exactly once"):
            generate_scene_edit_candidates(
                store,
                Provider([_proposal()]),
                Context(),
                _params(initial.revision_id, sceneId="scene-missing", alternatives=1),
            )
        with pytest.raises(ValueError, match="alternatives"):
            generate_scene_edit_candidates(
                store,
                Provider([_proposal()]),
                Context(),
                _params(initial.revision_id, alternatives=5),
            )
        with pytest.raises(ValueError, match="instruction"):
            generate_scene_edit_candidates(
                store,
                Provider([_proposal()]),
                Context(),
                _params(initial.revision_id, alternatives=1, instruction="x" * 4_001),
            )
