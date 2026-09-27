# External Dependencies — Verified, Not Assumed

This document lists what each pipeline actually requires to run — derived by grepping
`src/*.ts` for `spawn(`/`execFile(`/`execFileAsync(`/`execSync(` calls to external
binaries, and each `package.json`'s real `dependencies`/`devDependencies`. Nothing below
is aspirational; a dependency is listed here only if some code path in this repository
actually invokes it.

## Pipeline 1 (Research) & Pipeline 2 (Creative)

**No external system binaries.** Both are pure TypeScript/Node libraries — grepping their
`src/*.ts` for subprocess calls (`spawn`/`execFile`/`exec`) finds none. `npm install` is
sufficient; no SDKs, no system packages, no network access required to run `npm test`.

**Runtime:** Node.js (see root prerequisites), `typescript`, `vitest` (both dev
dependencies only — no runtime npm dependencies at all; see each `package.json`).

## Pipeline 3 (Production)

### npm dependencies (installed automatically by `npm install`)

- `remotion`, `@remotion/bundler`, `@remotion/renderer` (video composition/rendering)
- `react`, `react-dom` (Remotion's composition components, e.g. `P3Composition.tsx`)

### System binaries this codebase actually shells out to

Verified via `grep -rn 'spawn("\|execFile' pipeline3_production/src/*.ts`:

| Binary | Used by | Purpose | Required for |
|--------|---------|---------|---------------|
| `ffmpeg` | `merge.ts` (`defaultExecFfmpeg`) | Concat-merge shard videos, generate low-bandwidth preview | P3.08-DIST distributed render merge; `real_proof_merge_validation.test.ts` |
| `ffprobe` | `assetValidation.ts` (`defaultFfprobeMediaProbe`), `distribution.ts` (`downloadKaggleShard`), `gtts.ts` (`defaultExecGttsSubprocess`) | Probe real media duration/codec/dimensions from an actual file | P3.02 asset validation; P3.08-DIST shard duration measurement; gTTS duration measurement |
| `python3` | `piper.ts` (`defaultExecPiperSubprocess`), `gtts.ts` (`defaultExecGttsSubprocess`) | Run the `piper` module (Tier 1 voice) and the `gtts` package (Tier 2 voice fallback) | P3.04 real (non-fixture) voice preview |
| `kaggle` (Kaggle CLI) | `kaggle.ts` (`defaultExecKaggleCli`), `distribution.ts` (`defaultExecKaggleCli`) | Create/verify Kaggle datasets (P3.10 delivery); push/monitor/download Kaggle kernel jobs (P3.08-DIST) | P3.10 real delivery; P3.08-DIST real distributed render |

Each of the four is invoked only through an injectable seam (`ExecFfmpeg`, `MediaProbe`,
`ExecPiperSubprocess`/`ExecGttsSubprocess`, `ExecKaggleCli`) — the **hermetic test suite
(`npm test`) does not require any of them**, except `ffmpeg`/`ffprobe`, which two test
files genuinely shell out to (see "Tests that need real binaries" below).

### Python packages (only if you exercise the real, non-fixture Piper/gTTS path)

- **Piper:** the `piper` Python module (`python3 -m piper ...`), plus a downloaded ONNX
  voice model file (path supplied by the caller as `modelPath` — this codebase does not
  bundle or download models). Real Turkish model: search "Piper TTS tr_TR" for current
  download sources; the model path is a runtime parameter, not a hardcoded path.
- **gTTS:** the `gtts` PyPI package (`pip install gTTS`). Verified present and network-reachable
  in this development environment (`python3 -c "import gtts; print(gtts.__version__)"`
  succeeded, version 2.5.4; a real network call to Google's TTS endpoint also succeeded).
  Requires outbound internet access to `translate.google.com` at call time — this is a
  real network dependency, not an offline library.

### Browser (for real Remotion rendering)

`@remotion/renderer`'s `renderMedia()` needs a Chromium-family browser. `render.ts` tries
`process.env.REMOTION_BROWSER_EXECUTABLE` first, falling back to Remotion's own
managed/downloaded browser if unset. In this development environment, Chromium is
pre-installed at a fixed path and `REMOTION_BROWSER_EXECUTABLE` is set accordingly — a
fresh clone elsewhere either sets this variable to a local Chromium install, or lets
Remotion download its own on first real render (`npx remotion browser ensure`).

### Kaggle CLI authentication

The `kaggle` CLI is *not* configured by anything in this repository — it reads its own
credentials from `~/.kaggle/kaggle.json` (or `KAGGLE_USERNAME`/`KAGGLE_KEY` env vars that
the CLI itself recognizes; see https://www.kaggle.com/docs/api). `KAGGLE_USERNAME` in
`pipeline3_production/.env.example` is a *different* variable, read by this codebase's own
`p309Config.ts` to build a Kaggle kernel slug string — it does not authenticate the CLI.

### Tests that need real binaries

Most of the P3 test suite runs entirely on injected fixtures and needs none of the above.
Two test files deliberately exercise the real subprocess path (proving the actual
integration works, not just the fixture contract) and therefore need `ffmpeg`/`ffprobe` on
`PATH`:

- `tests/real_proof_merge_validation.test.ts` — real FFmpeg synthetic video generation and
  concat merge.
- `tests/remotion_real_render.test.ts` — real Remotion render + real FFmpeg merge.
- `tests/voiceFallback.p3c.test.ts` — one test makes a real (non-fixture) `gtts` network
  call; it self-skips (does not fail) if outbound network access to Google's TTS endpoint
  is unavailable.

All three are present in this environment's `npm test` run and pass for real (not
skipped) — see `FULL_PIPELINE_CANONICAL_MANIFEST.md` for the current pass/fail counts.
