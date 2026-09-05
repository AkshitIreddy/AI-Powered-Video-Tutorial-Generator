[CmdletBinding()]
param(
    [string]$Destination,
    [string]$TrustedRuntimeSourceRoot,
    [string]$DesktopSource,
    [string]$WorkerSource,
    [switch]$Force,
    [switch]$ValidateDestinationOnly,
    [switch]$SkipSourceBuild
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
if (-not $Destination) {
    $PreferredTestRoot = "E:\temp"
    $Destination = if (Test-Path -LiteralPath $PreferredTestRoot -PathType Container) {
        Join-Path $PreferredTestRoot "AI Video Tutorial Generator Test Sandbox"
    }
    else {
        Join-Path (Split-Path -Parent $RepoRoot) "AI Video Tutorial Generator Test Sandbox"
    }
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
    $CandidateIsReparsePoint = Test-IsReparsePoint $CandidatePath
    if ($CandidateIsReparsePoint -and -not $ContainedRoot) {
        throw "$Label is a link, junction, or other reparse target: $CandidatePath"
    }
    if ($Recurse -or $CandidateIsReparsePoint) {
        $ReparseItems = @(if ($CandidateIsReparsePoint) {
            Get-Item -LiteralPath $CandidatePath -Force
        }
        else {
            Get-ChildItem -LiteralPath $CandidatePath -Force -Recurse |
                Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }
        })
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
    # The packager refreshes only its owned App/Runtime payload. Models and
    # project media are durable user/runtime state and may intentionally contain
    # verified model junctions, so do not traverse those preserved trees here.
    Assert-NoReparsePoints -CandidatePath $SafeDestinationPath -Label "Portable destination"
    if (Test-Path -LiteralPath $SafeDestinationPath -PathType Container) {
        foreach ($Child in Get-ChildItem -LiteralPath $SafeDestinationPath -Force) {
            if ($Child.Name -in @("Models", "Projects", "Exports")) { continue }
            Assert-NoReparsePoints -CandidatePath $Child.FullName -Label "Portable destination" -Recurse -ContainedRoot $SafeDestinationPath
        }
    }

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

if (-not $DesktopSource) {
    $CargoTargetRoot = if ($env:CARGO_TARGET_DIR) {
        [IO.Path]::GetFullPath($env:CARGO_TARGET_DIR)
    }
    else {
        Join-Path $RepoRoot "apps\desktop\src-tauri\target"
    }
    $DesktopSource = Join-Path $CargoTargetRoot "debug\alystria-studio.exe"
}
if (-not $WorkerSource) {
    $WorkerSource = Join-Path $RepoRoot "dist\runtime-packs\pipeline\current\alystria-pipeline.exe"
}
$DesktopSource = [IO.Path]::GetFullPath($DesktopSource)
$WorkerSource = [IO.Path]::GetFullPath($WorkerSource)
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
        throw "Test area already exists: $Destination. Review it, then rerun with -Force to replace only AI Video Tutorial Generator-owned files."
    }
    if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) {
        throw "Refusing to write into an existing folder without AI Video Tutorial Generator's test-area manifest: $Destination"
    }
    $Existing = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
    if ($Existing.kind -notin @(
        "alystria-studio-portable-debug-test-area",
        "ai-video-tutorial-generator-portable-debug-test-area"
    )) {
        throw "Refusing to write into a folder that is not AI Video Tutorial Generator's portable test area: $Destination"
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

# Reject redirection in every existing path the packager will overwrite or
# populate. Preserved Models/Projects/Exports remain outside this mutation set.
foreach ($OwnedMutablePath in @(
    $AppDirectory,
    $RuntimeDirectory,
    $DataDirectory,
    $CacheDirectory,
    $TempDirectory,
    $TestHarnessDirectory,
    $EvidenceDirectory
)) {
    Assert-NoReparsePoints -CandidatePath $OwnedMutablePath -Label "Portable owned destination" -Recurse -ContainedRoot $Destination
}
if (-not $TrustedRuntimeSourceRoot) {
    $TrustedRuntimeSourceRoot = Join-Path (Split-Path -Parent $Destination) "Alystria Studio Test Area\Test Data\runtimes"
}
$TrustedRuntimeSourceRoot = [IO.Path]::GetFullPath($TrustedRuntimeSourceRoot)
if (-not (Test-Path -LiteralPath $TrustedRuntimeSourceRoot -PathType Container)) {
    throw "The trusted Node/Chromium/FFmpeg cache is missing: $TrustedRuntimeSourceRoot"
}
$DestinationPrefix = $Destination.TrimEnd('\') + '\'
foreach ($SourceRoot in @($TrustedRuntimeSourceRoot, $DesktopSource, $WorkerSource)) {
    $ResolvedSourceRoot = [IO.Path]::GetFullPath($SourceRoot)
    if (($ResolvedSourceRoot + '\').StartsWith($DestinationPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Portable build inputs must be outside the destination so -Force cannot erase or overwrite its own source: $ResolvedSourceRoot"
    }
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
        $Targets = @($Item.Target)
        $Target = [string]$Targets[0]
        if ([IO.Path]::IsPathRooted($Target)) { $Target }
        else { [IO.Path]::GetFullPath((Join-Path (Split-Path -Parent $Item.FullName) $Target)) }
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

$PortableRuntimeSource = (
    (Test-Path -LiteralPath (Join-Path $TrustedRuntimeSourceRoot "node\node.exe") -PathType Leaf) -and
    (Test-Path -LiteralPath (Join-Path $TrustedRuntimeSourceRoot "chromium\chrome.exe") -PathType Leaf) -and
    (Test-Path -LiteralPath (Join-Path $TrustedRuntimeSourceRoot "ffmpeg\ffmpeg.exe") -PathType Leaf)
)
if ($PortableRuntimeSource) {
    $NodeSourceRoot = Assert-TrustedRuntimeSource `
        (Join-Path $TrustedRuntimeSourceRoot "node") "Portable Node $NodeVersion"
    $NodeSource = Join-Path $NodeSourceRoot "node.exe"
    $NodeLicenseSource = Join-Path $NodeSourceRoot "LICENSE.txt"
    $CorepackSource = $null
    $ChromiumSourceRoot = Assert-TrustedRuntimeSource `
        (Join-Path $TrustedRuntimeSourceRoot "chromium") "Portable Chromium $ChromiumVersion"
    $ChromiumSource = Join-Path $ChromiumSourceRoot "chrome.exe"
    $FfmpegSourceRoot = Assert-TrustedRuntimeSource `
        (Join-Path $TrustedRuntimeSourceRoot "ffmpeg") "Portable FFmpeg $FfmpegVersion LGPL"
    $FfmpegSourceBin = $FfmpegSourceRoot
    $FfmpegLicenseSource = Join-Path $FfmpegSourceRoot "LICENSE.txt"
}
else {
    $NodeSourceRoot = Assert-TrustedRuntimeSource `
        (Join-Path $TrustedRuntimeSourceRoot "node-v$NodeVersion-win-x64\extracted\node-v$NodeVersion-win-x64") `
        "Node $NodeVersion"
    $NodeSource = Join-Path $NodeSourceRoot "node.exe"
    $NodeLicenseSource = Join-Path $NodeSourceRoot "LICENSE"
    $CorepackSource = Join-Path $NodeSourceRoot "corepack.cmd"
    $ChromiumSourceRoot = Assert-TrustedRuntimeSource `
        (Join-Path $TrustedRuntimeSourceRoot "chromium-$ChromiumRevision\chrome-win64") `
        "Chromium revision $ChromiumRevision"
    $ChromiumSource = Join-Path $ChromiumSourceRoot "chrome.exe"
    $FfmpegSourceRoot = Assert-TrustedRuntimeSource `
        (Join-Path $TrustedRuntimeSourceRoot "ffmpeg-n9.0.1-6-g9d4ca21220-win64-lgpl-shared-9.0\extracted\ffmpeg-n9.0.1-6-g9d4ca21220-win64-lgpl-shared-9.0") `
        "FFmpeg $FfmpegVersion LGPL"
    $FfmpegSourceBin = Join-Path $FfmpegSourceRoot "bin"
    $FfmpegLicenseSource = Join-Path $FfmpegSourceRoot "LICENSE.txt"
}
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
if ($SkipSourceBuild) {
    foreach ($BuiltPath in @(
        (Join-Path $RepoRoot "packages\scenes\dist"),
        (Join-Path $RepoRoot "services\renderer\dist")
    )) {
        if (-not (Test-Path -LiteralPath $BuiltPath -PathType Container)) {
            throw "-SkipSourceBuild requires the already-verified build output: $BuiltPath"
        }
    }
}
else {
    if (-not $CorepackSource -or -not (Test-Path -LiteralPath $CorepackSource -PathType Leaf)) {
        throw "The selected runtime source has no Corepack launcher. Run the source build first and pass -SkipSourceBuild."
    }
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

$DesktopDestination = Join-Path $AppDirectory "AI Video Tutorial Generator.exe"
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
Copy-Item -LiteralPath $NodeLicenseSource -Destination (Join-Path $NodeDestination "LICENSE.txt") -Force

$ChromiumDestination = Join-Path $RuntimeDirectory "chromium"
Copy-Item -LiteralPath $ChromiumSourceRoot -Destination $ChromiumDestination -Recurse -Force

$FfmpegDestination = Join-Path $RuntimeDirectory "ffmpeg"
Copy-DirectoryContents $FfmpegSourceBin $FfmpegDestination
Copy-Item -LiteralPath $FfmpegLicenseSource -Destination (Join-Path $FfmpegDestination "LICENSE.txt") -Force

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

$LegacyLauncherPath = Join-Path $Destination "Start AI Video Tutorial Generator Hidden.pyw"
if (Test-Path -LiteralPath $LegacyLauncherPath -PathType Leaf) {
    Remove-Item -LiteralPath $LegacyLauncherPath -Force
}

$Manifest = [ordered]@{
    kind = "ai-video-tutorial-generator-portable-debug-test-area"
    createdAt = [DateTime]::UtcNow.ToString("o")
    desktop = [ordered]@{
        path = "App\AI Video Tutorial Generator.exe"
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
    credentialStoreException = "Windows Credential Manager stores provider secret values outside the sandbox; only opaque keyring references may appear in app files."
    launch = "App\AI Video Tutorial Generator.exe"
    notes = @(
        "Debug-only local test handoff; not a signed installer or release artifact.",
        "The GUI executable discovers this signed-path sibling manifest before WebView2 starts and redirects app data, temp, caches, models, projects, exports, logs, and the supervised test sidecar to this test area.",
        "Bundled music and sound effects are copied beside the worker and verified against their catalog before launch.",
        "Bundled backgrounds and fictional presenter portraits are copied beside the worker and verified against the starter-kit catalog.",
        "The portable debug worker derives Node, the renderer CLI, Chromium, FFmpeg, and ffprobe only from the sibling hash ledger.",
        "The renderer dependency tree contains regular files only; it has no repository links or host-browser fallback.",
        "A separately staged presenter Python environment is outside the base runtime ledger and is trusted only through Models\presenter-runtime.json plus its exact model and environment attestations.",
        "Optional model packs may be staged under Models after this base sandbox is created; the executable binds the presenter runtime only to Models\presenter-runtime.json.",
        "AI Video Tutorial Generator.exe is a Windows GUI-subsystem binary and is the only supported launch entry point; no console or script launcher is included.",
        "No provider keys or production project folders are copied."
    )
}
$Manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $ManifestPath -Encoding UTF8

Write-Host "Created AI Video Tutorial Generator portable debug test area: $Destination"
Write-Host "Launch without a console window by double-clicking: $DesktopDestination"
Write-Host "Portable root: $Destination"
