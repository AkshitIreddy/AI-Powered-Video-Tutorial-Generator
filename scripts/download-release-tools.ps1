[CmdletBinding()]
param([Parameter(Mandatory)][string]$Destination)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$pins = Get-Content (Join-Path $PSScriptRoot '..\runtime-manifest.json') -Raw | ConvertFrom-Json
$Destination = [IO.Path]::GetFullPath($Destination)
New-Item -ItemType Directory -Path $Destination -Force | Out-Null
function Get-Archive([string]$Name, [string]$Url, [string]$Sha256 = '') {
    $archive = Join-Path $Destination "$Name.zip"
    Write-Host "Downloading $Name from $Url"
    Invoke-WebRequest -Uri $Url -OutFile $archive
    if ($Sha256 -and (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Sha256) {
        throw "Archive checksum mismatch: $Name"
    }
    Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $Destination $Name)
}
function Assert-Hash([string]$File, [string]$Expected) {
    if ((Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Expected) {
        throw "Tool checksum mismatch: $File"
    }
}
$nodeVersion = $pins.toolchains.node.version
Get-Archive 'node' "https://nodejs.org/dist/v$nodeVersion/node-v$nodeVersion-win-x64.zip"
Assert-Hash (Join-Path $Destination "node\node-v$nodeVersion-win-x64\node.exe") $pins.toolchains.node.windowsExecutableSha256
$chromeVersion = $pins.renderer.chromium.browserVersion
Get-Archive 'chromium' "https://storage.googleapis.com/chrome-for-testing-public/$chromeVersion/win64/chrome-win64.zip"
Assert-Hash (Join-Path $Destination 'chromium\chrome-win64\chrome.exe') $pins.renderer.chromium.executableSha256
$ffmpeg = $pins.media.ffmpeg.windowsLgplShared
Get-Archive 'ffmpeg' $ffmpeg.archiveUrl $ffmpeg.archiveSha256
$ffmpegRoot = Join-Path $Destination "ffmpeg\$($ffmpeg.extractedDirectory)"
foreach ($file in $ffmpeg.files) { Assert-Hash (Join-Path $ffmpegRoot "bin\$($file.name)") $file.sha256 }
Assert-Hash (Join-Path $ffmpegRoot 'LICENSE.txt') $ffmpeg.licenseSha256
Write-Host 'Downloaded and verified pinned Windows rendering tools.'
