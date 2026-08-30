param(
    [Parameter(Mandatory = $true)][string]$PythonPath,
    [Parameter(Mandatory = $true)][string]$WorkerPath,
    [Parameter(Mandatory = $true)][string]$JobPath,
    [Parameter(Mandatory = $true)][string]$PortraitPath,
    [Parameter(Mandatory = $true)][string]$AudioPath,
    [Parameter(Mandatory = $true)][string]$OutputPath,
    [Parameter(Mandatory = $true)][string]$WorkspacePath,
    [Parameter(Mandatory = $true)][int]$Seed
)

$ErrorActionPreference = "Stop"
$env:ALYSTRIA_TRUST_REMOTE_CODE = "0"
$env:HF_DATASETS_OFFLINE = "1"
$env:HF_HUB_DISABLE_TELEMETRY = "1"
$env:TRANSFORMERS_OFFLINE = "1"
$env:PYTHONIOENCODING = "utf-8"
$env:PYTHONUTF8 = "1"

& $PythonPath $WorkerPath `
    --job $JobPath `
    --portrait $PortraitPath `
    --audio $AudioPath `
    --output $OutputPath `
    --workspace $WorkspacePath `
    --seed $Seed
exit $LASTEXITCODE
