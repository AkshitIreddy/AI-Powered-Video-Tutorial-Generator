# Generated Karatsuba evaluation summary

These compact JSON files are the inspectable output of Alystria's deterministic
canonical evaluation lane. They were generated from
`fixtures/canonical/karatsuba/fixture.json` by:

```powershell
services\pipeline\.venv\Scripts\python.exe scripts\run-canonical-evaluation.py
```

The run uses the deterministic media and renderer clients, denies pipeline
network access, pauses at the approval gate, records the unapproved payload,
creates an approval revision, completes all sixteen stages, verifies every CAS
object, requires a passing final QA gate, and round-trips a portable
`.alytutorial` archive.

`expected-hashes.json` is the contract for these normalized summaries. The
approval revision ID is intentionally replaced with a run-local placeholder;
database IDs, timestamps, the bulky project database, CAS objects, archive,
audio, frames, and video remain under ignored `dist/evaluation/v2/karatsuba`.
The representative media hashes are environment-specific evidence for the
pinned development runtime, not cross-platform golden promises.
