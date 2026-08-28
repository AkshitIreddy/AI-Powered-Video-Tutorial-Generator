[CmdletBinding()]
param(
    [string]$Destination,
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
if (-not $Destination) {
    $Destination = Join-Path (Split-Path -Parent $RepoRoot) "Alystria Studio Test Area"
}
$Destination = [IO.Path]::GetFullPath($Destination)
$DesktopSource = Join-Path $RepoRoot "apps\desktop\src-tauri\target\debug\alystria-studio.exe"
$WorkerSource = Join-Path $RepoRoot "dist\runtime-packs\pipeline\current\alystria-pipeline.exe"
$ManifestPath = Join-Path $Destination "test-area-manifest.json"

foreach ($Path in @($DesktopSource, $WorkerSource)) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Required debug artifact is missing: $Path. Build the desktop and Windows sidecar first."
    }
}

if (Test-Path -LiteralPath $Destination) {
    if (-not $Force) {
        throw "Test area already exists: $Destination. Review it, then rerun with -Force to replace only Alystria-owned files."
    }
    if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) {
        throw "Refusing to write into an existing folder without Alystria's test-area manifest: $Destination"
    }
    $Existing = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
    if ($Existing.kind -ne "alystria-studio-portable-debug-test-area") {
        throw "Refusing to write into a folder that is not Alystria's portable test area: $Destination"
    }
}

$RuntimeDirectory = Join-Path $Destination "runtime"
$DataDirectory = Join-Path $Destination "Test Data"
New-Item -ItemType Directory -Path $Destination, $RuntimeDirectory, $DataDirectory -Force | Out-Null

$DesktopDestination = Join-Path $Destination "Alystria Studio.exe"
$WorkerDestination = Join-Path $RuntimeDirectory "alystria-pipeline.exe"
Copy-Item -LiteralPath $DesktopSource -Destination $DesktopDestination -Force:$Force
Copy-Item -LiteralPath $WorkerSource -Destination $WorkerDestination -Force:$Force

$LauncherPath = Join-Path $Destination "Start Alystria Studio Test.cmd"
$Launcher = @'
@echo off
setlocal
set "ALYSTRIA_APP_DATA_DIR=%~dp0Test Data"
set "ALYSTRIA_PIPELINE_WORKER=%~dp0runtime\alystria-pipeline.exe"
start "" "%~dp0Alystria Studio.exe"
'@
Set-Content -LiteralPath $LauncherPath -Value $Launcher -Encoding ASCII

$Manifest = [ordered]@{
    kind = "alystria-studio-portable-debug-test-area"
    createdAt = [DateTime]::UtcNow.ToString("o")
    desktop = [ordered]@{
        path = "Alystria Studio.exe"
        sha256 = (Get-FileHash -LiteralPath $DesktopDestination -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    pipelineWorker = [ordered]@{
        path = "runtime\alystria-pipeline.exe"
        sha256 = (Get-FileHash -LiteralPath $WorkerDestination -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    appData = "Test Data"
    launch = "Start Alystria Studio Test.cmd"
    notes = @(
        "Debug-only local test handoff; not a signed installer or release artifact.",
        "Launch variables redirect app data and the supervised test sidecar to this test area.",
        "No model weights, provider keys, or production project folders are copied."
    )
}
$Manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $ManifestPath -Encoding UTF8

Write-Host "Created Alystria portable debug test area: $Destination"
Write-Host "Launch by double-clicking: $LauncherPath"
Write-Host "Test-only app data: $DataDirectory"
