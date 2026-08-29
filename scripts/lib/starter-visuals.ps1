Set-StrictMode -Version Latest

function Test-AlystriaStarterVisualRoot {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$Root
    )

    $ResolvedRoot = [IO.Path]::GetFullPath($Root)
    if (-not (Test-Path -LiteralPath $ResolvedRoot -PathType Container)) {
        throw "Alystria starter visual root is missing: $ResolvedRoot"
    }
    $RootItem = Get-Item -LiteralPath $ResolvedRoot -Force
    if (($RootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Alystria starter visual root cannot be a reparse point: $ResolvedRoot"
    }

    $CatalogPath = Join-Path $ResolvedRoot "packages\themes\starter-kits\core.v1.json"
    if (-not (Test-Path -LiteralPath $CatalogPath -PathType Leaf)) {
        throw "Alystria starter visual catalog is missing: $CatalogPath"
    }
    $CatalogItem = Get-Item -LiteralPath $CatalogPath -Force
    if (($CatalogItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $CatalogItem.Length -le 0 -or $CatalogItem.Length -gt 8MB) {
        throw "Alystria starter visual catalog is not a bounded regular file."
    }
    try {
        $Catalog = Get-Content -LiteralPath $CatalogPath -Raw -Encoding UTF8 | ConvertFrom-Json
    }
    catch {
        throw "Alystria starter visual catalog is invalid JSON: $($_.Exception.Message)"
    }
    if ($Catalog.schemaVersion -ne 1 -or $Catalog.id -ne "alystria.starter-kit.core") {
        throw "Alystria starter visual catalog has an unsupported identity or schema."
    }

    $Assets = @($Catalog.assets | Where-Object {
        $_.kind -in @("background", "presenter-portrait") -and
        $_.source.delivery -eq "bundled-file" -and
        $_.source.availability -eq "ready"
    })
    if ($Assets.Count -eq 0) {
        throw "Alystria starter visual catalog contains no ready bundled images."
    }
    $RootPrefix = $ResolvedRoot.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    $Identifiers = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    $RelativePaths = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    $TotalBytes = [int64]0
    foreach ($Asset in $Assets) {
        $Identifier = [string]$Asset.id
        $RelativePath = [string]$Asset.source.relativePath
        $ExpectedHash = ([string]$Asset.source.contentHash).ToLowerInvariant()
        $ExpectedBytes = [int64]$Asset.source.byteSize
        if ([string]::IsNullOrWhiteSpace($Identifier) -or -not $Identifiers.Add($Identifier)) {
            throw "Alystria starter visual asset IDs must be non-empty and unique."
        }
        if ([string]::IsNullOrWhiteSpace($RelativePath) -or [IO.Path]::IsPathRooted($RelativePath)) {
            throw "Alystria starter visual asset '$Identifier' has an unsafe path."
        }
        $PathParts = @($RelativePath -split '[/\\]')
        if ($PathParts.Count -eq 0 -or @($PathParts | Where-Object { $_ -in @("", ".", "..") }).Count -ne 0) {
            throw "Alystria starter visual asset '$Identifier' has an unsafe path."
        }
        $NormalizedRelativePath = $PathParts -join [IO.Path]::DirectorySeparatorChar
        if (-not $RelativePaths.Add($NormalizedRelativePath)) {
            throw "Alystria starter visual catalog repeats path '$RelativePath'."
        }
        if ($ExpectedHash -notmatch '^[0-9a-f]{64}$' -or $ExpectedBytes -le 0 -or $ExpectedBytes -gt 32MB) {
            throw "Alystria starter visual asset '$Identifier' has invalid integrity metadata."
        }
        $AssetPath = [IO.Path]::GetFullPath((Join-Path $ResolvedRoot $NormalizedRelativePath))
        if (-not $AssetPath.StartsWith($RootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Alystria starter visual asset '$Identifier' escapes the catalog root."
        }
        if (-not (Test-Path -LiteralPath $AssetPath -PathType Leaf)) {
            throw "Alystria starter visual asset '$Identifier' is missing."
        }
        $AssetItem = Get-Item -LiteralPath $AssetPath -Force
        if (($AssetItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $AssetItem.Length -ne $ExpectedBytes) {
            throw "Alystria starter visual asset '$Identifier' does not match its catalog size."
        }
        $ActualHash = (Get-FileHash -LiteralPath $AssetPath -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($ActualHash -ne $ExpectedHash) {
            throw "Alystria starter visual asset '$Identifier' does not match its catalog hash."
        }
        $TotalBytes += $AssetItem.Length
    }

    [pscustomobject]@{
        Root = $ResolvedRoot
        CatalogPath = $CatalogPath
        CatalogSha256 = (Get-FileHash -LiteralPath $CatalogPath -Algorithm SHA256).Hash.ToLowerInvariant()
        Assets = $Assets
        AssetCount = $Assets.Count
        TotalBytes = $TotalBytes
    }
}

function Copy-AlystriaStarterVisualRoot {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$Source,
        [Parameter(Mandatory = $true)]
        [string]$Destination,
        [switch]$Force
    )

    $SourceProof = Test-AlystriaStarterVisualRoot -Root $Source
    $ResolvedDestination = [IO.Path]::GetFullPath($Destination)
    if (Test-Path -LiteralPath $ResolvedDestination) {
        if (-not $Force) {
            throw "Starter visual destination already exists: $ResolvedDestination"
        }
        Remove-Item -LiteralPath $ResolvedDestination -Recurse -Force
    }
    New-Item -ItemType Directory -Path $ResolvedDestination -Force | Out-Null

    $CatalogDestination = Join-Path $ResolvedDestination "packages\themes\starter-kits\core.v1.json"
    New-Item -ItemType Directory -Path (Split-Path -Parent $CatalogDestination) -Force | Out-Null
    Copy-Item -LiteralPath $SourceProof.CatalogPath -Destination $CatalogDestination
    foreach ($Asset in $SourceProof.Assets) {
        $PathParts = @(([string]$Asset.source.relativePath) -split '[/\\]')
        $RelativePath = $PathParts -join [IO.Path]::DirectorySeparatorChar
        $SourceFile = Join-Path $SourceProof.Root $RelativePath
        $DestinationFile = Join-Path $ResolvedDestination $RelativePath
        New-Item -ItemType Directory -Path (Split-Path -Parent $DestinationFile) -Force | Out-Null
        Copy-Item -LiteralPath $SourceFile -Destination $DestinationFile
    }
    Test-AlystriaStarterVisualRoot -Root $ResolvedDestination
}
