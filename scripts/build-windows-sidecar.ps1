[CmdletBinding()]
param(
    [string]$OutputDirectory,
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$PipelineRoot = Join-Path $RepoRoot "services\pipeline"
$SourceRoot = Join-Path $PipelineRoot "src"
if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path $RepoRoot "artifacts\windows-sidecar"
}
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
$OutputExecutable = Join-Path $OutputDirectory "alystria-pipeline.exe"

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

$WorkRoot = Join-Path ([IO.Path]::GetTempPath()) ("alystria-sidecar-" + [Guid]::NewGuid().ToString("N"))
$DistRoot = Join-Path $WorkRoot "dist"
$BuildRoot = Join-Path $WorkRoot "build"
$SpecRoot = Join-Path $WorkRoot "spec"
$Launcher = Join-Path $PipelineRoot "sidecar_entry.py"

New-Item -ItemType Directory -Path $WorkRoot | Out-Null
try {
    $UvExecutable = [string]$UvPath
    & $UvExecutable run --project $PipelineRoot --with "pyinstaller==6.22.2" `
        pyinstaller --noconfirm --clean --onefile --console `
        --name "alystria-pipeline" `
        --paths $SourceRoot `
        --collect-submodules "alystria" `
        --collect-data "alystria.sandbox" `
        --distpath $DistRoot `
        --workpath $BuildRoot `
        --specpath $SpecRoot `
        $Launcher
    if ($LASTEXITCODE -ne 0) {
        throw "PyInstaller failed with exit code $LASTEXITCODE."
    }

    $BuiltExecutable = Join-Path $DistRoot "alystria-pipeline.exe"
    if (-not (Test-Path $BuiltExecutable -PathType Leaf)) {
        throw "PyInstaller did not produce the expected alystria-pipeline.exe artifact."
    }

    & $BuiltExecutable doctor | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "The built sidecar failed its dependency-free doctor smoke test."
    }

    New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
    Copy-Item -LiteralPath $BuiltExecutable -Destination $OutputExecutable -Force:$Force
    $Digest = (Get-FileHash -LiteralPath $OutputExecutable -Algorithm SHA256).Hash.ToLowerInvariant()
    Set-Content -LiteralPath ($OutputExecutable + ".sha256") `
        -Value ("$Digest  alystria-pipeline.exe") -Encoding ASCII

    Write-Host "Built Alystria desktop sidecar: $OutputExecutable"
    Write-Host "SHA-256: $Digest"
    Write-Host "Runtime install location: <Alystria app data>\runtimes\pipeline\current\alystria-pipeline.exe"
}
finally {
    if (Test-Path $WorkRoot) {
        Remove-Item -LiteralPath $WorkRoot -Recurse -Force
    }
}
