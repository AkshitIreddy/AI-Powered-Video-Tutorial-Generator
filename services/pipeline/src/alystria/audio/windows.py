"""Windows-local narration fallback backed by ``System.Speech``.

This adapter is intentionally a fallback, not Alystria's preferred narration
engine.  It performs no network access, invokes PowerShell with an argument
vector (never a shell command), and exchanges user-controlled text through
private temporary files so narration cannot alter the command line.
"""

from __future__ import annotations

import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import wave
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import Protocol

from .models import WORKING_SAMPLE_RATE_HZ, SpeechRequest

WINDOWS_SPEECH_PROVIDER_ID = "windows-system-speech"
WINDOWS_SPEECH_MODEL = "System.Speech.Synthesis"


class WindowsSpeechError(RuntimeError):
    """Base class for actionable Windows narration failures."""


class WindowsSpeechUnavailableError(WindowsSpeechError):
    """Raised when the local Windows speech stack cannot be used."""


class WindowsSpeechTimeoutError(WindowsSpeechError):
    """Raised when voice discovery or synthesis exceeds its deadline."""


class WindowsSpeechCancelledError(WindowsSpeechError):
    """Raised when the caller cancels voice discovery or synthesis."""


class CommandTermination(StrEnum):
    EXITED = "exited"
    TIMED_OUT = "timed-out"
    CANCELLED = "cancelled"
    START_FAILED = "start-failed"


@dataclass(frozen=True, slots=True)
class WindowsCommandResult:
    returncode: int | None
    stdout: str = ""
    stderr: str = ""
    termination: CommandTermination = CommandTermination.EXITED


class WindowsCommandRunner(Protocol):
    def run(
        self,
        argv: tuple[str, ...],
        *,
        timeout_seconds: float,
        cancellation: threading.Event | None = None,
    ) -> WindowsCommandResult: ...


class SubprocessWindowsCommandRunner:
    """Run one bounded process without command-shell interpretation."""

    def run(
        self,
        argv: tuple[str, ...],
        *,
        timeout_seconds: float,
        cancellation: threading.Event | None = None,
    ) -> WindowsCommandResult:
        creation_flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        try:
            process = subprocess.Popen(
                argv,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
                shell=False,
                creationflags=creation_flags,
            )
        except OSError as error:
            return WindowsCommandResult(
                None,
                stderr=str(error),
                termination=CommandTermination.START_FAILED,
            )

        deadline = time.monotonic() + timeout_seconds
        termination = CommandTermination.EXITED
        while process.poll() is None:
            if cancellation is not None and cancellation.is_set():
                termination = CommandTermination.CANCELLED
                _stop_process(process)
                break
            if time.monotonic() >= deadline:
                termination = CommandTermination.TIMED_OUT
                _stop_process(process)
                break
            time.sleep(0.01)
        try:
            stdout, stderr = process.communicate(timeout=1.0)
        except subprocess.TimeoutExpired:
            process.kill()
            stdout, stderr = process.communicate(timeout=1.0)
        return WindowsCommandResult(process.returncode, stdout, stderr, termination)


@dataclass(frozen=True, slots=True)
class WindowsVoice:
    voice_id: str
    name: str
    locale: str
    gender: str
    age: str
    description: str
    enabled: bool = True


@dataclass(frozen=True, slots=True)
class WindowsSpeechCapabilities:
    available: bool
    provider_id: str
    model: str
    fallback: bool
    local_only: bool
    sample_rate_hz: int
    locales: tuple[str, ...]
    voices: tuple[WindowsVoice, ...]
    supports_voice_preview: bool = True
    supports_spoken_aliases: bool = True
    supports_ssml: bool = False
    supports_style: bool = False
    supports_emotion: bool = False
    supports_pitch: bool = False
    reason: str | None = None


@dataclass(frozen=True, slots=True)
class WindowsSpeechAudio:
    request_id: str
    provider_id: str
    model: str
    voice_id: str
    locale: str
    wav_bytes: bytes
    sample_rate_hz: int
    channels: int
    duration_ms: int
    fallback: bool = True


_POWERSHELL_SCRIPT = r"""
param(
  [Parameter(Mandatory = $true)][ValidateSet('list', 'synthesize')][string]$Operation,
  [Parameter(Mandatory = $true)][string]$OutputPath,
  [string]$InputPath = '',
  [string]$MetadataPath = '',
  [string]$VoiceId = '',
  [string]$Locale = '',
  [ValidateRange(-10, 10)][int]$Rate = 0
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$Synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $Installed = @($Synth.GetInstalledVoices() | ForEach-Object {
    $Info = $_.VoiceInfo
    [PSCustomObject]@{
      voiceId = $Info.Name
      name = $Info.Name
      locale = $Info.Culture.Name
      gender = $Info.Gender.ToString()
      age = $Info.Age.ToString()
      description = $Info.Description
      enabled = $_.Enabled
    }
  })
  if ($Operation -eq 'list') {
    $Json = ConvertTo-Json -InputObject @($Installed) -Depth 3 -Compress
    [System.IO.File]::WriteAllText($OutputPath, $Json, $Utf8NoBom)
    exit 0
  }

  if (-not $InputPath -or -not $MetadataPath) {
    throw 'Synthesis requires input and metadata paths.'
  }
  $Enabled = @($Installed | Where-Object { $_.enabled })
  if (-not $Enabled) { throw 'No enabled System.Speech voices are installed.' }
  $Selected = $null
  if ($VoiceId) {
    $Selected = $Enabled | Where-Object { $_.voiceId -ieq $VoiceId } | Select-Object -First 1
    if (-not $Selected) { throw "The requested Windows voice is not installed: $VoiceId" }
  } elseif ($Locale) {
    $Selected = $Enabled | Where-Object { $_.locale -ieq $Locale } | Select-Object -First 1
    if (-not $Selected) {
      $Language = ($Locale -split '[-_]')[0]
      $Selected = $Enabled | Where-Object {
        (($_.locale -split '[-_]')[0]) -ieq $Language
      } | Select-Object -First 1
    }
  }
  if (-not $Selected) { $Selected = $Enabled | Select-Object -First 1 }

  $Synth.SelectVoice($Selected.voiceId)
  $Synth.Rate = $Rate
  $Format = [System.Speech.AudioFormat.SpeechAudioFormatInfo]::new(
    48000,
    [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
    [System.Speech.AudioFormat.AudioChannel]::Mono
  )
  $Text = [System.IO.File]::ReadAllText($InputPath, [System.Text.Encoding]::UTF8)
  $Synth.SetOutputToWaveFile($OutputPath, $Format)
  $Synth.Speak($Text)
  $Synth.SetOutputToNull()
  $Metadata = [PSCustomObject]@{
    voiceId = $Selected.voiceId
    locale = $Selected.locale
  } | ConvertTo-Json -Compress
  [System.IO.File]::WriteAllText($MetadataPath, $Metadata, $Utf8NoBom)
} finally {
  $Synth.Dispose()
}
""".strip()


class WindowsSpeechAdapter:
    """Offline fallback voice adapter for packaged Windows pipeline workers."""

    def __init__(
        self,
        *,
        runner: WindowsCommandRunner | None = None,
        powershell_executable: str | Path | None = None,
        timeout_seconds: float = 60.0,
        platform_name: str | None = None,
    ) -> None:
        if timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be positive")
        self._runner = runner or SubprocessWindowsCommandRunner()
        self._platform_name = platform_name or sys.platform
        self._powershell = (
            str(powershell_executable) if powershell_executable is not None else None
        )
        self._timeout_seconds = timeout_seconds

    def capabilities(
        self, *, cancellation: threading.Event | None = None
    ) -> WindowsSpeechCapabilities:
        try:
            voices = self.list_voices(cancellation=cancellation)
        except WindowsSpeechError as error:
            return WindowsSpeechCapabilities(
                available=False,
                provider_id=WINDOWS_SPEECH_PROVIDER_ID,
                model=WINDOWS_SPEECH_MODEL,
                fallback=True,
                local_only=True,
                sample_rate_hz=WORKING_SAMPLE_RATE_HZ,
                locales=(),
                voices=(),
                reason=str(error),
            )
        enabled = tuple(voice for voice in voices if voice.enabled)
        reason = None if enabled else "No enabled System.Speech voices are installed."
        return WindowsSpeechCapabilities(
            available=bool(enabled),
            provider_id=WINDOWS_SPEECH_PROVIDER_ID,
            model=WINDOWS_SPEECH_MODEL,
            fallback=True,
            local_only=True,
            sample_rate_hz=WORKING_SAMPLE_RATE_HZ,
            locales=tuple(sorted({voice.locale for voice in enabled}, key=str.casefold)),
            voices=enabled,
            reason=reason,
        )

    def list_voices(
        self,
        locale: str | None = None,
        *,
        cancellation: threading.Event | None = None,
    ) -> tuple[WindowsVoice, ...]:
        executable = self._require_available_executable()
        with tempfile.TemporaryDirectory(prefix="alystria-windows-speech-") as raw_root:
            root = Path(raw_root)
            script_path = _write_private_text(root / "system-speech.ps1", _POWERSHELL_SCRIPT)
            output_path = root / "voices.json"
            argv = (
                *self._base_argv(executable, script_path),
                "-Operation",
                "list",
                "-OutputPath",
                str(output_path),
            )
            result = self._runner.run(
                argv,
                timeout_seconds=self._timeout_seconds,
                cancellation=cancellation,
            )
            self._ensure_succeeded(result, "Voice discovery")
            try:
                payload = json.loads(output_path.read_text(encoding="utf-8-sig"))
            except (OSError, UnicodeError, json.JSONDecodeError) as error:
                raise WindowsSpeechUnavailableError(
                    "System.Speech returned an unreadable voice inventory."
                ) from error
        if isinstance(payload, dict):
            payload = [payload]
        if not isinstance(payload, list):
            raise WindowsSpeechUnavailableError(
                "System.Speech returned an invalid voice inventory."
            )
        voices = tuple(sorted((_parse_voice(item) for item in payload), key=_voice_sort_key))
        if locale is None:
            return voices
        return tuple(voice for voice in voices if _locale_matches(voice.locale, locale))

    def synthesize(
        self,
        request: SpeechRequest,
        *,
        pronunciation_aliases: Mapping[str, str]
        | Sequence[tuple[str, str]] = (),
        cancellation: threading.Event | None = None,
    ) -> WindowsSpeechAudio:
        executable = self._require_available_executable()
        if cancellation is not None and cancellation.is_set():
            raise WindowsSpeechCancelledError("Windows narration was cancelled before it started.")
        text = apply_pronunciation_aliases(request.text, pronunciation_aliases)
        with tempfile.TemporaryDirectory(prefix="alystria-windows-speech-") as raw_root:
            root = Path(raw_root)
            script_path = _write_private_text(root / "system-speech.ps1", _POWERSHELL_SCRIPT)
            input_path = _write_private_text(root / "narration.txt", text)
            output_path = root / "narration.wav"
            metadata_path = root / "metadata.json"
            argv = (
                *self._base_argv(executable, script_path),
                "-Operation",
                "synthesize",
                "-OutputPath",
                str(output_path),
                "-InputPath",
                str(input_path),
                "-MetadataPath",
                str(metadata_path),
                "-Locale",
                request.locale,
                "-Rate",
                str(_pace_to_windows_rate(request.delivery.pace)),
            )
            if request.voice_id:
                argv = (*argv, "-VoiceId", request.voice_id)
            result = self._runner.run(
                argv,
                timeout_seconds=self._timeout_seconds,
                cancellation=cancellation,
            )
            self._ensure_succeeded(result, "Narration synthesis")
            try:
                wav_bytes = output_path.read_bytes()
                metadata = json.loads(metadata_path.read_text(encoding="utf-8-sig"))
            except (OSError, UnicodeError, json.JSONDecodeError) as error:
                raise WindowsSpeechError(
                    "System.Speech did not produce readable narration output."
                ) from error
        sample_rate, channels, duration_ms = _validate_pcm_wav(wav_bytes)
        return WindowsSpeechAudio(
            request_id=request.request_id,
            provider_id=WINDOWS_SPEECH_PROVIDER_ID,
            model=WINDOWS_SPEECH_MODEL,
            voice_id=_required_metadata(metadata, "voiceId"),
            locale=_required_metadata(metadata, "locale"),
            wav_bytes=wav_bytes,
            sample_rate_hz=sample_rate,
            channels=channels,
            duration_ms=duration_ms,
        )

    def preview_voice(
        self,
        voice_id: str,
        locale: str,
        *,
        text: str | None = None,
        cancellation: threading.Event | None = None,
    ) -> WindowsSpeechAudio:
        sample = text or _preview_text(locale)
        return self.synthesize(
            SpeechRequest(
                request_id=f"preview:{voice_id}",
                text=sample,
                locale=locale,
                voice_id=voice_id,
            ),
            cancellation=cancellation,
        )

    def _require_available_executable(self) -> str:
        if not self._platform_name.casefold().startswith("win"):
            raise WindowsSpeechUnavailableError(
                "Windows local narration is available only in a native Windows pipeline worker."
            )
        executable = self._powershell or shutil.which("powershell.exe") or shutil.which(
            "powershell"
        )
        if not executable:
            raise WindowsSpeechUnavailableError(
                "Windows PowerShell with System.Speech is not installed or is not on PATH."
            )
        return executable

    @staticmethod
    def _base_argv(executable: str, script_path: Path) -> tuple[str, ...]:
        return (
            executable,
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(script_path),
        )

    @staticmethod
    def _ensure_succeeded(result: WindowsCommandResult, operation: str) -> None:
        if result.termination is CommandTermination.CANCELLED:
            raise WindowsSpeechCancelledError(f"{operation} was cancelled.")
        if result.termination is CommandTermination.TIMED_OUT:
            raise WindowsSpeechTimeoutError(f"{operation} timed out.")
        if result.termination is CommandTermination.START_FAILED:
            raise WindowsSpeechUnavailableError(
                f"{operation} could not start Windows PowerShell: {_safe_error(result.stderr)}"
            )
        if result.returncode != 0:
            raise WindowsSpeechError(
                f"{operation} failed in System.Speech: {_safe_error(result.stderr)}"
            )


def apply_pronunciation_aliases(
    text: str,
    aliases: Mapping[str, str] | Sequence[tuple[str, str]],
) -> str:
    """Apply longest, whole-token spoken aliases without cascading replacements."""

    pairs = tuple(aliases.items()) if isinstance(aliases, Mapping) else tuple(aliases)
    cleaned: list[tuple[str, str]] = []
    seen: set[str] = set()
    for grapheme, spoken_alias in sorted(pairs, key=lambda item: -len(item[0])):
        if not grapheme or not spoken_alias:
            raise ValueError("pronunciation aliases require non-empty grapheme and spoken text")
        key = grapheme.casefold()
        if key in seen:
            continue
        seen.add(key)
        cleaned.append((grapheme, spoken_alias))
    if not cleaned:
        return text
    pattern = re.compile(
        "|".join(rf"(?<!\w)({re.escape(grapheme)})(?!\w)" for grapheme, _ in cleaned),
        re.IGNORECASE,
    )

    def replacement(match: re.Match[str]) -> str:
        assert match.lastindex is not None
        return cleaned[match.lastindex - 1][1]

    return pattern.sub(replacement, text)


def _write_private_text(path: Path, value: str) -> Path:
    path.write_text(value, encoding="utf-8")
    if os.name != "nt":
        path.chmod(0o600)
    return path


def _stop_process(process: subprocess.Popen[str]) -> None:
    process.terminate()
    try:
        process.wait(timeout=1.0)
    except subprocess.TimeoutExpired:
        process.kill()


def _parse_voice(item: object) -> WindowsVoice:
    if not isinstance(item, dict):
        raise WindowsSpeechUnavailableError("System.Speech returned an invalid voice record.")
    try:
        voice_id = str(item["voiceId"]).strip()
        name = str(item["name"]).strip()
        locale = str(item["locale"]).strip()
    except KeyError as error:
        raise WindowsSpeechUnavailableError(
            "System.Speech returned an incomplete voice record."
        ) from error
    if not voice_id or not name or not locale:
        raise WindowsSpeechUnavailableError("System.Speech returned an incomplete voice record.")
    return WindowsVoice(
        voice_id=voice_id,
        name=name,
        locale=locale,
        gender=str(item.get("gender", "Unknown")),
        age=str(item.get("age", "Unknown")),
        description=str(item.get("description", name)),
        enabled=bool(item.get("enabled", True)),
    )


def _voice_sort_key(voice: WindowsVoice) -> tuple[str, str, str]:
    return (voice.locale.casefold(), voice.name.casefold(), voice.voice_id.casefold())


def _locale_matches(candidate: str, requested: str) -> bool:
    candidate_key = candidate.replace("_", "-").casefold()
    requested_key = requested.replace("_", "-").casefold()
    return candidate_key == requested_key or (
        "-" not in requested_key and candidate_key.split("-", 1)[0] == requested_key
    )


def _pace_to_windows_rate(pace: float) -> int:
    # System.Speech exposes an integer -10..10 rate. Log scaling keeps equally
    # large perceived slow-downs and speed-ups approximately symmetric.
    return max(-10, min(10, round(math.log2(pace) * 5)))


def _validate_pcm_wav(wav_bytes: bytes) -> tuple[int, int, int]:
    try:
        from io import BytesIO

        with wave.open(BytesIO(wav_bytes), "rb") as wav:
            channels = wav.getnchannels()
            sample_width = wav.getsampwidth()
            sample_rate = wav.getframerate()
            frames = wav.getnframes()
            compression = wav.getcomptype()
    except (EOFError, wave.Error) as error:
        raise WindowsSpeechError("System.Speech produced an invalid WAV file.") from error
    if compression != "NONE" or sample_width != 2:
        raise WindowsSpeechError("System.Speech output must be uncompressed PCM16 WAV.")
    if sample_rate != WORKING_SAMPLE_RATE_HZ or channels != 1:
        raise WindowsSpeechError("System.Speech output must be 48 kHz mono PCM WAV.")
    if frames <= 0:
        raise WindowsSpeechError("System.Speech produced an empty WAV file.")
    return sample_rate, channels, max(1, round(frames * 1_000 / sample_rate))


def _required_metadata(metadata: object, key: str) -> str:
    if not isinstance(metadata, dict) or not str(metadata.get(key, "")).strip():
        raise WindowsSpeechError("System.Speech returned incomplete narration metadata.")
    return str(metadata[key]).strip()


def _safe_error(stderr: str) -> str:
    compact = " ".join(stderr.split())
    return compact[-1_000:] or "no diagnostic was returned"


def _preview_text(locale: str) -> str:
    language = locale.replace("_", "-").split("-", 1)[0].casefold()
    samples = {
        "en": "Welcome to Alystria Studio. This is a local voice preview.",
        "es": "Bienvenido a Alystria Studio. Esta es una vista previa de voz local.",
        "hi": "Alystria Studio mein aapka swagat hai. Yeh local voice preview hai.",
    }
    return samples.get(language, samples["en"])


__all__ = [
    "WINDOWS_SPEECH_MODEL",
    "WINDOWS_SPEECH_PROVIDER_ID",
    "CommandTermination",
    "SubprocessWindowsCommandRunner",
    "WindowsCommandResult",
    "WindowsCommandRunner",
    "WindowsSpeechAdapter",
    "WindowsSpeechAudio",
    "WindowsSpeechCancelledError",
    "WindowsSpeechCapabilities",
    "WindowsSpeechError",
    "WindowsSpeechTimeoutError",
    "WindowsSpeechUnavailableError",
    "WindowsVoice",
    "apply_pronunciation_aliases",
]
