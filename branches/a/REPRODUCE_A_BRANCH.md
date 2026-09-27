# A-BRANCH FULL PIPELINE REPRODUCTION GUIDE

This document explains how to reconstruct and run the A-Branch pipeline (P1 → P2 → P3) from this canonical snapshot.

## Prerequisites

- **Node.js:** v22 or later (verify with `node --version`)
- **npm:** 10+ (included with Node.js; verify with `npm --version`)
- **Git:** For version control (optional, but recommended)
- **Environment:** Linux, macOS, or Windows (with WSL recommended)

P1 and P2 need nothing beyond Node/npm. P3's hermetic test suite (`npm test`) also needs
nothing beyond Node/npm — all external calls (Piper, gTTS, ElevenLabs, Kaggle CLI,
Remotion/Chromium, FFmpeg) are injected fixtures there. Three specific P3 test files
exercise real system binaries (`ffmpeg`, `ffprobe`, and a real Chromium for Remotion) and
one makes a real network call to gTTS — see `docs/EXTERNAL_DEPENDENCIES.md` for the full,
verified breakdown (which binary, which file, which test) before assuming you need them.

## Directory Structure After Extraction

```
A_BRANCH_FULL_PIPELINE_P1_TO_P3_CANONICAL/
├── pipeline1_research/          # P1: Research pipeline
├── pipeline2_creative/          # P2: Creative pipeline
├── pipeline3_production/        # P3: Production pipeline
├── docs/                        # Shared documentation
├── FULL_PIPELINE_SYSTEM_MAP.md  # Architecture reference
├── FULL_PIPELINE_CANONICAL_MANIFEST.md
└── REPRODUCE_A_BRANCH.md        # This file
```

## Step-by-Step Reproduction

### 1. Extract the Snapshot

```bash
unzip A_BRANCH_FULL_PIPELINE_P1_TO_P3_CANONICAL.zip
cd A_BRANCH_FULL_PIPELINE_P1_TO_P3_CANONICAL
```

### 2. Environment Variables (Optional)

The pipelines work out-of-the-box with default configurations. However, for optional production features:

**For P3 Production Pipeline (optional, for real services):**

See `pipeline3_production/.env.example` for the complete, verified list (every variable
in that file is actually read by `src/*.ts` — checked with
`grep -rn "process.env." src/*.ts`). The two that matter most:

```bash
# pipeline3_production/.env (optional)

# Only required if you call P3.08-DIST distributed render (orchestration_p309.ts)
# without passing an explicit identity — throws a clear error if missing,
# never silently falls back to a hardcoded account.
KAGGLE_USERNAME=your_kaggle_username
P309_GITHUB_REPO_URL=https://github.com/your-org/your-fork.git
```

ElevenLabs production voice does NOT read an API key from `process.env` — `apiKey` is an
explicit function parameter to `runP305ElevenLabsProductionVoice()`, supplied by the
caller. The Kaggle CLI itself (used by both P3.08-DIST and P3.10 delivery) reads its own
credentials from `~/.kaggle/kaggle.json`, not from this codebase.

**Default behavior (no .env file needed):**
- P3 uses **Piper** for voice (local, free, default)
- P3 uses **gTTS** as fallback if Piper unavailable
- P3 uses **test fixtures** for ElevenLabs and Kaggle (no real API calls)
- All 462 tests pass without external credentials

**For Remotion rendering (optional):**
```bash
# Set custom Chromium path if needed (optional)
export REMOTION_BROWSER_EXECUTABLE=/path/to/chromium
```

### 3. Install Dependencies

**Pipeline 1 (Research):**
```bash
cd pipeline1_research
npm install
npm test                # Run all P1 tests (46 tests)
cd ..
```

**Pipeline 2 (Creative):**
```bash
cd pipeline2_creative
npm install
npm test                # Run all P2 tests (94 tests)
cd ..
```

**Pipeline 3 (Production):**
```bash
cd pipeline3_production
npm install
npm test                # Run all P3 tests (322 tests)
cd ..
```

### 4. Run Individual Pipeline Tests

**Test specific P1 test file:**
```bash
cd pipeline1_research
npm test pipeline.test.ts              # P1 pipeline tests (13 tests)
npm test -- -t "gates"                 # Tests matching pattern
cd ..
```

**Test specific P2 test files:**
```bash
cd pipeline2_creative
npm test pipeline.p2b.test.ts           # P2 pipeline tests (13 tests)
npm test promptArchitecture.test.ts     # Visual prompt architecture (16 tests)
cd ..
```

**Test specific P3 test files (production orchestration):**
```bash
cd pipeline3_production
npm test golden.integration.test.ts     # Full end-to-end P3.01→P3.10 test
npm test motion.p3a.test.ts             # P3-A Governance A enforcement (11 tests)
npm test p3b.orchestration.test.ts      # P3-B orchestration bridge (6 tests)
npm test p3c.orchestration.test.ts      # P3-C orchestration completion (3 tests)
cd ..
```

**Pattern-based test execution:**
```bash
cd pipeline3_production
npm test -- -t "Full P3.01"             # Run tests matching pattern
```

### 5. Pipeline Module Imports & Architecture

Each pipeline is a TypeScript library — there is no single `runP1ResearchPipeline()` /
`runP2CreativePipeline()` / `runP3ProductionPipeline()` entry point in any of the three
pipelines. Instead, `src/pipeline.ts` in each package exports one function PER PHASE, and
a consumer calls them in sequence (each phase's output feeds the next). The real exported
functions, per package (verified against `src/pipeline.ts` — run
`grep -n "^export function\|^export async function" src/pipeline.ts` in any package to
reproduce this list yourself):

**P1 (Research)** — `pipeline1_research/src/pipeline.ts`:
`runP101Input`, `runP102ProposeScope`, `approveScope`, `runP103DomainResearch`,
`runP104Verification`, `runP105And106Synthesis`, `draftHandoff`, `approvePackage`,
`requirePackageApproved`. Types: `ResearchRequest`, `ResearchPackageHandoff` (see
`src/types.ts`).

**P2 (Creative)** — `pipeline2_creative/src/pipeline.ts`:
`approveReferences`, `runP202Understand`, `runP203Strategize`, `decideFormat`,
`formatDecisionFromApprovedDecision`, `buildFormatDecisionMatrix`,
`approveFormatDecisionMatrix`, `runP206ArtDirection`, `approveArtDirection`,
`runP207AssetPlanning`, `runP208SceneShotPlanning`, `runP209FlowPromptDirection`,
`runP210VoiceSpec`, `draftProductionPackage`, `approveProductionPackage`,
`requireProductionPackageApproved`. Types: `ProductionPackageHandoff` (see `src/types.ts`).

**P3 (Production)** — `pipeline3_production/src/pipeline.ts`:
`approveDeliveryReceived`, `runIngestValidateMatch`, `runP302AssetValidation`,
`runP304PiperPreview`, `runP304GttsFallbackPreview`, `runP304VoicePreviewWithFallback`
(the real tiered Piper→gTTS policy — see `docs/VOICE_PROVIDER_POLICY.md`),
`runP305ElevenLabsProductionVoice`, `runP306Timing`, `runP307Timeline`, `runP308Render`,
`runP309QA`, `runP310Kaggle`, `approveAmbiguityResolution`, `approveFinalQA`,
`assembleFinalDeliveryPackage`. Types: `ProductionDeliveryInput`, `FinalDeliveryPackage`
(see `src/types.ts`).

Each package also has a distinct optional distributed-render subsystem
(`pipeline3_production/src/orchestration_p309.ts`, `P309Orchestrator` class) — internally
labeled "P3.08-DIST" in its own logs/comments because it is an OPTIONAL variant of P3.08
Render, not phase P3.09 (which is `runP309QA` above, canonical Automated QA).

**The real, working call sequence** is exercised end-to-end by
`pipeline3_production/tests/golden.integration.test.ts` — read that file for the complete,
runnable example (static fixtures throughout, no real external services). It calls the P3
functions above in order: ingest → validate → match → voice preview (with fallback) → Gate
A5 → ElevenLabs preflight → production voice → timing → timeline → render → automated QA →
Gate A7 → Kaggle delivery → final package assembly.

### 6. Verify Installation

**Quick sanity check (run full integration test):**
```bash
cd pipeline3_production
npm test golden.integration.test.ts

# Should see:
#  ✓ tests/golden.integration.test.ts (1 test) <duration>
#   Test Files  1 passed (1)
#        Tests  1 passed (1)
```

**Verify all pipelines work:**
```bash
cd pipeline1_research && npm test && cd ..
cd pipeline2_creative && npm test && cd ..
cd pipeline3_production && npm test
```

## Troubleshooting

### Node.js Version Issues

If npm test fails with module errors:
```bash
node --version              # Should be v22+
npm install -g npm@latest   # Update npm
rm -rf node_modules package-lock.json
npm install
npm test
```

### Test Failures

**If tests fail with "module not found":**
```bash
npm install --save-dev     # Reinstall dev dependencies
npm test
```

**If P3 tests fail on external services (ElevenLabs, Kaggle):**
- This is expected in isolated environments
- P3 uses fixture adapters for testing without real API calls
- See `tests/` files for fixture implementations

### Git Operations

If you need to track changes:
```bash
git init
git add .
git commit -m "Initial A-Branch snapshot"
```

## Architecture Quick Reference

See `FULL_PIPELINE_SYSTEM_MAP.md` for:
- Phase-by-phase data flow
- Entry points for each pipeline
- Input/output contracts
- Test file locations

See `FULL_PIPELINE_CANONICAL_MANIFEST.md` for:
- Complete phase listing
- Frozen contracts
- Test coverage statistics
- Git status at snapshot time

## Expected Test Results

After full reproduction:

```
P1 (Research):    46 tests  → ✓ PASS
P2 (Creative):    94 tests  → ✓ PASS
P3 (Production): 322 tests  → ✓ PASS
────────────────────────────
TOTAL:           462 tests  → ✓ PASS
```

## Next Steps

1. **Review Architecture:** Read `docs/architecture/` for design decisions
2. **Modify Inputs:** Update P1 research scope, P2 creative strategy, P3 production parameters
3. **Extend:** Add new P1 research phases, P2 creative modules, P3 production stages
4. **Integrate:** Connect to external services (Kaggle, ElevenLabs, Remotion)

## Support

None of the three pipelines has a per-package README.md (verified: only
`node_modules/**/README.md` files exist, from third-party dependencies). For questions:

- **P1/P2/P3 source-level questions:** Read the module's own header comment in `src/*.ts` —
  every module in this codebase opens with a comment describing its role and any AUDIT
  FIX / correction history.
- **Architecture questions:** See `docs/architecture/`
- **Voice provider policy:** See `docs/VOICE_PROVIDER_POLICY.md`
- **P2 module responsibilities:** See `docs/P2_CREATIVE_MODULES.md`
- **P3.07 motion coordination / P3.08 vs P3.08-DIST:** See `docs/P3_07_MOTION_COORDINATION.md`, `docs/P3_08_VS_P3_09.md`

---

**Snapshot Date:** 2026-08-26  
**Git Branch:** claude/a-branch-pipeline-arch-ni1pes  
**Git HEAD:** 72f9da0 (Add A-Branch canonical snapshot documentation)

For detailed phase-by-phase breakdown, see FULL_PIPELINE_SYSTEM_MAP.md.
