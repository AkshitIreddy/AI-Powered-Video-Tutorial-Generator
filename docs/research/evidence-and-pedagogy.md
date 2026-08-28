# Research, evidence, and pedagogy

## Pipeline

```text
learner brief
→ safe source ingestion
→ research questions
→ retrieval and evidence ledger
→ prerequisites, objectives, and misconceptions
→ concept graph and instructional blueprint
→ outline candidates
→ script draft
→ pedagogy, factuality, clarity, redundancy, and pacing reviews
→ final narration
→ storyboard and VisualBible
→ cost, privacy, and rights approval
→ assets, audio, scenes, and render
→ rendered-output QA and at most two repairs
→ export
```

The learner profile is established before research. It records audience, knowledge level, locale, goals, prior knowledge, constraints, and accessibility needs. Objectives are observable and carry assessment criteria. Prerequisite edges must be acyclic, and every lesson/scene traces to at least one objective or is explicitly marked connective material.

## Source acquisition

Research uses authoritative discovery APIs where appropriate: [OpenAlex](https://help.openalex.org/api/), [Crossref](https://www.crossref.org/documentation/retrieve-metadata/rest-api/), [DataCite](https://support.datacite.org/docs/rest-api), [OpenCitations](https://opencitations.net/index/api/v2), [Europe PMC](https://europepmc.org/RestfulWebService), and [arXiv](https://info.arxiv.org/help/api/user-manual.html). Discovery metadata is not automatically evidence. The system resolves the original lawful repository or publisher and records an immutable source version.

Unknown or restrictive material remains link-only or transient. Open-access status does not erase attribution or license requirements. Imported private sources default to local-only classification. Documents are parsed in quarantine; [Docling](https://docling.org/) is the preferred structured parser for pages, sections, tables, equations, figures, and bounding boxes, subject to its runtime and security validation.

## Evidence ledger

Each `SourceVersion` records canonical locator, retrieval time, content hash, authors/publisher, language, trust classification, storage policy, rights status, and license. An `EvidenceChunk` points to exact immutable text offsets, page boxes, time ranges, table cells, figures, sections, or records. Derived indexes are rebuildable caches and never replace the source locator.

Retrieval combines local lexical and dense search with reciprocal-rank fusion and reranking. Results retain per-stage scores for diagnosis but are not accepted as support merely because they rank highly.

An `AtomicClaim` expresses one proposition, type, verifiability, importance, and support state. `ClaimSupport` relates it to an exact evidence chunk as entails, supports, contextualizes, qualifies, or contradicts, with rationale and assessor. Citation presence alone is insufficient; the distinction between citation and actual support is central to [ALCE](https://aclanthology.org/2023.emnlp-main.398.pdf) and [FActScore](https://aclanthology.org/2023.emnlp-main.741.pdf).

## Grounding modes

- **Creative:** factual claims still require support, but clearly creative story/analogy content is marked `creative` and does not need an external citation.
- **Grounded:** important factual claims require evidence; minor unsupported claims are visible warnings and cannot be silently presented as sourced.
- **Strict:** every externally verifiable claim requires adequate support. Any unsupported, contradicted, or unresolved critical/major claim blocks approval and export.

Changing mode never deletes claims, sources, or support assessments. It changes gates and makes the revision explicit.

## Instructional planning

The planner produces prerequisite-aware objectives, known misconceptions, a concept DAG, worked examples, checks for understanding, and a duration budget before drafting prose. Outline candidates expose meaningful trade-offs—such as example-first versus definition-first—rather than cosmetic rewrites.

Script review is multi-pass and typed. Factual review operates on atomic claims and evidence. Pedagogy review checks sequence, prerequisite introduction, examples, misconception treatment, assessment alignment, and cognitive load. Clarity review checks terminology and audience fit. Redundancy and pacing review prevents duplicate explanation and impossible narration density.

The visual director selects deterministic explanation first for exact math, code, data, diagrams, and timelines; user/licensed evidence for real people, places, events, documents, and interfaces; generated illustration for concepts/analogies; generated motion only when it materially explains; and sparse presenter use for hooks, transitions, misconceptions, empathy, and recaps.

## Approval and regeneration

The user approves the learning plan and storyboard before expensive generation. The approval sheet identifies provider, content classification, retention/region, upper-bound cost, rights state, and any presenter/voice consent. No cloud content call occurs before approval.

Regeneration always declares scope, instruction, preservation locks, alternatives, dependency impact, invalidated descendants, and estimated cost. Generated candidates remain revisions. Accepting one creates a new revision; it does not overwrite the approved prior state.

## Evaluation

The research pipeline is evaluated for source precision/recall, evidence-locator correctness, claim atomicity, support entailment, contradiction handling, objective coverage, prerequisite validity, misconception treatment, duration realism, and reviewer scores. Strict fixtures require 100% externally verifiable claim coverage and zero unresolved critical/major claims.
