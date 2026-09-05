[CmdletBinding()]
param(
    [string]$OutputDirectory,
    [string]$BuildRootDirectory,
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$PipelineRoot = Join-Path $RepoRoot "services\pipeline"
$SourceRoot = Join-Path $PipelineRoot "src"
$StarterAudioSource = Join-Path $RepoRoot "assets\starter\audio"
$CanonicalFixtureSource = Join-Path $RepoRoot "fixtures\canonical"
. (Join-Path $PSScriptRoot "lib\starter-audio.ps1")
. (Join-Path $PSScriptRoot "lib\starter-visuals.ps1")
if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path $RepoRoot "artifacts\windows-sidecar"
}
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
$OutputExecutable = Join-Path $OutputDirectory "alystria-pipeline.exe"

if (-not $BuildRootDirectory) {
    $PreferredBuildRoot = "E:\temp\AI Video Tutorial Generator\build\sidecar"
    $BuildRootDirectory = if (Test-Path -LiteralPath "E:\temp" -PathType Container) {
        $PreferredBuildRoot
    }
    else {
        Join-Path ([IO.Path]::GetTempPath()) "ai-video-tutorial-generator\build\sidecar"
    }
}
$BuildRootDirectory = [IO.Path]::GetFullPath($BuildRootDirectory)

if ((Test-Path $OutputExecutable) -and -not $Force) {
    throw "Sidecar output already exists. Pass -Force to replace this exact artifact: $OutputExecutable"
}

$UserUv = Join-Path $env:USERPROFILE "AppData\Roaming\Python\Python312\Scripts\uv.exe"
if (Test-Path $UserUv -PathType Leaf) {
    $UvPath = $UserUv
}
else {
    $Uv = Get-Command uv -ErrorAction SilentlyContinue
    $UvPath = $Uv.Source
    if (-not $UvPath) { $UvPath = $Uv.FullName }
}
if (-not $UvPath) {
    throw "uv is required to build the isolated Python sidecar. Install uv and rerun this script."
}

$WorkRoot = Join-Path $BuildRootDirectory ("build-" + [Guid]::NewGuid().ToString("N"))
$DistRoot = Join-Path $WorkRoot "dist"
$BuildRoot = Join-Path $WorkRoot "build"
$SpecRoot = Join-Path $WorkRoot "spec"
$Launcher = Join-Path $PipelineRoot "sidecar_entry.py"

New-Item -ItemType Directory -Path $WorkRoot -Force | Out-Null
try {
    $UvExecutable = [string]$UvPath
    # Start-Process is deliberately used instead of relying on LASTEXITCODE:
    # PowerShell hosts launched through WSL can leave that variable unset even
    # after a native process has completed. Quote every argv atom because the
    # saved project path contains spaces.
    $PyInstallerArguments = @(
        "run", "--project", $PipelineRoot, "--with", "pyinstaller==6.22.2",
        "pyinstaller", "--noconfirm", "--clean", "--onefile", "--console",
        "--name", "alystria-pipeline", "--paths", $SourceRoot,
        "--collect-submodules", "alystria", "--collect-data", "alystria.sandbox",
        "--add-data", ($CanonicalFixtureSource + ";alystria\generation\canonical"),
        "--distpath", $DistRoot, "--workpath", $BuildRoot, "--specpath", $SpecRoot,
        $Launcher
    )
    $QuotedArguments = ($PyInstallerArguments | ForEach-Object {
        '"' + ([string]$_).Replace('"', '\"') + '"'
    }) -join ' '
    $PyInstallerProcess = Start-Process -FilePath $UvExecutable -ArgumentList $QuotedArguments -Wait -PassThru -NoNewWindow
    if ($PyInstallerProcess.ExitCode -ne 0) {
        throw "PyInstaller failed with exit code $($PyInstallerProcess.ExitCode)."
    }

    $BuiltExecutable = Join-Path $DistRoot "alystria-pipeline.exe"
    if (-not (Test-Path $BuiltExecutable -PathType Leaf)) {
        # Some Windows hosts launched through WSL do not set LASTEXITCODE for
        # a completed native child. The immutable output in this fresh temp
        # dist directory is the authoritative success signal either way.
        throw "PyInstaller did not produce the expected alystria-pipeline.exe artifact."
    }

    $DoctorProcess = Start-Process -FilePath $BuiltExecutable -ArgumentList '"doctor"' -Wait -PassThru -NoNewWindow
    if ($DoctorProcess.ExitCode -ne 0) {
        throw "The built sidecar failed its dependency-free doctor smoke test (exit $($DoctorProcess.ExitCode))."
    }

    New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
    Copy-Item -LiteralPath $BuiltExecutable -Destination $OutputExecutable -Force:$Force
    $StarterAudioDestination = Join-Path $OutputDirectory "assets\starter\audio"
    $StarterAudioProof = Copy-AlystriaStarterAudioRoot `
        -Source $StarterAudioSource `
        -Destination $StarterAudioDestination `
        -Force:$Force
    $StarterVisualDestination = Join-Path $OutputDirectory "assets\starter\visuals"
    $StarterVisualProof = Copy-AlystriaStarterVisualRoot `
        -Source $RepoRoot `
        -Destination $StarterVisualDestination `
        -Force:$Force
    $Digest = (Get-FileHash -LiteralPath $OutputExecutable -Algorithm SHA256).Hash.ToLowerInvariant()
    Set-Content -LiteralPath ($OutputExecutable + ".sha256") `
        -Value ("$Digest  alystria-pipeline.exe") -Encoding ASCII

    Write-Host "Built AI Video Tutorial Generator desktop sidecar: $OutputExecutable"
    Write-Host "SHA-256: $Digest"
    Write-Host "Verified starter audio: $($StarterAudioProof.AssetCount) assets, catalog $($StarterAudioProof.CatalogSha256)"
    Write-Host "Verified starter visuals: $($StarterVisualProof.AssetCount) assets, catalog $($StarterVisualProof.CatalogSha256)"
    Write-Host "Runtime install location: <AI Video Tutorial Generator app data>\runtimes\pipeline\current\alystria-pipeline.exe"
}
finally {
    if (Test-Path $WorkRoot) {
        Remove-Item -LiteralPath $WorkRoot -Recurse -Force
    }
}
