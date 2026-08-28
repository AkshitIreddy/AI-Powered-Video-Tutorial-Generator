"""Portable practice-set exports derived from course learning activities."""

from __future__ import annotations

import csv
import io
import json
from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from .models import Course, PausePrompt, QuizQuestion, WorkedProblem


class PracticeExportFormat(StrEnum):
    JSON = "json"
    MARKDOWN = "markdown"
    CSV = "csv"


@dataclass(frozen=True, slots=True)
class PracticeExport:
    filename: str
    media_type: str
    content: str
    activity_count: int


class PracticeExporter:
    """Export quizzes, pause prompts and worked problems without render state."""

    def export(
        self,
        course: Course,
        locale: str,
        output_format: PracticeExportFormat,
        *,
        include_answers: bool = False,
    ) -> PracticeExport:
        records = self._records(course, locale, include_answers=include_answers)
        stem = self._safe_stem(course.course_id)
        if output_format is PracticeExportFormat.JSON:
            content = json.dumps(
                {
                    "schemaVersion": 1,
                    "courseId": course.course_id,
                    "locale": locale,
                    "title": course.title.get(locale, allow_family_fallback=False),
                    "includeAnswers": include_answers,
                    "activities": records,
                },
                ensure_ascii=False,
                indent=2,
                sort_keys=True,
            )
            return PracticeExport(
                f"{stem}-practice-{locale}.json",
                "application/json",
                content + "\n",
                len(records),
            )
        if output_format is PracticeExportFormat.MARKDOWN:
            return PracticeExport(
                f"{stem}-practice-{locale}.md",
                "text/markdown; charset=utf-8",
                self._markdown(course, locale, records, include_answers),
                len(records),
            )
        if output_format is PracticeExportFormat.CSV:
            return PracticeExport(
                f"{stem}-practice-{locale}.csv",
                "text/csv; charset=utf-8",
                self._csv(records),
                len(records),
            )
        raise ValueError(f"Unsupported practice export format: {output_format}")

    @staticmethod
    def _safe_stem(value: str) -> str:
        result = "".join(character.lower() if character.isalnum() else "-" for character in value)
        return "-".join(part for part in result.split("-") if part) or "course"

    def _records(
        self, course: Course, locale: str, *, include_answers: bool
    ) -> list[dict[str, Any]]:
        records: list[dict[str, Any]] = []
        for resolved in course.iter_scenes():
            for activity in resolved.scene.activities:
                common: dict[str, Any] = {
                    "activityId": activity.activity_id,
                    "sceneId": resolved.scene.scene_id,
                    "path": resolved.path.as_string(),
                    "prompt": activity.prompt.get(locale, allow_family_fallback=False),
                    "objectiveIds": list(activity.objective_ids),
                }
                if isinstance(activity, QuizQuestion):
                    record = {
                        **common,
                        "type": "quiz",
                        "quizKind": activity.kind.value,
                        "points": activity.points,
                        "options": [
                            {
                                "optionId": option.option_id,
                                "label": option.label.get(locale, allow_family_fallback=False),
                            }
                            for option in activity.options
                        ],
                    }
                    if include_answers:
                        if activity.correct_option_ids:
                            record["correctOptionIds"] = list(activity.correct_option_ids)
                        if activity.accepted_answers:
                            record["acceptedAnswers"] = list(
                                activity.accepted_answers.get(locale, ())
                            )
                        if activity.explanation:
                            record["explanation"] = activity.explanation.get(
                                locale, allow_family_fallback=False
                            )
                    records.append(record)
                elif isinstance(activity, PausePrompt):
                    record = {
                        **common,
                        "type": "pause_prompt",
                        "suggestedPauseSeconds": activity.suggested_pause_seconds,
                    }
                    if include_answers and activity.reveal:
                        record["reveal"] = activity.reveal.get(
                            locale, allow_family_fallback=False
                        )
                    records.append(record)
                elif isinstance(activity, WorkedProblem):
                    record = {
                        **common,
                        "type": "worked_problem",
                    }
                    if include_answers:
                        record["steps"] = [
                            {
                                "stepId": step.step_id,
                                "explanation": step.explanation.get(
                                    locale, allow_family_fallback=False
                                ),
                                "expression": step.expression,
                            }
                            for step in activity.steps
                        ]
                        record["finalAnswer"] = activity.final_answer.get(
                            locale, allow_family_fallback=False
                        )
                    records.append(record)
        return records

    @staticmethod
    def _markdown(
        course: Course,
        locale: str,
        records: list[dict[str, Any]],
        include_answers: bool,
    ) -> str:
        lines = [
            f"# {course.title.get(locale, allow_family_fallback=False)} — Practice",
            "",
        ]
        for index, record in enumerate(records, start=1):
            lines.extend([f"## {index}. {record['prompt']}", ""])
            for option in record.get("options", []):
                lines.append(f"- [ ] {option['label']}")
            if record["type"] == "pause_prompt":
                lines.append(
                    f"_Pause for about {record['suggestedPauseSeconds']} seconds before "
                    "continuing._"
                )
            if include_answers:
                if record.get("correctOptionIds"):
                    lines.append(f"**Answer:** {', '.join(record['correctOptionIds'])}")
                if record.get("acceptedAnswers"):
                    lines.append(f"**Accepted answers:** {', '.join(record['acceptedAnswers'])}")
                if record.get("reveal"):
                    lines.append(f"**Reveal:** {record['reveal']}")
                for step_number, step in enumerate(record.get("steps", []), start=1):
                    expression = f" — `{step['expression']}`" if step.get("expression") else ""
                    lines.append(f"{step_number}. {step['explanation']}{expression}")
                if record.get("finalAnswer"):
                    lines.append(f"**Final answer:** {record['finalAnswer']}")
                if record.get("explanation"):
                    lines.append(f"**Explanation:** {record['explanation']}")
            lines.append("")
        return "\n".join(lines).rstrip() + "\n"

    @staticmethod
    def _csv(records: list[dict[str, Any]]) -> str:
        output = io.StringIO(newline="")
        writer = csv.DictWriter(
            output,
            fieldnames=(
                "activity_id",
                "scene_id",
                "type",
                "prompt",
                "options",
                "answer",
                "objectives",
            ),
        )
        writer.writeheader()
        for record in records:
            answer = record.get("finalAnswer") or record.get("reveal") or "; ".join(
                record.get("correctOptionIds", record.get("acceptedAnswers", []))
            )
            writer.writerow(
                {
                    "activity_id": record["activityId"],
                    "scene_id": record["sceneId"],
                    "type": record["type"],
                    "prompt": record["prompt"],
                    "options": " | ".join(
                        option["label"] for option in record.get("options", [])
                    ),
                    "answer": answer,
                    "objectives": "; ".join(record["objectiveIds"]),
                }
            )
        return output.getvalue()
