# Piper Capability Profile (P3.04)

Small-improvements addition (C8). This is a **capability record, not new pipeline code** — `src/piper.ts`'s locked, tested behavior is unchanged by this document. Populated by actually installing and running Piper in this environment (`denenip kontrol edilerek`), not written from assumption.

## Version

- Package: `piper-tts` **1.7.0** (installed via `pip install piper-tts`, from PyPI).
- Upstream project: `github.com/OHF-Voice/piper1-gpl` (confirmed by the installed package's own `Home-page` metadata — this matches the finding in `PRODUCTION_VOICE_SPEC_GUIDE.md` §2.2 that active development has moved off `rhasspy/piper`).
- Python: 3.11.15 (this environment).

## Model used for this trial

`en_US-lessac-medium` — downloaded via Piper's own bundled `python3 -m piper.download_voices en_US-lessac-medium` helper (confirms this helper exists and works; no manual Hugging Face download was needed).

## Input / output

- **Input**: plain text via **stdin** (no `-i`/`--input-file` flag needed) — confirmed to work exactly as `pipeline3_production/src/piper.ts`'s `defaultExecPiperSubprocess` already assumes (`proc.stdin.write(text); proc.stdin.end();`). No mismatch found between the locked implementation's assumptions and the real CLI.
- **Output**: a standard WAV file at the path given to `-f`/`--output-file` (`piper.ts` uses `--output_file`, which the real CLI accepts as an alias for `-f`/`--output-file`).
- For the `medium` quality tier specifically, real output measured: **mono, 22050 Hz sample rate, 16-bit samples**.

## Real trial: measured timing and duration accuracy

Command: `echo "$TEXT" | python3 -m piper -m en_US-lessac-medium.onnx -f out.wav`, text = a 21-word, two-sentence excerpt (the same "Aqua Appia" sample text already used in this project's own P1/P2/P3 fixtures).

| Metric | Measured value |
|---|---|
| Wall-clock synthesis time | 2.68s (includes ONNX model load — a one-time cost per process invocation, not per-sentence) |
| Output audio duration | 8.557s (from Python's `wave` module: `nframes / framerate`) |
| Sample rate / channels / sample width | 22050 Hz / mono / 16-bit |
| Output file size | 377,388 bytes for 8.557s of audio |

**Cross-check against P3's own locked WAV parser** (`piper.ts`'s `wavDurationFromBuffer`, which reads `byteRate` at header offset 28 and `dataSize` at offset 40): computing `dataSize / byteRate` on this real output file gives **8.5566s** — matching the `wave` module's 8.557s to within floating-point rounding. **This directly validates that P3's locked, hand-rolled WAV duration parser produces a correct result against a real Piper-generated file**, not just against synthetic test fixtures.

## Language

English (`en_US`) tested directly. Piper's own documentation (see `PRODUCTION_VOICE_SPEC_GUIDE.md` §2.3) lists 30+ supported languages/dialects via separately-distributed ONNX voice models — not independently re-verified for this profile beyond the English trial actually run.

## Pronunciation

Confirmed via `--debug` output: Piper phonemizes text through embedded `espeak-ng` before synthesis (real IPA phoneme sequences were visible in the debug log for the trial sentence, e.g. `ˈæk.wə` for "Aqua"). No pronunciation-dictionary/override mechanism was found in the CLI's own `--help` output (`-h`) — unlike ElevenLabs (see `PRODUCTION_VOICE_SPEC_GUIDE.md` §1.3), Piper's pronunciation is controlled entirely by what `espeak-ng` produces from the input text; the practical mitigation for a mispronunciation is the same one this project already uses for ElevenLabs — spell the risky token out phonetically or in words in `voice_script` itself, since there's no separate override channel here.

## Speed

The real CLI exposes `--length-scale` (phoneme length — lower is faster speech, higher is slower) and `--sentence-silence` (seconds of silence appended after each sentence, default measured as `0.0` in this trial's debug output). Neither is currently passed by `piper.ts`'s `defaultExecPiperSubprocess` — both are real, available levers if narration pacing ever needs tuning without touching P3's locked 15% deviation-threshold logic itself.

## Failure modes (real, observed)

- **Missing/invalid model path**: a real trial against a nonexistent model path (`/nonexistent/model.onnx`) raised `ValueError: Unable to find voice: /nonexistent/model.onnx (use piper.download_voices)` from `piper/__main__.py`, with a Python traceback printed to stderr. `piper.ts`'s `defaultExecPiperSubprocess` already treats any non-zero exit / `"close"` event with a non-zero code as a hard failure (`reject(new Error(...))`) — this observed behavior is consistent with what the locked implementation already handles, not a new case it needs to cover.
- No other failure mode was exercised in this trial (e.g. malformed/empty input, GPU-unavailable-with-`--cuda`) — not claimed here, since it wasn't actually tried.

## Environment requirements (this sandbox, confirmed)

- CPU-only synthesis works without any GPU (the `--cuda` flag exists but was not used/tested here).
- `onnxruntime` and `pathvalidate` are the only real Python dependencies pulled in by `pip install piper-tts` in this environment.
- No system-level (apt) dependency was needed beyond the existing Python 3.11 install — `pip install piper-tts` alone was sufficient to get a working CLI.

## Limitations / not verified in this pass

- Non-English languages, multi-speaker models, and quality tiers other than `medium` were not trialed — no claim is made about their behavior here.
- No formal minimum-hardware specification was found in Piper's own docs (see `PRODUCTION_VOICE_SPEC_GUIDE.md` §2.4) — this profile's 2.68s wall time (including model load) on this specific sandbox's CPU is a real data point, not a general benchmark.
