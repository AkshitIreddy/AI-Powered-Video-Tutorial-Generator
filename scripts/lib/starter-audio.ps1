Set-StrictMode -Version Latest

function Test-AlystriaStarterAudioRoot {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$Root
    )

    $ResolvedRoot = [IO.Path]::GetFullPath($Root)
    if (-not (Test-Path -LiteralPath $ResolvedRoot -PathType Container)) {
        throw "Alystria starter audio root is missing: $ResolvedRoot"
    }
    $RootItem = Get-Item -LiteralPath $ResolvedRoot -Force
    if (($RootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Alystria starter audio root cannot be a reparse point: $ResolvedRoot"
    }

    $CatalogPath = Join-Path $ResolvedRoot "catalog.json"
    if (-not (Test-Path -LiteralPath $CatalogPath -PathType Leaf)) {
        throw "Alystria starter audio catalog is missing: $CatalogPath"
    }
    $CatalogItem = Get-Item -LiteralPath $CatalogPath -Force
    if (($CatalogItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Alystria starter audio catalog cannot be a reparse point."
    }
    if ($CatalogItem.Length -le 0 -or $CatalogItem.Length -gt 2MB) {
        throw "Alystria starter audio catalog must be between 1 byte and 2 MiB."
    }

    try {
        $Catalog = Get-Content -LiteralPath $CatalogPath -Raw -Encoding UTF8 | ConvertFrom-Json
    }
    catch {
        throw "Alystria starter audio catalog is invalid JSON: $($_.Exception.Message)"
    }
    if ($Catalog.schemaVersion -ne 1 -or $Catalog.catalogId -ne "alystria.starter-audio.v1") {
        throw "Alystria starter audio catalog has an unsupported identity or schema."
    }
    if ($null -eq $Catalog.assets -or $Catalog.assets.Count -eq 0) {
        throw "Alystria starter audio catalog contains no assets."
    }

    $RootPrefix = $ResolvedRoot.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    $Identifiers = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    $RelativePaths = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    $TotalBytes = [int64]0
    foreach ($Asset in $Catalog.assets) {
        $Identifier = [string]$Asset.id
        $RelativePath = [string]$Asset.path
        $ExpectedHash = ([string]$Asset.sha256).ToLowerInvariant()
        $ExpectedBytes = [int64]$Asset.bytes
        if ([string]::IsNullOrWhiteSpace($Identifier) -or -not $Identifiers.Add($Identifier)) {
            throw "Alystria starter audio asset IDs must be non-empty and unique."
        }
        if ([string]::IsNullOrWhiteSpace($RelativePath) -or [IO.Path]::IsPathRooted($RelativePath)) {
            throw "Alystria starter audio asset '$Identifier' has an unsafe path."
        }
        $PathParts = @($RelativePath -split '[/\\]')
        if ($PathParts.Count -eq 0 -or @($PathParts | Where-Object { $_ -in @("", ".", "..") }).Count -ne 0) {
            throw "Alystria starter audio asset '$Identifier' has an unsafe path."
        }
        $NormalizedRelativePath = $PathParts -join [IO.Path]::DirectorySeparatorChar
        if (-not $RelativePaths.Add($NormalizedRelativePath)) {
            throw "Alystria starter audio catalog repeats path '$RelativePath'."
        }
        if ($ExpectedHash -notmatch '^[0-9a-f]{64}$' -or $ExpectedBytes -le 0 -or $ExpectedBytes -gt 64MB) {
            throw "Alystria starter audio asset '$Identifier' has invalid integrity metadata."
        }

        $AssetPath = [IO.Path]::GetFullPath((Join-Path $ResolvedRoot $NormalizedRelativePath))
        if (-not $AssetPath.StartsWith($RootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Alystria starter audio asset '$Identifier' escapes the catalog root."
        }
        if (-not (Test-Path -LiteralPath $AssetPath -PathType Leaf)) {
            throw "Alystria starter audio asset '$Identifier' is missing."
        }
        $AssetItem = Get-Item -LiteralPath $AssetPath -Force
        if (($AssetItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Alystria starter audio asset '$Identifier' cannot be a reparse point."
        }
        if ($AssetItem.Length -ne $ExpectedBytes) {
            throw "Alystria starter audio asset '$Identifier' does not match its catalog size."
        }
        $ActualHash = (Get-FileHash -LiteralPath $AssetPath -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($ActualHash -ne $ExpectedHash) {
            throw "Alystria starter audio asset '$Identifier' does not match its catalog hash."
        }
        $TotalBytes += $AssetItem.Length
    }

    [pscustomobject]@{
        Root = $ResolvedRoot
        CatalogPath = $CatalogPath
        CatalogSha256 = (Get-FileHash -LiteralPath $CatalogPath -Algorithm SHA256).Hash.ToLowerInvariant()
        Catalog = $Catalog
        AssetCount = $Catalog.assets.Count
        TotalBytes = $TotalBytes
    }
}

function Copy-AlystriaStarterAudioRoot {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$Source,

        [Parameter(Mandatory = $true)]
        [string]$Destination,

        [switch]$Force
    )

    $SourceProof = Test-AlystriaStarterAudioRoot -Root $Source
    $ResolvedDestination = [IO.Path]::GetFullPath($Destination)
    if (Test-Path -LiteralPath $ResolvedDestination) {
        if (-not $Force) {
            throw "Starter audio destination already exists: $ResolvedDestination"
        }
        Remove-Item -LiteralPath $ResolvedDestination -Recurse -Force
    }
    New-Item -ItemType Directory -Path $ResolvedDestination -Force | Out-Null

    foreach ($Name in @("catalog.json", "verification.json", "README.md")) {
        $SourceFile = Join-Path $SourceProof.Root $Name
        if (Test-Path -LiteralPath $SourceFile -PathType Leaf) {
            Copy-Item -LiteralPath $SourceFile -Destination (Join-Path $ResolvedDestination $Name)
        }
    }
    foreach ($Asset in $SourceProof.Catalog.assets) {
        $PathParts = @(([string]$Asset.path) -split '[/\\]')
        $RelativePath = $PathParts -join [IO.Path]::DirectorySeparatorChar
        $SourceFile = Join-Path $SourceProof.Root $RelativePath
        $DestinationFile = Join-Path $ResolvedDestination $RelativePath
        New-Item -ItemType Directory -Path (Split-Path -Parent $DestinationFile) -Force | Out-Null
        Copy-Item -LiteralPath $SourceFile -Destination $DestinationFile
    }

    Test-AlystriaStarterAudioRoot -Root $ResolvedDestination
}
