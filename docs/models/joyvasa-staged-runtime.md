# JoyVASA staged presenter runtime

`scripts/prepare-joyvasa-presenter-runtime.py` turns a reviewed JoyVASA candidate into
an exact-hash runtime pack. It performs no network requests and defaults to a dry run.
The active presenter configuration changes only with `--activate`, and route changes
require an explicit portrait-routes manifest.

This installer does not describe JoyVASA as a managed sandbox. The current presenter
runtime remains `unsafe-test-only` with `networkPolicy: not-enforced`. The strict Python
worker blocks Python network audit events and forces supported libraries offline, but
that is not an operating-system network denial.

## Inputs

Use the repository-tracked `docs/models/joyvasa/install-manifest.json`. The candidate may
also contain the same file at `candidate-metadata/alystria-install-manifest.json`, which
is the command default. The curated manifest was produced after source, weight, license,
and visual review and pins:

- the candidate evidence manifest and upstream source revision;
- every candidate or repository file allowed into the installed pack;
- a self-contained embedded Python base plus the reviewed relative site-packages tree;
- the broker adapter, strict worker, FFmpeg, FFprobe, and their dependencies;
- source files, audio feature files, motion weights, templates, and portrait runtime
  weights included in the worker's nested manifests;
- one canonical human profile and one canonical animal profile.

Each file entry has `origin` (`candidate` or `repository`), `sourcePath`, `installPath`,
`bytes`, and `sha256`. The dependency directory is represented by a reviewed canonical
tree digest, file count, and byte count. The installer recomputes its per-file ledger and
tree digest during every dry run or first activation. Runtime paths can only reference
reviewed entries. Portable paths use `/`, cannot contain `..`, and cannot traverse
symlinks or Windows reparse points.

The candidate's original venv records an owner-machine Python installation and is not
part of the activation payload. The reviewed layout uses embedded CPython under
`python-base` and imports the exact relative `venv/Lib/site-packages` tree. The curated
manifest declares `runtime.pythonRuntime.kind: embedded`, `home`, `homeExecutable`, and
`sitePackages`; embedded mode rejects `venvConfig` and requires the configured runtime
executable to be the installed embedded interpreter. No owner Python path is retained.

The source manifest must include the adapter-selected config, wrapper, motion model, and
both pipeline files, plus the supporting `src/modules` and `src/utils` subset imported by
those paths. The selected-file checks are a minimum, not permission to omit dependencies.
Each nested manifest is capped at the worker's reviewed 10,000-file bound, and each child
config is checked against the presenter's 1 MiB config limit. The 42,871-file dependency
tree is attested when installing, while the selected source and model files are pinned
and rechecked before each render. The full dependency ledger stays in the local receipt
instead of being committed or duplicated into top-level `pinnedFiles`.

An optional routes manifest uses this shape:

```json
{
  "schemaVersion": 1,
  "routes": [
    {
      "runtime": "animal",
      "profileId": "presenter-portrait.animal-cat-milo-v1",
      "portraitArtifactHash": "<lowercase SHA-256>",
      "subjectId": "fictional-synthetic-animal-cat-milo-v1",
      "priorPortraitArtifactHash": "<optional exact hash to retire>"
    }
  ]
}
```

Routes are keyed by the exact imported portrait bytes. Existing routes are preserved.
A hash already routed elsewhere is an error rather than a silent replacement. A route
may declare `priorPortraitArtifactHash` for an explicit migration. The installer removes
that prior hash only when it points to the same child runtime, or accepts an already
completed migration when the new hash is present. A missing prior and new hash, a prior
hash routed elsewhere, or overlap between prior and current route hashes is an error.

## Review and install

Run the validation pass first. Supply paths for the reviewed candidate and the target
Sandbox Models directory; no path in the tracked manifest is owner-specific. It reads
and hashes the candidate, repository worker and adapter, primary presenter config, and
optional routes without writing to `Models`:

```powershell
$candidate = "<reviewed JoyVASA candidate directory>"
$models = "<Sandbox Models directory>"
$plan = "<local output directory>\joyvasa-install-plan.json"

python scripts/prepare-joyvasa-presenter-runtime.py `
  --candidate $candidate `
  --manifest "docs\models\joyvasa\install-manifest.json" `
  --destination "$models\Presenter\JoyVASA" `
  --primary-config "$models\presenter-runtime.json" `
  --routes-manifest "docs\assets\joyvasa-presenter-routes-2026-09-20.json" `
  --dry-run `
  --receipt $plan
```

The candidate evidence manifest must hash to
`cd22d9e2d97162e1a99201a329dd436c19984f3e64123ba4674c3d6ac4df4ff6`.
The curated install manifest must hash to
`240e993925e6faf8a954303334529334e44ddb82e29921c89112f86c0d3f946d`.
This supersedes the first activated manifest (`2d9dc173…`), which omitted two upstream
`InferenceConfig` resources, and the resource-complete manifest (`06d4efa4…`), whose
adapter placed intermediate files in the delivery directory. The current manifest pins
`lip_array.pkl` and `mask_template.png`, both byte-identical to their blobs in JoyVASA
source commit `916a90f8de490e8648fee460c1200bd5d9a795af`. It also pins the repository worker and
adapter from commit `04547f1a9d951a9e509074c8b1832bb8eec08c57`, which keeps intermediates under the
declared job workspace and reserves the delivery directory for its one declared output.
The current routes also perform a guarded Finn v1-to-v2 portrait migration after dense
visual review rejected the v1 anatomy. Finn v1 remains a historical static asset but is
not retained as a ninth JoyVASA route.
Review the dry-run receipt before activation. Activation is the same command with
`--activate` in place of `--dry-run`:

```powershell
python scripts/prepare-joyvasa-presenter-runtime.py `
  --candidate $candidate `
  --manifest "docs\models\joyvasa\install-manifest.json" `
  --destination "$models\Presenter\JoyVASA" `
  --primary-config "$models\presenter-runtime.json" `
  --routes-manifest "docs\assets\joyvasa-presenter-routes-2026-09-20.json" `
  --activate `
  --receipt "<local output directory>\joyvasa-install-activated.json"
```

No provider key, common API key, user token, or credential path is an installer input.
The default `auto` transfer mode hardlinks immutable candidate payloads when the volume
supports it. It always copies the repository worker and adapter because those files are
active development sources. Use `--transfer copy` for a completely independent payload.

## Transaction and receipts

Activation builds a sibling staging directory and rehashes every installed file before
it can replace the destination. It generates:

- `manifests/runtime-source.json`;
- `manifests/portrait-runtime.json`;
- `joy-human.json` and `joy-animal.json`;
- `install-receipt.json`.

A reviewed `kind: venv` manifest can generate `pyvenv.cfg`, but the current JoyVASA pack
uses embedded Python and does not install the candidate's `venv/Scripts` or `pyvenv.cfg`.

The child configs pin the strict worker, adapter, executable, FFmpeg, FFprobe, contract
roles, source manifest, portrait runtime manifest, and declared extra files. They retain
the current `unsafe-test-only` and `not-enforced` policy labels. The worker rechecks the
nested source and portrait file hashes before each render.

When routes are supplied, the primary `presenter-runtime.json` receives only new
`portraitRuntimeOverrides`. Its default profile, profiles, MuseTalk runtime, extensions,
and all unrelated fields remain byte-equivalent after JSON parsing. A timestamped backup
is written beside it before replacement. An older JoyVASA destination is also moved to a
timestamped backup. Failure rolls both changes back.

`install-receipt.json` has schema version 1 and records the pack/source/model revisions,
curated and candidate evidence hashes, destination, transfer counts, every installed and
generated file hash, and requested routes. Repeating activation with the same manifest
verifies the existing receipt and files and does not create another config backup when
the routes already match.
