# Windows development setup

Windows is the reference platform. The final user experience must be installer-driven; these steps are for contributors building from source.

## Prerequisites

- Git with long-path support.
- The exact Node.js, Corepack/pnpm, Python/uv, and Rust versions declared by
  `runtime-manifest.json` and the root version files.
- Rust stable with the Windows MSVC target and Visual Studio Build Tools C++ workload.
- Python version declared by the pipeline project and `uv`.
- WebView2 Runtime.
- FFmpeg/ffprobe supplied by the pinned development runtime or discovered by diagnostics.
- Optional: NVIDIA driver suitable for declared local model runtimes.

Do not install model weights manually into the repository. The model manager owns immutable revisions and checksums. Do not add provider keys to `.env`, tracked files, terminal history, or launch arguments; use the credential flow in the application.

## Bootstrap

From the repository root, use the root scripts rather than starting services in separate terminals:

```powershell
.\scripts\bootstrap.ps1 -Check
.\scripts\bootstrap.ps1
corepack pnpm doctor
corepack pnpm dev
```

`pnpm dev` launches Tauri and its authenticated pipeline worker in one process
tree. Use `node scripts/dev.mjs --check` for a headless readiness check or
`corepack pnpm dev:web` for browser-only UI work.

## Validation

Run the repository-owned commands:

```powershell
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm test:fixtures
corepack pnpm test:e2e
corepack pnpm render-test
corepack pnpm benchmark -- --estimate-only --power-profile Silent --cpu-boost disabled
corepack pnpm package:desktop
```

Live BYOK tests are opt-in. The default test suite uses mock providers and
deterministic local fixtures. `package:desktop` creates a local artifact only
and must not publish it.

## Pipeline sidecar

Build the local Windows pipeline executable without model weights:

```powershell
.\scripts\build-windows-sidecar.ps1
```

The optional packaging-smoke script produces
`artifacts\windows-sidecar\alystria-pipeline.exe` and its SHA-256 file. Alystria
loads an installed worker from
`<Alystria app data>\runtimes\pipeline\current\alystria-pipeline.exe`; use the
Diagnostics screen to resolve the app-data root. Building does not install or
publish the worker. Normal source development uses the locked worker installed
under `services\pipeline\.venv`; production runtime installation remains the
signed runtime manager's responsibility.

## Power and background workloads

Functional tests, deterministic renders, and visual QA do not require turbo/boost. They may run in G-Helper Silent mode with CPU boost disabled. Benchmarks record the current profile, boost state, AC/battery state, temperatures, and notable background load.

Do not silently alter the Windows power plan or G-Helper settings. If peak characterization is useful, request approval or have the operator deliberately select the profile, then label the result separately from realistic silent-mode numbers. Other user agents or workloads remain in place unless the user explicitly permits stopping them.

## Clean-machine expectation

The release candidate must install without requiring Node, Python, Rust, Git, or manual terminals. Runtimes and optional model/runtime packs are versioned, checksum-verified, and managed by the application. A clean Windows virtual machine test is required before release approval.

## Uninstall and user data

Uninstalling the application must not delete project directories, model caches, exports, credentials, or custom runtime packs without a separately described user choice. The UI lists their locations and offers explicit cleanup after uninstall.
