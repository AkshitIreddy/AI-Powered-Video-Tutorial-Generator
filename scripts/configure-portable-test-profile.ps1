[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$PortableRoot,
    [string]$KeyFile,
    [switch]$ImportCredentialFile,
    [string]$ForcedAlignerConfigPath = "E:\temp\AI Video Tutorial Generator\runtimes\forced-alignment\wav2vec2-large-xlsr-english-a5a0efb\alignment-runtime.json"
)

$ErrorActionPreference = "Stop"
function Get-ArtifactSha256([string]$Path) {
    # Use the runtime API so a Windows PowerShell child can verify files even
    # when its inherited module path does not expose Get-FileHash.
    $Hasher = [Security.Cryptography.SHA256]::Create()
    $Stream = [IO.File]::OpenRead($Path)
    try { return [BitConverter]::ToString($Hasher.ComputeHash($Stream)).Replace('-', '').ToLowerInvariant() }
    finally { $Stream.Dispose(); $Hasher.Dispose() }
}

$PortableRoot = [IO.Path]::GetFullPath($PortableRoot)
if (-not (Test-Path -LiteralPath $PortableRoot -PathType Container)) { throw "Portable root not found." }
if ($ImportCredentialFile) {
    if (-not $KeyFile) { throw "-ImportCredentialFile requires -KeyFile." }
    $KeyFile = [IO.Path]::GetFullPath($KeyFile)
    if (-not (Test-Path -LiteralPath $KeyFile -PathType Leaf)) { throw "Key file not found." }
}
elseif ($KeyFile) {
    throw "A key file is read only when -ImportCredentialFile is explicitly provided. Existing OS-vault references remain available without importing secrets."
}

if ($ForcedAlignerConfigPath) {
    $ForcedAlignerConfigPath = [IO.Path]::GetFullPath($ForcedAlignerConfigPath)
    if (Test-Path -LiteralPath $ForcedAlignerConfigPath -PathType Leaf) {
        $AlignerConfig = Get-Content -LiteralPath $ForcedAlignerConfigPath -Raw | ConvertFrom-Json
        if ($AlignerConfig.schemaVersion -ne 1 -or -not [IO.Path]::IsPathRooted([string]$AlignerConfig.runtimeRoot)) {
            throw "Forced aligner config must use schemaVersion 1 and an absolute runtimeRoot."
        }
        $AlignerRuntimeRoot = [IO.Path]::GetFullPath([string]$AlignerConfig.runtimeRoot)
        foreach ($Role in @("python", "worker", "model", "vocab")) {
            $Entry = $AlignerConfig.$Role
            if (-not $Entry -or [string]$Entry.sha256 -notmatch '^[a-f0-9]{64}$') {
                throw "Forced aligner config has no valid $Role SHA-256 pin."
            }
            $RelativePath = [string]$Entry.relativePath
            if (-not $RelativePath -or [IO.Path]::IsPathRooted($RelativePath) -or $RelativePath -match '(^|[\\/])\.\.([\\/]|$)') {
                throw "Forced aligner $Role path must be a contained relative path."
            }
            $ArtifactPath = [IO.Path]::GetFullPath((Join-Path $AlignerRuntimeRoot $RelativePath))
            $AllowedPrefix = $AlignerRuntimeRoot.TrimEnd('\') + '\'
            if (-not $ArtifactPath.StartsWith($AllowedPrefix, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $ArtifactPath -PathType Leaf)) {
                throw "Forced aligner $Role artifact is missing or escapes runtimeRoot."
            }
            $ActualHash = Get-ArtifactSha256 $ArtifactPath
            if ($ActualHash -ne [string]$Entry.sha256) {
                throw "Forced aligner $Role artifact failed its SHA-256 pin."
            }
        }
        $PortableModels = Join-Path $PortableRoot "Models"
        New-Item -ItemType Directory -Path $PortableModels -Force | Out-Null
        $PortableAlignerConfigPath = [IO.Path]::GetFullPath((Join-Path $PortableModels "alignment-runtime.json"))
        if (-not $ForcedAlignerConfigPath.Equals($PortableAlignerConfigPath, [StringComparison]::OrdinalIgnoreCase)) {
            Copy-Item -LiteralPath $ForcedAlignerConfigPath -Destination $PortableAlignerConfigPath -Force
        }
    }
}

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class ProductCredentialWriter {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct CREDENTIAL {
        public UInt32 Flags;
        public UInt32 Type;
        public IntPtr TargetName;
        public IntPtr Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public UInt32 CredentialBlobSize;
        public IntPtr CredentialBlob;
        public UInt32 Persist;
        public UInt32 AttributeCount;
        public IntPtr Attributes;
        public IntPtr TargetAlias;
        public IntPtr UserName;
    }

    [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredWrite(ref CREDENTIAL credential, UInt32 flags);

    public static void Write(string service, string account, string secret) {
        byte[] blob = System.Text.Encoding.Unicode.GetBytes(secret);
        IntPtr target = Marshal.StringToCoTaskMemUni(account + "." + service);
        IntPtr user = Marshal.StringToCoTaskMemUni(account);
        IntPtr comment = Marshal.StringToCoTaskMemUni("keyring v3.6.3");
        IntPtr secretPointer = Marshal.AllocCoTaskMem(blob.Length);
        try {
            Marshal.Copy(blob, 0, secretPointer, blob.Length);
            CREDENTIAL credential = new CREDENTIAL {
                Flags = 0,
                Type = 1,
                TargetName = target,
                Comment = comment,
                CredentialBlobSize = (UInt32)blob.Length,
                CredentialBlob = secretPointer,
                Persist = 3,
                AttributeCount = 0,
                Attributes = IntPtr.Zero,
                TargetAlias = IntPtr.Zero,
                UserName = user
            };
            if (!CredWrite(ref credential, 0)) {
                throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            }
        } finally {
            Array.Clear(blob, 0, blob.Length);
            for (int index = 0; index < blob.Length; index++) Marshal.WriteByte(secretPointer, index, 0);
            Marshal.FreeCoTaskMem(secretPointer);
            Marshal.FreeCoTaskMem(comment);
            Marshal.FreeCoTaskMem(user);
            Marshal.FreeCoTaskMem(target);
        }
    }
}
'@

$ConfiguredProviders = @()
if ($ImportCredentialFile) {
    $Keys = @{}
    foreach ($RawLine in Get-Content -LiteralPath $KeyFile) {
        $Line = $RawLine.Trim()
        if (-not $Line -or $Line.StartsWith('#')) { continue }
        $Separator = $Line.IndexOfAny([char[]]@(':', '='))
        if ($Separator -lt 1) { continue }
        $Name = $Line.Substring(0, $Separator).Trim().ToLowerInvariant()
        $Value = $Line.Substring($Separator + 1).Trim().Trim('"').Trim("'")
        if ($Value) { $Keys[$Name] = $Value }
    }

    # The prior Cohere and ElevenLabs values are recorded as compromised and
    # must not be refreshed into the OS vault. This handoff imports only the
    # independently authorized Groq, Mistral, Gemini, and NVIDIA test credentials.
    $NvidiaKeyName = @($Keys.Keys | Where-Object { $_ -match 'nvidia' -and $_ -match 'nim' } | Select-Object -First 1)
    $GeminiKeyName = @($Keys.Keys | Where-Object { $_ -match 'gemini' } | Select-Object -First 1)
    $GroqKeyName = @($Keys.Keys | Where-Object { $_ -match 'groq' } | Select-Object -First 1)
    $MistralKeyName = @($Keys.Keys | Where-Object { $_ -match 'mistral' } | Select-Object -First 1)
    $NvidiaSecret = if ($NvidiaKeyName.Count) { $Keys[[string]$NvidiaKeyName[0]] } else { $null }
    $GeminiSecret = if ($GeminiKeyName.Count) { $Keys[[string]$GeminiKeyName[0]] } else { $null }
    $GroqSecret = if ($GroqKeyName.Count) { $Keys[[string]$GroqKeyName[0]] } else { $null }
    $MistralSecret = if ($MistralKeyName.Count) { $Keys[[string]$MistralKeyName[0]] } else { $null }
    $ProviderSecrets = [ordered]@{
        "groq" = $GroqSecret
        "mistral" = $MistralSecret
        "gemini" = $GeminiSecret
        "nvidia-nim" = $NvidiaSecret
    }
    foreach ($Provider in @($ProviderSecrets.Keys)) {
        $Secret = [string]$ProviderSecrets[$Provider]
        if (-not $Secret) { continue }
        # Keep the legacy service name so credentials written by older builds
        # remain discoverable by the current app. This is not user-visible.
        [ProductCredentialWriter]::Write("Alystria Studio", "provider/$Provider/api_key", $Secret)
        $ConfiguredProviders += $Provider
        $ProviderSecrets[$Provider] = $null
    }
    $Keys.Clear()
}

$Route = {
    param([string]$ProviderId, [string]$ModelId, [string]$VoiceId = "")
    [ordered]@{
        providerId = $ProviderId
        modelId = $ModelId
        modelRevision = $null
        installFingerprint = $null
        voiceId = if ($VoiceId) { $VoiceId } else { $null }
        presenterProfileId = $null
    }
}
$WorkerPath = Join-Path $PortableRoot "Runtime\alystria-pipeline.exe"
if (-not (Test-Path -LiteralPath $WorkerPath -PathType Leaf)) { throw "Packaged worker not found." }
$WorkerFingerprint = Get-ArtifactSha256 $WorkerPath
$WorkerRevision = "packaged-worker-" + $WorkerFingerprint.Substring(0, 16)
$PresenterConfigPath = Join-Path $PortableRoot "Models\presenter-runtime.json"
$PresenterConfig = if (Test-Path -LiteralPath $PresenterConfigPath -PathType Leaf) {
    Get-Content -LiteralPath $PresenterConfigPath -Raw | ConvertFrom-Json
} else { $null }
$PresenterModelRevision = if ($PresenterConfig -and $PresenterConfig.modelRevision) { [string]$PresenterConfig.modelRevision } else { "presenter-not-configured" }
$PresenterFingerprint = if ($PresenterConfig -and $PresenterConfig.installFingerprint -match '^[a-f0-9]{64}$') { [string]$PresenterConfig.installFingerprint } else { $WorkerFingerprint }
$PresenterProfileId = if ($PresenterConfig -and $PresenterConfig.defaultProfileId) { [string]$PresenterConfig.defaultProfileId } else { $null }

$LocalRoutes = [ordered]@{
    writing = & $Route "local-runtime" "pipeline/deterministic-writer-v1"
    research = & $Route "local-runtime" "off for local acceptance"
    images = & $Route "local-runtime" "pipeline/procedural-scenes-v1"
    motion = & $Route "local-runtime" "off for local acceptance"
    voice = & $Route "local-runtime" "System.Speech.Synthesis" "Microsoft Zira Desktop"
    transcription = & $Route "local-runtime" "off for local acceptance"
    presenter = & $Route "local-runtime" "off for local acceptance"
    portraitAnimation = & $Route "local-runtime" "off for local acceptance"
    lipSync = & $Route "local-runtime" "off for local acceptance"
}
foreach ($Medium in @("writing", "images", "voice")) {
    $LocalRoutes[$Medium].modelRevision = $WorkerRevision
    $LocalRoutes[$Medium].installFingerprint = $WorkerFingerprint
}

$PresenterRoutes = [ordered]@{
    writing = $LocalRoutes.writing
    research = $LocalRoutes.research
    images = $LocalRoutes.images
    motion = $LocalRoutes.motion
    voice = $LocalRoutes.voice
    transcription = $LocalRoutes.transcription
    presenter = & $Route "local-runtime" "liveportrait-musetalk-1.5"
    portraitAnimation = & $Route "local-runtime" "local/liveportrait"
    lipSync = & $Route "local-runtime" "local/musetalk-1.5"
}
foreach ($Medium in @("presenter", "portraitAnimation", "lipSync")) {
    $PresenterRoutes[$Medium].modelRevision = $PresenterModelRevision
    $PresenterRoutes[$Medium].installFingerprint = $PresenterFingerprint
    $PresenterRoutes[$Medium].presenterProfileId = $PresenterProfileId
}

$ProviderRoutes = [ordered]@{
    writing = & $Route "groq" "openai/gpt-oss-20b"
    research = & $Route "gemini" "gemini-3.8-flash"
    images = & $Route "nvidia-nim" "black-forest-labs/flux.2-klein-4b"
    visualReview = & $Route "nvidia-nim" "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning"
    motion = $LocalRoutes.motion
    voice = & $Route "nvidia-nim" "nvidia/magpie-tts-multilingual" "Magpie-Multilingual.EN-US.Aria"
    transcription = $LocalRoutes.transcription
    presenter = $LocalRoutes.presenter
    portraitAnimation = $LocalRoutes.portraitAnimation
    lipSync = $LocalRoutes.lipSync
}

$ProviderPresenterRoutes = [ordered]@{
    writing = $ProviderRoutes.writing
    research = $ProviderRoutes.research
    images = $ProviderRoutes.images
    visualReview = $ProviderRoutes.visualReview
    motion = $ProviderRoutes.motion
    voice = $ProviderRoutes.voice
    transcription = $ProviderRoutes.transcription
    presenter = $PresenterRoutes.presenter
    portraitAnimation = $PresenterRoutes.portraitAnimation
    lipSync = $PresenterRoutes.lipSync
}

$Groq120ProviderPresenterRoutes = [ordered]@{
    writing = & $Route "groq" "openai/gpt-oss-120b"
    research = $ProviderRoutes.research
    images = $ProviderRoutes.images
    visualReview = $ProviderRoutes.visualReview
    motion = $ProviderRoutes.motion
    voice = $ProviderRoutes.voice
    transcription = $ProviderRoutes.transcription
    presenter = $PresenterRoutes.presenter
    portraitAnimation = $PresenterRoutes.portraitAnimation
    lipSync = $PresenterRoutes.lipSync
}

$NvidiaWritingProviderPresenterRoutes = [ordered]@{
    writing = & $Route "nvidia-nim" "openai/gpt-oss-20b"
    research = $ProviderRoutes.research
    images = $ProviderRoutes.images
    visualReview = $ProviderRoutes.visualReview
    motion = $ProviderRoutes.motion
    voice = $ProviderRoutes.voice
    transcription = $ProviderRoutes.transcription
    presenter = $PresenterRoutes.presenter
    portraitAnimation = $PresenterRoutes.portraitAnimation
    lipSync = $PresenterRoutes.lipSync
}

$MistralProviderPresenterRoutes = [ordered]@{
    writing = & $Route "mistral" "mistral-small-2603"
    research = $ProviderRoutes.research
    images = $ProviderRoutes.images
    visualReview = $ProviderRoutes.visualReview
    motion = $ProviderRoutes.motion
    voice = $ProviderRoutes.voice
    transcription = $ProviderRoutes.transcription
    presenter = $PresenterRoutes.presenter
    portraitAnimation = $PresenterRoutes.portraitAnimation
    lipSync = $PresenterRoutes.lipSync
}

$Profiles = @([ordered]@{
    id = "portable-test-local"
    name = "Portable test · local"
    description = "Packaged deterministic integration route for native acceptance; no cloud credential or GPU work."
    routes = $LocalRoutes
}, [ordered]@{
    id = "portable-test-groq-nvidia"
    name = "Portable test · Groq + NVIDIA"
    description = "Public test content with Groq-authored teaching, FLUX art, Magpie Aria narration, and optional NVIDIA rendered-frame review."
    routes = $ProviderRoutes
})
if ($PresenterConfig) {
    $Profiles += [ordered]@{
        id = "portable-test-presenter"
        name = "Portable test · presenter"
        description = "Installed presenter runtime and owner profile; select only while the GPU lease is held."
        routes = $PresenterRoutes
    }, [ordered]@{
        id = "portable-test-groq-nvidia-presenter"
        name = "Portable test · Groq + NVIDIA + Elena"
        description = "Public test route with Groq-authored teaching, FLUX art, Magpie Aria narration, optional NVIDIA frame review, and the installed Elena presenter. Requires the GPU lease."
        routes = $ProviderPresenterRoutes
    }, [ordered]@{
        id = "portable-test-groq-120b-nvidia-presenter"
        name = "Portable test · Groq 120B + NVIDIA + Elena"
        description = "Public Groq 120B teaching with FLUX art, Magpie Aria, optional NVIDIA frame review, and the installed Elena presenter. GPU lease required."
        routes = $Groq120ProviderPresenterRoutes
    }, [ordered]@{
        id = "portable-test-nvidia-writing-presenter"
        name = "Portable test · NVIDIA writing + Elena"
        description = "Public NVIDIA GPT-OSS teaching with FLUX art, Magpie Aria, optional frame review, and the installed Elena presenter. GPU lease required."
        routes = $NvidiaWritingProviderPresenterRoutes
    }, [ordered]@{
        id = "portable-test-mistral-nvidia-presenter"
        name = "Portable test · Mistral + NVIDIA + Elena"
        description = "Public test route with Mistral-authored teaching, FLUX art, Magpie Aria narration, optional NVIDIA frame review, and the installed Elena presenter. Requires the GPU lease."
        routes = $MistralProviderPresenterRoutes
    }
}

$Setup = [ordered]@{
    schemaVersion = 1
    activeProfileId = "portable-test-local"
    selectedModelIds = @("local/qwen3.5-9b-gguf", "local/kokoro", "local/whisper-large-v3-turbo", "local/liveportrait", "local/musetalk-1.5")
    lipSyncModelId = "local/musetalk-1.5"
    portraitAnimationModelId = "local/liveportrait"
    existingModelDirectory = Join-Path $PortableRoot "Models"
    profiles = $Profiles
    updatedAt = [DateTime]::UtcNow.ToString("o")
}
$AppData = Join-Path $PortableRoot "App Data"
New-Item -ItemType Directory -Path $AppData -Force | Out-Null
$SetupPath = Join-Path $AppData "model-setup.json"
[IO.File]::WriteAllText($SetupPath, ($Setup | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))

$CredentialSummary = if ($ImportCredentialFile) { "Imported provider references: $($ConfiguredProviders -join ', ')" } else { "Existing OS-vault references preserved; no credential file read" }
Write-Host "$CredentialSummary; active profile: $($Setup.activeProfileId); attached model selections: $($Setup.selectedModelIds.Count)."
