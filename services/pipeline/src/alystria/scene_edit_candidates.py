"""Durable, review-first authored edits for one tutorial scene.

Generation stores validated proposals without changing the accepted scene.
Acceptance is a separate, optimistic revision that applies one exact proposal;
rejection is also durable so a dismissed proposal does not reappear as ready.
"""

from __future__ import annotations

import copy
import hashlib
import json
import math
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol, cast

from .project import ProjectHistory, ProjectStore
from .project.models import Revision, utc_now

TICKS_PER_SECOND = 240_000
MAX_ALTERNATIVES = 4
MAX_INSTRUCTION_CHARS = 4_000
MAX_TITLE_CHARS = 160
MAX_NARRATION_CHARS = 4_000
MAX_OBJECTIVE_CHARS = 1_000
MAX_VISUAL_INTENT_CHARS = 2_000
MAX_DURATION_SECONDS = 10_800
MAX_SAFE_INTEGER = 2**53 - 1

FOCUSES = frozenset({"explanation", "pacing"})
PRESERVATION_LOCKS = frozenset(
    {"narration", "citations", "learningobjective", "timing", "assets", "presenter"}
)
SCENE_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
CANDIDATE_ID_PATTERN = re.compile(r"^scene_edit_[0-9a-f]{32}$")
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")


@dataclass(frozen=True, slots=True)
class SceneEditUsageIdentity:
    """Provider identity and billable usage attached to one proposal."""

    provider_id: str
    model: str
    request_id: str | None = None
    actual_cost_micros: int = 0
    units: Mapping[str, float] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class SceneEditProviderResult:
    """Provider-neutral proposal response accepted by this module."""

    proposal: Mapping[str, Any]
    idempotency_key: str
    usage: SceneEditUsageIdentity


class StructuredSceneEditResponse(Protocol):
    """Structural shape returned by the structured-writing adapter."""

    @property
    def proposal(self) -> Mapping[str, Any]: ...

    @property
    def idempotency_key(self) -> str: ...

    @property
    def provider_result(self) -> object: ...


class SceneEditProvider(Protocol):
    def propose_scene_edit(
        self,
        scene: Mapping[str, Any],
        *,
        instruction: str,
        focus: str,
        alternative_index: int,
        preservation_locks: tuple[str, ...],
    ) -> SceneEditProviderResult | StructuredSceneEditResponse: ...


class SceneEditJobContext(Protocol):
    task_key: str

    def check_cancelled(self) -> None: ...


def generate_scene_edit_candidates(
    store: ProjectStore,
    provider: SceneEditProvider,
    context: SceneEditJobContext,
    params: Mapping[str, Any],
) -> dict[str, Any]:
    """Persist one to four authored alternatives without editing the scene."""

    head = _current_head(store, params)
    scene_id = _scene_id(params.get("sceneId"))
    scene = _scene(head.snapshot, scene_id)
    original = _scene_payload(scene)
    focus = _enum(params.get("focus"), FOCUSES, "focus")
    instruction = _bounded_text(
        params.get("instruction"), "instruction", MAX_INSTRUCTION_CHARS, strip=True
    )
    alternatives = _integer(params.get("alternatives", 1), "alternatives", 1, MAX_ALTERNATIVES)
    locks = _preservation_locks(params.get("preservationLocks", []))
    task_key = _bounded_text(getattr(context, "task_key", None), "context.task_key", 1_000)
    base_generation_id_value = params.get("baseGenerationId")
    base_generation_id = (
        None
        if base_generation_id_value is None
        else _bounded_text(base_generation_id_value, "baseGenerationId", 160)
    )

    candidates: list[dict[str, Any]] = []
    for index in range(alternatives):
        context.check_cancelled()
        candidate_id = _candidate_id(task_key, head.revision_id, scene_id, focus, index)
        _set_progress(
            context,
            0.05 + (index / alternatives) * 0.8,
            f"Writing scene proposal {index + 1} of {alternatives}",
        )
        raw_result = provider.propose_scene_edit(
            copy.deepcopy(scene),
            instruction=instruction,
            focus=focus,
            alternative_index=index,
            preservation_locks=locks,
        )
        context.check_cancelled()
        proposal_value, idempotency_key, usage = _provider_response(raw_result)
        proposal = _proposal_payload(proposal_value, original)
        _enforce_locks(original, proposal, locks)
        changed_fields = _changed_fields(original, proposal)
        candidate = {
            "id": candidate_id,
            "sceneId": scene_id,
            "status": "ready",
            "focus": focus,
            "instruction": instruction,
            "alternativeIndex": index,
            "baseRevisionId": head.revision_id,
            "baseGenerationId": base_generation_id,
            "preservationLocks": list(locks),
            "originalScene": copy.deepcopy(original),
            "originalHash": _canonical_hash(original),
            "proposed": copy.deepcopy(proposal),
            "changedFields": changed_fields,
            "provider": usage.provider_id,
            "model": usage.model,
            "providerRequestId": usage.request_id,
            "idempotencyKey": idempotency_key,
            "actualCostMicros": usage.actual_cost_micros,
            "usageUnits": dict(usage.units),
            "createdAt": utc_now(),
            "acceptedSceneUnchanged": True,
        }
        candidate["integrityHash"] = _candidate_integrity_hash(candidate)
        _record_provider_acceptance(context, candidate)
        candidates.append(candidate)

    # Provider calls may be slow. Cancellation and a fresh-head check both run
    # immediately before the sole project mutation.
    context.check_cancelled()
    _current_head(store, {"expectedHeadRevisionId": head.revision_id})
    snapshot = copy.deepcopy(head.snapshot)
    snapshot["sceneEditCandidates"] = [
        *_records(snapshot, "sceneEditCandidates"),
        *copy.deepcopy(candidates),
    ]
    revision = store.create_revision(
        snapshot=snapshot,
        kind="generation",
        message=f"Generated authored scene proposals for {scene_id}",
        expected_head=head.revision_id,
    )
    ProjectHistory(store).record_new_revision(head.revision_id, revision)
    _set_progress(context, 1.0, "Scene proposals are ready for review")
    return {
        "operation": "generate_scene_edit_candidates",
        "projectId": store.manifest.project_id,
        "sceneId": scene_id,
        "focus": focus,
        "baseRevisionId": head.revision_id,
        "baseGenerationId": base_generation_id,
        "headRevisionId": revision.revision_id,
        "revisionNumber": revision.number,
        "candidateIds": [item["id"] for item in candidates],
        "candidates": copy.deepcopy(candidates),
        "readyCount": len(candidates),
        "acceptedSceneUnchanged": True,
    }


def accept_scene_edit_candidate(
    store: ProjectStore, params: Mapping[str, Any]
) -> dict[str, Any]:
    """Apply exactly one ready proposal in a new undoable approval revision."""

    head = _current_head(store, params)
    candidate_id = _candidate_id_value(params.get("candidateId"))
    candidates = _records(head.snapshot, "sceneEditCandidates")
    candidate = _unique_record(candidates, candidate_id, "scene edit candidate")
    validated = _validated_candidate(store, candidate)
    if validated["status"] != "ready":
        raise ValueError("Only a ready scene edit candidate can be accepted")

    scene_id = validated["sceneId"]
    scenes = _records(head.snapshot, "scenes")
    current_scene = _unique_record(scenes, scene_id, "scene")
    current_payload = _scene_payload(current_scene)
    if current_payload != validated["originalScene"] and not _matches_accepted_candidate(
        store, candidates, scene_id, current_payload
    ):
        raise ValueError("Scene edit candidate is stale because its source scene changed")
    _enforce_locks(
        current_payload,
        validated["proposed"],
        tuple(validated["preservationLocks"]),
    )

    updated_scene = copy.deepcopy(current_scene)
    for key in ("title", "narration", "objective", "visualIntent"):
        if key in validated["proposed"]:
            updated_scene[key] = validated["proposed"][key]
    duration_key = "durationTicks" if "durationTicks" in current_payload else "duration"
    proposed_seconds = validated["proposed"]["durationSeconds"]
    updated_scene[duration_key] = (
        round(proposed_seconds * TICKS_PER_SECOND)
        if duration_key == "durationTicks"
        else proposed_seconds
    )
    _synchronize_authored_scene(updated_scene, validated["proposed"], proposed_seconds)

    now = utc_now()
    updated_candidates: list[dict[str, Any]] = []
    for item in candidates:
        updated = copy.deepcopy(item)
        if updated.get("id") == candidate_id:
            updated.update({"status": "accepted", "acceptedAt": now})
        elif updated.get("sceneId") == scene_id and updated.get("status") == "accepted":
            updated.update(
                {
                    "status": "rejected",
                    "rejectedAt": now,
                    "rejectionReason": "superseded by another accepted scene edit",
                }
            )
        updated_candidates.append(updated)

    snapshot = copy.deepcopy(head.snapshot)
    snapshot["scenes"] = [
        updated_scene if item.get("id") == scene_id else copy.deepcopy(item) for item in scenes
    ]
    _synchronize_storyboard_scene(snapshot, scene_id, validated["proposed"], proposed_seconds)
    snapshot["sceneEditCandidates"] = updated_candidates
    snapshot["mediaInvalidatedAt"] = now
    revision = store.create_revision(
        snapshot=snapshot,
        kind="approval",
        message=f"Accepted authored scene proposal {candidate_id}",
        expected_head=head.revision_id,
    )
    ProjectHistory(store).record_new_revision(head.revision_id, revision)
    return {
        "operation": "accept_scene_edit_candidate",
        "projectId": store.manifest.project_id,
        "candidateId": candidate_id,
        "sceneId": scene_id,
        "baseRevisionId": validated["baseRevisionId"],
        "baseGenerationId": validated["baseGenerationId"],
        "headRevisionId": revision.revision_id,
        "revisionNumber": revision.number,
        "changedFields": copy.deepcopy(validated["changedFields"]),
        "preservationLocks": copy.deepcopy(validated["preservationLocks"]),
        "originalHash": validated["originalHash"],
        "status": "accepted",
    }


def _synchronize_authored_scene(
    scene: dict[str, Any], proposal: Mapping[str, Any], duration_seconds: int | float
) -> None:
    """Keep the renderer-owned storyboard copy aligned with an accepted edit."""

    authored = scene.get("authored")
    if not isinstance(authored, Mapping):
        return
    synchronized = copy.deepcopy(dict(authored))
    synchronized["title"] = proposal["title"]
    synchronized["narration"] = proposal["narration"]
    synchronized["visualIntent"] = proposal.get("visualIntent", proposal["objective"])
    synchronized["durationTicks"] = round(duration_seconds * TICKS_PER_SECOND)
    synchronized.pop("duration", None)
    scene["authored"] = synchronized


def _synchronize_storyboard_scene(
    snapshot: dict[str, Any],
    scene_id: str,
    proposal: Mapping[str, Any],
    duration_seconds: int | float,
) -> None:
    """Update the generated storyboard copy preferred by desktop hydration."""

    payload = snapshot.get("payload")
    if not isinstance(payload, Mapping):
        return
    storyboard = payload.get("storyboard")
    if not isinstance(storyboard, Mapping):
        return
    storyboard_scenes = storyboard.get("scenes")
    if not isinstance(storyboard_scenes, list):
        return
    matches = [
        index
        for index, item in enumerate(storyboard_scenes)
        if isinstance(item, Mapping) and item.get("id") == scene_id
    ]
    if len(matches) != 1:
        raise ValueError(
            f"Generated storyboard scene {scene_id} does not exist exactly once"
        )
    synchronized = copy.deepcopy(dict(cast(Mapping[str, Any], storyboard_scenes[matches[0]])))
    synchronized["title"] = proposal["title"]
    synchronized["narration"] = proposal["narration"]
    synchronized["visualIntent"] = proposal.get("visualIntent", proposal["objective"])
    synchronized["durationTicks"] = round(duration_seconds * TICKS_PER_SECOND)
    synchronized.pop("duration", None)
    updated_scenes = copy.deepcopy(storyboard_scenes)
    updated_scenes[matches[0]] = synchronized
    updated_storyboard = copy.deepcopy(dict(storyboard))
    updated_storyboard["scenes"] = updated_scenes
    updated_payload = copy.deepcopy(dict(payload))
    updated_payload["storyboard"] = updated_storyboard
    snapshot["payload"] = updated_payload


def reject_scene_edit_candidate(
    store: ProjectStore, params: Mapping[str, Any]
) -> dict[str, Any]:
    """Durably dismiss one ready authored proposal."""

    head = _current_head(store, params)
    candidate_id = _candidate_id_value(params.get("candidateId"))
    reason_value = params.get("reason", "rejected by user")
    reason = _bounded_text(reason_value, "reason", 500, strip=True)
    candidates = _records(head.snapshot, "sceneEditCandidates")
    candidate = _unique_record(candidates, candidate_id, "scene edit candidate")
    validated = _validated_candidate(store, candidate)
    if validated["status"] != "ready":
        raise ValueError("Only a ready scene edit candidate can be rejected")

    now = utc_now()
    updated_candidates: list[dict[str, Any]] = []
    for item in candidates:
        updated = copy.deepcopy(item)
        if updated.get("id") == candidate_id:
            updated.update(
                {"status": "rejected", "rejectedAt": now, "rejectionReason": reason}
            )
        updated_candidates.append(updated)

    snapshot = copy.deepcopy(head.snapshot)
    snapshot["sceneEditCandidates"] = updated_candidates
    revision = store.create_revision(
        snapshot=snapshot,
        kind="edit",
        message=f"Rejected authored scene proposal {candidate_id}",
        expected_head=head.revision_id,
    )
    ProjectHistory(store).record_new_revision(head.revision_id, revision)
    return {
        "operation": "reject_scene_edit_candidate",
        "projectId": store.manifest.project_id,
        "candidateId": candidate_id,
        "sceneId": validated["sceneId"],
        "headRevisionId": revision.revision_id,
        "revisionNumber": revision.number,
        "status": "rejected",
    }


def _provider_response(
    value: Any,
) -> tuple[Mapping[str, Any], str, SceneEditUsageIdentity]:
    """Accept the generic result and StructuredSceneEdit adapter result."""

    proposal: Any
    idempotency_key: Any
    if isinstance(value, SceneEditProviderResult):
        proposal = value.proposal
        idempotency_key = value.idempotency_key
        usage = value.usage
    elif hasattr(value, "proposal") and hasattr(value, "provider_result"):
        proposal = value.proposal
        idempotency_key = value.idempotency_key
        provider_result = value.provider_result
        provider_usage = getattr(provider_result, "usage", None)
        usage = SceneEditUsageIdentity(
            provider_id=cast(str, getattr(provider_result, "provider_id", None)),
            model=cast(str, getattr(provider_result, "model", None)),
            request_id=(
                getattr(provider_result, "raw_id", None)
                or getattr(provider_usage, "request_id", None)
            ),
            actual_cost_micros=getattr(provider_usage, "actual_cost_micros", 0) or 0,
            units=getattr(provider_usage, "units", {}),
        )
    elif isinstance(value, Mapping):
        proposal = value.get("proposal")
        idempotency_key = value.get("idempotencyKey", value.get("idempotency_key"))
        usage_value = value.get("usage")
        if not isinstance(usage_value, Mapping):
            raise ValueError("Scene edit provider response has no usage identity")
        usage = SceneEditUsageIdentity(
            provider_id=cast(
                str, usage_value.get("providerId", usage_value.get("provider_id"))
            ),
            model=cast(str, usage_value.get("model")),
            request_id=usage_value.get("requestId", usage_value.get("request_id")),
            actual_cost_micros=usage_value.get(
                "actualCostMicros", usage_value.get("actual_cost_micros", 0)
            ),
            units=usage_value.get("units", {}),
        )
    else:
        raise ValueError("Scene edit provider returned an unsupported response")

    if not isinstance(proposal, Mapping):
        raise ValueError("Scene edit provider returned no proposal object")
    key = _bounded_text(idempotency_key, "provider idempotency key", 512)
    normalized_usage = SceneEditUsageIdentity(
        provider_id=_bounded_text(usage.provider_id, "scene edit provider", 240),
        model=_bounded_text(usage.model, "scene edit model", 500),
        request_id=(
            None
            if usage.request_id is None
            else _bounded_text(usage.request_id, "provider request ID", 500)
        ),
        actual_cost_micros=_integer(
            usage.actual_cost_micros, "actualCostMicros", 0, 2**63 - 1
        ),
        units=_numeric_usage(usage.units),
    )
    return proposal, key, normalized_usage


def _proposal_payload(
    value: Mapping[str, Any], original: Mapping[str, Any]
) -> dict[str, Any]:
    proposal: dict[str, Any] = {
        "title": _bounded_text(value.get("title"), "proposal.title", MAX_TITLE_CHARS),
        "narration": _bounded_text(
            value.get("narration"), "proposal.narration", MAX_NARRATION_CHARS
        ),
        "objective": _bounded_text(
            value.get("objective"), "proposal.objective", MAX_OBJECTIVE_CHARS
        ),
    }
    if "visualIntent" in value:
        proposal["visualIntent"] = _bounded_text(
            value.get("visualIntent"),
            "proposal.visualIntent",
            MAX_VISUAL_INTENT_CHARS,
            allow_empty=True,
        )
    elif "visualIntent" in original:
        proposal["visualIntent"] = original["visualIntent"]

    supplied_duration_keys = [
        key for key in ("durationTicks", "durationSeconds", "duration") if key in value
    ]
    if len(supplied_duration_keys) != 1:
        raise ValueError("Proposal must contain exactly one duration value")
    proposal["durationSeconds"] = _proposal_duration(value, supplied_duration_keys[0])
    return proposal


def _proposal_duration(value: Mapping[str, Any], supplied_key: str) -> int | float:
    raw = value[supplied_key]
    if supplied_key == "durationTicks":
        ticks = _integer(raw, "proposal.durationTicks", 1, MAX_SAFE_INTEGER)
        seconds = ticks / TICKS_PER_SECOND
        if seconds > MAX_DURATION_SECONDS:
            raise ValueError(
                f"proposal.durationTicks must not exceed {MAX_DURATION_SECONDS} seconds"
            )
    else:
        seconds = _number(raw, f"proposal.{supplied_key}", 0, MAX_DURATION_SECONDS)
        ticks = round(seconds * TICKS_PER_SECOND)
        if not 1 <= ticks <= MAX_SAFE_INTEGER:
            raise ValueError("Proposal duration cannot be represented as safe timeline ticks")
    return int(seconds) if float(seconds).is_integer() else seconds


def _validated_candidate(store: ProjectStore, candidate: Mapping[str, Any]) -> dict[str, Any]:
    candidate_id = _candidate_id_value(candidate.get("id"))
    status = _enum(
        candidate.get("status"), frozenset({"ready", "accepted", "rejected"}), "candidate status"
    )
    scene_id = _scene_id(candidate.get("sceneId"))
    focus = _enum(candidate.get("focus"), FOCUSES, "candidate focus")
    instruction = _bounded_text(
        candidate.get("instruction"), "candidate instruction", MAX_INSTRUCTION_CHARS, strip=True
    )
    index = _integer(candidate.get("alternativeIndex"), "candidate alternativeIndex", 0, 3)
    base_revision_id = _bounded_text(
        candidate.get("baseRevisionId"), "candidate baseRevisionId", 160
    )
    base_generation_id_value = candidate.get("baseGenerationId")
    base_generation_id = (
        None
        if base_generation_id_value is None
        else _bounded_text(
            base_generation_id_value, "candidate baseGenerationId", 160
        )
    )
    locks = _preservation_locks(candidate.get("preservationLocks"))
    original_value = candidate.get("originalScene")
    proposal_value = candidate.get("proposed")
    if not isinstance(original_value, Mapping) or not isinstance(proposal_value, Mapping):
        raise ValueError("Scene edit candidate is missing its immutable scene records")
    try:
        base = store.get_revision(base_revision_id)
    except KeyError as error:
        raise ValueError("Scene edit candidate base revision does not exist") from error
    original = _scene_payload(_scene(base.snapshot, scene_id))
    if dict(original_value) != original:
        raise ValueError("Scene edit candidate source does not match its base revision")
    original_hash = candidate.get("originalHash")
    if not isinstance(original_hash, str) or original_hash != _canonical_hash(original):
        raise ValueError("Scene edit candidate originalHash is invalid")
    proposal = _proposal_payload(proposal_value, original)
    if dict(proposal_value) != proposal:
        raise ValueError("Scene edit candidate proposal is not canonical")
    _enforce_locks(original, proposal, locks)
    changed_fields = _changed_fields(original, proposal)
    if candidate.get("changedFields") != changed_fields:
        raise ValueError("Scene edit candidate changedFields do not match its proposal")
    provider = _bounded_text(candidate.get("provider"), "candidate provider", 240)
    model = _bounded_text(candidate.get("model"), "candidate model", 500)
    request_id = candidate.get("providerRequestId")
    if request_id is not None:
        request_id = _bounded_text(request_id, "candidate providerRequestId", 500)
    idempotency_key = _bounded_text(
        candidate.get("idempotencyKey"), "candidate idempotencyKey", 512
    )
    actual_cost = _integer(candidate.get("actualCostMicros"), "candidate cost", 0, 2**63 - 1)
    units = _numeric_usage(candidate.get("usageUnits"))
    if candidate.get("acceptedSceneUnchanged") is not True:
        raise ValueError("Scene edit candidate lacks its review-first invariant")

    normalized = {
        **copy.deepcopy(dict(candidate)),
        "id": candidate_id,
        "status": status,
        "sceneId": scene_id,
        "focus": focus,
        "instruction": instruction,
        "alternativeIndex": index,
        "baseRevisionId": base_revision_id,
        "baseGenerationId": base_generation_id,
        "preservationLocks": list(locks),
        "originalScene": original,
        "originalHash": original_hash,
        "proposed": proposal,
        "changedFields": changed_fields,
        "provider": provider,
        "model": model,
        "providerRequestId": request_id,
        "idempotencyKey": idempotency_key,
        "actualCostMicros": actual_cost,
        "usageUnits": units,
    }
    integrity_hash = candidate.get("integrityHash")
    if not isinstance(integrity_hash, str) or SHA256_PATTERN.fullmatch(integrity_hash) is None:
        raise ValueError("Scene edit candidate has no valid integrity hash")
    if integrity_hash != _candidate_integrity_hash(normalized):
        raise ValueError("Scene edit candidate immutable fields were modified")
    return normalized


def _candidate_integrity_hash(candidate: Mapping[str, Any]) -> str:
    immutable_keys = (
        "id",
        "sceneId",
        "focus",
        "instruction",
        "alternativeIndex",
        "baseRevisionId",
        "baseGenerationId",
        "preservationLocks",
        "originalScene",
        "originalHash",
        "proposed",
        "changedFields",
        "provider",
        "model",
        "providerRequestId",
        "idempotencyKey",
        "actualCostMicros",
        "usageUnits",
        "acceptedSceneUnchanged",
    )
    payload = {key: candidate.get(key) for key in immutable_keys}
    encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(encoded.encode()).hexdigest()


def _canonical_hash(value: Mapping[str, Any]) -> str:
    encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(encoded.encode()).hexdigest()


def _matches_accepted_candidate(
    store: ProjectStore,
    candidates: Sequence[dict[str, Any]],
    scene_id: str,
    current: Mapping[str, Any],
) -> bool:
    """Allow switching alternatives only while the accepted authored state is intact."""

    accepted = [
        _validated_candidate(store, item)
        for item in candidates
        if item.get("sceneId") == scene_id and item.get("status") == "accepted"
    ]
    if len(accepted) != 1:
        return False
    prior = accepted[0]
    expected: dict[str, Any] = copy.deepcopy(
        cast(dict[str, Any], prior["originalScene"])
    )
    for key in ("title", "narration", "objective", "visualIntent"):
        if key in prior["proposed"]:
            expected[key] = prior["proposed"][key]
    if "durationTicks" in expected:
        expected["durationTicks"] = round(
            prior["proposed"]["durationSeconds"] * TICKS_PER_SECOND
        )
    else:
        expected["duration"] = prior["proposed"]["durationSeconds"]
    return dict(current) == expected


def _scene_payload(scene: Mapping[str, Any]) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "title": _bounded_text(scene.get("title"), "scene.title", MAX_TITLE_CHARS),
        "narration": _bounded_text(
            scene.get("narration"), "scene.narration", MAX_NARRATION_CHARS
        ),
        "objective": _bounded_text(
            scene.get("objective"), "scene.objective", MAX_OBJECTIVE_CHARS
        ),
    }
    if "visualIntent" in scene:
        payload["visualIntent"] = _bounded_text(
            scene.get("visualIntent"),
            "scene.visualIntent",
            MAX_VISUAL_INTENT_CHARS,
            allow_empty=True,
        )
    has_ticks = "durationTicks" in scene
    has_duration = "duration" in scene
    if has_ticks == has_duration:
        raise ValueError("Scene must contain exactly one of durationTicks or duration")
    if has_ticks:
        payload["durationTicks"] = _integer(
            scene.get("durationTicks"), "scene.durationTicks", 1, MAX_SAFE_INTEGER
        )
    else:
        duration = _number(scene.get("duration"), "scene.duration", 0, MAX_DURATION_SECONDS)
        payload["duration"] = int(duration) if duration.is_integer() else duration
    return payload


def _enforce_locks(
    original: Mapping[str, Any], proposal: Mapping[str, Any], locks: Sequence[str]
) -> None:
    if "narration" in locks and proposal["narration"] != original["narration"]:
        raise ValueError("Narration preservation lock conflicts with the authored proposal")
    if "learningobjective" in locks and proposal["objective"] != original["objective"]:
        raise ValueError("Learning-objective preservation lock requires an exact objective")
    if "timing" in locks and proposal["durationSeconds"] != _duration_seconds(original):
        raise ValueError("Timing preservation lock requires the exact scene duration")


def _changed_fields(original: Mapping[str, Any], proposal: Mapping[str, Any]) -> list[str]:
    changed = [
        key
        for key in ("title", "narration", "objective", "visualIntent")
        if key in proposal and original.get(key) != proposal[key]
    ]
    if proposal["durationSeconds"] != _duration_seconds(original):
        changed.append("durationSeconds")
    return sorted(changed)


def _duration_seconds(scene: Mapping[str, Any]) -> int | float:
    seconds = (
        scene["durationTicks"] / TICKS_PER_SECOND
        if "durationTicks" in scene
        else float(scene["duration"])
    )
    return int(seconds) if float(seconds).is_integer() else seconds


def _record_provider_acceptance(context: SceneEditJobContext, candidate: Mapping[str, Any]) -> None:
    recorder = getattr(context, "record_provider_acceptance", None)
    if not callable(recorder):
        return
    recorder(
        idempotency_key=candidate["idempotencyKey"],
        provider=candidate["provider"],
        model=candidate["model"],
        provider_request_id=candidate["providerRequestId"],
        result=copy.deepcopy(dict(candidate)),
        unit="scene_edit_proposal",
        quantity=1.0,
        cost_micros=candidate["actualCostMicros"],
        usage_metadata={
            "sceneId": candidate["sceneId"],
            "candidateId": candidate["id"],
            "focus": candidate["focus"],
            "providerUnits": copy.deepcopy(candidate["usageUnits"]),
        },
    )


def _set_progress(context: SceneEditJobContext, progress: float, message: str) -> None:
    setter = getattr(context, "set_progress", None)
    if callable(setter):
        setter(progress, message=message)


def _current_head(store: ProjectStore, params: Mapping[str, Any]) -> Revision:
    expected = _bounded_text(
        params.get("expectedHeadRevisionId"), "expectedHeadRevisionId", 160
    )
    head = store.head_revision()
    if head is None or head.revision_id != expected:
        actual = "none" if head is None else head.revision_id
        raise ValueError(
            f"Scene edit candidate base revision became stale: expected {expected}, got {actual}"
        )
    return head


def _scene(snapshot: Mapping[str, Any], scene_id: str) -> dict[str, Any]:
    return _unique_record(_records(snapshot, "scenes"), scene_id, "scene")


def _unique_record(
    records: Sequence[dict[str, Any]], identifier: str, label: str
) -> dict[str, Any]:
    matches = [copy.deepcopy(item) for item in records if item.get("id") == identifier]
    if len(matches) != 1:
        raise ValueError(f"{label.title()} {identifier} does not exist exactly once")
    return matches[0]


def _records(snapshot: Mapping[str, Any], key: str) -> list[dict[str, Any]]:
    value = snapshot.get(key, [])
    if not isinstance(value, list) or not all(isinstance(item, dict) for item in value):
        raise ValueError(f"Project {key} must be an array of records")
    return [copy.deepcopy(item) for item in value]


def _candidate_id(task_key: str, revision_id: str, scene_id: str, focus: str, index: int) -> str:
    digest = hashlib.sha256(
        f"{task_key}:{revision_id}:{scene_id}:{focus}:{index}".encode()
    ).hexdigest()
    return f"scene_edit_{digest[:32]}"


def _candidate_id_value(value: Any) -> str:
    candidate_id = _bounded_text(value, "candidateId", 160)
    if CANDIDATE_ID_PATTERN.fullmatch(candidate_id) is None:
        raise ValueError("candidateId is not a scene edit candidate identifier")
    return candidate_id


def _scene_id(value: Any) -> str:
    scene_id = _bounded_text(value, "sceneId", 128, strip=True)
    if SCENE_ID_PATTERN.fullmatch(scene_id) is None:
        raise ValueError("sceneId contains unsupported characters")
    return scene_id


def _preservation_locks(value: Any) -> tuple[str, ...]:
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise ValueError("preservationLocks must be an array of strings")
    normalized = tuple(sorted(set(value)))
    unknown = set(normalized).difference(PRESERVATION_LOCKS)
    if unknown:
        raise ValueError(f"Unsupported preservation locks: {', '.join(sorted(unknown))}")
    return normalized


def _numeric_usage(value: Any) -> dict[str, float]:
    if not isinstance(value, Mapping):
        raise ValueError("Provider usage units must be an object")
    result: dict[str, float] = {}
    for key, item in value.items():
        if not isinstance(key, str) or not key or len(key) > 80:
            raise ValueError("Provider usage unit names must contain 1 to 80 characters")
        if isinstance(item, bool) or not isinstance(item, int | float):
            raise ValueError("Provider usage quantities must be numeric")
        number = float(item)
        if not math.isfinite(number) or number < 0:
            raise ValueError("Provider usage quantities must be finite and non-negative")
        result[key] = number
    return result


def _bounded_text(
    value: Any,
    label: str,
    maximum: int,
    *,
    strip: bool = False,
    allow_empty: bool = False,
) -> str:
    if not isinstance(value, str) or len(value) > maximum:
        raise ValueError(f"{label} must contain at most {maximum} characters")
    if not allow_empty and not value.strip():
        raise ValueError(f"{label} must contain 1 to {maximum} characters")
    return value.strip() if strip else value


def _enum(value: Any, allowed: frozenset[str], label: str) -> str:
    if not isinstance(value, str) or value not in allowed:
        raise ValueError(f"{label} must be one of {', '.join(sorted(allowed))}")
    return value


def _integer(value: Any, label: str, minimum: int, maximum: int) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or not minimum <= value <= maximum:
        raise ValueError(f"{label} must be an integer between {minimum} and {maximum}")
    return value


def _number(value: Any, label: str, minimum: float, maximum: float) -> float:
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise ValueError(f"{label} must be a number")
    number = float(value)
    if not math.isfinite(number) or not minimum < number <= maximum:
        raise ValueError(f"{label} must be greater than {minimum} and at most {maximum}")
    return number
