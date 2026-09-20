# Reviewed JoyVASA runtime inputs

This directory keeps the small, machine-independent inputs needed to recreate the
reviewed Alystria JoyVASA presenter pack:

- `install-manifest.json` defines the exact allowed source files, model weights,
  portable Python files, FFmpeg files, repository worker files, runtime paths, and the
  canonical dependency-tree attestation;
- `provenance.json` records upstream revisions, hashes, the portable Python contract,
  selected-weight and runtime-resource pins, and the limits of the visual review;
- `joyvasa-final-source.patch` preserves the reviewed no-crop, motion-offset, and speech
  gate source changes relative to JoyVASA commit
  `916a90f8de490e8648fee460c1200bd5d9a795af`;
- `requirements-inference-win-cu121.lock.txt` preserves the reviewed dependency lock.

Large weights, the portable interpreter, and the 42,871-file dependency inventory are
not tracked here. The installer reads them from a reviewed candidate, verifies every
declared file and the canonical dependency-tree digest, and performs no downloads.

See `docs/models/joyvasa-staged-runtime.md` for the dry-run and explicit activation
commands. A dry run must pass before activation, and activation still requires review of
the concrete receipt. No API key or private credential is used by this workflow.
