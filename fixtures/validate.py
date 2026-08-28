#!/usr/bin/env python3
"""Validate canonical Alystria fixtures without mutating the repository."""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
SCHEMA_PATH = ROOT / "schema" / "canonical-fixture.schema.json"


def fail(errors: list[str], path: Path, message: str) -> None:
    errors.append(f"{path.relative_to(ROOT)}: {message}")


def unique_ids(errors: list[str], path: Path, values: list[dict[str, Any]], label: str) -> set[str]:
    ids = [value.get("id") for value in values]
    seen = {value for value in ids if isinstance(value, str)}
    if len(seen) != len(ids):
        fail(errors, path, f"{label} IDs must be present and unique")
    return seen


def validate_fixture(path: Path, data: dict[str, Any], errors: list[str]) -> None:
    objectives = unique_ids(errors, path, data.get("objectives", []), "objective")
    sources = unique_ids(errors, path, data.get("sources", []), "source")
    claims = unique_ids(errors, path, data.get("claims", []), "claim")
    unique_ids(errors, path, data.get("scenes", []), "scene")
    unique_ids(errors, path, data.get("qualityAssertions", []), "quality assertion")

    for source in data.get("sources", []):
        relative = source.get("path", "")
        source_path = (path.parent / relative).resolve()
        try:
            source_path.relative_to(path.parent.resolve())
        except ValueError:
            fail(errors, path, f"source path escapes fixture directory: {relative}")
            continue
        if not source_path.is_file():
            fail(errors, path, f"missing source: {relative}")
            continue
        actual = hashlib.sha256(source_path.read_bytes()).hexdigest()
        if actual != source.get("sha256"):
            fail(errors, path, f"source hash mismatch for {relative}: expected {source.get('sha256')}, actual {actual}")

    for claim in data.get("claims", []):
        for support in claim.get("supports", []):
            if support.get("sourceId") not in sources:
                fail(errors, path, f"claim {claim.get('id')} references unknown source {support.get('sourceId')}")

    for objective in data.get("objectives", []):
        for prerequisite in objective.get("prerequisiteObjectiveIds", []):
            if prerequisite not in objectives:
                fail(errors, path, f"objective {objective.get('id')} references unknown prerequisite {prerequisite}")

    for scene in data.get("scenes", []):
        for objective_id in scene.get("objectiveIds", []):
            if objective_id not in objectives:
                fail(errors, path, f"scene {scene.get('id')} references unknown objective {objective_id}")
        for claim_id in scene.get("claimIds", []):
            if claim_id not in claims:
                fail(errors, path, f"scene {scene.get('id')} references unknown claim {claim_id}")
        if not str(scene.get("captionText", "")).strip():
            fail(errors, path, f"scene {scene.get('id')} has no caption text")

    if data.get("groundingMode") == "strict":
        unsupported = [claim.get("id") for claim in data.get("claims", []) if claim.get("verifiability") != "creative" and not claim.get("supports")]
        if unsupported:
            fail(errors, path, f"Strict fixture has unsupported claims: {', '.join(map(str, unsupported))}")


def main() -> int:
    errors: list[str] = []
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    fixture_paths = sorted((ROOT / "canonical").glob("*/fixture.json")) + sorted((ROOT / "canonical" / "localization").glob("*.json"))
    if not fixture_paths:
        errors.append("No canonical fixture JSON files found")

    try:
        import jsonschema  # type: ignore[import-not-found]
    except ImportError:
        jsonschema = None

    localization: dict[str, dict[str, Any]] = {}
    for path in fixture_paths:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            fail(errors, path, f"invalid JSON: {exc}")
            continue
        if jsonschema is not None:
            validator = jsonschema.Draft202012Validator(schema, format_checker=jsonschema.FormatChecker())
            for error in sorted(validator.iter_errors(data), key=lambda item: list(item.path)):
                fail(errors, path, f"schema at {'/'.join(map(str, error.path)) or '<root>'}: {error.message}")
        validate_fixture(path, data, errors)
        if path.parent.name == "localization":
            localization[data.get("locale", path.stem)] = data

    required_locales = {"en-US", "es-ES", "hi-IN"}
    if set(localization) != required_locales:
        errors.append(f"localization variants must be exactly {sorted(required_locales)}; found {sorted(localization)}")
    elif localization:
        baseline = localization["en-US"]
        for locale, fixture in localization.items():
            if len(fixture.get("scenes", [])) != len(baseline.get("scenes", [])):
                errors.append(f"canonical/localization/{locale}: scene count differs from en-US")
            if [a.get("check") for a in fixture.get("qualityAssertions", [])] != [a.get("check") for a in baseline.get("qualityAssertions", [])]:
                errors.append(f"canonical/localization/{locale}: assertion check sequence differs from en-US")

    if errors:
        print("Fixture validation failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    suffix = " with JSON Schema" if jsonschema is not None else " (structural checks; install jsonschema for schema checks)"
    print(f"Validated {len(fixture_paths)} canonical fixture files{suffix}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
