# Security and privacy

## Security goals

Alystria protects project confidentiality, secrets, filesystem integrity, provenance, consent, and provider spend against untrusted documents, URLs, model output, media, extensions, and crashed workers. The system assumes imported content and generated output can be hostile.

The desktop interface is not a trusted shell. The Rust core is a narrow privilege broker. The pipeline is the sole project writer. All other processes operate on immutable inputs and disposable staging directories.

## Local, hybrid, and cloud execution

Fully Local mode blocks project-content network egress, remote fonts/assets, analytics, crash-upload, and cloud fallback. Loopback IPC remains allowed. Hybrid and Cloud modes require a per-operation disclosure of provider, model, payload classes, endpoint/region, retention policy, and purpose before the first content-bearing call.

Consent to one provider is not consent to another. A failed provider may be retried only under its declared policy; switching provider, region, retention class, or local/cloud boundary requires a new approval. Unapproved retention blocks the call. Unknown pricing does not block an otherwise approved route; usage receipts retain known cost, and retries remain bounded.

## Secrets

Provider credentials are stored in Windows Credential Manager, macOS Keychain, or Linux Secret Service. Projects contain only opaque credential references. Keys must never appear in command-line arguments, environment dumps, logs, events, diagnostics bundles, screenshots, archives, crash reports, or export metadata. Workers request a scoped, short-lived authorization channel from the broker; they do not receive the credential vault.

Legacy tracked key files and public Basic credentials are prohibited. Secret scanning runs in local verification and CI.

## Import quarantine

Files enter a quarantine directory outside the authoritative object store. Ingestion checks declared and detected media type, extension mismatch, size, item count, decompression ratio, nested archive depth, parser timeout, path traversal, symlinks, active content, and malware scanner result when available. Parsing happens outside the privileged UI with resource limits.

The original is preserved only if policy and rights allow it. Parsed text is data, never instructions. Document text cannot alter prompts, provider selection, file paths, commands, SQL, or policy without explicit structured mediation.

## Network fetch safety

URL imports allow only explicit HTTP(S) schemes and re-resolve every redirect. Requests block loopback, private, link-local, multicast, reserved, Unix socket, `file:`, cloud metadata, and credential-bearing destinations. DNS rebinding checks occur at connection time. Response type, length, redirect count, decompression, and elapsed time are bounded. Authentication headers never cross origins.

## Generated-output containment

Model output is untrusted. JSON is schema-validated and size-limited. It cannot directly become a shell command, SQL fragment, filesystem path, SVG script, HTML script, renderer source, FFmpeg argument list, or extension manifest. SVG is sanitized to the supported declarative subset. FFmpeg arguments are constructed from typed enums and verified paths, never interpolated command strings. Code examples run in capability-limited WASI/Wasmtime, Pyodide, or QuickJS-WASM environments; `node:vm` is not a security boundary.

## Worker and extension isolation

Workers authenticate to a per-session endpoint, use least-privilege directories, inherit a minimal environment, and are terminated as a process tree. Third-party executable extensions are out of process and declare versioned capabilities. Filesystem, network, model, secret, GPU, and export access are denied unless the user approves the exact capability. A marketplace is outside the 2.0 release candidate.

## Provenance, rights, and consent

Every source, model, and asset records immutable origin, hash, creator, provider/model/revision, license expression, attribution, ingredient assets, consent references, and C2PA state. Unknown, expired, preview-only, noncommercial, no-derivatives, missing-attribution, revoked, or missing-consent assets block incompatible export.

Voice cloning and real-person presenter use require an immutable consent record covering subject, scope, proof, recording time, expiry/revocation, distribution, and synthetic-media disclosure. Revocation makes affected outputs stale and blocks new export. Presenter providers receive only the approved portrait/video and final scene audio, not project sources.

Release-candidate packaging generates an SPDX SBOM, third-party notices, model notices, FFmpeg build configuration, and provenance manifest, and attaches C2PA content credentials where supported. See [SPDX](https://spdx.dev/learn/overview/) and [C2PA](https://spec.c2pa.org/post/contentcredentials/).

## Logging and diagnostics

Logs use allow-listed structured fields. Content, prompts, narration, source text, URLs with query strings, file contents, headers, credentials, and raw provider responses are excluded by default. Identifiers are scoped and pseudonymous. A diagnostics bundle shows a manifest to the user before creation and provides a redacted preview.

## Security acceptance gates

- Fully Local fixture runs with content networking denied.
- Secret canaries do not appear in logs, arguments, screenshots, archives, diagnostics, database exports, or generated media.
- URL and archive fuzz suites reject traversal, SSRF, decompression bombs, type confusion, and parser timeouts.
- Crash recovery does not duplicate a billable provider request.
- Unknown rights or revoked consent blocks export with an actionable explanation.
- Project import cannot write outside the selected destination.
- Application success never initiates push, merge, publication, deployment, or release.

Security reports must describe the concrete impact and reproduction conditions without including user content or real credentials. Follow the repository contribution guide for private coordination before public disclosure.
