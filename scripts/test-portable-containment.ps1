[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$Packager = Join-Path $PSScriptRoot "create-portable-test-area.ps1"
$ScratchRoot = Join-Path ([IO.Path]::GetTempPath()) ("alystria-portable-containment-" + [Guid]::NewGuid().ToString("N"))

function Assert-ThrowsLike {
    param(
        [Parameter(Mandatory = $true)][scriptblock]$Action,
        [Parameter(Mandatory = $true)][string]$Pattern
    )
    try {
        & $Action
    }
    catch {
        if ($_.Exception.Message -notlike $Pattern) {
            throw "Expected error like '$Pattern', got '$($_.Exception.Message)'."
        }
        return
    }
    throw "Expected an error like '$Pattern', but the action succeeded."
}

try {
    New-Item -ItemType Directory -Path $ScratchRoot | Out-Null

    # Validation must be read-only: an absent, narrowly scoped destination is
    # accepted without creating it.
    $ValidDestination = Join-Path $ScratchRoot "Alystria Studio 2.0 Test Sandbox"
    & $Packager -Destination $ValidDestination -ValidateDestinationOnly
    if (Test-Path -LiteralPath $ValidDestination) {
        throw "Destination-only validation unexpectedly created the sandbox."
    }

    # Browser profiles create compatibility junctions such as Content.IE5. A
    # target that remains inside the portable root is safe and must not make a
    # force refresh impossible; an outward target must still fail closed.
    New-Item -ItemType Directory -Path $ValidDestination | Out-Null
    $InternalTarget = Join-Path $ValidDestination "profile-cache"
    $InternalJunction = Join-Path $ValidDestination "profile-compat"
    New-Item -ItemType Directory -Path $InternalTarget | Out-Null
    New-Item -ItemType Junction -Path $InternalJunction -Target $InternalTarget | Out-Null
    & $Packager -Destination $ValidDestination -ValidateDestinationOnly
    Remove-Item -LiteralPath $InternalJunction -Force

    $ExternalTarget = Join-Path $ScratchRoot "external-cache"
    $ExternalJunction = Join-Path $ValidDestination "escaping-compat"
    New-Item -ItemType Directory -Path $ExternalTarget | Out-Null
    New-Item -ItemType Junction -Path $ExternalJunction -Target $ExternalTarget | Out-Null
    Assert-ThrowsLike -Pattern "*escapes its root*" -Action {
        & $Packager -Destination $ValidDestination -ValidateDestinationOnly
    }
    Remove-Item -LiteralPath $ExternalJunction -Force

    $VolumeRoot = [IO.Path]::GetPathRoot($ScratchRoot)
    Assert-ThrowsLike -Pattern "*filesystem root*" -Action {
        & $Packager -Destination $VolumeRoot -ValidateDestinationOnly
    }

    # A junction in any existing ancestor must be rejected before the packager
    # reads build artifacts or writes destination files.
    $JunctionTarget = Join-Path $ScratchRoot "junction-target"
    $JunctionPath = Join-Path $ScratchRoot "junction-ancestor"
    New-Item -ItemType Directory -Path $JunctionTarget | Out-Null
    New-Item -ItemType Junction -Path $JunctionPath -Target $JunctionTarget | Out-Null
    Assert-ThrowsLike -Pattern "*reparse target*" -Action {
        & $Packager -Destination (Join-Path $JunctionPath "Sandbox") -ValidateDestinationOnly
    }

    $PackagerSource = Get-Content -LiteralPath $Packager -Raw
    foreach ($Variable in @(
        "ALYSTRIA_PORTABLE_ROOT",
        "ALYSTRIA_APP_DATA_DIR",
        "ALYSTRIA_RUNTIME_DIR",
        "ALYSTRIA_MODELS_DIR",
        "ALYSTRIA_PROJECTS_DIR",
        "ALYSTRIA_EXPORTS_DIR",
        "ALYSTRIA_LOGS_DIR",
        "ALYSTRIA_CACHE_DIR",
        "ALYSTRIA_TEMP_DIR",
        "WEBVIEW2_USER_DATA_FOLDER",
        "TEMP",
        "TMP",
        "APPDATA",
        "LOCALAPPDATA",
        "HF_HOME",
        "TORCH_HOME",
        "DOCLING_ARTIFACTS_PATH",
        "PYTHONPYCACHEPREFIX",
        "PLAYWRIGHT_BROWSERS_PATH",
        "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD"
    )) {
        if ($PackagerSource -notmatch [Regex]::Escape("`"$Variable`"")) {
            throw "Portable launcher is missing the $Variable redirect."
        }
    }
    foreach ($RequiredText in @(
        '"Alystria Studio 2.0 Test Sandbox"',
        'Start Alystria Studio Hidden.pyw',
        'subprocess.CREATE_NO_WINDOW | subprocess.DETACHED_PROCESS',
        'startup_info.wShowWindow = subprocess.SW_HIDE',
        '[str(portable_root / "App" / "Alystria Studio.exe")]',
        'Windows Credential Manager stores provider secret values outside the sandbox',
        'Models\presenter-runtime.json plus its exact model and environment attestations',
        'launcherSha256'
    )) {
        if (-not $PackagerSource.Contains($RequiredText)) {
            throw "Portable packager is missing required containment text: $RequiredText"
        }
    }
    if ($PackagerSource.Contains('Get-ChildItem -LiteralPath $RuntimeDirectory -File -Recurse')) {
        throw "Portable base-runtime hashing must not absorb separately attested presenter environments."
    }

    Write-Host "PORTABLE_CONTAINMENT_TESTS_PASSED"
}
finally {
    if (Test-Path -LiteralPath $ScratchRoot) {
        Remove-Item -LiteralPath $ScratchRoot -Recurse -Force
    }
}
