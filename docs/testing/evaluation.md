# Testing and evaluation

## Principles

Verification separates functional correctness, deterministic reproducibility, visual acceptance, educational quality, security/privacy, rights, and performance. Passing a schema or unit test is not visual acceptance; visible work requires rendered screenshots or frames that are actually inspected.

The deterministic fixtures under `fixtures/canonical` are the common inputs for unit, integration, render, accessibility, fault-injection, and product evaluation. Their source files are locally authored and hash-pinned; external evidence URIs provide provenance and reviewer context without making the test dependent on the network.

## Canonical suite

- Twelve-minute undergraduate Karatsuba flagship, including `1234 × 5678`.
- Binary search with execution trace and edge cases.
- Algebraic derivation with symbolic verification.
- French Revolution history with map, timeline, evidence, and interpretive qualification.
- Document-grounded science tutorial.
- Structured-data/statistics tutorial.
- Child-friendly illustrated analogy.
- Multi-lesson course with cross-lesson prerequisites.
- English, Spanish, and Hindi localized variants.

Each fixture declares learning objectives, atomic claims, exact source locators, storyboard scenes, deterministic seed, output targets, provenance, and machine-readable assertions.

## Automated gates

1. **Contracts and persistence:** JSON Schema validation, generated-binding drift, migration round trips, project reopen, revision restore, object reachability, and deterministic `.alytutorial` round trips.
2. **Durability:** process termination before/after provider acceptance, object promotion, and database commit; lease recovery; cancellation; no duplicated provider charge.
3. **Invalidation:** a local edit invalidates only transitive descendants, while unrelated scene artifacts remain byte-identical.
4. **Render:** canonical frame hashes in the pinned environment, visual-regression diffs, missing-glyph/overflow/blank-frame/flash/safe-area/caption-collision checks, and real screenshot inspection.
5. **Audio:** zero clipped samples, −16 ±1 LUFS, no more than −1.5 dBTP, narration ASR word-error rate no greater than 3%, at least 98% aligned tokens, and A/V duration within one frame.
6. **Grounding:** Strict mode has 100% support coverage for externally verifiable claims and zero unresolved critical or major claims. Support must entail or substantively support the claim; citation presence alone is insufficient, as emphasized by [ALCE](https://aclanthology.org/2023.emnlp-main.398.pdf) and [FActScore](https://aclanthology.org/2023.emnlp-main.741.pdf).
7. **Security/privacy:** no secret canary in logs, arguments, exports, screenshots, diagnostics, archives, or databases; Fully Local mode completes with project-content egress denied.
8. **Rights:** unknown/restricted rights, absent attribution, and revoked or missing consent block export.
9. **Packaging:** clean-machine installer, update/rollback, optional runtime pack, model download/resume/checksum/license, and macOS/Linux build smoke tests.

Automatic repair is bounded to two attempts. A remaining critical or major defect requires human review; the workflow must not loop indefinitely or hide the failure.

## Human educational evaluation

Reviewers score accuracy, teaching sequence, objective coverage, prerequisite handling, misconception correction, worked-example correctness, clarity, pacing, visual explanatory value, source support, narration, caption quality, consistency, usability, and editability on a five-point anchored scale. Identity of system version is hidden when practical.

The 2.0 candidate must average at least 4/5 for accuracy, sequencing, visual explanation, audio, and usability; contain no critical regression; and clearly outperform preserved 1.0 evidence in at least nine comparison dimensions. If 1.0 cannot run reproducibly, the report must say so and compare only against hash-preserved artifacts.

## Karatsuba acceptance

The flagship must correctly explain splitting by a power-of-ten base, compute `z2 = ac`, `z0 = bd`, and `z1 = (a+b)(c+d) − z2 − z0`, work through `1234 × 5678 = 7006652`, and compare `T(n)=3T(n/2)+O(n)` with grade-school `O(n²)`. It must keep citations, captions, theme, and source credits intact after scene-local editing.

## Performance methodology

Performance is descriptive, not a substitute for correctness. Record application commit, fixture hash, operating system, CPU/GPU, driver, RAM/VRAM, storage, power source, Windows/G-Helper mode, CPU boost state, temperatures, other major workloads, runtime/model revisions, quantization, cold/warm state, and sample count. Report median plus an appropriate spread; do not publish a single best run.

Silent mode with CPU boost disabled is an accepted real-world profile and requires no intervention. Peak characterization is a separate labeled run. The test harness must never silently change the power plan, enable boost, stop unrelated user workloads, or portray an estimate as a measured benchmark.

## Release evidence packet

The local release-candidate packet contains commands and results, machine profile, fixture/schema hashes, screenshots, sample renders, audio measurements, fault-injection logs, SBOM/notices, provenance/rights reports, known limitations, v1 comparison, and exact reproduction instructions. Producing the packet does not authorize push, merge, publication, deployment, or release.
