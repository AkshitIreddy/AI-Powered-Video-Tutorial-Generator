from __future__ import annotations

import math
import unittest
from itertools import pairwise

from alystria.audio import (
    AccessibilityEvent,
    AlignmentResult,
    AlignmentStatus,
    ASRVerification,
    AudioDescriptionCue,
    AudioDescriptionExportPlan,
    AudioQAPolicy,
    AudioStemSpec,
    CaptionCue,
    CaptionKind,
    CaptionPolicy,
    DescriptionPlacement,
    LoudnessMeasurement,
    NativeAudioArtifact,
    PhonemeTiming,
    PronunciationRule,
    PronunciationScope,
    QAStatus,
    SpeechArtifact,
    SpeechRequest,
    WavFixtureSpec,
    WordTiming,
    build_accessibility_captions,
    captions_from_words,
    evaluate_audio_quality,
    generate_sine_wav,
    measure_wav,
    plan_pronunciation_invalidation,
    resolve_pronunciations,
    to_srt,
    to_webvtt,
)


class AudioContractTests(unittest.TestCase):
    def test_working_stem_is_always_48khz(self) -> None:
        self.assertEqual(AudioStemSpec().sample_rate_hz, 48_000)
        with self.assertRaisesRegex(ValueError, "48 kHz"):
            AudioStemSpec(sample_rate_hz=44_100)

    def test_speech_artifact_preserves_native_and_normalized_alignment(self) -> None:
        alignment = AlignmentResult(
            AlignmentStatus.COMPLETE,
            words=(WordTiming("Alystria", 0, 500, 0, 8, 0.99),),
            phonemes=(PhonemeTiming("ə", 0, 80, 0, 0.95),),
            captions=(CaptionCue("cue-1", 0, 700, "Alystria"),),
            aligned_token_ratio=1.0,
            engine="fixture-aligner",
        )
        artifact = SpeechArtifact(
            artifact_id="speech-1",
            request_id="request-1",
            provider="mock",
            model="deterministic-voice",
            native=NativeAudioArtifact("sha256:native", "audio/mpeg", 44_100, 2),
            working_artifact_hash="sha256:working",
            working_spec=AudioStemSpec(),
            duration_ms=700,
            alignment=alignment,
        )
        self.assertEqual(artifact.native.sample_rate_hz, 44_100)
        self.assertEqual(artifact.working_spec.sample_rate_hz, 48_000)
        self.assertEqual(artifact.alignment.phonemes[0].word_index, 0)

    def test_pronunciation_scope_precedence_and_effective_invalidation(self) -> None:
        request = SpeechRequest("scene-1", "SQL joins make SQL useful.", "en-US")
        global_rule = PronunciationRule(
            "global-sql",
            1,
            PronunciationScope.GLOBAL,
            "SQL",
            "en",
            spoken_alias="sequel",
        )
        project_rule = PronunciationRule(
            "project-sql",
            1,
            PronunciationScope.PROJECT,
            "SQL",
            "en-US",
            spoken_alias="ess cue ell",
            project_id="project-1",
        )
        occurrence_rule = PronunciationRule(
            "occurrence-sql",
            1,
            PronunciationScope.OCCURRENCE,
            "SQL",
            "en-US",
            ipa="siːkwəl",  # noqa: RUF001 - IPA length mark is intentional.
            occurrence_request_id="scene-1",
            occurrence_start=0,
            occurrence_end=3,
        )
        resolved = resolve_pronunciations(
            request,
            (global_rule, project_rule, occurrence_rule),
            project_id="project-1",
        )
        self.assertEqual(
            [item.scope for item in resolved],
            [
                PronunciationScope.OCCURRENCE,
                PronunciationScope.PROJECT,
            ],
        )
        self.assertEqual(resolved[1].spoken_alias, "ess cue ell")

        changed_global = PronunciationRule(
            "global-sql",
            2,
            PronunciationScope.GLOBAL,
            "SQL",
            "en",
            spoken_alias="S Q L",
        )
        # Both occurrences are overridden, so a global edit causes no work.
        self.assertEqual(
            plan_pronunciation_invalidation(
                (request,),
                before_rules=(global_rule, project_rule, occurrence_rule),
                after_rules=(changed_global, project_rule, occurrence_rule),
                project_id="project-1",
            ),
            (),
        )

        changed_project = PronunciationRule(
            "project-sql",
            2,
            PronunciationScope.PROJECT,
            "SQL",
            "en-US",
            spoken_alias="structured query language",
            project_id="project-1",
        )
        impact = plan_pronunciation_invalidation(
            (request,),
            before_rules=(global_rule, project_rule, occurrence_rule),
            after_rules=(global_rule, changed_project, occurrence_rule),
            project_id="project-1",
        )
        self.assertEqual(len(impact), 1)
        self.assertIn("speech:scene-1:alignment", impact[0].stale_logical_keys)
        self.assertIn("composition:final", impact[0].stale_logical_keys)

    def test_caption_timing_serialization_and_accessibility_track(self) -> None:
        tokens = ("Alystria", "makes", "clear", "tutorials.")
        words = tuple(
            WordTiming(token, index * 400, index * 400 + 350) for index, token in enumerate(tokens)
        )
        cues = captions_from_words(words, speaker="Narrator", policy=CaptionPolicy())
        self.assertEqual(len(cues), 1)
        self.assertEqual(cues[0].text, "Alystria makes clear tutorials.")
        self.assertEqual(cues[0].start_ms, 0)
        self.assertEqual(cues[0].end_ms, 1550)

        accessible = build_accessibility_captions(
            cues,
            (
                AccessibilityEvent(
                    "chime", 100, 600, "gentle confirmation chime", CaptionKind.SOUND
                ),
            ),
        )
        vtt = to_webvtt(accessible)
        srt = to_srt(accessible)
        self.assertTrue(vtt.startswith("WEBVTT\n"))
        self.assertIn("00:00:00.100 --> 00:00:00.600", vtt)
        self.assertIn("[gentle confirmation chime]", vtt)
        self.assertIn("00:00:00,000 --> 00:00:01,550", srt)
        self.assertIn("Narrator: Alystria", srt)

    def test_audio_description_sidecars_are_deterministic(self) -> None:
        plan = AudioDescriptionExportPlan(
            locale="en-US",
            cues=(
                AudioDescriptionCue(
                    "ad-1",
                    1_000,
                    2_500,
                    "A highlighted node connects to two children.",
                    DescriptionPlacement.NATURAL_GAP,
                ),
            ),
            speech_artifact_hashes=("sha256:description",),
            mixed_audio_output="exports/tutorial.ad.en.wav",
            webvtt_output="exports/tutorial.ad.en.vtt",
            transcript_output="exports/tutorial.ad.en.txt",
        )
        self.assertIn("00:00:01.000 --> 00:00:02.500", plan.webvtt())
        self.assertEqual(
            plan.transcript(),
            "[00:00:01.000] A highlighted node connects to two children.\n",
        )

    def test_short_adjacent_caption_cues_merge_before_minimum_hold(self) -> None:
        words = (
            WordTiming("First.", 0, 100),
            WordTiming("Second.", 300, 400),
        )
        cues = captions_from_words(words)
        self.assertEqual(len(cues), 1)
        self.assertEqual(cues[0].text, "First. Second.")
        self.assertEqual(cues[0].start_ms, 0)
        self.assertEqual(cues[0].end_ms, 700)

    def test_caption_rebalance_does_not_cross_a_long_speech_gap(self) -> None:
        words = (
            WordTiming("First.", 0, 100),
            WordTiming("Second.", 1_001, 1_101),
        )
        cues = captions_from_words(words)
        self.assertEqual(len(cues), 2)
        self.assertEqual(cues[0].end_ms, 700)
        self.assertEqual(cues[1].start_ms, 1_001)

    def test_caption_hold_cap_never_truncates_observed_speech(self) -> None:
        cues = captions_from_words((WordTiming("Exceptionally-long-word", 0, 8_000),))

        self.assertEqual(len(cues), 1)
        self.assertEqual(cues[0].start_ms, 0)
        self.assertEqual(cues[0].end_ms, 8_000)

    def test_caption_rebalance_repairs_short_realistic_math_fragments(self) -> None:
        words = tuple(
            WordTiming(token, start, end)
            for token, start, end in (
                ("Following", 23_428, 23_808),
                ("that", 23_848, 23_988),
                ("branching", 24_028, 24_408),
                ("until", 24_468, 24_648),
                ("single", 24_728, 24_988),
                ("digits", 25_048, 25_408),
                ("explains", 25_488, 25_948),
                ("the", 25_988, 26_089),
                ("exponent:", 26_169, 26_669),
                ("log", 27_189, 27_409),
                ("base", 27_509, 27_789),
                ("two", 27_929, 28_169),
                ("of", 28_429, 28_509),
                ("three", 28_609, 28_849),
                ("measures", 28_909, 29_310),
                ("the", 29_650, 29_730),
                ("tree's", 29_770, 30_050),
                ("growth.", 30_130, 30_410),
            )
        )

        cues = captions_from_words(words)

        self.assertEqual(
            " ".join(cue.text.replace("\n", " ") for cue in cues),
            "Following that branching until single digits explains the exponent: "
            "log base two of three measures the tree's growth.",
        )
        self.assertTrue(
            all(cue.end_ms - cue.start_ms >= CaptionPolicy().min_duration_ms for cue in cues)
        )
        self.assertTrue(
            all(
                len(cue.text.replace("\n", " ")) / ((cue.end_ms - cue.start_ms) / 1_000)
                <= CaptionPolicy().max_chars_per_second
                for cue in cues
            )
        )
        self.assertTrue(
            all(
                len(cue.text.splitlines()) <= CaptionPolicy().max_lines
                and all(
                    len(line) <= CaptionPolicy().max_chars_per_line
                    for line in cue.text.splitlines()
                )
                for cue in cues
            )
        )
        self.assertTrue(all(left.end_ms <= right.start_ms for left, right in pairwise(cues)))

    def test_deterministic_wav_is_measured_without_ffmpeg(self) -> None:
        spec = WavFixtureSpec(
            duration_ms=1_000,
            frequency_hz=1_000,
            amplitude=0.25,
            leading_silence_ms=100,
            trailing_silence_ms=100,
            fade_ms=10,
        )
        first = generate_sine_wav(spec)
        second = generate_sine_wav(spec)
        self.assertEqual(first, second)
        measured = measure_wav(first)
        self.assertEqual(measured.sample_rate_hz, 48_000)
        self.assertEqual(measured.duration_ms, 1_000)
        self.assertAlmostEqual(measured.peak_linear, 0.25, places=3)
        # 0.25 peak sine with 20% total silence is about -16.09 dBFS RMS.
        self.assertAlmostEqual(measured.rms_dbfs, -16.09, delta=0.2)
        self.assertEqual(measured.clipped_sample_count, 0)
        self.assertAlmostEqual(measured.leading_silence_ms, 100, delta=0.1)
        self.assertAlmostEqual(measured.trailing_silence_ms, 100, delta=0.1)

        qa = evaluate_audio_quality(
            measured,
            expected_duration_ms=1_000,
            loudness=LoudnessMeasurement(-16.0, -1.7),
            asr=ASRVerification(
                status=QAStatus.PASSED,
                engine="fixture-asr",
                reference_text="test",
                transcript="test",
                word_error_rate=0.0,
                aligned_token_ratio=1.0,
            ),
        )
        self.assertEqual(qa.status, QAStatus.PASSED)
        self.assertEqual(qa.findings, ())

    def test_qa_reports_silence_clipping_duration_and_external_placeholders(self) -> None:
        silence = measure_wav(generate_sine_wav(WavFixtureSpec(amplitude=0)))
        silence_result = evaluate_audio_quality(silence, expected_duration_ms=900)
        codes = {finding.code for finding in silence_result.findings}
        self.assertEqual(silence_result.status, QAStatus.FAILED)
        self.assertTrue(
            {"AUDIO_SILENT", "AUDIO_DURATION_MISMATCH", "LOUDNESS_NOT_MEASURED", "ASR_NOT_RUN"}
            <= codes
        )

        full_scale = measure_wav(
            generate_sine_wav(WavFixtureSpec(amplitude=1.0, frequency_hz=1_000, fade_ms=0))
        )
        self.assertGreater(full_scale.clipped_sample_count, 0)
        self.assertTrue(math.isfinite(full_scale.rms_dbfs))

    def test_duration_gate_is_exactly_one_configured_frame(self) -> None:
        measured = measure_wav(generate_sine_wav())
        result = evaluate_audio_quality(
            measured,
            expected_duration_ms=1_000 + 50,
            policy=AudioQAPolicy(max_duration_delta_ms=1_000 / 24),
        )
        self.assertIn("AUDIO_DURATION_MISMATCH", {item.code for item in result.findings})


if __name__ == "__main__":
    unittest.main()
