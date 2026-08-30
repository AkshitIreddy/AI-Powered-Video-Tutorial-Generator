[CmdletBinding()]
param(
    [string]$Destination,
    [string]$TrustedRuntimeSourceRoot,
    [switch]$Force,
    [switch]$ValidateDestinationOnly
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
if (-not $Destination) {
    $Destination = Join-Path (Split-Path -Parent $RepoRoot) "Alystria Studio 2.0 Test Sandbox"
}
$Destination = [IO.Path]::GetFullPath($Destination)
$DestinationRoot = [IO.Path]::GetPathRoot($Destination)
$env:ALYSTRIA_PACKAGER_DESTINATION_GUARD = $Destination

function Test-IsReparsePoint {
    param([Parameter(Mandatory = $true)][string]$CandidatePath)
    $Item = Get-Item -LiteralPath $CandidatePath -Force
    return [bool]($Item.Attributes -band [IO.FileAttributes]::ReparsePoint)
}

function Get-ReparseTargets {
    param([Parameter(Mandatory = $true)]$ReparseItem)
    $Targets = @($ReparseItem.Target | Where-Object {
        -not [string]::IsNullOrWhiteSpace([string]$_)
    })
    if ($Targets.Count -gt 0) { return $Targets }

    # Windows PowerShell 5.1 leaves Target empty for some system-created mount
    # points (notably the WebView profile's Content.IE5 compatibility link).
    # fsutil exposes the canonical print name without following the link.
    $Fsutil = Join-Path $env:SystemRoot "System32\fsutil.exe"
    $StartInfo = New-Object System.Diagnostics.ProcessStartInfo
    $StartInfo.FileName = $Fsutil
    $StartInfo.Arguments = 'reparsepoint query "' + $ReparseItem.FullName.Replace('"', '\"') + '"'
    $StartInfo.UseShellExecute = $false
    $StartInfo.CreateNoWindow = $true
    $StartInfo.RedirectStandardOutput = $true
    $StartInfo.RedirectStandardError = $true
    $Process = [Diagnostics.Process]::Start($StartInfo)
    $Query = $Process.StandardOutput.ReadToEnd() + "`n" + $Process.StandardError.ReadToEnd()
    $Process.WaitForExit()
    $PrintName = [Regex]::Match($Query, '(?m)^\s*Print Name:\s+(.+?)\s*$')
    if ($PrintName.Success) {
        return @($PrintName.Groups[1].Value.Trim())
    }
    return @()
}

function Assert-NoReparsePoints {
    param(
        [Parameter(Mandatory = $true)][string]$CandidatePath,
        [Parameter(Mandatory = $true)][string]$Label,
        [switch]$Recurse,
        [string]$ContainedRoot
    )
    if (-not (Test-Path -LiteralPath $CandidatePath)) { return }
    if (Test-IsReparsePoint $CandidatePath) {
        throw "$Label is a link, junction, or other reparse target: $CandidatePath"
    }
    if ($Recurse) {
        $ReparseItems = @(Get-ChildItem -LiteralPath $CandidatePath -Force -Recurse |
            Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint })
        if ($ReparseItems.Count -gt 0 -and -not $ContainedRoot) {
            throw "$Label contains a link, junction, or other reparse target: $($ReparseItems[0].FullName)"
        }
        if ($ContainedRoot) {
            $AllowedRoot = [IO.Path]::GetFullPath($ContainedRoot).TrimEnd('\') + '\'
            foreach ($ReparseItem in $ReparseItems) {
                $Targets = @(Get-ReparseTargets $ReparseItem)
                if ($Targets.Count -eq 0) {
                    throw "$Label contains a reparse point whose target cannot be verified: $($ReparseItem.FullName)"
                }
                foreach ($Target in $Targets) {
                    $ResolvedTarget = if ([IO.Path]::IsPathRooted([string]$Target)) {
                        [IO.Path]::GetFullPath([string]$Target)
                    }
                    else {
                        [IO.Path]::GetFullPath((Join-Path $ReparseItem.DirectoryName ([string]$Target)))
                    }
                    if (-not ($ResolvedTarget + '\').StartsWith($AllowedRoot, [StringComparison]::OrdinalIgnoreCase)) {
                        throw "$Label contains a reparse point that escapes its root: $($ReparseItem.FullName) -> $ResolvedTarget"
                    }
                }
            }
        }
    }
}

function Assert-SafePortableDestination {
    param([Parameter(Mandatory = $true)][string]$CandidatePath)
    $SafeDestinationPath = [IO.Path]::GetFullPath($CandidatePath)
    if ($SafeDestinationPath.TrimEnd([char[]]@('\', '/')) -eq $DestinationRoot.TrimEnd([char[]]@('\', '/'))) {
        throw "Refusing to use a filesystem root as the portable destination: $SafeDestinationPath"
    }

    $Cursor = $SafeDestinationPath
    Assert-NoReparsePoints -CandidatePath $SafeDestinationPath -Label "Portable destination" -Recurse -ContainedRoot $SafeDestinationPath

    # Validate every already-existing ancestor before creating or replacing a
    # file. This blocks a seemingly safe child path from traversing a junction.
    while ($Cursor -and -not (Test-Path -LiteralPath $Cursor)) {
        $Parent = Split-Path -Parent $Cursor
        if (-not $Parent -or $Parent -eq $Cursor) { break }
        $Cursor = $Parent
    }
    if ($Cursor) {
        $Cursor = [IO.Path]::GetFullPath($Cursor)
        while ($Cursor) {
            Assert-NoReparsePoints -CandidatePath $Cursor -Label "Portable destination ancestor"
            if ($Cursor.TrimEnd([char[]]@('\', '/')) -eq $DestinationRoot.TrimEnd([char[]]@('\', '/'))) { break }
            $Parent = Split-Path -Parent $Cursor
            if (-not $Parent -or $Parent -eq $Cursor) { break }
            $Cursor = $Parent
        }
    }
}

Assert-SafePortableDestination $env:ALYSTRIA_PACKAGER_DESTINATION_GUARD
$Destination = $env:ALYSTRIA_PACKAGER_DESTINATION_GUARD
Remove-Item Env:\ALYSTRIA_PACKAGER_DESTINATION_GUARD
if ($ValidateDestinationOnly) {
    Write-Host "Portable destination containment validation passed: $Destination"
    return
}

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

$AppDirectory = Join-Path $Destination "App"
$RuntimeDirectory = Join-Path $Destination "Runtime"
$DataDirectory = Join-Path $Destination "App Data"
$ModelsDirectory = Join-Path $Destination "Models"
$ProjectsDirectory = Join-Path $Destination "Projects"
$ExportsDirectory = Join-Path $Destination "Exports"
$LogsDirectory = Join-Path $Destination "Logs"
$CacheDirectory = Join-Path $Destination "Cache"
$TempDirectory = Join-Path $Destination "Temp"
$TestHarnessDirectory = Join-Path $Destination "Test Harness"
$EvidenceDirectory = Join-Path $Destination "Evidence"
if (-not $TrustedRuntimeSourceRoot) {
    $TrustedRuntimeSourceRoot = Join-Path (Split-Path -Parent $Destination) "Alystria Studio Test Area\Test Data\runtimes"
}
$TrustedRuntimeSourceRoot = [IO.Path]::GetFullPath($TrustedRuntimeSourceRoot)
if (-not (Test-Path -LiteralPath $TrustedRuntimeSourceRoot -PathType Container)) {
    throw "The trusted Node/Chromium/FFmpeg cache is missing: $TrustedRuntimeSourceRoot"
}
Assert-NoReparsePoints -CandidatePath $TrustedRuntimeSourceRoot -Label "Trusted runtime source" -Recurse

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

# Resolve and inspect every copy source before the first destination write.
# Workspace package links are resolved deliberately, but a resolved payload may
# not itself contain links or junctions.
foreach ($Source in @(
    $DesktopSource,
    $WorkerSource,
    $StarterAudioSource,
    $StarterVisualSource,
    (Join-Path $RepoRoot "services\renderer\dist"),
    (Join-Path $RepoRoot "packages\scenes\dist")
)) {
    Assert-NoReparsePoints -CandidatePath $Source -Label "Portable payload source" -Recurse
}
$ResolvedDependencies = @{}
foreach ($Dependency in @("playwright-core", "react", "react-dom", "scheduler")) {
    $LinkPath = if ($Dependency -eq "scheduler") {
        Join-Path $RepoRoot "node_modules\.pnpm\scheduler@0.26.0\node_modules\scheduler"
    }
    else {
        Join-Path $RepoRoot "services\renderer\node_modules\$Dependency"
    }
    $DependencySource = Resolve-PackageDirectory $LinkPath $Dependency
    Assert-NoReparsePoints -CandidatePath $DependencySource -Label "$Dependency production dependency" -Recurse
    $ResolvedDependencies[$Dependency] = $DependencySource
}

$OwnedRuntimeDirectories = @("node", "chromium", "ffmpeg", "renderer")
foreach ($OwnedName in $OwnedRuntimeDirectories) {
    $OwnedPath = Join-Path $RuntimeDirectory $OwnedName
    if (Test-Path -LiteralPath $OwnedPath) {
        if (-not $Force) { throw "Portable runtime payload already exists: $OwnedPath" }
        Remove-Item -LiteralPath $OwnedPath -Recurse -Force
    }
}

$PortableDirectories = @(
    $Destination,
    $AppDirectory,
    $RuntimeDirectory,
    $DataDirectory,
    $ModelsDirectory,
    $ProjectsDirectory,
    $ExportsDirectory,
    $LogsDirectory,
    $CacheDirectory,
    $TempDirectory,
    $TestHarnessDirectory,
    $EvidenceDirectory,
    (Join-Path $DataDirectory "Roaming"),
    (Join-Path $DataDirectory "Local"),
    (Join-Path $DataDirectory "User Profile"),
    (Join-Path $DataDirectory "WebView2"),
    (Join-Path $CacheDirectory "XDG"),
    (Join-Path $CacheDirectory "HuggingFace"),
    (Join-Path $CacheDirectory "Torch"),
    (Join-Path $CacheDirectory "TorchInductor"),
    (Join-Path $CacheDirectory "Triton"),
    (Join-Path $CacheDirectory "Numba"),
    (Join-Path $CacheDirectory "CUDA"),
    (Join-Path $CacheDirectory "Matplotlib"),
    (Join-Path $CacheDirectory "Docling"),
    (Join-Path $CacheDirectory "PythonBytecode"),
    (Join-Path $CacheDirectory "pip"),
    (Join-Path $CacheDirectory "uv"),
    (Join-Path $CacheDirectory "npm")
)
New-Item -ItemType Directory -Path $PortableDirectories -Force | Out-Null

$DesktopDestination = Join-Path $AppDirectory "Alystria Studio.exe"
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
    $DependencySource = $ResolvedDependencies[$Dependency]
    Copy-DirectoryContents $DependencySource (Join-Path $RendererDestination "node_modules\$Dependency")
}

$BaseRuntimePayloadRoots = @(
    $WorkerDestination,
    (Join-Path $RuntimeDirectory "assets"),
    $NodeDestination,
    $ChromiumDestination,
    $FfmpegDestination,
    $RendererDestination
)
foreach ($PayloadRoot in $BaseRuntimePayloadRoots) {
    if (Test-Path -LiteralPath $PayloadRoot -PathType Container) {
        $ReparsePoint = Get-ChildItem -LiteralPath $PayloadRoot -Recurse -Force |
            Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint } |
            Select-Object -First 1
        if ($ReparsePoint) {
            throw "Portable runtime contains a link or junction instead of immutable files: $($ReparsePoint.FullName)"
        }
    }
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
$RuntimeFiles = @(
    foreach ($PayloadRoot in $BaseRuntimePayloadRoots) {
        if (Test-Path -LiteralPath $PayloadRoot -PathType Leaf) {
            Get-Item -LiteralPath $PayloadRoot -Force
        }
        else {
            Get-ChildItem -LiteralPath $PayloadRoot -File -Recurse -Force
        }
    }
) | Sort-Object FullName
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
set "ALYSTRIA_PORTABLE_ROOT=%~dp0"
set "ALYSTRIA_APP_DATA_DIR=%~dp0App Data"
set "ALYSTRIA_RUNTIME_DIR=%~dp0Runtime"
set "ALYSTRIA_MODELS_DIR=%~dp0Models"
set "ALYSTRIA_PROJECTS_DIR=%~dp0Projects"
set "ALYSTRIA_EXPORTS_DIR=%~dp0Exports"
set "ALYSTRIA_LOGS_DIR=%~dp0Logs"
set "ALYSTRIA_CACHE_DIR=%~dp0Cache"
set "ALYSTRIA_TEMP_DIR=%~dp0Temp"
set "ALYSTRIA_PIPELINE_WORKER=%~dp0Runtime\alystria-pipeline.exe"
set "ALYSTRIA_LOCAL_PRESENTER_CONFIG_PATH=%~dp0Models\presenter-runtime.json"
set "WEBVIEW2_USER_DATA_FOLDER=%~dp0App Data\WebView2"
set "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333"
set "TEMP=%~dp0Temp"
set "TMP=%~dp0Temp"
set "TMPDIR=%~dp0Temp"
set "APPDATA=%~dp0App Data\Roaming"
set "LOCALAPPDATA=%~dp0App Data\Local"
set "USERPROFILE=%~dp0App Data\User Profile"
set "HOME=%~dp0App Data\User Profile"
set "XDG_CACHE_HOME=%~dp0Cache\XDG"
set "XDG_CONFIG_HOME=%~dp0App Data\XDG\Config"
set "XDG_DATA_HOME=%~dp0App Data\XDG\Data"
set "XDG_STATE_HOME=%~dp0App Data\XDG\State"
set "HF_HOME=%~dp0Cache\HuggingFace"
set "HUGGINGFACE_HUB_CACHE=%~dp0Cache\HuggingFace\Hub"
set "TRANSFORMERS_CACHE=%~dp0Cache\HuggingFace\Transformers"
set "HF_DATASETS_CACHE=%~dp0Cache\HuggingFace\Datasets"
set "TORCH_HOME=%~dp0Cache\Torch"
set "TORCHINDUCTOR_CACHE_DIR=%~dp0Cache\TorchInductor"
set "TRITON_CACHE_DIR=%~dp0Cache\Triton"
set "NUMBA_CACHE_DIR=%~dp0Cache\Numba"
set "CUDA_CACHE_PATH=%~dp0Cache\CUDA"
set "MPLCONFIGDIR=%~dp0Cache\Matplotlib"
set "DOCLING_ARTIFACTS_PATH=%~dp0Cache\Docling"
set "PYTHONPYCACHEPREFIX=%~dp0Cache\PythonBytecode"
set "PIP_CACHE_DIR=%~dp0Cache\pip"
set "UV_CACHE_DIR=%~dp0Cache\uv"
set "NPM_CONFIG_CACHE=%~dp0Cache\npm"
set "PLAYWRIGHT_BROWSERS_PATH=0"
set "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1"
start "" "%~dp0App\Alystria Studio.exe"
'@
Set-Content -LiteralPath $LauncherPath -Value $Launcher -Encoding ASCII

$Manifest = [ordered]@{
    kind = "alystria-studio-portable-debug-test-area"
    createdAt = [DateTime]::UtcNow.ToString("o")
    desktop = [ordered]@{
        path = "App\Alystria Studio.exe"
        sha256 = (Get-FileHash -LiteralPath $DesktopDestination -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    pipelineWorker = [ordered]@{
        path = "Runtime\alystria-pipeline.exe"
        sha256 = (Get-FileHash -LiteralPath $WorkerDestination -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    starterAudio = [ordered]@{
        path = "Runtime\assets\starter\audio"
        catalogSha256 = $StarterAudioProof.CatalogSha256
        assetCount = $StarterAudioProof.AssetCount
        totalBytes = $StarterAudioProof.TotalBytes
    }
    starterVisuals = [ordered]@{
        path = "Runtime\assets\starter\visuals"
        catalogSha256 = $StarterVisualProof.CatalogSha256
        assetCount = $StarterVisualProof.AssetCount
        totalBytes = $StarterVisualProof.TotalBytes
    }
    rendererRuntime = [ordered]@{
        path = "Runtime"
        manifest = "Runtime\runtime-manifest.json"
        manifestSha256 = $RuntimeManifestSha256
        componentCount = $Components.Count
        node = "24.20.0"
        chromium = "$ChromiumVersion (Playwright revision $ChromiumRevision)"
        ffmpeg = "$FfmpegVersion LGPL"
        renderer = $RendererVersion
    }
    portableRoot = "."
    appData = "App Data"
    mutableDirectories = @("App Data", "Models", "Projects", "Exports", "Logs", "Cache", "Temp", "Evidence")
    credentialStoreException = "Windows Credential Manager stores provider secret values outside the sandbox; only opaque keyring references may appear in Alystria files."
    launch = "Start Alystria Studio Test.cmd"
    launcherSha256 = (Get-FileHash -LiteralPath $LauncherPath -Algorithm SHA256).Hash.ToLowerInvariant()
    notes = @(
        "Debug-only local test handoff; not a signed installer or release artifact.",
        "Launch variables redirect app data, WebView2, temp, caches, models, projects, exports, logs, and the supervised test sidecar to this test area.",
        "Bundled music and sound effects are copied beside the worker and verified against their catalog before launch.",
        "Bundled backgrounds and fictional presenter portraits are copied beside the worker and verified against the starter-kit catalog.",
        "The portable debug worker derives Node, the renderer CLI, Chromium, FFmpeg, and ffprobe only from the sibling hash ledger.",
        "The renderer dependency tree contains regular files only; it has no repository links or host-browser fallback.",
        "A separately staged presenter Python environment is outside the base runtime ledger and is trusted only through Models\presenter-runtime.json plus its exact model and environment attestations.",
        "Optional model packs may be staged under Models after this base sandbox is created; the launcher binds the presenter runtime only to Models\presenter-runtime.json.",
        "No provider keys or production project folders are copied."
    )
}
$Manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $ManifestPath -Encoding UTF8

Write-Host "Created Alystria portable debug test area: $Destination"
Write-Host "Launch by double-clicking: $LauncherPath"
Write-Host "Portable root: $Destination"
