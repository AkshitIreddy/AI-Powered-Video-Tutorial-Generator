"""Deterministic offline workflow used for development, recovery tests and demos."""

from __future__ import annotations

import hashlib
import re
from typing import Any

from alystria.project.store import ProjectStore

from .keys import ActionKey, DependencyGraph, canonical_json
from .runtime import JobContext, SQLiteWorkflowRuntime, TaskHandler


def _stable_id(prefix: str, value: str) -> str:
    return f"{prefix}_{hashlib.sha256(value.encode()).hexdigest()[:16]}"


class MockGenerationWorkflow:
    """A complete, zero-network generation path with stable deterministic output."""

    STAGES = ("mock.learning_plan", "mock.script", "mock.storyboard", "mock.finalize")

    def __init__(self, store: ProjectStore, runtime: SQLiteWorkflowRuntime) -> None:
        self.store = store
        self.runtime = runtime

    @property
    def handlers(self) -> dict[str, TaskHandler]:
        return {
            "mock.learning_plan": self._learning_plan,
            "mock.script": self._script,
            "mock.storyboard": self._storyboard,
            "mock.finalize": self._finalize,
        }
    def enqueue(
        self,
        *,
        topic: str,
        audience: str = "General",
        language: str = "en",
        duration_minutes: int = 5,
        seed: int = 0,
    ) -> dict[str, Any]:
        topic = " ".join(topic.split())
        if not topic:
            raise ValueError("Topic cannot be blank")
        if not 1 <= duration_minutes <= 180:
            raise ValueError("Duration must be between 1 and 180 minutes")
        project_id = self.store.manifest.project_id
        base = {
            "topic": topic,
            "audience": audience,
            "language": language,
            "durationMinutes": duration_minutes,
            "seed": seed,
        }
        jobs = []
        previous: str | None = None
        for stage in self.STAGES:
            parameters = {**base, "inputJobId": previous}
            key = ActionKey(
                kind=stage,
                implementation_version="mock-v1",
                parameters=parameters,
                input_hashes=() if previous is None else (self.runtime.get_job(previous).task_key,),
                provider="local-mock",
                model_revision="deterministic-v1",
                prompt_version="mock-v1",
                seed=seed,
            )
            job = self.runtime.enqueue(
                project_id=project_id,
                kind=stage,
                parameters=parameters,
                action_key=key,
                dependency_ids=[] if previous is None else [previous],
                max_attempts=2,
                estimated_cost_micros=0,
            )
            jobs.append(job)
            previous = job.job_id
        return {"jobIds": [job.job_id for job in jobs], "finalJobId": jobs[-1].job_id}

    def _input_result(self, parameters: dict[str, Any]) -> dict[str, Any]:
        input_id = parameters.get("inputJobId")
        if not isinstance(input_id, str):
            raise ValueError("Workflow stage requires an input job")
        result = self.runtime.get_job(input_id).result
        if result is None:
            raise ValueError(f"Input job {input_id} has no result")
        return result

    def _learning_plan(self, context: JobContext, parameters: dict[str, Any]) -> dict[str, Any]:
        context.set_progress(0.25, message="Planning objectives")
        topic = parameters["topic"]
        plan = {
            "id": _stable_id("plan", canonical_json(parameters)),
            "topic": topic,
            "audience": parameters["audience"],
            "language": parameters["language"],
            "durationMinutes": parameters["durationMinutes"],
            "objectives": [
                {"id": _stable_id("objective", topic + ":explain"), "text": f"Explain {topic} clearly"},
                {"id": _stable_id("objective", topic + ":apply"), "text": f"Apply {topic} in an example"},
                {"id": _stable_id("objective", topic + ":recap"), "text": f"Recall the key ideas in {topic}"},
            ],
            "prerequisites": [],
            "misconceptions": [],
            "groundingMode": "mock",
        }
        context.set_progress(1, message="Learning plan ready")
        return {"learningPlan": plan}

    def _script(self, context: JobContext, parameters: dict[str, Any]) -> dict[str, Any]:
        plan = self._input_result(parameters)["learningPlan"]
        context.set_progress(0.3, message="Drafting narration")
        sections = []
        for index, objective in enumerate(plan["objectives"]):
            section_id = _stable_id("section", objective["id"])
            sections.append(
                {
                    "id": section_id,
                    "title": objective["text"],
                    "objectiveIds": [objective["id"]],
                    "narration": (
                        f"Section {index + 1}. {objective['text']}. "
                        "This deterministic draft is safe to regenerate and edit locally."
                    ),
                    "claims": [],
                }
            )
        context.set_progress(1, message="Script ready")
        return {"learningPlan": plan, "script": {"sections": sections}}

    def _storyboard(self, context: JobContext, parameters: dict[str, Any]) -> dict[str, Any]:
        input_result = self._input_result(parameters)
        plan = input_result["learningPlan"]
        script = input_result["script"]
        context.set_progress(0.2, message="Choosing deterministic scene types")
        scenes = []
        scene_types = ("title", "definition", "worked-example", "recap")
        for index, section in enumerate(script["sections"]):
            scene_id = _stable_id("scene", section["id"])
            words = re.findall(r"\w+", section["narration"], re.UNICODE)
            scenes.append(
                {
                    "id": scene_id,
                    "sectionId": section["id"],
                    "type": scene_types[min(index + 1, len(scene_types) - 1)],
                    "title": section["title"],
                    "narration": section["narration"],
                    "durationTicks": max(480_000, len(words) * 96_000),
                    "accessibilityDescription": section["title"],
                    "locks": [],
                }
            )
        storyboard = {
            "id": _stable_id("storyboard", canonical_json(scenes)),
            "timebase": 240_000,
            "target": {"width": 1920, "height": 1080, "fpsNumerator": 30, "fpsDenominator": 1},
            "scenes": scenes,
        }
        context.set_progress(1, message="Storyboard ready")
        return {"learningPlan": plan, "script": script, "storyboard": storyboard}

    def _finalize(self, context: JobContext, parameters: dict[str, Any]) -> dict[str, Any]:
        result = self._input_result(parameters)
        context.set_progress(0.2, message="Writing immutable storyboard artifact")
        artifact_content = (canonical_json(result["storyboard"]) + "\n").encode()
        artifact = self.store.add_artifact_bytes(
            artifact_content,
            media_type="application/json",
            original_name="storyboard.json",
            metadata={"generator": "local-mock", "rightsStatus": "owned"},
        )
        snapshot = {
            "projectId": self.store.manifest.project_id,
            "learningPlan": result["learningPlan"],
            "script": result["script"],
            "storyboard": result["storyboard"],
            "artifacts": [{"hash": artifact.hash, "role": "storyboard"}],
        }
        context.set_progress(0.7, message="Creating project revision")
        revision = self.store.create_revision(
            snapshot=snapshot,
            kind="generation",
            message=f"Mock tutorial generated for {parameters['topic']}",
            artifact_links=[{"artifactHash": artifact.hash, "role": "storyboard"}],
        )
        graph = DependencyGraph(self.store.connection, self.store.manifest.project_id)
        graph.record_node("learning-plan", hashlib.sha256(canonical_json(result["learningPlan"]).encode()).hexdigest())
        graph.record_node(
            "script",
            hashlib.sha256(canonical_json(result["script"]).encode()).hexdigest(),
            upstream_keys=["learning-plan"],
        )
        graph.record_node(
            "storyboard",
            artifact.hash,
            artifact_hash=artifact.hash,
            upstream_keys=["script"],
        )
        context.set_progress(1, message="Revision committed")
        return {
            "revisionId": revision.revision_id,
            "artifactHash": artifact.hash,
            "sceneCount": len(result["storyboard"]["scenes"]),
        }
