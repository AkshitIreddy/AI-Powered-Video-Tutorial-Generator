[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$PortableRoot,
    [Parameter(Mandatory = $true)][string]$KeyFile
)

$ErrorActionPreference = "Stop"
$PortableRoot = [IO.Path]::GetFullPath($PortableRoot)
$KeyFile = [IO.Path]::GetFullPath($KeyFile)
if (-not (Test-Path -LiteralPath $PortableRoot -PathType Container)) { throw "Portable root not found." }
if (-not (Test-Path -LiteralPath $KeyFile -PathType Leaf)) { throw "Key file not found." }

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class AlystriaCredentialWriter {
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

$ProviderSecrets = [ordered]@{
    "cohere" = if ($Keys.ContainsKey("cohere_production")) { $Keys["cohere_production"] } else { $Keys["cohere"] }
    "elevenlabs" = $Keys["elevenlabs"]
    "nvidia-nim" = $Keys["nvidia_nim"]
}
$ConfiguredProviders = @()
foreach ($Provider in @($ProviderSecrets.Keys)) {
    $Secret = [string]$ProviderSecrets[$Provider]
    if (-not $Secret) { continue }
    [AlystriaCredentialWriter]::Write("Alystria Studio", "provider/$Provider/api_key", $Secret)
    $ConfiguredProviders += $Provider
    $ProviderSecrets[$Provider] = $null
}
$Keys.Clear()

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
$Setup = [ordered]@{
    schemaVersion = 1
    activeProfileId = "portable-test-connected"
    selectedModelIds = @("local/qwen3.5-9b-gguf", "local/kokoro", "local/whisper-large-v3-turbo", "local/liveportrait", "local/musetalk-1.5")
    lipSyncModelId = "local/musetalk-1.5"
    portraitAnimationModelId = "local/liveportrait"
    existingModelDirectory = Join-Path $PortableRoot "Models"
    profiles = @([ordered]@{
        id = "portable-test-connected"
        name = "Portable test · connected"
        description = "Required local tools are attached and the supplied Cohere, ElevenLabs, and NVIDIA NIM connections are available."
        routes = [ordered]@{
            writing = & $Route "cohere" "choose at generation"
            research = & $Route "cohere" "choose at generation"
            images = & $Route "nvidia-nim" "choose at generation"
            motion = & $Route "nvidia-nim" "choose at generation"
            voice = & $Route "elevenlabs" "eleven_multilingual_v2" "Xb7hH8MSUJpSbSDYk0k2"
            transcription = & $Route "local-runtime" "local/whisper-large-v3-turbo"
            presenter = & $Route "local-runtime" "choose in studio"
            portraitAnimation = & $Route "local-runtime" "local/liveportrait"
            lipSync = & $Route "local-runtime" "local/musetalk-1.5"
        }
    })
    updatedAt = [DateTime]::UtcNow.ToString("o")
}
$AppData = Join-Path $PortableRoot "App Data"
New-Item -ItemType Directory -Path $AppData -Force | Out-Null
$SetupPath = Join-Path $AppData "model-setup.json"
[IO.File]::WriteAllText($SetupPath, ($Setup | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))

Write-Host "Configured providers: $($ConfiguredProviders -join ', '); attached model selections: $($Setup.selectedModelIds.Count)."
