[CmdletBinding()]
param(
    [string]$RuntimeRoot = "E:\temp\AI Video Tutorial Generator\runtimes\forced-alignment\wav2vec2-large-xlsr-english-a5a0efb",
    [string]$PythonPath = "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe",
    [string]$UvPath = "$env:APPDATA\Python\Python312\Scripts\uv.exe"
)

$ErrorActionPreference = "Stop"
$Revision = "a5a0efbf15dec1a4a0d46e8b9c0d207f0fc755e0"
$Repository = "onnx-community/wav2vec2-large-xlsr-english-ONNX"
$ModelSha256 = "3308030a66b07b135f1d9b4cfe130d0470be5225a1defd81daf99920b096dfa7"
$VocabSha256 = "f7a204596a4f25139bf3e0e3f6d5d205f16cd58fb6aa29e29bb70240a60401e4"
$WorkerSha256 = "6e1f7050c82d2dbd98c2b76645edf0b8d5b9932a3521af173147e0633a91c055"
$NumpyVersion = "2.5.2"
$OnnxRuntimeVersion = "1.29.0"

function Get-LowerSha256([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Install-PinnedDownload([string]$Uri, [string]$Destination, [string]$ExpectedSha256) {
    if (Test-Path -LiteralPath $Destination -PathType Leaf) {
        if ((Get-LowerSha256 $Destination) -eq $ExpectedSha256) { return }
        throw "Existing artifact does not match its pin: $Destination"
    }
    $Partial = "$Destination.download-$PID"
    try {
        Invoke-WebRequest -UseBasicParsing -Uri $Uri -OutFile $Partial
        if ((Get-LowerSha256 $Partial) -ne $ExpectedSha256) {
            throw "Downloaded artifact failed its SHA-256 pin: $Uri"
        }
        Move-Item -LiteralPath $Partial -Destination $Destination
    }
    finally {
        if (Test-Path -LiteralPath $Partial) { Remove-Item -LiteralPath $Partial -Force }
    }
}

foreach ($Executable in @($PythonPath, $UvPath)) {
    if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) {
        throw "Required executable is missing: $Executable"
    }
}

$RuntimeRoot = [IO.Path]::GetFullPath($RuntimeRoot)
$ModelRoot = Join-Path $RuntimeRoot "model"
New-Item -ItemType Directory -Path $RuntimeRoot, $ModelRoot -Force | Out-Null

$WorkerSource = Join-Path $PSScriptRoot "..\services\pipeline\scripts\onnx_ctc_forced_aligner.py"
$WorkerSource = [IO.Path]::GetFullPath($WorkerSource)
if ((Get-LowerSha256 $WorkerSource) -ne $WorkerSha256) {
    throw "The reviewed forced-alignment worker changed; update its installer pin after review."
}
Copy-Item -LiteralPath $WorkerSource -Destination (Join-Path $RuntimeRoot "onnx_ctc_forced_aligner.py") -Force

& $UvPath venv --allow-existing --python $PythonPath $RuntimeRoot
if ($LASTEXITCODE -ne 0) { throw "uv could not create the CPU alignment environment." }
$RuntimePython = Join-Path $RuntimeRoot "Scripts\python.exe"
& $UvPath pip install --python $RuntimePython "numpy==$NumpyVersion" "onnxruntime==$OnnxRuntimeVersion"
if ($LASTEXITCODE -ne 0) { throw "uv could not install the pinned CPU alignment packages." }
$Versions = & $RuntimePython -c "import json,numpy,onnxruntime,sys; print(json.dumps({'python': '.'.join(map(str,sys.version_info[:3])), 'numpy': numpy.__version__, 'onnxruntime': onnxruntime.__version__, 'cpu': 'CPUExecutionProvider' in onnxruntime.get_available_providers()}))" | ConvertFrom-Json
if (
    $Versions.python -ne "3.12.2" -or
    $Versions.numpy -ne $NumpyVersion -or
    $Versions.onnxruntime -ne $OnnxRuntimeVersion -or
    -not $Versions.cpu
) {
    throw "The installed forced-alignment environment does not match its reviewed CPU package pins."
}

$BaseUri = "https://huggingface.co/$Repository/resolve/$Revision"
$ModelPath = Join-Path $ModelRoot "model_quantized.onnx"
$VocabPath = Join-Path $ModelRoot "vocab.json"
Install-PinnedDownload "$BaseUri/onnx/model_quantized.onnx" $ModelPath $ModelSha256
Install-PinnedDownload "$BaseUri/vocab.json" $VocabPath $VocabSha256

$Roles = [ordered]@{
    python = "Scripts\python.exe"
    worker = "onnx_ctc_forced_aligner.py"
    model = "model\model_quantized.onnx"
    vocab = "model\vocab.json"
}
$Config = [ordered]@{
    schemaVersion = 1
    runtimeRoot = $RuntimeRoot
    timeoutSeconds = 900
}
foreach ($Role in $Roles.Keys) {
    $RelativePath = $Roles[$Role]
    $Config[$Role] = [ordered]@{
        relativePath = $RelativePath
        sha256 = Get-LowerSha256 (Join-Path $RuntimeRoot $RelativePath)
    }
}
$ConfigPath = Join-Path $RuntimeRoot "alignment-runtime.json"
[IO.File]::WriteAllText($ConfigPath, ($Config | ConvertTo-Json -Depth 4), [Text.UTF8Encoding]::new($false))

$Manifest = [ordered]@{
    schemaVersion = 1
    runtime = "Alystria CPU forced alignment"
    source = [ordered]@{
        repository = $Repository
        revision = $Revision
        modelPath = "onnx/model_quantized.onnx"
        license = "Apache-2.0"
        url = "https://huggingface.co/$Repository/tree/$Revision"
    }
    packages = [ordered]@{
        python = $Versions.python
        numpy = $NumpyVersion
        onnxruntime = $OnnxRuntimeVersion
    }
    executionProvider = "CPUExecutionProvider"
    configSha256 = Get-LowerSha256 $ConfigPath
}
[IO.File]::WriteAllText(
    (Join-Path $RuntimeRoot "runtime-manifest.json"),
    ($Manifest | ConvertTo-Json -Depth 5),
    [Text.UTF8Encoding]::new($false)
)

Write-Host "Verified CPU forced-alignment runtime: $RuntimeRoot"
Write-Host "Configuration: $ConfigPath"
