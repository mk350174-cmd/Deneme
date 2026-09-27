# A-BRANCH CANONICAL MANIFEST — 2026-09-06 (GPT-5.6 execution pass, FINAL)

This is the current canonical state of A-Branch. It supersedes every
manifest/report dated before this one (each of those is marked
`SUPERSEDED` at its own top and retained for history).

**Baseline for this pass:** `A_BRANCH_REPAIRED_20260906.zip` (the prior,
Opus-5-executed repair pass — see the now-superseded
`A_BRANCH_OPUS5_REPAIR_REPORT.md` for what that pass covered).

**Mandate for this pass:**
`A_BRANCH_FINAL_REPAIR_INSTRUCTIONS_GPT56_VOICEBOX_ELEVENLABS_20260906.md`
(R00 through R08).

---

## Ground-truth test counts (actual runner output, `npm ci` clean)

| Pipeline | Discovered | Executed | Passed | Failed | Skipped |
|---|---|---|---|---|---|
| P1 Research | 124 | 124 | 124 | 0 | 0 |
| P2 Creative | 133 | 133 | 133 | 0 | 0 |
| P3 Production | 427 | 427 | 427 | 0 | 0 |
| **TOTAL** | **684** | **684** | **684** | **0** | **0** |

All three pipelines build clean (`tsc -p tsconfig.json`, 0 errors).
Full methodology and reconciliation of prior conflicting counts:
`docs/release/R00_CANONICAL_RECONCILIATION.md`.

## Repair items completed this pass (R00–R08)

See `A_BRANCH_GPT56_FINAL_REPAIR_REPORT.md` for the full Problem / Root
Cause / Files / Solution / Tests / Verification / Remaining-Limitation
writeup of every item below.

- **R00** — canonical release reconciliation (598 -> 684 tests; every prior
  cited count reconciled against real runner output).
- **R01.1–R01.6** — category_2_context integrity, synthesis metadata
  determinism, VoiceLine/voice_script drift prevention, "modified" decision
  semantics, reference provenance, source/evidence identity.
- **R02.1–R02.6** — real timeline FPS (24/30/60 proven), Final Delivery A7
  invariant, human QA findings wired (both linear and distributed paths),
  distributed recovery genuinely wired into the primary execution path,
  worker asset binding (byte-level pre-render gate), preview
  duration/sampling (real ffprobe measurement, real input fps).
- **R03/R03.1** — `ProductionVoiceProvider` abstraction;
  `ElevenLabsProvider` (wraps the existing, unmodified
  `generateProductionVoice`); `VoiceboxClient` (real, source-verified API
  schema) and `VoiceboxProvider` (text integrity, cache/generation
  identity, real duration measurement).
- **R04** — provider routing: ElevenLabs primary when available, Voicebox
  fallback; fallback strictly limited to genuine provider conditions;
  governance failures (A5/A6, hash/lineage/malformed input) always
  hard-fail and are structurally incapable of triggering fallback.
- **R05** — full clean verification (`npm ci` + build + test), 684/684.
- **R06** — distributed verification: every link in
  `approved package -> render bundle -> bundle hash -> code SHA ->
  asset mapping -> worker` and the recovery path proven by executable
  tests against realistic fixture CLI responses.
- **R07** — post-upload exact-set verification FIXED/VERIFIED
  (name+size, not count alone); live Kaggle E2E honestly reported
  `UNAVAILABLE` — no Kaggle CLI/credentials exist in this execution
  environment (verified by direct check, not assumed).
- **R08** — this freeze: historical manifests marked superseded, new
  canonical manifest and final report written, clean packaging via the
  repo's own `scripts/build_canonical_snapshot.sh` (pre-existing, unchanged
  — already excludes `node_modules`, `dist`, `__pycache__`, `.pyc`, and
  more).

## Voice verification matrix (per the mandate's required format)

```
Piper:       FIXTURE — tests/piper.test.ts explicitly documents "Uses a
             fixture I/O-seam adapter — never a real Piper subprocess."
             No real Piper binary/model was invoked in this session.
Voicebox:    FIXTURE — all tests use an injected HTTP seam
             (VoiceboxHttpFetch/VoiceboxAudioFetch); no local Voicebox
             server was running in this execution environment, so no real
             smoke test against a live server was possible. The API schema
             itself is REAL (independently source-verified against
             Voicebox's own documentation and generated SDKs — see
             voiceboxClient.ts's header), not fixture-invented; the
             fixtures exercise that real schema.
ElevenLabs:  UNAVAILABLE / NOT VERIFIED (real path) — no
             ELEVENLABS_API_KEY was provided or embedded, per the
             mandate's explicit instruction. Status-code normalization
             (401/429/5xx -> AUTH_FAILED/QUOTA_UNAVAILABLE/PROVIDER_ERROR)
             is tested via FIXTURE HTTP responses; the real network path
             remains implemented, unmodified, and secret-safe.
```

## What must NOT be considered fully verified (honest scope limits)

- **Live Voicebox smoke test**: not run — no local Voicebox server was
  available in this session's execution environment to smoke-test against.
  The adapter's logic is proven against realistic fixtures matching the
  real, documented API shape; a genuine local run is the next step for
  whoever has Voicebox installed.
- **Live Kaggle E2E**: not run — no Kaggle CLI/credentials in this
  environment (see R07's report for the exact commands checked and their
  results).
- **`reassign_worker`'s Kaggle-side worker-type differentiation**: the
  Kaggle submission path does not currently vary its kernel/accelerator
  target by `WorkerType`; a reassignment retry is functionally an
  additional retry on the same infrastructure. Documented in R06's report.
- **One Voicebox endpoint (audio retrieval for a completed generation)**:
  the exact path is an informed inference from documented file-layout
  conventions, not a directly confirmed API path. Isolated behind one named
  function (`VoiceboxClient.resolveAudioUrl`) for easy correction.
- **T2.5/T2.6 (shard identity / fps plumbing) from the prior Opus 5 pass**:
  still only integration-tested, not unit-isolated (carried over from that
  pass's own honest disclosure; unchanged by this pass).
- **T2.8 (source/resource identity) and several Tier 3 items from the
  prior pass** (split_shard, token refresh, preview sampling — the
  duration part of which R02.6 in THIS pass has now fixed; other Tier-3
  items remain untouched): still `REMAINS`, carried over unchanged.

## Final package contents

```
pipeline1_research/    (src, tests, package.json, tsconfig.json —
                         no dist/, no node_modules/)
pipeline2_creative/    (same)
pipeline3_production/  (same)
docs/                   (architecture docs + docs/release/ — this pass's
                         R00/R05/R06/R07 reports)
scripts/                (pre-existing build_canonical_snapshot.sh, unchanged)
*.md                    (canonicalization/planning docs — historical ones
                         now marked SUPERSEDED at their own top)
A_BRANCH_OPUS5_REPAIR_REPORT.md          (prior pass, marked SUPERSEDED,
                                           retained as accurate history)
A_BRANCH_GPT56_FINAL_REPAIR_REPORT.md    (this pass's full report)
A_BRANCH_CANONICAL_MANIFEST_20260906_FINAL.md  (this file)
```

No `node_modules`, `dist`, `__pycache__`, `.pyc`, or other generated
artifacts are included — verified by the packaging script's own
self-check (see R08 in the final report).
