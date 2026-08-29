# Alystria pipeline

The pipeline is the sole writer for Alystria project metadata. It provides a
small JSON IPC service, local project archives, content-addressed objects and a
durable SQLite workflow runtime. It intentionally has no mandatory network or
cloud dependency.

Run the service from the repository root with:

```bash
PYTHONPATH=services/pipeline/src python3 -m alystria.cli serve
```

Each input line is a JSON request with `id`, `method`, and `params`. Each output
line is a JSON response. Logs must go to stderr so stdout remains protocol-safe.

## Desktop worker

The Tauri broker launches the packaged pipeline with the private
`--alystria-desktop-worker` flag. It sends the protocol version and a fresh
authentication token on stdin; the worker then exposes a random IPv4 or IPv6
loopback port and accepts only the desktop RPC allow-list. Tokens are never
accepted through command-line arguments or environment variables.

Build the dependency-free Windows executable from PowerShell with:

```powershell
.\scripts\build-windows-sidecar.ps1
```

The build artifact is written to
`artifacts\windows-sidecar\alystria-pipeline.exe` with a SHA-256 sidecar. The
desktop runtime manager expects the installed copy at
`<Alystria app data>\runtimes\pipeline\current\alystria-pipeline.exe`; the
absolute app-data root is shown by Alystria diagnostics. The build script does
not install the executable, alter a power profile, download model weights, or
publish an artifact.

## Local presenter worker

The service attaches an installed MuseTalk-style local worker only when
`ALYSTRIA_LOCAL_PRESENTER_CONFIG_PATH` points to its setup record. The worker
receives CAS-verified portrait and final narration copies in an isolated
attempt directory. Its command is an argv template, never a shell string:

```json
{
  "schemaVersion": 1,
  "runtimeRoot": "C:/Alystria/runtimes/presenter/current",
  "executable": { "relativePath": "presenter-worker.exe", "sha256": "<64 hex>" },
  "ffprobe": { "relativePath": "ffprobe.exe", "sha256": "<64 hex>" },
  "argumentTemplate": [
    "--portrait", "{portrait}", "--audio", "{audio}",
    "--output", "{output}", "--workspace", "{workspace}",
    "--job", "{job_manifest}", "--seed", "{seed}"
  ],
  "modelId": "musetalk",
  "modelRevision": "<immutable revision>",
  "executionPolicy": "managed-verified",
  "networkPolicy": "supervisor-deny",
  "profiles": [{
    "profileId": "presenter.default",
    "portraitArtifactHash": "<project CAS SHA-256>",
    "consentId": "<consent record ID>"
  }],
  "defaultProfileId": "presenter.default"
}
```

Managed mode requires pinned worker and ffprobe files plus supervisor-enforced
network denial. An unmanaged development invocation must declare
`executionPolicy: "unsafe-test-only"`, `networkPolicy: "not-enforced"`, and
`unsafeTestOnlyAcknowledged: true`; that state is preserved in artifact
metadata and cannot be mistaken for a verified production result.
