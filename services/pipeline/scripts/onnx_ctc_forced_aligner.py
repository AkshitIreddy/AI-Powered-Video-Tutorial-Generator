"""Offline English CTC forced-alignment worker for a pinned ONNX Wav2Vec2 model."""

from __future__ import annotations

import argparse
import json
import math
import unicodedata
import wave
from pathlib import Path

PINNED_NUMPY_VERSION = "2.5.2"
PINNED_ONNXRUNTIME_VERSION = "1.29.0"


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--vocab", required=True, type=Path)
    parser.add_argument("--request", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args()


def _audio(path: Path):
    import numpy as np

    with wave.open(str(path), "rb") as stream:
        channels = stream.getnchannels()
        sample_width = stream.getsampwidth()
        sample_rate = stream.getframerate()
        frames = stream.readframes(stream.getnframes())
    if channels != 1 or sample_width != 2:
        raise ValueError("alignment audio must be mono 16-bit PCM WAV")
    values = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0
    if sample_rate != 16_000:
        # Magpie is fixed at 48 kHz. A windowed linear resample avoids adding
        # another native decoder to the trust boundary and supports other
        # integer/non-integer PCM rates deterministically.
        target_size = max(1, round(len(values) * 16_000 / sample_rate))
        source_positions = np.arange(len(values), dtype=np.float64)
        target_positions = np.arange(target_size, dtype=np.float64) * sample_rate / 16_000
        values = np.interp(target_positions, source_positions, values).astype(np.float32)
    deviation = float(values.std())
    if not math.isfinite(deviation) or deviation < 1e-7:
        raise ValueError("alignment audio is silent or invalid")
    return ((values - float(values.mean())) / math.sqrt(deviation * deviation + 1e-7))[None, :]


def _normalized_words(text: str, vocab: dict[str, int]) -> tuple[list[str], list[str]]:
    words = text.split()
    normalized: list[str] = []
    alphabet = {key for key in vocab if len(key) == 1 and key != "|"}
    uppercase = any(key.isupper() for key in alphabet)
    ignorable = frozenset(".,!?;:'\"")
    for word in words:
        folded = unicodedata.normalize("NFKD", word)
        folded = "".join(character for character in folded if not unicodedata.combining(character))
        folded = folded.upper() if uppercase else folded.lower()
        unsupported = [
            character
            for character in folded
            if character not in alphabet and character not in ignorable
        ]
        if unsupported:
            raise ValueError(
                f"transcript word cannot be represented by the pinned vocabulary: {word!r}"
            )
        token = "".join(character for character in folded if character in alphabet)
        if not token:
            raise ValueError(
                f"transcript word cannot be represented by the pinned vocabulary: {word!r}"
            )
        normalized.append(token)
    return words, normalized


def _target_ids(words: list[str], vocab: dict[str, int]) -> tuple[list[int], list[int]]:
    ids: list[int] = []
    owners: list[int] = []
    delimiter = vocab.get("|")
    for word_index, word in enumerate(words):
        if word_index and delimiter is not None:
            ids.append(delimiter)
            owners.append(-1)
        for character in word:
            ids.append(vocab[character])
            owners.append(word_index)
    return ids, owners


def _viterbi(logits, target: list[int], blank: int):
    import numpy as np

    frames, _ = logits.shape
    states = 2 * len(target) + 1
    if frames < states:
        raise ValueError("audio has too few acoustic frames for the transcript")
    labels = np.full(states, blank, dtype=np.int64)
    labels[1::2] = np.asarray(target, dtype=np.int64)
    negative = np.float32(-1e30)
    previous = np.full(states, negative, dtype=np.float32)
    previous[0] = logits[0, blank]
    previous[1] = logits[0, target[0]]
    back = np.full((frames, states), -1, dtype=np.int8)
    for frame in range(1, frames):
        current = np.full(states, negative, dtype=np.float32)
        for state in range(states):
            best_state = state
            best = previous[state]
            if state > 0 and previous[state - 1] > best:
                best_state, best = state - 1, previous[state - 1]
            if (
                state > 1
                and labels[state] != blank
                and labels[state] != labels[state - 2]
                and previous[state - 2] > best
            ):
                best_state, best = state - 2, previous[state - 2]
            current[state] = best + logits[frame, labels[state]]
            back[frame, state] = best_state - state
        previous = current
    state = states - 1 if previous[-1] >= previous[-2] else states - 2
    path = np.empty(frames, dtype=np.int32)
    for frame in range(frames - 1, -1, -1):
        path[frame] = state
        if frame:
            state += int(back[frame, state])
    if state not in {0, 1}:
        raise ValueError("forced-alignment path did not reach the transcript start")
    return path, labels


def _align(session, item: dict, vocab: dict[str, int]) -> list[dict]:
    import numpy as np

    original_words, normalized_words = _normalized_words(str(item["text"]), vocab)
    target, owners = _target_ids(normalized_words, vocab)
    if not target:
        raise ValueError("alignment transcript is empty")
    inputs = _audio(Path(item["audioPath"]))
    input_name = session.get_inputs()[0].name
    logits = session.run(None, {input_name: inputs})[0]
    if logits.ndim != 3 or logits.shape[0] != 1:
        raise ValueError("alignment model returned invalid logits")
    logits = logits[0].astype(np.float32, copy=False)
    blank = int(vocab.get("[PAD]", 0))
    path, labels = _viterbi(logits, target, blank)
    frame_seconds = (int(item["durationMs"]) / 1000) / len(path)
    timings: list[dict] = []
    for word_index, original in enumerate(original_words):
        target_positions = [index for index, owner in enumerate(owners) if owner == word_index]
        states = {2 * index + 1 for index in target_positions}
        frames = np.flatnonzero(np.isin(path, list(states)))
        if not len(frames):
            raise ValueError(f"alignment omitted transcript word {original!r}")
        selected = logits[frames, labels[path[frames]]]
        maxima = logits[frames].max(axis=1, keepdims=True)
        confidence = np.exp(selected - maxima[:, 0]) / np.exp(logits[frames] - maxima).sum(axis=1)
        timings.append(
            {
                "word": original,
                "startMs": max(0, round(float(frames[0]) * frame_seconds * 1000)),
                "endMs": min(
                    int(item["durationMs"]),
                    max(1, round(float(frames[-1] + 1) * frame_seconds * 1000)),
                ),
                "confidence": round(float(confidence.mean()), 6),
            }
        )
    for index in range(len(timings) - 1):
        if timings[index]["endMs"] > timings[index + 1]["startMs"]:
            boundary = (timings[index]["endMs"] + timings[index + 1]["startMs"]) // 2
            timings[index]["endMs"] = max(timings[index]["startMs"] + 1, boundary)
            timings[index + 1]["startMs"] = min(timings[index + 1]["endMs"] - 1, boundary)
    return timings


def main() -> int:
    import numpy as np
    import onnxruntime as ort

    if np.__version__ != PINNED_NUMPY_VERSION or ort.__version__ != PINNED_ONNXRUNTIME_VERSION:
        raise RuntimeError(
            "forced-alignment runtime package versions do not match the reviewed pins"
        )

    args = _arguments()
    request = json.loads(args.request.read_text(encoding="utf-8"))
    vocab = json.loads(args.vocab.read_text(encoding="utf-8"))
    if request.get("schemaVersion") != 1 or not isinstance(request.get("items"), list):
        raise ValueError("alignment request schema is invalid")
    if not isinstance(vocab, dict) or not all(
        isinstance(key, str) and isinstance(value, int) for key, value in vocab.items()
    ):
        raise ValueError("alignment vocabulary is invalid")
    session = ort.InferenceSession(
        str(args.model),
        providers=["CPUExecutionProvider"],
        sess_options=ort.SessionOptions(),
    )
    results = [
        {
            "sceneId": item["sceneId"],
            "words": _align(session, item, vocab),
        }
        for item in request["items"]
    ]
    args.output.write_text(
        json.dumps({"schemaVersion": 1, "results": results}, ensure_ascii=False),
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
