# FULL PIPELINE SYSTEM MAP — P1.01 → P3.10

Complete architectural map of the A-Branch pipeline system showing phase hierarchy, data flow, contracts, and orchestration.

---

## SYSTEM ARCHITECTURE

```
┌─────────────────────────────────────────────────────────────────┐
│                    P1: RESEARCH PIPELINE                        │
│                                                                 │
│  P1.01 → P1.02 → P1.03 → ... → P1.xx → ResearchPackage       │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ↓
┌─────────────────────────────────────────────────────────────────┐
│                   P2: CREATIVE PIPELINE                         │
│                                                                 │
│  P2.01 → P2.02 → ... → P2.11 ProductionPackage (FROZEN)       │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ↓
┌─────────────────────────────────────────────────────────────────┐
│                 P3: PRODUCTION PIPELINE                         │
│                                                                 │
│ P3.01 ─→ P3.02 ─→ P3.03 ─→ P3.04 ─→ P3.05 ─→ P3.06 ─→ P3.07  │
│                                                      ↓          │
│                                            P3.08 ←─ │ ─→ P3.09  │
│                                              ↓                 │
│                                            P3.10               │
│                                              ↓                 │
│                                      FinalDeliveryPackage     │
└─────────────────────────────────────────────────────────────────┘
```

---

## PIPELINE 1: RESEARCH (P1.01 → P1.xx)

**Location:** `pipeline1_research/`

| Phase | Module | Entry Point | Input | Output | Tests | Status |
|-------|--------|-------------|-------|--------|-------|--------|
| P1.01 | Input Initialization | `runP101Input` | Topic, scope | ResearchRequest | pipeline.test.ts | ✅ |
| P1.02 | Scope Proposal | `runP102ProposeScope` | ResearchRequest | ResearchScope | scopeBoundary.test.ts | ✅ |
| P1.03 | Domain Research | `runP103DomainResearch` | ResearchScope | VerifiedClaims[] | verification.test.ts | ✅ |
| P1.04 | Claim Verification | `runP104Verification` | DomainAnalysis | VerifiedClaims[] | verification.test.ts | ✅ |
| P1.05–P1.06 | Synthesis | `runP105And106Synthesis` | VerifiedClaims[] | Analysis | pipeline.test.ts | ✅ |
| P1.07 | Handoff Assembly | `draftHandoff` | Analysis | ResearchPackageHandoff | pipeline.test.ts | ✅ |

**Key Files:**
- `src/pipeline.ts` — P1 orchestration (entry points for each phase)
- `src/types.ts` — P1 contract definitions (ResearchScope, ResearchPackage, etc.)
- `tests/` — 46 total tests across 12 test files
- `package.json` — Dependencies, scripts

**Data Flow:**
```
Topic/Scope → P1.01 (scope init)
           → P1.02 (source discovery)
           → P1.03 (domain analysis)
           → P1.04 (verification)
           → ... (squeeze + synthesis)
           → P1.xx (ResearchPackage handoff to P2)
```

**Downstream Consumer:** P2.01 (Creative pipeline ingests ResearchPackage)

---

## PIPELINE 2: CREATIVE (P2.01 → P2.11)

**Location:** `pipeline2_creative/`

| Phase | Module | Entry Point | Input | Output | Contract | Status |
|-------|--------|-------------|-------|--------|----------|--------|
| P2.01 | Ingest & Reference Discovery | `approveReferences` | ResearchPackage | ReferenceUniverse | — | ✅ |
| P2.02 | Understanding | `runP202Understand` | ReferenceUniverse | UnderstandingAnalysis | — | ✅ |
| P2.03 | Creative Strategy | `runP203Strategize` | UnderstandingAnalysis | CreativeStrategy | — | ✅ |
| P2.04 | Format & Duration Decision | `decideFormat`, `buildFormatDecisionMatrix`, `approveFormatDecisionMatrix` | CreativeStrategy | FormatDecision | — | ✅ |
| P2.05 | Manual Research / Observation | `recordObservation` (via referenceDiscovery.ts) | FormatDecision | Observations[] | — | ✅ |
| P2.06 | Visual Direction | `runP206ArtDirection`, `approveArtDirection` | Observations[] | VisualLanguage | — | ✅ |
| P2.07 | Asset Planning | `runP207AssetPlanning` | VisualLanguage | AssetRequirements | — | ✅ |
| P2.08 | Scene/Shot Planning | `runP208SceneShotPlanning` | AssetRequirements | SceneShots[] | — | ✅ |
| P2.09 | Flow Prompt Direction | `runP209FlowPromptDirection` | SceneShots[] | PromptList[] | — | ✅ |
| P2.10 | Voice Specification | `runP210VoiceSpec` | PromptList[] | VoiceSpec | — | ✅ |
| P2.11 | Production Package Approval | `draftProductionPackage`, `approveProductionPackage`, `requireProductionPackageApproved` | VoiceSpec | **ProductionPackageHandoff** | **FROZEN** | ✅ |

**Key Files:**
- `src/pipeline.ts` — P2 orchestration (all phase entry points)
- `src/types.ts` (11.7 KB) — **P2.11 ProductionPackageHandoff (FROZEN contract; P3 validates against this exactly)**
- `src/referenceDiscovery.ts` — P2.01 reference universe
- `src/aiDirector.ts` — P2.06 visual direction
- `src/assetPlanning.ts` — P2.07 asset requirements
- `src/promptArchitecture.ts` — P2.09 visual generation prompts
- `src/voiceSpec.ts` — P2.10 voice specification
- `tests/` — 94 total tests across 21 test files
- `package.json`, `package-lock.json` — Dependencies, scripts

**Data Flow:**
```
ResearchPackage → P2.01 (ingest)
               → P2.02 (strategy)
               → P2.03-P2.04 (format/duration decision)
               → P2.05 (storyboard review)
               → P2.06 (visual direction)
               → P2.07 (asset planning)
               → P2.08 (scene/shot matrix)
               → P2.09 (visual prompts)
               → P2.10 (voice spec)
               → P2.11 (ProductionPackageHandoff to P3)
```

**Frozen Boundary:** P2.11 ProductionPackageHandoff — P3 ingest validates against this contract exactly. 0 changes allowed without P3 re-validation.

**Downstream Consumer:** P3.01 (Production pipeline ingests ProductionPackageHandoff)

---

## PIPELINE 3: PRODUCTION (P3.01 → P3.10)

**Location:** `pipeline3_production/`

**Orchestration Layer:** `src/pipeline.ts` (342 lines, 8 orchestration wrappers)

### Full Orchestration Sequence

| Phase | Module | Wrapper | Input | Output | Provider | Governance | Tests |
|-------|--------|---------|-------|--------|----------|-----------|-------|
| P3.01 | Ingest + Validation | `runIngestValidateMatch` | ProductionPackageHandoff | ResolvedAsset[] | (internal) | Gate A4 | ingest.test.ts |
| P3.02 | Asset Decodability | `runP302AssetValidation` | ResolvedAsset[], files | AssetProbeRecord[] | ffprobe (fixture) | — | qa.test.ts |
| P3.03 | Asset Matching | (via P3.01) | AssetRequirements, Delivery | ResolvedAsset[] | (internal) | — | assetMatching.test.ts |
| P3.04 | Piper Preview [cached] | `runP304PiperPreview` | VoiceScript | PiperPreviewResult | Piper (local) | Gate A5 | piper.test.ts |
| P3.05 | ElevenLabs Voice [cached] | `runP305ElevenLabsProductionVoice` | VoiceScript | ProductionVoiceResult | ElevenLabs (API) | Gate A5/A6 | elevenlabs.test.ts |
| P3.06 | Timing (master clock) | `runP306Timing` | Shots, narration duration | TimingResult | (math) | — | timing.test.ts |
| P3.07 | Timeline + Motion Validation | `runP307Timeline` | Scenes, timing, assets | Timeline | (internal) | **P3-A Governance A** | **motion.p3a.test.ts** |
| P3.08 | Remotion Render [frozen] | `runP308Render` | Timeline, Composition | RenderManifest | Remotion/Chrome | — | remotion_real_render.test.ts |
| P3.09 | Automated QA | `runP309QA` | Assets, render, timeline | QAReport | (analysis) | Gate A7 | qa.test.ts |
| P3.10 | Kaggle Delivery [frozen] | `runP310Kaggle` | FinalVideoId, files | KaggleDeliveryRecord | Kaggle CLI | Gate A7 | kaggle.test.ts |

**Key Files:**
- **`src/pipeline.ts`** (342 lines) — Central orchestration with 8 wrappers (P3.01-P3.10)
- **`src/timeline.ts`** (P3.07) — **P3-A Governance A enforced: motion validation, no creative inference**
- **`src/render.ts`** (P3.08) — **Remotion render contract (FROZEN)**
- **`src/kaggle.ts`** (P3.10) — **Kaggle provider contract (FROZEN)**
- `src/ingest.ts` — P3.01 ingest + validation
- `src/assetValidation.ts` — P3.02 asset decodability probing
- `src/assetMatching.ts` — P3.03 asset matching
- `src/piper.ts` — P3.04 Piper integration
- `src/elevenlabs.ts` — P3.05 ElevenLabs integration
- `src/timing.ts` — P3.06 timing math
- `src/qa.ts` — P3.09 automated QA logic
- `src/types.ts` — P3 contract definitions
- `remotion/P3Composition.tsx` — **Remotion React component (FROZEN)**
- `tests/` — 322 total tests across 34 test files (see FULL_PIPELINE_CANONICAL_MANIFEST.md
  for the complete, verified breakdown)
  - `motion.p3a.test.ts` — 11 tests (P3-A Governance A enforcement)
  - `p3b.orchestration.test.ts` — 6 tests (P3.06-P3.08 bridge)
  - `p3c.orchestration.test.ts` — 3 tests (P3.09-P3.10 completion)
  - `golden.integration.test.ts` — 1 test (full P3.01→P3.10)
  - 301 other tests (module-level + the P3.08-DIST/gTTS/hash-fix test files added in
    the 12-fix remediation pass)
- `package.json`, `package-lock.json` — Dependencies, scripts

**Data Flow:**
```
ProductionPackageHandoff → P3.01 (ingest + validation)
                        → P3.02 (asset decodability)
                        → P3.03 (asset matching)
                        → P3.04 (Piper preview, cached)
                        → Gate A5 ↑ (human approval)
                        → P3.05 (ElevenLabs production, cached)
                        → P3.06 (timing: narration = master clock)
                        → P3.07 (timeline + motion validation)
                        → P3.08 (Remotion render)
                        → P3.09 (automated QA)
                        → Gate A7 ↑ (human QA approval)
                        → P3.10 (Kaggle delivery)
                        → FinalDeliveryPackage
```

### Frozen Contracts (Immutable)

| File | Reason | Verification |
|------|--------|--------------|
| `src/timeline.ts` | P3-A Governance A: motion validation only, no creative inference | 0 changes (42e5bc4 → 496c19a) |
| `src/render.ts` | Remotion provider interface locked | 0 changes (42e5bc4 → 496c19a) |
| `src/kaggle.ts` | Kaggle CLI provider interface locked | 0 changes (42e5bc4 → 496c19a) |
| `remotion/P3Composition.tsx` | Remotion React component locked | 0 changes (42e5bc4 → 496c19a) |

### Governance A (P3-A) Enforcement

**Principle:** P3.07 validates explicit motion_plan from P2; never invents motion metadata.

**Implementation:** `timeline.ts::normalizeMotionMetadata()`
- REQUIRES all fields from P2's motion_plan
- Throws errors if missing: `motion_plan.camera_movement is required`, etc.
- Deleted: `computeMovementDurationFrames()` (was performing creative inference)
- Result: P3 is purely validator + executor

**Test Evidence:** `motion.p3a.test.ts` (11 tests)
- Rejects missing transition_type → PASS
- Rejects missing transition_duration_frames → PASS
- Rejects missing movement_duration_frames → PASS
- Ignores camera.movement field (no inference) → PASS

---

## COMPLETE PIPELINE DATA FLOW

```
RESEARCH (P1)
├── Input: Topic, scope, example sources
├── Output: ResearchPackage
│   └── Verified claims
│   └── Source analysis
│   └── Domain understanding
│
CREATIVE (P2)
├── Input: ResearchPackage
├── Processing: Reference universe → strategy → format → duration → visuals → prompts → voice → approval
├── Output: ProductionPackageHandoff (FROZEN contract)
│   └── Asset requirements
│   └── Scene/shot matrix
│   └── Visual direction guide
│   └── Voice specification
│   └── Visual generation prompts
│
PRODUCTION (P3)
├── Input: ProductionPackageHandoff
├── Processing:
│   ├── P3.01-P3.03: Ingest + validation + asset matching
│   ├── P3.04-P3.05: Voice (Piper preview → ElevenLabs production)
│   ├── P3.06-P3.08: Timing → timeline (P3-A Governance A) → render
│   └── P3.09-P3.10: QA → Kaggle delivery
├── Output: FinalDeliveryPackage
│   └── Rendered video (MP4)
│   └── QA report
│   └── Kaggle dataset
│   └── Integrity hashes
└── Governance: 7 gates (A1, A2, A4, A5, A6, A7) enforce human approval points
```

---

## ENTRY POINTS FOR REPRODUCTION

**Correction (this pass):** each pipeline is a TypeScript library, not a CLI — there is no
`npm run research`/`creative`/`produce`/`full-pipeline` script in any `package.json` (each
package only defines `build`, `test`, `test:watch`). Reproduction means importing and
calling the real exported phase functions directly. See `REPRODUCE_A_BRANCH.md` for the
full, verified command-by-command walkthrough; the table below lists the real entry
functions per pipeline (verified via `grep -n "^export function\|^export async function"`).

| Pipeline | Entry Script | Real Exported Phase Functions (call directly, no CLI) | Input | Output |
|----------|--------------|---------------------------------------------------------|-------|--------|
| P1 | `pipeline1_research/src/pipeline.ts` | `runP101Input`, `runP102ProposeScope`, `approveScope`, `runP103DomainResearch`, `runP104Verification`, `runP105And106Synthesis`, `draftHandoff`, `approvePackage`, `requirePackageApproved` | Topic string | `ResearchPackageHandoff` |
| P2 | `pipeline2_creative/src/pipeline.ts` | `approveReferences`, `runP202Understand`, `runP203Strategize`, `decideFormat`, `runP206ArtDirection`, `approveArtDirection`, `runP207AssetPlanning`, `runP208SceneShotPlanning`, `runP209FlowPromptDirection`, `runP210VoiceSpec`, `draftProductionPackage`, `approveProductionPackage`, `requireProductionPackageApproved` | `ResearchPackageHandoff`, format, duration | `ProductionPackageHandoff` |
| P3 | `pipeline3_production/src/pipeline.ts` | `runIngestValidateMatch`, `runP302AssetValidation`, `runP304VoicePreviewWithFallback`, `runP305ElevenLabsProductionVoice`, `runP306Timing`, `runP307Timeline`, `runP308Render`, `runP309QA`, `runP310Kaggle`, `assembleFinalDeliveryPackage` | `ProductionPackageHandoff`, voice, render | `FinalDeliveryPackage` + MP4 video |

---

## TEST EXECUTION REFERENCE

| Pipeline | Command | Tests | Location |
|----------|---------|-------|----------|
| **P1** | `cd pipeline1_research && npm test` | 46 tests | `tests/` (8 files) |
| **P2** | `cd pipeline2_creative && npm test` | 94 tests | `tests/` (14 files) |
| **P3** | `cd pipeline3_production && npm test` | 322 tests | `tests/` (34 files) |
| **P3-A** (Governance) | `npm test -- motion.p3a.test.ts` | 11 tests | `tests/motion.p3a.test.ts` |
| **P3-B** (Bridge) | `npm test -- p3b.orchestration.test.ts` | 6 tests | `tests/p3b.orchestration.test.ts` |
| **P3-C** (Completion) | `npm test -- p3c.orchestration.test.ts` | 3 tests | `tests/p3c.orchestration.test.ts` |
| **P3 Golden** | `npm test -- golden.integration.test.ts` | 1 test | `tests/golden.integration.test.ts` |

**Total:** 462 tests (verified by running `npm test` in each of the three pipelines and
summing `Tests N passed`; see FULL_PIPELINE_CANONICAL_MANIFEST.md for the detailed
per-file breakdown of the P3 count).

---

## CONFIGURATION FILES

| Path | Purpose | Notes |
|------|---------|-------|
| `pipeline1_research/package.json` | P1 dependencies | No runtime `dependencies` at all — only `devDependencies` (`@types/node`, `typescript`, `vitest`) |
| `pipeline1_research/tsconfig.json` | TypeScript config for P1 | `strict: true`, `noUncheckedIndexedAccess: true` |
| `pipeline1_research/vitest.config.ts` | Test runner config | Runs tests in pipeline1_research/tests/ |
| `pipeline2_creative/package.json` | P2 dependencies | No runtime `dependencies` at all (no `@anthropic-sdk` or any other package) — only `devDependencies` (`@types/node`, `typescript`, `vitest`) |
| `pipeline2_creative/tsconfig.json` | TypeScript config for P2 | `strict: true`, `noUncheckedIndexedAccess: true` |
| `pipeline2_creative/vitest.config.ts` | Test runner config | Runs tests in pipeline2_creative/tests/ |
| `pipeline3_production/package.json` | P3 dependencies | Real runtime `dependencies`: `remotion`, `@remotion/bundler`, `@remotion/renderer`, `react`, `react-dom`. `kaggle` and `ffprobe` are **not** npm packages — they are external system binaries the code shells out to (see `docs/EXTERNAL_DEPENDENCIES.md`) |
| `pipeline3_production/tsconfig.json` | TypeScript config for P3 | `strict: true`, `noUncheckedIndexedAccess: true` (as of the 12-fix pass; previously `strict: false`) |
| `pipeline3_production/vitest.config.ts` | Test runner config | Runs tests in pipeline3_production/tests/ |

---

## DOCUMENTATION STRUCTURE

```
docs/
├── architecture/
│   ├── 01_PIPELINE_1_ARCHITECTURE.md      # P1 research pipeline design
│   ├── 02_PIPELINE_2_ARCHITECTURE.md      # P2 creative pipeline design
│   └── 03_PIPELINE_3_ARCHITECTURE.md      # P3 production pipeline design + orchestration
├── [Additional docs as present in snapshot]

pipeline1_research/
├── [Pipeline-specific docs if present]

pipeline2_creative/
├── docs/
│   └── [P2-specific documentation]

pipeline3_production/
├── docs/
│   └── [P3-specific documentation]
```

---

**System Map Version:** 2026-08-27
**Pipeline State:** P1.01 → P3.10 all have orchestration wrappers; P3-A Governance A enforced.
Real-external-service execution (Kaggle, ElevenLabs) is fixture-verified only — see
FULL_PIPELINE_CANONICAL_MANIFEST.md's "Honest Status" section before calling any
component unconditionally production-ready.
**Total Tests:** 462 (all passing in this environment as of this pass)

For detailed git history and frozen boundary verification, see FULL_PIPELINE_CANONICAL_MANIFEST.md.
