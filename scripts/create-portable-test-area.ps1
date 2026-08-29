[CmdletBinding()]
param(
    [string]$Destination,
    [string]$TrustedRuntimeSourceRoot,
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
$StarterAudioSource = Join-Path (Split-Path -Parent $WorkerSource) "assets\starter\audio"
$StarterVisualSource = Join-Path (Split-Path -Parent $WorkerSource) "assets\starter\visuals"
$ManifestPath = Join-Path $Destination "test-area-manifest.json"
. (Join-Path $PSScriptRoot "lib\starter-audio.ps1")
. (Join-Path $PSScriptRoot "lib\starter-visuals.ps1")

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
if (-not $TrustedRuntimeSourceRoot) {
    $TrustedRuntimeSourceRoot = Join-Path $DataDirectory "runtimes"
}
$TrustedRuntimeSourceRoot = [IO.Path]::GetFullPath($TrustedRuntimeSourceRoot)
if (-not (Test-Path -LiteralPath $TrustedRuntimeSourceRoot -PathType Container)) {
    throw "The trusted Node/Chromium/FFmpeg cache is missing: $TrustedRuntimeSourceRoot"
}

$DesktopDestination = Join-Path $Destination "Alystria Studio.exe"
$WorkerDestination = Join-Path $RuntimeDirectory "alystria-pipeline.exe"
Copy-Item -LiteralPath $DesktopSource -Destination $DesktopDestination -Force:$Force
Copy-Item -LiteralPath $WorkerSource -Destination $WorkerDestination -Force:$Force
$StarterAudioDestination = Join-Path $RuntimeDirectory "assets\starter\audio"
$StarterAudioProof = Copy-AlystriaStarterAudioRoot `
    -Source $StarterAudioSource `
    -Destination $StarterAudioDestination `
    -Force:$Force
$StarterVisualDestination = Join-Path $RuntimeDirectory "assets\starter\visuals"
$StarterVisualProof = Copy-AlystriaStarterVisualRoot `
    -Source $StarterVisualSource `
    -Destination $StarterVisualDestination `
    -Force:$Force

function Assert-TrustedRuntimeSource {
    param([string]$Path, [string]$Label)
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "$Label is missing from the trusted runtime cache: $Path"
    }
    $TrustedRoot = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $TrustedRuntimeSourceRoot).Path).TrimEnd('\') + '\'
    $Resolved = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $Path).Path)
    if (-not $Resolved.StartsWith($TrustedRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw "$Label escapes the trusted runtime cache."
    }
    return $Resolved
}

function Assert-FileSha256 {
    param([string]$Path, [string]$Expected, [string]$Label)
    $Actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($Actual -ne $Expected) {
        throw "$Label failed its exact SHA-256 pin. Expected $Expected, got $Actual."
    }
}

function Copy-DirectoryContents {
    param([string]$Source, [string]$Destination)
    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    Get-ChildItem -LiteralPath $Source -Force | Copy-Item -Destination $Destination -Recurse -Force
}

function Resolve-PackageDirectory {
    param([string]$Path, [string]$Label)
    $Item = Get-Item -LiteralPath $Path
    $Resolved = if ($Item.LinkType) {
        $Target = [string]$Item.Target[0]
        if ([IO.Path]::IsPathRooted($Target)) { $Target }
        else { [IO.Path]::GetFullPath((Join-Path $Item.DirectoryName $Target)) }
    }
    else { $Item.FullName }
    if (-not (Test-Path -LiteralPath $Resolved -PathType Container)) {
        throw "$Label production dependency is unavailable: $Resolved"
    }
    return [IO.Path]::GetFullPath($Resolved)
}

$RepositoryRuntimeManifest = Get-Content -LiteralPath (Join-Path $RepoRoot "runtime-manifest.json") -Raw | ConvertFrom-Json
$NodeVersion = [string]$RepositoryRuntimeManifest.toolchains.node.version
$ChromiumRevision = [string]$RepositoryRuntimeManifest.renderer.chromium.revision
$ChromiumVersion = [string]$RepositoryRuntimeManifest.renderer.chromium.browserVersion
$ChromiumSha256 = [string]$RepositoryRuntimeManifest.renderer.chromium.executableSha256
$FfmpegVersion = [string]$RepositoryRuntimeManifest.media.ffmpeg.version
$RendererPackage = Get-Content -LiteralPath (Join-Path $RepoRoot "services\renderer\package.json") -Raw | ConvertFrom-Json
$RendererVersion = [string]$RendererPackage.version

$NodeSourceRoot = Assert-TrustedRuntimeSource `
    (Join-Path $TrustedRuntimeSourceRoot "node-v$NodeVersion-win-x64\extracted\node-v$NodeVersion-win-x64") `
    "Node $NodeVersion"
$NodeSource = Join-Path $NodeSourceRoot "node.exe"
$CorepackSource = Join-Path $NodeSourceRoot "corepack.cmd"
$ChromiumSourceRoot = Assert-TrustedRuntimeSource `
    (Join-Path $TrustedRuntimeSourceRoot "chromium-$ChromiumRevision\chrome-win64") `
    "Chromium revision $ChromiumRevision"
$ChromiumSource = Join-Path $ChromiumSourceRoot "chrome.exe"
$FfmpegSourceRoot = Assert-TrustedRuntimeSource `
    (Join-Path $TrustedRuntimeSourceRoot "ffmpeg-n9.0.1-6-g9d4ca21220-win64-lgpl-shared-9.0\extracted\ffmpeg-n9.0.1-6-g9d4ca21220-win64-lgpl-shared-9.0") `
    "FFmpeg $FfmpegVersion LGPL"
$FfmpegSourceBin = Join-Path $FfmpegSourceRoot "bin"
$FfmpegSource = Join-Path $FfmpegSourceBin "ffmpeg.exe"
$FfprobeSource = Join-Path $FfmpegSourceBin "ffprobe.exe"

Assert-FileSha256 $NodeSource "5c976096e04e5c2c1f091938926234cc9fbebfe9787ddd149351b3b0ecc707b5" "Node $NodeVersion"
Assert-FileSha256 $ChromiumSource $ChromiumSha256 "Chromium $ChromiumVersion"
Assert-FileSha256 $FfmpegSource "b5885fe673a8cc93188f4fc1b5d59dac12507b5a0bf0b76d875874498ce76af4" "FFmpeg $FfmpegVersion"
Assert-FileSha256 $FfprobeSource "fa77f24b8fef79a10a102d3ba0e6c4b497de9c754261157acd6aeb9aa8c0d897" "ffprobe $FfmpegVersion"
if ((Get-Item -LiteralPath $NodeSource).VersionInfo.ProductVersion -ne $NodeVersion) {
    throw "The trusted Node executable did not report v$NodeVersion."
}
if ((Get-Item -LiteralPath $ChromiumSource).VersionInfo.ProductVersion -ne $ChromiumVersion) {
    throw "The trusted Chromium executable did not report $ChromiumVersion."
}
# Build the current renderer and its scene package before copying production
# files. Runtime execution uses the exact Node 24 binary copied below; Corepack
# is used here only as the lockfile-aware build driver.
$OriginalPath = $env:PATH
$OriginalPathExt = $env:PATHEXT
$env:PATH = "$NodeSourceRoot;$OriginalPath"
$env:PATHEXT = ".COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC;.CPL"
try {
    $BuildArguments = @("pnpm", "--filter", "@alystria/scenes", "build")
    $BuildProcess = Start-Process -FilePath $CorepackSource -ArgumentList $BuildArguments -WorkingDirectory $RepoRoot -Wait -PassThru -NoNewWindow
    if ($BuildProcess.ExitCode -ne 0) {
        throw "The scene package build failed with exit code $($BuildProcess.ExitCode)."
    }
    $BuildArguments = @("pnpm", "--filter", "@alystria/renderer", "build")
    $BuildProcess = Start-Process -FilePath $CorepackSource -ArgumentList $BuildArguments -WorkingDirectory $RepoRoot -Wait -PassThru -NoNewWindow
    if ($BuildProcess.ExitCode -ne 0) {
        throw "The renderer build failed with exit code $($BuildProcess.ExitCode)."
    }
}
finally {
    $env:PATH = $OriginalPath
    $env:PATHEXT = $OriginalPathExt
}

$OwnedRuntimeDirectories = @("node", "chromium", "ffmpeg", "renderer")
foreach ($OwnedName in $OwnedRuntimeDirectories) {
    $OwnedPath = Join-Path $RuntimeDirectory $OwnedName
    if (Test-Path -LiteralPath $OwnedPath) {
        if (-not $Force) { throw "Portable runtime payload already exists: $OwnedPath" }
        Remove-Item -LiteralPath $OwnedPath -Recurse -Force
    }
}

$NodeDestination = Join-Path $RuntimeDirectory "node"
New-Item -ItemType Directory -Path $NodeDestination -Force | Out-Null
Copy-Item -LiteralPath $NodeSource -Destination (Join-Path $NodeDestination "node.exe") -Force
Copy-Item -LiteralPath (Join-Path $NodeSourceRoot "LICENSE") -Destination (Join-Path $NodeDestination "LICENSE.txt") -Force

$ChromiumDestination = Join-Path $RuntimeDirectory "chromium"
Copy-Item -LiteralPath $ChromiumSourceRoot -Destination $ChromiumDestination -Recurse -Force

$FfmpegDestination = Join-Path $RuntimeDirectory "ffmpeg"
Copy-DirectoryContents $FfmpegSourceBin $FfmpegDestination
Copy-Item -LiteralPath (Join-Path $FfmpegSourceRoot "LICENSE.txt") -Destination (Join-Path $FfmpegDestination "LICENSE.txt") -Force

# Create a flat, link-free production dependency tree. pnpm's workspace links
# are appropriate for development but are deliberately not copied into a
# portable runtime because one of them points back to the source repository.
$RendererDestination = Join-Path $RuntimeDirectory "renderer"
Copy-DirectoryContents (Join-Path $RepoRoot "services\renderer\dist") (Join-Path $RendererDestination "dist")
Copy-Item -LiteralPath (Join-Path $RepoRoot "services\renderer\package.json") -Destination $RendererDestination -Force
Copy-Item -LiteralPath (Join-Path $RepoRoot "services\renderer\README.md") -Destination $RendererDestination -Force
$ScenesDestination = Join-Path $RendererDestination "node_modules\@alystria\scenes"
Copy-DirectoryContents (Join-Path $RepoRoot "packages\scenes\dist") (Join-Path $ScenesDestination "dist")
Copy-Item -LiteralPath (Join-Path $RepoRoot "packages\scenes\package.json") -Destination $ScenesDestination -Force
foreach ($Dependency in @("playwright-core", "react", "react-dom", "scheduler")) {
    $LinkPath = if ($Dependency -eq "scheduler") {
        Join-Path $RepoRoot "node_modules\.pnpm\scheduler@0.26.0\node_modules\scheduler"
    }
    else {
        Join-Path $RepoRoot "services\renderer\node_modules\$Dependency"
    }
    $DependencySource = Resolve-PackageDirectory $LinkPath $Dependency
    Copy-DirectoryContents $DependencySource (Join-Path $RendererDestination "node_modules\$Dependency")
}

$ReparsePoint = Get-ChildItem -LiteralPath $RuntimeDirectory -Recurse -Force |
    Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint } |
    Select-Object -First 1
if ($ReparsePoint) {
    throw "Portable runtime contains a link or junction instead of immutable files: $($ReparsePoint.FullName)"
}

$RuntimeManifestPath = Join-Path $RuntimeDirectory "runtime-manifest.json"
$RelativeVersionAndLicense = @{
    "alystria-pipeline.exe" = @($RendererVersion, "MIT")
    "node/node.exe" = @($NodeVersion, "MIT")
    "renderer/dist/src/cli.js" = @($RendererVersion, "MIT")
    "chromium/chrome.exe" = @($ChromiumVersion, "BSD-3-Clause")
    "ffmpeg/ffmpeg.exe" = @($FfmpegVersion, "LGPL-2.1-or-later")
    "ffmpeg/ffprobe.exe" = @($FfmpegVersion, "LGPL-2.1-or-later")
    "assets/starter/audio/catalog.json" = @($RendererVersion, "MIT")
    "assets/starter/visuals/packages/themes/starter-kits/core.v1.json" = @($RendererVersion, "MIT")
}
$RequiredIds = @{
    "alystria-pipeline.exe" = "pipeline-worker"
    "node/node.exe" = "node"
    "renderer/dist/src/cli.js" = "renderer-cli"
    "chromium/chrome.exe" = "chromium"
    "ffmpeg/ffmpeg.exe" = "ffmpeg"
    "ffmpeg/ffprobe.exe" = "ffprobe"
    "assets/starter/audio/catalog.json" = "starter-audio-catalog"
    "assets/starter/visuals/packages/themes/starter-kits/core.v1.json" = "starter-visual-catalog"
}
$Components = [Collections.Generic.List[object]]::new()
$PayloadIndex = 0
$RuntimeFiles = Get-ChildItem -LiteralPath $RuntimeDirectory -File -Recurse -Force |
    Where-Object { $_.FullName -ne $RuntimeManifestPath } |
    Sort-Object FullName
foreach ($File in $RuntimeFiles) {
    $RelativePath = $File.FullName.Substring($RuntimeDirectory.TrimEnd('\').Length + 1).Replace('\', '/')
    $VersionAndLicense = $RelativeVersionAndLicense[$RelativePath]
    $ComponentId = $RequiredIds[$RelativePath]
    if (-not $ComponentId) {
        $PayloadIndex += 1
        $ComponentId = "payload-{0:d4}" -f $PayloadIndex
        $VersionAndLicense = @($RendererVersion, "SEE-BUNDLED-NOTICES")
    }
    $Components.Add([ordered]@{
        id = $ComponentId
        version = [string]$VersionAndLicense[0]
        target = "windows-x86_64"
        relativePath = $RelativePath
        url = "file:///portable-debug/$RelativePath"
        sha256 = (Get-FileHash -LiteralPath $File.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        sizeBytes = [uint64]$File.Length
        license = [string]$VersionAndLicense[1]
        optional = $false
    })
}
foreach ($RequiredId in @("pipeline-worker", "node", "renderer-cli", "chromium", "ffmpeg", "ffprobe")) {
    if (-not ($Components | Where-Object id -eq $RequiredId)) {
        throw "Portable runtime manifest generation missed required component $RequiredId."
    }
}
$PortableRuntimeManifest = [ordered]@{
    schemaVersion = 1
    channel = "portable-debug"
    generatedAt = [DateTime]::UtcNow.ToString("o")
    components = $Components
    signature = $null
    note = "Unsigned local debug pack. Every file is path-contained and SHA-256 verified; release builds reject this channel."
}
$PortableRuntimeJson = $PortableRuntimeManifest | ConvertTo-Json -Depth 8
[IO.File]::WriteAllText($RuntimeManifestPath, $PortableRuntimeJson, [Text.UTF8Encoding]::new($false))
$RuntimeManifestSha256 = (Get-FileHash -LiteralPath $RuntimeManifestPath -Algorithm SHA256).Hash.ToLowerInvariant()

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
    starterAudio = [ordered]@{
        path = "runtime\assets\starter\audio"
        catalogSha256 = $StarterAudioProof.CatalogSha256
        assetCount = $StarterAudioProof.AssetCount
        totalBytes = $StarterAudioProof.TotalBytes
    }
    starterVisuals = [ordered]@{
        path = "runtime\assets\starter\visuals"
        catalogSha256 = $StarterVisualProof.CatalogSha256
        assetCount = $StarterVisualProof.AssetCount
        totalBytes = $StarterVisualProof.TotalBytes
    }
    rendererRuntime = [ordered]@{
        path = "runtime"
        manifest = "runtime\runtime-manifest.json"
        manifestSha256 = $RuntimeManifestSha256
        componentCount = $Components.Count
        node = "24.20.0"
        chromium = "$ChromiumVersion (Playwright revision $ChromiumRevision)"
        ffmpeg = "$FfmpegVersion LGPL"
        renderer = $RendererVersion
    }
    appData = "Test Data"
    launch = "Start Alystria Studio Test.cmd"
    notes = @(
        "Debug-only local test handoff; not a signed installer or release artifact.",
        "Launch variables redirect app data and the supervised test sidecar to this test area.",
        "Bundled music and sound effects are copied beside the worker and verified against their catalog before launch.",
        "Bundled backgrounds and fictional presenter portraits are copied beside the worker and verified against the starter-kit catalog.",
        "The portable debug worker derives Node, the renderer CLI, Chromium, FFmpeg, and ffprobe only from the sibling hash ledger.",
        "The renderer dependency tree contains regular files only; it has no repository links or host-browser fallback.",
        "No model weights, provider keys, or production project folders are copied."
    )
}
$Manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $ManifestPath -Encoding UTF8

Write-Host "Created Alystria portable debug test area: $Destination"
Write-Host "Launch by double-clicking: $LauncherPath"
Write-Host "Test-only app data: $DataDirectory"
