from __future__ import annotations

import unittest
from datetime import date

from alystria.audio import (
    AudioAssetKind,
    AudioRightsRecord,
    LicenseKind,
    LoudnormMeasurement,
    MixAsset,
    TwoPassMasteringPlan,
    validate_mix_rights,
)


class MasteringAndRightsTests(unittest.TestCase):
    def test_two_pass_plan_mixes_ducks_and_normalizes_without_shell(self) -> None:
        plan = TwoPassMasteringPlan(
            ffmpeg_binary="runtime/ffmpeg.exe",
            narration_path="staging/narration.wav",
            music_path="staging/music with spaces.wav",
            sound_effect_paths=("staging/chime.wav",),
            output_path="exports/master.wav",
        )
        analysis = plan.analysis_command()
        final = plan.final_command(LoudnormMeasurement(-20.1, 5.2, -3.0, -30.0, 0.2))
        self.assertTrue(analysis.reads_loudnorm_json_from_stderr)
        self.assertIn("staging/music with spaces.wav", analysis.argv)
        self.assertNotIn("shell=True", analysis.argv)
        analysis_graph = analysis.argv[analysis.argv.index("-filter_complex") + 1]
        final_graph = final.argv[final.argv.index("-filter_complex") + 1]
        self.assertIn("sidechaincompress", analysis_graph)
        self.assertIn("amix=inputs=3", analysis_graph)
        self.assertIn("print_format=json", analysis_graph)
        self.assertIn("measured_I=-20.100000", final_graph)
        self.assertIn("linear=true", final_graph)
        self.assertEqual(final.argv[-2:], ("pcm_s24le", "exports/master.wav"))
        self.assertIn("48000", final.argv)

    def test_music_and_sfx_rights_are_export_gates(self) -> None:
        music = MixAsset("sha256:music", "rights-music", AudioAssetKind.MUSIC, gain_db=-18)
        sfx = MixAsset("sha256:sfx", "rights-sfx", AudioAssetKind.SOUND_EFFECT)
        rights = (
            AudioRightsRecord(
                "rights-music",
                "sha256:music",
                AudioAssetKind.MUSIC,
                LicenseKind.CC_BY,
                creator="Composer",
                attribution="Music by Composer, CC BY 4.0",
            ),
            AudioRightsRecord(
                "rights-sfx",
                "sha256:sfx",
                AudioAssetKind.SOUND_EFFECT,
                LicenseKind.COMMERCIAL,
                proof_artifact_hash="sha256:receipt",
            ),
        )
        self.assertEqual(validate_mix_rights((music, sfx), rights, on_date=date(2026, 8, 28)), {})

        blocked = AudioRightsRecord(
            "rights-music",
            "sha256:music",
            AudioAssetKind.MUSIC,
            LicenseKind.CC_BY,
            creator="Composer",
        )
        failures = validate_mix_rights((music,), (blocked,), on_date=date(2026, 8, 28))
        self.assertIn("CC-BY asset is missing attribution", failures["sha256:music"])


if __name__ == "__main__":
    unittest.main()
