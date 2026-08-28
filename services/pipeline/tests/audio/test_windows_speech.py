from __future__ import annotations

import json
import threading
import unittest
from pathlib import Path

from alystria.audio import (
    CommandTermination,
    SpeechRequest,
    WavFixtureSpec,
    WindowsCommandResult,
    WindowsSpeechAdapter,
    WindowsSpeechCancelledError,
    WindowsSpeechTimeoutError,
    WindowsSpeechUnavailableError,
    apply_pronunciation_aliases,
    generate_sine_wav,
    measure_wav,
)


class FakeWindowsRunner:
    def __init__(self) -> None:
        self.calls: list[tuple[str, ...]] = []
        self.input_texts: list[str] = []
        self.termination = CommandTermination.EXITED
        self.returncode: int | None = 0

    def run(
        self,
        argv: tuple[str, ...],
        *,
        timeout_seconds: float,
        cancellation: threading.Event | None = None,
    ) -> WindowsCommandResult:
        self.calls.append(argv)
        if self.termination is not CommandTermination.EXITED:
            return WindowsCommandResult(
                self.returncode,
                stderr="fake failure",
                termination=self.termination,
            )
        operation = _argument(argv, "-Operation")
        if operation == "list":
            Path(_argument(argv, "-OutputPath")).write_text(
                json.dumps(
                    [
                        {
                            "voiceId": "Microsoft Ravi Desktop",
                            "name": "Microsoft Ravi Desktop",
                            "locale": "hi-IN",
                            "gender": "Male",
                            "age": "Adult",
                            "description": "Hindi fallback",
                            "enabled": True,
                        },
                        {
                            "voiceId": "Microsoft Zira Desktop",
                            "name": "Microsoft Zira Desktop",
                            "locale": "en-US",
                            "gender": "Female",
                            "age": "Adult",
                            "description": "English fallback",
                            "enabled": True,
                        },
                    ]
                ),
                encoding="utf-8",
            )
        elif operation == "synthesize":
            input_text = Path(_argument(argv, "-InputPath")).read_text(encoding="utf-8")
            self.input_texts.append(input_text)
            Path(_argument(argv, "-OutputPath")).write_bytes(
                generate_sine_wav(
                    WavFixtureSpec(duration_ms=420, frequency_hz=220, amplitude=0.2)
                )
            )
            voice_id = _optional_argument(argv, "-VoiceId") or "Microsoft Zira Desktop"
            locale = _argument(argv, "-Locale")
            Path(_argument(argv, "-MetadataPath")).write_text(
                json.dumps({"voiceId": voice_id, "locale": locale}),
                encoding="utf-8",
            )
        else:  # pragma: no cover - protects the fake from adapter drift.
            raise AssertionError(f"unexpected operation: {operation}")
        return WindowsCommandResult(0)


def _argument(argv: tuple[str, ...], name: str) -> str:
    return argv[argv.index(name) + 1]


def _optional_argument(argv: tuple[str, ...], name: str) -> str | None:
    return _argument(argv, name) if name in argv else None


class WindowsSpeechTests(unittest.TestCase):
    def test_non_windows_reports_clear_unavailable_capability(self) -> None:
        adapter = WindowsSpeechAdapter(platform_name="linux")
        capability = adapter.capabilities()
        self.assertFalse(capability.available)
        self.assertTrue(capability.fallback)
        self.assertTrue(capability.local_only)
        self.assertIn("native Windows", capability.reason or "")
        with self.assertRaisesRegex(WindowsSpeechUnavailableError, "native Windows"):
            adapter.list_voices()

    def test_voice_listing_and_locale_capabilities_are_deterministic(self) -> None:
        runner = FakeWindowsRunner()
        adapter = WindowsSpeechAdapter(
            runner=runner,
            powershell_executable="C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
            platform_name="win32",
        )
        voices = adapter.list_voices("en")
        self.assertEqual([voice.voice_id for voice in voices], ["Microsoft Zira Desktop"])
        capability = adapter.capabilities()
        self.assertTrue(capability.available)
        self.assertEqual(capability.locales, ("en-US", "hi-IN"))
        self.assertFalse(capability.supports_style)
        self.assertFalse(capability.supports_pitch)
        self.assertTrue(capability.supports_spoken_aliases)

        argv = runner.calls[0]
        self.assertEqual(argv[0], "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe")
        self.assertIn("-File", argv)
        self.assertNotIn("-Command", argv)
        self.assertIn("-NoProfile", argv)

    def test_synthesis_uses_temp_input_aliases_and_returns_measured_48k_pcm(self) -> None:
        runner = FakeWindowsRunner()
        adapter = WindowsSpeechAdapter(
            runner=runner,
            powershell_executable="powershell.exe",
            platform_name="win32",
        )
        dangerous_text = "SQL joins; Remove-Item C:\\important | should remain narration."
        audio = adapter.synthesize(
            SpeechRequest(
                request_id="scene-7",
                text=dangerous_text,
                locale="en-US",
                voice_id="Microsoft Zira Desktop",
            ),
            pronunciation_aliases=(("SQL", "sequel"),),
        )

        self.assertEqual(
            runner.input_texts,
            ["sequel joins; Remove-Item C:\\important | should remain narration."],
        )
        self.assertTrue(all(dangerous_text not in value for value in runner.calls[-1]))
        self.assertEqual(audio.voice_id, "Microsoft Zira Desktop")
        self.assertEqual(audio.sample_rate_hz, 48_000)
        self.assertEqual(audio.channels, 1)
        self.assertEqual(audio.duration_ms, 420)
        measured = measure_wav(audio.wav_bytes)
        self.assertEqual(measured.duration_ms, 420)
        self.assertFalse(measured.is_digital_silence)
        self.assertEqual(measured.clipped_sample_count, 0)

    def test_preview_uses_same_safe_synthesis_path(self) -> None:
        runner = FakeWindowsRunner()
        adapter = WindowsSpeechAdapter(
            runner=runner,
            powershell_executable="powershell.exe",
            platform_name="win32",
        )
        preview = adapter.preview_voice("Microsoft Ravi Desktop", "hi-IN")
        self.assertEqual(preview.request_id, "preview:Microsoft Ravi Desktop")
        self.assertIn("Alystria Studio", runner.input_texts[-1])

    def test_alias_preprocessing_is_longest_first_whole_token_and_non_cascading(self) -> None:
        self.assertEqual(
            apply_pronunciation_aliases(
                "SQL and SQL Server are not MySQLServer.",
                (("SQL", "sequel"), ("SQL Server", "sequel server")),
            ),
            "sequel and sequel server are not MySQLServer.",
        )
        self.assertEqual(
            apply_pronunciation_aliases("A B", (("A", "B"), ("B", "bee"))),
            "B bee",
        )

    def test_timeout_and_cancellation_are_distinct(self) -> None:
        runner = FakeWindowsRunner()
        adapter = WindowsSpeechAdapter(
            runner=runner,
            powershell_executable="powershell.exe",
            platform_name="win32",
        )
        runner.termination = CommandTermination.TIMED_OUT
        with self.assertRaisesRegex(WindowsSpeechTimeoutError, "timed out"):
            adapter.list_voices()

        cancellation = threading.Event()
        cancellation.set()
        with self.assertRaisesRegex(WindowsSpeechCancelledError, "before it started"):
            adapter.synthesize(
                SpeechRequest("cancelled", "Stop now", "en-US"),
                cancellation=cancellation,
            )


if __name__ == "__main__":
    unittest.main()
