> **SUPERSEDED (R08 final release freeze).** This document reflects a prior session/state and is retained for history only. For the current canonical state, see `A_BRANCH_CANONICAL_MANIFEST_20260906_FINAL.md` and `A_BRANCH_GPT56_FINAL_REPAIR_REPORT.md`.

---

# FULL PIPELINE CANONICAL MANIFEST — P1.01 → P3.10

**Updated:** 2026-08-27
**Purpose:** Complete metadata record for A-Branch full pipeline snapshot
**Scope:** Pipeline 1 (Research) + Pipeline 2 (Creative) + Pipeline 3 (Production)

**Methodology note:** every count in this document (test counts, file counts, line
counts) was measured directly from the repository or from a real `npm test` run at
the time of writing — none are hand-typed estimates. Reproduce any number yourself
with the commands shown next to it.

---

## GIT STATE AT SNAPSHOT

| Property | Value |
|----------|-------|
| **Branch** | claude/a-branch-pipeline-arch-ni1pes |
| **Last commit (HEAD)** | `fe6d64a` — "Fix snapshot reproduction documentation and add .env.example files" |
| **Working tree** | **NOT clean** — contains the "12 düzeltme" (12-fix) remediation pass on top of `fe6d64a`, uncommitted at the time this manifest was written (see "12-Fix Remediation Pass" below for the full file list) |
| **P1 Source** | `pipeline1_research/` — no changes this pass |
| **P2 Source** | `pipeline2_creative/` — no changes this pass |
| **P3 Source** | `pipeline3_production/` — extensively changed this pass (see below) |

This snapshot's ZIP is built from the **working tree**, not from `HEAD` alone — so it
includes the uncommitted fixes. If you diff this snapshot against `git show fe6d64a`,
expect real differences in `pipeline3_production/` and a few root docs; that is
intentional, not drift.

---

## 12-FIX REMEDIATION PASS (this snapshot's basis)

A prior snapshot (built from `fe6d64a`) was audited and found to contain several real
defects — not interface gaps, actual bugs. All 12 were fixed in this pass, each with a
regression test. Full detail in code comments at each fix site; summary:

| # | Fix | Files touched (non-test) | Real bug found |
|---|-----|---------------------------|-----------------|
| 1 | Render hash | `render.ts` | Hashed `run_id:bytes` string metadata, not the actual output file's bytes — two different files of the same size/run_id would get an identical "content" hash |
| 2 | P3.08-DIST real gaps | `distribution.ts`, `orchestration_p309.ts`, `costLedger.ts`, `p309Config.ts` (new) | `enable_internet: false` while the generated kernel script does `git clone`+`npm install`; `frame_range`/`duration_s` hardcoded to `{0,0}`/`0`; `wouldExceedLimit()` a placeholder always returning `false`; the real FFmpeg merge was never actually called (only a comment said it would be) |
| 3 | P3.09 naming collision | `qa.ts`, `orchestration_p309.ts`, `distribution.ts`, `sharding.ts`, `scheduling.ts`, `merge.ts`, `feedback.ts`, `recovery.ts`, `p309_live_execution.ts`, `p309Config.ts`, `docs/P3_08_VS_P3_09.md` | "P3.09" was used for two unrelated things: canonical Automated QA (`runP309QA`) and the distributed-render subsystem. Distributed-render's own logs/comments/test titles renamed to "P3.08-DIST" |
| 4 | gTTS fallback wired | `gtts.ts`, `pipeline.ts`, `types.ts` | gTTS was a stub that estimated duration from word count and never wrote an audio file; the Piper→gTTS fallback existed only as pseudocode inside a test, never as real orchestration code |
| 5 | Hardcoded identities | `p309Config.ts` (new), `distribution.ts`, `orchestration_p309.ts`, `p309_live_execution.ts` | A specific Kaggle username and a specific GitHub repo URL were hardcoded as defaults inside production code |
| 6 | Docs corrected | `REPRODUCE_A_BRANCH.md`, `docs/VOICE_PROVIDER_POLICY.md` | Documented `runP1ResearchPipeline()`/`runP2CreativePipeline()`/`runP3ProductionPipeline()` and other functions that do not exist anywhere in the codebase; referenced nonexistent `README.md` files |
| 7 | TS strict alignment | `tsconfig.json`, `merge.ts`, `sharding.ts`, `scheduling.ts` | P3's `tsconfig.json` had `strict: false` while P1/P2 have `strict: true` |
| 8 | `any` removed | `pipeline.ts`, `orchestration_p309.ts`, `feedback.ts` | 9 explicit `any` usages, replaced with the real existing contract types |
| 9 | Dependency docs | `docs/EXTERNAL_DEPENDENCIES.md` (new) | No prior doc listed which system binaries (`ffmpeg`, `ffprobe`, `python3`, `kaggle`) the code actually shells out to |
| 10 | Clean packaging | `.gitignore` (P3), `scripts/build_canonical_snapshot.sh` (new) | A prior canonical ZIP snapshot contained a real `.pyc` file (`pipeline3_production/scripts/__pycache__/*.pyc`) — the packaging command had no cache-artifact exclusion |
| 11 | Manifest numbers | This file | Prior version claimed P1 has "12 test files" (actually 8) and P2 has "21 test files" (actually 14) — stale/incorrect from the start, not just outdated |
| 12 | Claims vs. reality | This file, `docs/VOICE_PROVIDER_POLICY.md`, `docs/P3_08_VS_P3_09.md` | See "Honest Status" section below |

---

## PIPELINE 1: RESEARCH

**Location:** `pipeline1_research/`
**Status:** Source implemented; hermetic test suite passing. See "Honest Status" for
what "implemented" does and does not mean here.

### Phases
P1.01 through P1.06+ (input → propose scope → domain research → verification →
synthesis → handoff). Real exported functions (verified: `grep -n "^export function\|^export async function" src/pipeline.ts`):
`runP101Input`, `runP102ProposeScope`, `approveScope`, `runP103DomainResearch`,
`runP104Verification`, `runP105And106Synthesis`, `draftHandoff`, `approvePackage`,
`requirePackageApproved`.

### Source Code
- **12** TypeScript modules in `src/` (verified: `ls pipeline1_research/src/*.ts | wc -l`)
- Contract definitions: `src/types.ts`

### Tests
- **46 tests across 8 test files** (verified: `cd pipeline1_research && npm test` →
  `Test Files 8 passed (8)` / `Tests 46 passed (46)`)
- Test location: `pipeline1_research/tests/`

### Configuration
- `package.json` — no runtime `dependencies` at all (only `devDependencies`:
  `@types/node`, `typescript`, `vitest` — verified: `jq .dependencies package.json` → `null`)
- `tsconfig.json` — `strict: true`, `noUncheckedIndexedAccess: true`

### Downstream
Outputs a `ResearchPackageHandoff`; feeds P2.

---

## PIPELINE 2: CREATIVE

**Location:** `pipeline2_creative/`
**Status:** Source implemented; hermetic test suite passing. See "Honest Status".

### Phases
P2.01 (reference discovery/approval) through **P2.11 (Production Package Approval —
FROZEN CONTRACT)**. Real exported functions: `approveReferences`, `runP202Understand`,
`runP203Strategize`, `decideFormat`, `formatDecisionFromApprovedDecision`,
`buildFormatDecisionMatrix`, `approveFormatDecisionMatrix`, `runP206ArtDirection`,
`approveArtDirection`, `runP207AssetPlanning`, `runP208SceneShotPlanning`,
`runP209FlowPromptDirection`, `runP210VoiceSpec`, `draftProductionPackage`,
`approveProductionPackage`, `requireProductionPackageApproved`.

### Source Code
- **18** TypeScript modules in `src/` (verified: `ls pipeline2_creative/src/*.ts | wc -l`)
- **Frozen contract:** `src/types.ts` — P2.11 `ProductionPackageHandoff`, the exact
  shape P3's ingest (`ingest.ts`) validates against

### Tests
- **94 tests across 14 test files** (verified: `cd pipeline2_creative && npm test` →
  `Test Files 14 passed (14)` / `Tests 94 passed (94)`)
- Test location: `pipeline2_creative/tests/`

### Configuration
- `package.json` — no runtime `dependencies` (dev-only: `@types/node`, `typescript`, `vitest`)
- `tsconfig.json` — `strict: true`, `noUncheckedIndexedAccess: true`

### Frozen Boundary
`src/types.ts`'s `ProductionPackageHandoff` — P3's ingest validates against this
contract exactly; a change here requires P3 re-validation.

### Downstream
Outputs a `ProductionPackageHandoff`; feeds P3.

---

## PIPELINE 3: PRODUCTION

**Location:** `pipeline3_production/`
**Status:** All 10 canonical phases (P3.01–P3.10) have an orchestration wrapper in
`src/pipeline.ts` and are exercised together by the golden integration test. See
"Honest Status" below for what remains fixture-only vs. genuinely real-execution-verified.

### Phases (all 10 have an orchestration wrapper)

| Phase | Wrapper (`pipeline.ts`) | Frozen? |
|-------|--------------------------|---------|
| P3.01–P3.03 | `runIngestValidateMatch` | — |
| P3.02 | `runP302AssetValidation` | — |
| P3.04 | `runP304PiperPreview`, `runP304GttsFallbackPreview`, `runP304VoicePreviewWithFallback` | — |
| P3.05 | `runP305ElevenLabsProductionVoice` | — |
| P3.06 | `runP306Timing` | — |
| P3.07 | `runP307Timeline` | ✅ P3-A Governance A (`timeline.ts`) |
| P3.08 | `runP308Render` | Provider interface locked (`render.ts`); hash logic fixed this pass — see fix #1 |
| P3.09 | `runP309QA` | — (canonical Automated QA; **not** the distributed-render subsystem — see naming note) |
| P3.10 | `runP310Kaggle` | ✅ Kaggle provider interface locked (`kaggle.ts`) |

**Naming note:** a separate, optional subsystem (`orchestration_p309.ts`,
`P309Orchestrator` class, plus `distribution.ts`/`sharding.ts`/`scheduling.ts`/
`merge.ts`/`feedback.ts`/`recovery.ts`) implements a distributed variant of P3.08
Render across Kaggle workers. It is internally labeled **"P3.08-DIST"** in its own
logs, comments, and test titles as of this pass — it is not phase P3.09 and does not
perform QA, despite the historical "p309" fragment in its file/class names (kept to
avoid an unnecessary breaking rename).

### Orchestration Layer

`src/pipeline.ts` — **429 lines** (verified: `wc -l pipeline3_production/src/pipeline.ts`),
15 exported orchestration functions (verified: `grep -c "^export function\|^export async function" src/pipeline.ts`).

### Source Code
- **34** TypeScript modules in `src/` (verified: `ls pipeline3_production/src/*.ts | wc -l`)
- **Frozen, unchanged since the P3-A baseline (`42e5bc4`), verified with
  `git diff 42e5bc4..HEAD -- <file>` returning empty, PLUS no uncommitted working-tree
  changes (`git status --short <file>` empty) as of this pass:**
  - `pipeline3_production/src/timeline.ts` (P3-A Governance A)
  - `pipeline3_production/src/kaggle.ts` (P3.10 provider interface)
  - `pipeline3_production/remotion/P3Composition.tsx`
  - `pipeline2_creative/src/types.ts` (P2.11)
- **Touched this pass, under the documented exception process (real defect + minimal
  fix + regression test):**
  - `pipeline3_production/src/render.ts` (P3.08) — see fix #1. The provider interface
    (`ExecRemotionRender` seam, function signature) is unchanged; only the hash
    computation inside `renderTimeline()` changed, from hashing `run_id:bytes` metadata
    to hashing the actual output file's bytes.

### Tests
- **322 tests across 34 test files** (verified: `cd pipeline3_production && npm test` →
  `Test Files 34 passed (34)` / `Tests 322 passed (322)`)
- Test location: `pipeline3_production/tests/`

#### Test Breakdown (counts from the actual `npm test` run, not computed by hand)

| Category | Tests | File(s) |
|----------|-------|---------|
| P3-A Governance A | 11 | `motion.p3a.test.ts` |
| P3-B Orchestration Bridge | 6 | `p3b.orchestration.test.ts` |
| P3-C Orchestration Completion | 3 | `p3c.orchestration.test.ts` |
| Golden Integration (full P3.01→P3.10) | 1 | `golden.integration.test.ts` |
| Render + content-hash proof (fix #1, incl. 2 new tests proving same-size/different-content ⇒ different hash) | 7 | `timelineRender.test.ts` |
| P3.08-DIST distribution unit tests (fix #2/#5) | 7 | `distribution.test.ts` (new) |
| P309Config identity resolution (fix #5) | 5 | `p309Config.test.ts` (new) |
| CostLedger.wouldExceedLimit (fix #2) | 4 | `costLedger.wouldExceedLimit.test.ts` (new) |
| Real tiered voice fallback (fix #4), incl. one real gTTS network call | 7 | `voiceFallback.p3c.test.ts` (new) |
| All other module-level tests | 271 | remaining 25 test files |

271 + 11 + 6 + 3 + 1 + 7 + 7 + 5 + 4 + 7 = 322.

### Configuration
- `package.json` — real runtime `dependencies`: `remotion`, `@remotion/bundler`,
  `@remotion/renderer`, `react`, `react-dom` (verified: `jq .dependencies package.json`)
- `tsconfig.json` — **`strict: true`, `noUncheckedIndexedAccess: true`,
  `forceConsistentCasingInFileNames: true`** as of this pass (previously `false` on
  all three — see fix #7). Matches P1/P2's settings exactly.

### Governance A (P3-A) Enforcement — unchanged this pass

**Principle:** P3 validates the explicit `motion_plan` from P2; never invents motion
metadata.

**Implementation in `timeline.ts`:** `normalizeMotionMetadata()` requires every field
from P2's `motion_plan` and throws if any is missing (e.g.
`transition_duration_frames is required`). No default values, no inference from
`camera.movement`.

**Test evidence:** `motion.p3a.test.ts`, 11 tests — rejects missing
`transition_type`/`transition_duration_frames`/`movement_duration_frames`, ignores
`camera.movement` for inference, transports P2's explicit values unchanged.

### Downstream
Outputs a `FinalDeliveryPackage` (video MP4 + QA report + Kaggle delivery record).

---

## HONEST STATUS (fix #12 — claims checked against reality)

A capability is only called **"complete"** below if it is: (a) implemented, (b) has a
passing test that exercises it, (c) is actually called from the real production
orchestration path (not just available as an unused function), and (d) has no known
placeholder left inside it. Anything short of that is described precisely instead.

| Component | Status | Why |
|-----------|--------|-----|
| **P1 `researchEngine.ts`** | Implemented, unit-tested, called from `pipeline.ts`. Deterministic, rule-based analysis over supplied `ResearchScope`/source inputs — not a call to any external research/LLM API. Accurate description: **"deterministic research-structuring engine"**, not "AI research engine" or similar. | Verified by reading `src/researchEngine.ts` directly; no `fetch`/`spawn`/API-client code in it. |
| **P2 creative strategy modules** (`creativeStrategy.ts`, `aiDirector.ts`, etc.) | Implemented, unit-tested, called from `pipeline.ts`. Same caveat as P1: rule/heuristic-based decision logic over structured inputs, not a call to an external reasoning/LLM service. | Verified by reading the modules; no external API calls. |
| **P3.08-DIST distributed render** | The 4 concrete placeholder bugs found this pass are fixed and covered by unit + integration tests (fixture-based, fast, hermetic). **Not** verified: an actual end-to-end run against the real Kaggle API (real account, real kernel push, real GPU/CPU worker, real download) was not performed in this session — `tests/orchestration_p309.integration.test.ts` and `tests/distribution.test.ts` use an injected fixture `ExecKaggleCli`, not the real `kaggle` CLI. Accurate description: **"placeholder-free and test-covered, real-Kaggle-execution unverified in this session."** | See fix #2 test files; note their fixture seams. |
| **Piper (Tier 1 voice, local)** | Real implementation — genuinely spawns `python3 -m piper` with real WAV output and real duration measurement from WAV headers. All Piper tests in `piper.test.ts` use an injected fixture seam (`defaultExecPiperSubprocess`), not the real subprocess path. Accurate description: **"real implementation exists, fixture-tested, no real-path test coverage."** Caveat: depends on Python + piper package available locally at render time. | See `piper.ts` (lines 24-48, real subprocess call); `piper.test.ts` (all tests use fixture seam, not real subprocess). |
| **gTTS (Tier 2 voice fallback)** | Real implementation as of this pass — genuinely spawns `python3` + the `gtts` package, writes a real MP3, measures real duration via `ffprobe`. One test in `voiceFallback.p3c.test.ts` makes the actual network call (no fixture) and passed in this environment. Accurate description: **"real, network-verified in this environment."** Caveat: depends on outbound network access to Google's TTS endpoint at call time, which this repository does not guarantee in every environment. | See fix #4; the real (non-fixture) test in `voiceFallback.p3c.test.ts`. |
| **P3.10 Kaggle delivery** | Real implementation, provider interface frozen, unit-tested with an injected fixture `ExecKaggleCli`. Same caveat as P3.08-DIST: not verified against the real Kaggle API in this session. | `kaggle.test.ts` |
| **ElevenLabs production voice (P3.05)** | Real HTTP-call implementation, gate-enforced, unit-tested with an injected fixture HTTP function. Not verified against the real ElevenLabs API (no API key available in this session). | `elevenlabs.test.ts`, `elevenlabsConnectivity.test.ts` |
| **P3.08 Remotion render** | Real implementation; two dedicated test files (`remotion_real_render.test.ts`, `real_proof_merge_validation.test.ts`) exercise the actual `@remotion/renderer` + real `ffmpeg`, not fixtures, and pass in this environment. | Genuinely real-execution-verified, unlike the Kaggle-dependent paths above. |

**Do not describe this snapshot as unconditionally "production-ready."** The pieces
that talk to real paid/external services (Kaggle, ElevenLabs) are implemented,
gated, and unit-tested against injected fixtures, but their real-service integration
was not exercised end-to-end in this session — say so explicitly rather than
inferring readiness from passing fixture tests.

---

## DIRECTORY STRUCTURE

```
A_BRANCH_FULL_PIPELINE_P1_TO_P3_CANONICAL.zip/
├── pipeline1_research/
│   ├── src/ (12 modules)
│   ├── tests/ (46 tests, 8 files)
│   ├── package.json, package-lock.json, tsconfig.json, vitest.config.ts, .gitignore
│
├── pipeline2_creative/
│   ├── src/ (18 modules, P2.11 FROZEN)
│   ├── tests/ (94 tests, 14 files)
│   ├── docs/
│   ├── package.json, package-lock.json, tsconfig.json, vitest.config.ts, .gitignore
│
├── pipeline3_production/
│   ├── src/ (34 modules)
│   │   ├── pipeline.ts (429 lines, 14 orchestration functions)
│   │   ├── timeline.ts (P3-A FROZEN)
│   │   ├── render.ts (P3.08 — hash fix applied this pass; provider interface unchanged)
│   │   ├── kaggle.ts (P3.10 FROZEN)
│   │   ├── p309Config.ts (new this pass — single identity-config source)
│   │   └── [29 other modules]
│   ├── remotion/P3Composition.tsx (FROZEN)
│   ├── tests/ (322 tests, 34 files — see Test Breakdown above)
│   ├── docs/, notebooks/
│   ├── package.json, package-lock.json, tsconfig.json, vitest.config.ts, .env.example, .gitignore
│
├── docs/
│   ├── architecture/01_PIPELINE_1_ARCHITECTURE.md, 02_PIPELINE_2_ARCHITECTURE.md, 03_PIPELINE_3_ARCHITECTURE.md
│   ├── VOICE_PROVIDER_POLICY.md
│   ├── EXTERNAL_DEPENDENCIES.md (new this pass)
│   ├── P3_08_VS_P3_09.md
│   └── [additional shared docs]
│
├── scripts/build_canonical_snapshot.sh (new this pass — the corrected packaging tool)
├── REPRODUCE_A_BRANCH.md
├── FULL_PIPELINE_SYSTEM_MAP.md
└── FULL_PIPELINE_CANONICAL_MANIFEST.md (this file)
```

---

## EXCLUDED FROM SNAPSHOT

Enforced by `scripts/build_canonical_snapshot.sh` (fix #10), which verifies its own
output before finishing:

- `.git/`, `node_modules/`, `dist/`, `build/`, `.vitest/`, `.turbo/`
- `__pycache__/`, `*.pyc`, `.pytest_cache/`, `.mypy_cache/`, `.ipynb_checkpoints/`
  (a prior snapshot leaked a real `.pyc` file — see fix #10)
- `.env`, `*.env` (secrets) — `.env.example` files are explicitly kept
- `.DS_Store`, `*.log`

---

## HOW TO USE THIS SNAPSHOT

```bash
unzip A_BRANCH_FULL_PIPELINE_P1_TO_P3_CANONICAL.zip
cd A_BRANCH_FULL_PIPELINE_P1_TO_P3_CANONICAL

cd pipeline1_research && npm install && npm test && cd ..
cd pipeline2_creative && npm install && npm test && cd ..
cd pipeline3_production && npm install && npm test && cd ..
```

Expected: `46 passed`, `94 passed`, `322 passed` respectively — **462 tests total**.
See `REPRODUCE_A_BRANCH.md` for the full guide, including which P3 tests need real
`ffmpeg`/`ffprobe` binaries or outbound network access, and `docs/EXTERNAL_DEPENDENCIES.md`
for the verified dependency list.

---

**Status:** All 462 tests pass in this environment as of this pass. The 12-item
remediation described above is complete, each with a regression test. Real-external-
service execution (Kaggle API, ElevenLabs API) remains fixture-verified only — see
"Honest Status" before describing any component as unconditionally production-ready.
