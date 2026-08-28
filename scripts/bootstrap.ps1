[CmdletBinding()]
param(
    [switch]$Check,
    [switch]$Offline,
    [switch]$AllowVersionMismatch,
    [switch]$SkipJs,
    [switch]$SkipPython,
    [switch]$SkipRust
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Node = Get-Command node -ErrorAction SilentlyContinue
if (-not $Node -and (Test-Path "C:\Program Files\nodejs\node.exe")) {
    $Node = Get-Item "C:\Program Files\nodejs\node.exe"
}
if (-not $Node) {
    throw "Node.js is required. Install the version in .node-version, then rerun this script."
}

$Arguments = @("scripts/setup.mjs")
if ($Check) { $Arguments += "--check" }
if ($Offline) { $Arguments += "--offline" }
if ($AllowVersionMismatch) { $Arguments += "--allow-version-mismatch" }
if ($SkipJs) { $Arguments += "--skip-js" }
if ($SkipPython) { $Arguments += "--skip-python" }
if ($SkipRust) { $Arguments += "--skip-rust" }

$SetupExitCode = 1
Push-Location $RepoRoot
try {
    $NodePath = $Node.Source
    if (-not $NodePath) { $NodePath = $Node.FullName }
    $Process = Start-Process -FilePath $NodePath -ArgumentList $Arguments -NoNewWindow -Wait -PassThru
    $SetupExitCode = $Process.ExitCode
}
finally {
    Pop-Location
}

if ($SetupExitCode -ne 0) {
    Write-Error "Alystria setup failed with exit code $SetupExitCode."
    exit $SetupExitCode
}
