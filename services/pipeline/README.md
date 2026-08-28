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
