# Deterministic canonical fixtures

These fixtures are network-independent inputs for contracts, persistence, research, rendering, accessibility, localization, security, and educational evaluation. They are deliberately small enough for routine tests while containing the release-critical assertions for the full scenarios.

## Layout

```text
fixtures/
  schema/canonical-fixture.schema.json
  canonical/<fixture>/fixture.json
  canonical/<fixture>/sources/*
  canonical/localization/{en-US,es-ES,hi-IN}.json
```

Fixture source files are locally authored for Alystria testing and licensed CC0-1.0 unless a file says otherwise. External evidence URIs identify authoritative reviewer context; tests never fetch them. Each fixture pins the SHA-256 of every local source. A changed byte therefore requires an intentional fixture update.

Every `fixture.json` declares learner intent, objectives, claims, story scenes, provenance, targets, and machine-readable quality assertions. Assertions use stable check identifiers; implementations may add measurements but must not silently weaken a release-blocking expected value.

## Validation

Run the validator from the repository root:

```text
python fixtures/validate.py
```

The validator checks JSON syntax, the bundled JSON Schema when `jsonschema` is installed, exact local source hashes, unique stable IDs, internal claim/objective/source references, caption presence, and localization parity. It uses only the Python standard library for the mandatory checks.

## Determinism

Network calls, current dates, random seeds chosen at runtime, mutable provider aliases, and host-installed fonts are not fixture inputs. Tests use mock providers or declared local assets. Canonical rendered hashes are environment-specific golden evidence and belong in test artifacts, not inside source fixtures.
