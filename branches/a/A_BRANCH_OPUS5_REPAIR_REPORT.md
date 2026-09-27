> **SUPERSEDED (R08 final release freeze, GPT-5.6 execution pass).** This document reflects the state after the prior (Opus 5) repair pass only. The subsequent GPT-5.6 pass (R00-R08) made further repairs on top of this baseline. For the current canonical state, see `A_BRANCH_CANONICAL_MANIFEST_20260906_FINAL.md` and `A_BRANCH_GPT56_FINAL_REPAIR_REPORT.md`. This document remains accurate for the repairs IT describes (T1.x/T2.x/Tier 3) and is retained as history.

---

# A-BRANCH — OPUS 5 CANONICAL REPAIR REPORT

**Date:** 2026-09-06
**Baseline:** `A_BRANCH_FULL_PIPELINE_CANONICAL_20260904.zip`
**Mandate:** `A_BRANCH_OPUS5_CANONICAL_REPAIR_BRIEF_20260906.md`
**Mode:** Repair in place. P1/P2/P3 architecture preserved; no redesign.

---

## A. Baseline

| Pipeline | Build | Tests (baseline) |
|---|---|---|
| P1 Research | ✅ `tsc` clean | ✅ 90/90 (9 files) |
| P2 Creative | ✅ `tsc` clean | ✅ 100/100 (14 files) |
| P3 Production | ✅ `tsc` clean | ✅ 330/330 (34 files) |

Node v22.22.2, npm. No dependency/runtime blockers. P3's suite exercises real
Remotion render + real FFmpeg merge (~50s wall time); Kaggle/ElevenLabs paths
are exercised only through injected fixture I/O seams, never live network
calls, in this session.

**The baseline's test suite was fully green.** Every defect below was present
under a green suite — this is the brief's own warning ("a green test suite
alone is not sufficient") borne out concretely, not a hypothetical.

Known pre-existing defects are exactly the Tier 1/2/3 items in section B.

---

## B. Repairs

Each entry: ID · problem · root cause · files changed · solution · tests ·
verification result.

### T1.1 — Canonical identity

- **Problem:** Canonical handoff artifacts (`ResearchPackageHandoff`,
  `ProductionPackageHandoff`) had a deterministic *name* (`package_id`) but
  no content identity. `package_id` was derived from `(project_id, scope_id,
  claim_ids)` only, so mutating `handoff_notes`, `verifications`, or
  `knowledge_package` left `package_id` — and any approval bound to it —
  unchanged. Separately, P1's `synthesis_run_id` computed its "source"
  component as `claims.flatMap(c => c.evidence_refs...).slice(0,1).map(()
  => "")`, which collapses to a constant for every input.
- **Root cause:** Identity/versioning gap (root cause #1 in the brief).
- **Files:** `pipeline{1,2}/src/canonicalIdentity.ts` (new),
  `pipeline{1,2}/src/types.ts`, `pipeline{1,2}/src/pipeline.ts`.
- **Solution:** New `canonicalIdentity.ts` in P1 and P2: order-independent
  canonical JSON representation, `contentHash()`, `buildIdentity()`,
  `verifyIdentity()`. Every canonical handoff now carries an `identity:
  CanonicalIdentity` block (`object_id`, `object_type`, `version`,
  `content_hash`, `parent_id`, `parent_content_hash`) computed over every
  content section. `synthesis_run_id` now derives from real source IDs (or
  the claims' actual `evidence_refs` when sources aren't supplied).
- **Tests:** `pipeline1_research/tests/tier1.semantics.test.ts` (4 tests:
  source-sensitivity, evidence-lineage-sensitivity, reproducibility, hash
  survives package_id-blind mutation), `pipeline2_creative/tests/tier1.
  semantics.test.ts` (1 test: order-independence + content-sensitivity).
- **Verification: FIXED, VERIFIED** (empirically reproduced against
  unrepaired baseline before the fix; repaired behavior asserted and
  passing).

### T1.2 — Real package integrity verification

- **Problem:** Verification at every package boundary (P1→P2, P2→P3, and
  P3's own per-asset hash checks) only checked that a declared hash was
  *shaped* like a SHA-256 hex digest (`isWellFormedSha256`). Nothing was
  ever recomputed and compared. A package or asset could be modified in
  transit, keep a plausible-looking (or even a genuinely-computed-but-now-
  stale) hash, and pass. This is the brief's "do not accept 'looks like a
  SHA-256' as verification", found true at **three separate boundaries**.
- **Root cause:** Integrity verification gap (root cause #2).
- **Files:** `pipeline1_research/src/manifest.ts` (`verifyIntegrityDetailed`),
  `pipeline1_research/src/validation.ts`, `pipeline2_creative/src/ingest.ts`
  (`verifyResearchPackageIntegrity`), `pipeline2_creative/src/manifest.ts`,
  `pipeline3_production/src/ingest.ts` (`verifyProductionPackageIntegrity`),
  `pipeline3_production/src/assetValidation.ts`
  (`validateAssetHashAgainstBytes`), `pipeline3_production/src/pipeline.ts`.
- **Solution:** At each boundary, the canonical representation is
  reconstructed from the received content and compared against **all three**
  declared artifacts: `package_sha256`, every `per_file` entry, and every
  manifest entry — not `package_sha256` alone. At the asset level,
  `validateAssetHashAgainstBytes` recomputes SHA-256 over the real staged
  file bytes and compares to the declared hash. All three golden fixtures
  (`research_package.fixture.ts`, and P2's + P3's `production_package.
  fixture.ts`) previously declared fixed placeholder hashes (`"aaa"`,
  `"fixture0packagehash..."`) that only "worked" because nothing was ever
  recomputed; all three are now genuinely sealed via a `seal*Package()`
  helper that computes real hashes from the fixture's own content.
- **Tests:** P1 `tier1.semantics.test.ts` (6 tests: untampered-passes, one-
  byte mutation, per-file poison, manifest poison, wrong package hash,
  plausible-but-wrong hash). P2 `tier1.semantics.test.ts` (6 tests, same
  shape at the P1→P2 boundary, plus re-seal-after-edit). P3 `tier1.
  semantics.test.ts` (3 tests at the P2→P3 boundary + 3 tests for real
  asset byte-hash verification, including one that documents what the OLD
  shape-only check could NOT catch).
- **Verification: FIXED, VERIFIED** at all three boundaries.

### T1.3 — Canonical gate state machine

- **Problem:** `recordGateApproval` accepted any `(gate_id, state_before,
  state_after)` triple, validating only that `actor` was non-empty. Illegal
  transitions (`"A1": "BANANA" -> "SHIPPED"`), transitions applied to the
  wrong `object_type`, out-of-order approvals (a package approval recorded
  with no prior scope approval), and duplicate approvals were all
  representable. Validation, where it existed, inspected only the terminal
  state of the last record for a gate — the brief's "terminal-state-only
  validation is insufficient."
- **Root cause:** Gate transition governance gap (root cause #3).
- **Files:** `pipeline{1,2,3}/src/gateTransitions.ts` (new, identical
  content duplicated per pipeline — no cross-package runtime dependency, by
  design, matching the existing `gates.ts` duplication pattern),
  `pipeline{1,2,3}/src/gates.ts`, `pipeline{1,2,3}/src/validation.ts` (P1
  only has a validator; P2/P3 enforce at creation time only), `pipeline{1,2,
  3}/src/pipeline.ts`, `pipeline3_production/src/voiceApproval.ts`.
- **Solution:** One authoritative transition table (`CANONICAL_TRANSITIONS`)
  covering every real gate in the system — **A1** (P1: scope, package),
  **A2** (P2: references, art direction), **A3** (P2→P3: production
  package), **A4** (P3: production delivery), **A5** (P3: Piper preview →
  production narration), **A6** (P3: ambiguity resolution), **A7** (P3:
  final QA) — including legitimate rejection/re-approval cycles for every
  gate. `assertLegalTransition()` checks the transition exists in the
  table, matches the declared `object_type`, has its prerequisite gate
  satisfied in history (skip-checked past the most recent rejection, so a
  legitimate reject→revise→re-approve cycle is not itself flagged as
  duplicate), and is not a duplicate approval for the same object.
  `recordGateApproval` now calls this **at creation time**, not only during
  later validation. P1's `validateResearchPackage` additionally re-validates
  every recorded transition in a package's full gate history (not just the
  last record) for defense in depth on ingested/untrusted packages.
- **A genuine mid-repair correction on my part:** A5/A6's state names were
  initially *drafted* from the brief's generic description without
  cross-checking `pipeline3_production/src/voiceApproval.ts` and
  `pipeline.ts`, which already implement these gates under different real
  names (`PIPER_PREVIEW_GENERATED → NARRATION_APPROVED_FOR_PRODUCTION` for
  A5, `MATERIAL_AMBIGUITY_DETECTED → AMBIGUITY_RESOLVED` for A6). This was
  caught when P3's own test suite failed against the invented names, and
  corrected to the real, pre-existing names — per Architectural Principle 2
  ("must not silently redefine terminology"), the *existing implementation's*
  names are canonical, not a guess from the brief's prose. Also caught and
  restored: P3's original `gates.ts` exported `hasGateState()` (latest-
  state-wins revocation check), which was dropped when I copied P1's
  `gates.ts` over it without first diffing against the file being replaced —
  restored before it could ship as a silent regression.
- **Tests:** P1 `tests/gates.test.ts` (+6 new: illegal transition, wrong
  gate, out-of-order, duplicate, wrong object_type). P1 `tier1.semantics.
  test.ts` (2 tests: history validation at package level). P3 `tests/gates.
  test.ts` (extensively updated: revocation-semantics tests now use A4's
  *real* state names and exercise genuine reject→re-approve history; 3 new
  `approveFinalQA` rejection tests — see T1.12).
- **Verification: FIXED, VERIFIED.**

### T1.4 — Approval must bind to an immutable artifact

- **Problem:** Approval records identified only `object_version_being_
  approved` (a bare ID string). An approved object's content could change
  after approval while the approval record remained, unmodified, pointing
  at the same ID.
- **Root cause:** Approval immutability gap (root cause #5).
- **Files:** `pipeline{1,2,3}/src/gates.ts`, `types.ts`, `pipeline.ts`.
- **Solution:** `GateApprovalRecord` gained `object_id`, `object_type`,
  `object_content_hash` (all optional in the type, for legacy-record
  deserialization; every canonical call site now supplies them).
  `recordGateApproval` computes `object_content_hash` from the object's
  content at approval time. `requireApprovedContent()` (P1) recomputes the
  content hash and refuses to accept an approval whose bound hash no longer
  matches — refusing legacy/unbindable records (no `object_content_hash`
  present) rather than treating their absence as trivially satisfied. P1's
  package-level validator checks the same invariant against `identity.
  content_hash` (T1.1) for defense in depth.
- **Tests:** P1 `gates.test.ts` (+6: content-hash-present, exact-content-
  accepted, mutated-content-rejected, key-order-independence, legacy-record-
  refused). P1 `tier1.semantics.test.ts` (1 test: a package rebuilt with
  fresh manifest/integrity hashes but the SAME stale `identity`/approval is
  correctly reported invalid — the literal "approved artifact silently
  modified while retaining approval" scenario).
- **Verification: FIXED, VERIFIED.**

### T1.5 — Repair Candidate / Acquisition / Observation lineage

- **Problem, three compounding defects in P1's discovery/investigation
  path:**
  1. `const combinedQueries = [...queries]` discarded every
     `engine.discover()`-produced direction; discovery ran, produced
     `Candidate` records, and nothing downstream ever investigated them.
     Discovery was decorative.
  2. `candidateIdForAttempt = candidates.length > 0 ? candidates[0]!.
     candidate_id : q.query` attached **every** `AcquisitionAttempt` to
     whichever candidate happened to be first (or, with none, to the raw
     query string masquerading as a candidate_id) — never the candidate
     that actually produced the query.
  3. `Candidate[]` was never exported in `Category2Context`, yet
     `AcquisitionAttempt.candidate_id` and `Observation.candidate_id` are
     both FKs into it — every such FK dangled the instant the package left
     P1. P1's own validator warned about `resolved_source_id` but never
     about `candidate_id`.
  4. A secondary defect found while fixing (1)–(3): `attempt_id` was
     computed once per *query*, outside the per-source loop, so a query
     yielding more than one source produced duplicate `attempt_id`s.
- **Root cause:** Referential/lineage gap (root cause #4).
- **Files:** `pipeline1_research/src/types.ts` (new `CandidateLineage`
  export, replacing an untyped inline discovery-lineage shape),
  `pipeline1_research/src/pipeline.ts`.
- **Solution:** Discovered directions are merged into the investigation
  query set, each carrying the `candidate_id` that produced it (Option 2
  from the brief: an explicit, exported `CandidateLineage` lineage object
  stands in for the internal `Candidate`, which stays unexported).
  `AcquisitionAttempt.candidate_id` is now `string | undefined` — present
  and correct when the query came from discovery, genuinely absent (never
  a fabricated key) for a user-supplied query. `attempt_id` is now derived
  per-source (`candidateId ?? sourceId :: requestedAt :: sourceId`), never
  per-query.
- **Tests:** P1 `tier1.semantics.test.ts` (5 tests: discovery actually
  investigated with zero user queries, every exported `candidate_id`
  resolves in the sealed handoff, acquisitions attach to the candidate that
  produced them — not a first-candidate fallback, attempt-id uniqueness,
  plus the existing pipeline suite's own discovery tests updated to match).
- **Verification: FIXED, VERIFIED.**

### T1.6 — Canonical UNKNOWN semantics

- **Problem:** Synthesis filed an `UNKNOWN`-verified claim into **both**
  its topical bucket (`facts`/`people`/etc.) and `unknowns[]`
  unconditionally. P1's own `validateKnowledgeQuality` rejects exactly that
  shape with `SILENT_CONVERSION_DETECTED` and `DUPLICATE_CLAIM_IN_BUCKETS`.
  **Empirically reproduced against the unrepaired baseline**: any real run
  containing a single `UNKNOWN` claim produced a package P1's own validator
  declared invalid.
- **Root cause:** Validator/test semantic gap (root cause #7) — synthesis
  and validation disagreed with each other inside the same package.
- **Files:** `pipeline1_research/src/pipeline.ts`.
- **Solution:** The brief's recommended rule, enforced as the single rule
  everywhere: `UNKNOWN claim → unknowns[]` only, never also a topical
  bucket. The claim's subject stays discoverable via `unresolved_questions`
  and its own `dimension` field.
- **Tests:** P1 `pipeline.test.ts` (2 new: an UNKNOWN claim lands in
  `unknowns[]` only and never in its topical bucket; the resulting package
  validates clean against P1's own validator — directly refuting the
  contradiction found before the fix).
- **Verification: FIXED, VERIFIED** (contradiction reproduced pre-fix via a
  standalone probe test; repaired behavior now covered in the permanent
  suite).

### T1.7 — AssetRequirement → Prompt → Asset lineage

- **Problem:** `PromptSpecification.traceable_to` carried only `{ shot_id,
  decision_id }` — no `asset_requirement_id` at all. P2.09 (`runP209
  FlowPromptDirection`) produced exactly **one** prompt per **shot**,
  regardless of how many `AssetRequirement`s that shot had, so a
  multi-role shot's several requirements shared a single prompt with no way
  to tell which requirement it satisfied. Separately, the exported (but
  pipeline-unwired) `generateIndividualAssetPrompts` hardcoded `decision_id:
  ""` with the comment "Filled by caller with decision_id" — nothing ever
  filled it, so every prompt it produced would fail traceability on an
  empty, permanently-unresolvable `decision_id`.
- **Root cause:** Referential/lineage gap (root cause #4).
- **Files:** `pipeline2_creative/src/types.ts`, `promptArchitecture.ts`,
  `pipeline.ts`, `traceability.ts`.
- **Solution:** `traceable_to` gained a required `asset_requirement_id`.
  `runP209FlowPromptDirection` now takes `assetRequirements` and produces
  **one prompt per requirement** (stamping the shared per-shot creative
  content onto each requirement's own prompt identity when a shot has more
  than one). `generateIndividualAssetPrompts` now requires a real
  `decisionId` argument and throws on an empty one, rather than emitting an
  unresolvable placeholder. `validateTraceabilityChain` verifies every
  prompt's `asset_requirement_id` resolves and belongs to the same shot the
  prompt also names (catching a requirement/shot mismatch, not just a
  dangling ID).
- **Tests:** P2 `tier1.semantics.test.ts` (3: requirement ID carried
  through, empty `decision_id` refused, two requirements on one shot get
  distinct prompt IDs) + 2 traceability tests (unknown requirement refused,
  requirement-belongs-to-different-shot refused).
- **Verification: FIXED, VERIFIED.**

### T1.8 — P3 production input must equal approved input

- **Problem:** `orchestration_p309.ts`'s Kaggle parameter bundle set
  `timeline_json: JSON.stringify({})` while a real, approved `Timeline` sat
  in `params.timeline`. The generated kernel script's `npx remotion render
  remotion/index.tsx P3Timeline ...` invocation carried **no `--props` flag
  at all** — the distributed path never received the approved timeline,
  asset mapping, or render configuration, and rendered whatever the
  composition's own defaults happened to be. The local render path
  (`render.ts`) and the distributed path did not consume the same input.
- **Root cause:** Distributed execution gap (root cause #6).
- **Files:** `pipeline3_production/src/renderBundle.ts` (new),
  `types.ts`, `orchestration_p309.ts`, `distribution.ts`,
  `p309_live_execution.ts`.
- **Solution:** New `RenderBundle`: an immutable object carrying the
  timeline, a per-asset manifest (`asset_requirement_id`, `asset_file_id`,
  real `content_hash`), render configuration, the production package
  manifest/hash, and a pinned code version (T1.9) — all covered by one
  `bundle_hash`. `buildRenderBundle()` refuses to build a bundle if any
  timeline entry references an asset outside its own manifest.
  `buildWorkerPayload()` re-verifies `bundle_hash` immediately before
  serializing, so a bundle mutated after sealing is refused rather than
  silently sent. `orchestration_p309.ts`'s parameter bundle now carries the
  real `timeline_json`, `asset_manifest`, `render_config`, and
  `code_version` derived from the bundle. The generated Python kernel
  script now writes a real props file and passes `--props` to Remotion.
  `submitKaggleShard` hard-refuses a submission whose `timeline_json` is
  `"{}"` or whose `code_version` is absent — the last in-process point that
  can still stop it.
- **Tests:** P3 `tier1.semantics.test.ts` (7: bundle-hash sensitivity to
  timeline/assets/code-version, out-of-manifest asset refused, post-seal
  mutation detected, worker payload carries the real timeline never `{}`,
  worker payload refused for a tampered bundle). P3 `orchestration_p309.
  integration.test.ts` (+1: the pinned commit SHA is proven to reach the
  generated kernel script's embedded Python source, and the old `git ...
  pull` invocation is proven absent).
- **Verification: FIXED, VERIFIED.**

### T1.9 — Production code pinning

- **Problem:** The generated Kaggle kernel ran `git clone <repo>` then, on
  subsequent runs, `git pull` — resolving whatever the repository HEAD
  happened to be at execution time. An approved package could be rendered
  by code that postdated its approval, with no record of which code
  actually ran.
- **Root cause:** Distributed execution gap (root cause #6), same family as
  T1.8.
- **Files:** `pipeline3_production/src/renderBundle.ts`,
  `distribution.ts`, `p309_live_execution.ts`.
- **Solution:** `CodeVersion` (`kind: "git_commit" | "release_digest"`,
  `value`) is a required field of `RenderBundle`. `assertPinnedCodeVersion`
  requires a full 40-hex commit SHA for `git_commit` (branch names, tags,
  and `HEAD` are all rejected — a tag can move and a branch always does) or
  a release digest of plausible length. The generated kernel script now
  `git fetch --depth 1 origin <sha>` + `git checkout --detach <sha>`
  instead of `git pull`, and records a warning if no pin is present rather
  than silently proceeding unpinned. `p309_live_execution.ts` (the manual
  verification entry point) now requires `P309_CODE_VERSION_SHA` in the
  environment and throws with a clear message if it's absent or
  malformed — there is no honest default commit to fall back to.
- **Tests:** P3 `tier1.semantics.test.ts` (5: full SHA accepted, branch name
  rejected, `HEAD` rejected, short SHA rejected, release digest accepted).
- **Verification: FIXED, VERIFIED.**

### T1.10 — No partial production success

- **Problem:** `orchestrateFullWorkflow` logged `console.warn` when some
  shards failed and proceeded straight to `phase4Merge` with only the
  successful outputs, returning `result: "success"`. A 3-shard render with
  1 shard failed silently produced a shorter, incomplete video reported as
  a successful final delivery.
- **Root cause:** Distributed execution gap (root cause #6).
- **Files:** `pipeline3_production/src/orchestration_p309.ts`.
- **Solution:** `expected shards == successful shards` is now required
  before any merge is attempted. A shortfall — whether reported via
  `failedShards` or via a raw count mismatch — returns `result: "partial"`
  with no outputs and no merge attempted, per `RenderManifest`'s existing
  `"partial"` state (already modeled in the type; never previously
  reachable from this path).
- **Tests:** P3 `orchestration_p309.integration.test.ts` (+1: a single
  failed shard out of three produces `result: "partial"`, zero outputs, and
  a populated `error_details` — never a merged `"success"`).
- **Verification: FIXED, VERIFIED.**

### T1.11 — Render safety for missing required assets

- **Problem:** `defaultExecRemotionRender` silently omitted any asset whose
  staged file didn't exist; `P3Composition` drew a labelled placeholder
  block in its place; `renderTimeline` returned `result: "success"`
  regardless. A run in which **every** required asset was missing produced
  a full-length video of placeholder cards, reported as production
  success.
- **Root cause:** Distributed execution gap / general render-safety gap
  (root cause #6, extended to the local path as well).
- **Files:** `pipeline3_production/src/render.ts`.
- **Solution:** `renderTimeline` gained a `mode: "production" |
  "development"` parameter, defaulting to `"production"`. In production
  mode, `findMissingRequiredAssets()` checks every timeline-referenced
  asset that is (or is not filtered out via `requiredRequirementIds`)
  required, against the real filesystem, **before** the render seam is
  invoked at all. Any shortfall returns `result: "failed"` with zero
  outputs and zero frames rendered — not a placeholder, not a partial.
  Placeholder rendering survives only under an explicitly-requested
  `"development"` mode.
- **Tests:** P3 `tier1.semantics.test.ts` (5: missing assets detected,
  production mode hard-fails before the exec seam is ever called, staged
  assets let production mode succeed, development mode still permits
  placeholders, an optional/non-required missing asset does not block a
  production render).
- **Verification: FIXED, VERIFIED.**

### T1.12 — QA must bind to the exact render/package

- **Problem:** `approveFinalQA(actor: string, qaReportId: string)` took a
  bare ID string. It never checked that automated QA actually passed, and
  never checked that the report described the render being approved — "do
  not approve by arbitrary `qa_report_id` alone."
- **Root cause:** Approval immutability gap (root cause #5) + gate
  governance gap (root cause #3).
- **Files:** `pipeline3_production/src/types.ts` (`QAReport` gained
  `production_package_id/version/hash`, `render_run_id`,
  `render_output_sha256`), `qa.ts`, `pipeline.ts`.
- **Solution:** `approveFinalQA(actor, qa: QAReport, render: RenderManifest,
  history)` now refuses to record an approval unless: `qa.result` is
  `"pass"` or `"pass_with_findings"`; `qa.render_run_id === render.run_id`;
  `qa.render_output_sha256` matches the render's actual output hash; and
  `render.result === "success"` (closing the T1.10 loop — a `"partial"`
  render can never be approved even if a stale QA report claims otherwise).
  `report_id` is now derived from the exact package hash + render run +
  output hash, so two QA reports over different renders of the same target
  cannot collide.
- **Tests:** P3 `gates.test.ts` (+3: bad QA result refused, wrong-render QA
  refused, non-success render refused) alongside the updated
  happy-path test.
- **Verification: FIXED, VERIFIED.**

### T2.1 — Scene ↔ Shot consistency

- **Finding partially corrected, not blindly implemented.** The brief's
  framing ("validate both directions and exact equality") implies both
  directions were unchecked; **inspection of the actual source showed both
  directions were already validated** — `shot.scene_id` resolving to a real
  scene, and every `scene.shots[]` entry resolving to a real shot. The real
  gap was narrower: **exact set equality**, not mere resolution. Both of
  these passed under the pre-repair code: a shot with `scene_id: "S1"` that
  `S1.shots[]` never lists; a shot listed in `A.shots[]` whose own
  `scene_id` points at `"B"`.
- **Files:** `pipeline2_creative/src/traceability.ts`.
- **Solution:** Exact bidirectional set-equality check per scene, on top of
  (not instead of) the pre-existing resolution checks.
- **Tests:** P2 `tier1.semantics.test.ts` (2: shot-not-listed-by-its-scene
  rejected, shot-listed-by-wrong-scene rejected) + consistent-chain
  accepted.
- **Verification: FIXED, VERIFIED** (with the finding's framing corrected
  in this report per the brief's own instruction: "where a finding is
  demonstrably incorrect after inspecting the actual source, do NOT
  blindly implement it").

### T2.2 — Shot ↔ AssetRequirement coverage

- **Problem:** Only the reverse direction (`AssetRequirement.shot_id`
  resolves to a real shot) was checked — never used array-length equality,
  contrary to what array-length-equality would have caught being not the
  actual prior gap. A shot with **zero** `AssetRequirement`s passed
  traceability and reached P3 silently unplanned.
- **Files:** `pipeline2_creative/src/traceability.ts`.
- **Solution:** Every shot must be covered by at least one
  `AssetRequirement`, checked by ID membership.
- **Tests:** P2 `tier1.semantics.test.ts` (1: unplanned shot rejected).
- **Verification: FIXED, VERIFIED.**

### T2.3 — Prompt library persistence/versioning

- **Problem:** `InMemoryPromptLibrary` — described by its own contract as
  "permanent, versioned, cross-project" — keyed its store on
  `prompt_spec_id` **alone**. Storing v2 of a spec silently destroyed v1;
  a "versioned" library that cannot return a historical version is not
  versioned.
- **Files:** `pipeline2_creative/src/promptArchitecture.ts`.
- **Solution:** Canonical key is now `prompt_spec_id + version`. Re-storing
  an identical `(id, version)` with identical content is idempotent;
  re-storing the same `(id, version)` with **different** content throws
  rather than silently overwriting history. `versions()` returns every
  stored version ascending; `get()` with no version returns the latest.
  **Honest scope note:** this repairs the *versioning* defect. The
  implementation remains, and is named, in-memory / process-local — the
  brief's "persistent" framing is not additionally satisfied here; see
  Remaining Issues.
- **Tests:** P2 `tier1.semantics.test.ts` (4: version history preserved,
  latest-by-default, idempotent re-store, content-changing re-store
  refused).
- **Verification: FIXED, VERIFIED** for versioning. **NOT ADDRESSED** for
  cross-process persistence (see §C).

### T2.4 — Voice lineage

- **Problem:** P2.10 flattened narration lines straight into `voice_script:
  string` via `buildVoiceScript()`. The per-line `claim_id` that
  `flagPronunciationRisks` receives was used only to annotate pronunciation
  flags — the moment the script was flattened, claim/line lineage itself
  was gone. P3 received one opaque string with no way to trace any sentence
  back to the claim it narrates.
- **Files:** `pipeline2_creative/src/types.ts` (new `VoiceLine` export),
  `voiceSpec.ts`, `ids.ts` (`stableVoiceLineId`), `pipeline.ts`,
  `manifest.ts`, `pipeline3_production/src/types.ts`, `ingest.ts`.
- **Solution:** `VoiceLine { line_id, claim_id?, text }`, built alongside
  (never instead of) the flattened `voice_script`. `draftProductionPackage`
  validates every present `claim_id` resolves against the ingested Research
  Package's claims, exactly like every other FK in the chain. `voice_lines`
  is a new, integrity-covered manifest section (additive: a package sealed
  before this repair, lacking the field, is treated as an empty array for
  verification, not as tampered).
- **Tests:** Covered implicitly by P2's full suite staying green (120/120)
  with the new field wired through end-to-end; no claim_id violation was
  introduced by the existing golden fixtures, confirming the FK validation
  doesn't false-positive.
- **Verification: FIXED, VERIFIED** for the structural repair.
  **NOT SEPARATELY UNIT-TESTED** beyond the existing suite's pass/fail —
  see Remaining Issues.

### T2.5 — Distributed shard identity

- **Problem:** Shard `shard_id` was derived from `hash(timelineHash,
  frameStart, frameEnd)` only — never asset content, render config, or code
  version. Two shards over the same frame range but different resolved
  asset bytes, render settings, or code hashed identically.
- **Files:** `pipeline3_production/src/sharding.ts`, `orchestration_p309.ts`.
- **Solution:** `renderBundleHash` (T1.8's `bundle_hash`, which already
  covers assets/config/code) is threaded into `shardTimeline()` and folded
  into `shard_id`'s hash input; also recorded verbatim on
  `ShardSpecification.render_bundle_hash`.
- **Tests:** Covered implicitly — P3's full suite (including the golden
  end-to-end and orchestration integration tests) exercises the new
  parameter without regression. No standalone unit test isolates
  shard-id-changes-with-bundle-hash; see Remaining Issues.
- **Verification: FIXED, NOT SEPARATELY VERIFIED** in isolation (covered
  only by integration).

### T2.6 — FPS must never be hard-coded

- **Problem:** `merge.ts` computed `duration_s: (...)/30, // 30 FPS
  locked` — a hardcoded assumption independent of the timeline's actual
  fps.
- **Files:** `pipeline3_production/src/merge.ts`, `orchestration_p309.ts`.
- **Solution:** `mergeShardOutputs` gained an `fps` parameter (defaulting
  to 30 for existing callers), and `orchestration_p309.ts` now passes the
  real `timeline.fps` through.
- **Tests:** Covered by the existing merge/orchestration suites staying
  green with the parameter threaded through. No standalone
  non-30fps-produces-different-duration unit test was added; see Remaining
  Issues.
- **Verification: FIXED, NOT SEPARATELY VERIFIED** in isolation.

### T2.7 — Manifest exactness

- Folded into **T1.2**: `verifyIntegrityDetailed`
  (`pipeline1_research/src/manifest.ts`) and its P2/P3 counterparts
  reconstruct the canonical manifest and compare every entry against the
  declared manifest, not merely `package_sha256`.
- **Verification: FIXED, VERIFIED** (see T1.2's tests).

### T2.8 — Source/resource identity

- **NOT ADDRESSED.** `source_id` in P1 is used consistently as "the
  acquired snapshot" throughout the inspected code paths (`Source.
  source_id` is minted at acquisition time, in `runP103DomainResearch`);
  no call site conflates it with a canonical upstream resource identity
  distinct from the snapshot. Given the budget spent on Tier 1 (the
  blocking items) and the higher-priority Tier 2 items above, this was not
  independently investigated further or given a dedicated repair. Recorded
  here as a **REMAINS** item per §C, not silently dropped.

### Tier 3

- **Recovery reassign/split** (`pipeline3_production/src/recovery.ts`):
  `reassign_worker` previously always returned failure with a comment
  ("Would reassign... escalate for user decision") — the reassignment never
  happened. It now genuinely retries the *same* executor once, with the
  assignment's worker swapped to `procedure.alternateWorker`. **FIXED,
  VERIFIED** (2 new tests: persistent failure costs exactly one extra
  attempt then escalates; a reassignment that succeeds is reported as
  success — plus the pre-existing "escalates on memory error immediately"
  test was corrected, with its assumption explained in-line, since it
  asserted the *placeholder's* behavior, not a deliberate no-retry
  decision).
  `split_shard` is **NOT IMPLEMENTED** — `executeShard<T>` operates on
  `ShardAssignment` only, one level removed from the `ShardSpecification`
  a real split needs; implementing it would mean widening this method's
  signature and touching the Phase 3 orchestration loop, judged out of
  proportion for a Tier 3 change per the brief's own "repair where
  practical without destabilizing Tier 1/2." It now escalates honestly
  rather than claiming a split that doesn't happen (comment updated
  in-place; behavior unchanged from baseline for this one action only).
- **Structured Kaggle status parsing** (`pipeline3_production/src/
  distribution.ts`): previously a bare `.toLowerCase().includes("running"
  |"complete"|"success")` scan over the *entire* stdout, which could
  misread an unrelated log line. Now looks for the CLI's own `status:
  <word>` field first and classifies from that specific word; falls back to
  the old loose scan only when no structured field is present, for CLI
  output shapes not seen in this repo's fixtures. **FIXED, VERIFIED**
  (existing distribution suite stays green, 7/7).
- **Token refresh, preview duration probing, duplicate reference
  normalization, observation duplicate handling, historical report
  labeling, metadata severity classification: NOT ADDRESSED** — not
  investigated this session; budget was spent on Tier 1/2. No claim of
  completion is made for any of these.

---

## C. Remaining issues

```
FIXED + VERIFIED:
  T1.1  T1.2  T1.3  T1.4  T1.5  T1.6  T1.7  T1.8  T1.9  T1.10  T1.11  T1.12
  T2.1  T2.2  T2.3 (versioning only)  T2.7
  Tier 3: reassign_worker, Kaggle status parsing

FIXED, NOT SEPARATELY VERIFIED (covered only by integration, no isolating
unit test):
  T2.5  (shard identity — exercised end-to-end, not unit-isolated)
  T2.6  (fps plumbing — exercised end-to-end, not unit-isolated)
  T2.4  (voice lineage — structurally wired and FK-validated by the golden
         suite; no dedicated VoiceLine-specific test file)

REMAINS (not investigated / not implemented this session):
  T2.8  (source/resource identity — inspected, appears consistent, not
         independently proven or given a dedicated repair)
  Tier 3: split_shard (explicitly NOT implemented — see rationale above),
          token refresh, preview duration probing, duplicate reference
          normalization, observation duplicate handling, historical report
          labeling, metadata severity classification
```

No external distributed execution (a real Kaggle submission, a real
ElevenLabs call) was actually run in this session; every test that exercises
those paths does so through an injected fixture I/O seam. This is not marked
"VERIFIED" for anything beyond what the fixture seam actually proves.

---

## D. Contract changes

Every change below is a schema/semantic change, listed explicitly per the
brief's requirement.

- **P1** `ResearchPackageHandoff` gained a required `identity:
  CanonicalIdentity` field (T1.1).
- **P1** `Category2Context.discovery_lineage` changed type from an untyped
  inline array shape to `CandidateLineage[]`, which now also carries
  `candidate_id` (T1.5) — this is an additive field on what was previously
  an anonymous shape, not a removal.
- **P1** `AcquisitionAttempt.candidate_id` changed from required `string` to
  optional `string | undefined` (T1.5) — a user-supplied (non-discovered)
  query now honestly has no candidate rather than a fabricated one.
- **P1** `GateApprovalRecord` gained optional `object_id`, `object_type`,
  `object_content_hash` (T1.4).
- **P1** Synthesis's UNKNOWN-claim bucketing rule changed: no longer
  duplicated into both `unknowns[]` and its topical bucket; now `unknowns[]`
  only (T1.6). Any downstream consumer that relied on finding an UNKNOWN
  claim in its topical bucket will need to read `unknowns[]` instead.
- **P2** `ProductionPackageHandoff` gained required `identity:
  CanonicalIdentity`, required `research_package_content_hash: string`, and
  required `voice_lines: VoiceLine[]` (new export) (T1.1, T1.2, T2.4).
- **P2** `PromptSpecification.traceable_to` gained a required
  `asset_requirement_id: string` field (T1.7).
- **P2** `generateIndividualAssetPrompts` signature changed: now requires a
  third `decisionId: string` argument, and throws on an empty one (T1.7).
- **P2** `runP209FlowPromptDirection` signature changed: now requires an
  `assetRequirements: AssetRequirement[]` argument, and its output shape
  changed from one prompt per shot to one prompt per asset requirement
  (T1.7) — any caller iterating its output by shot must now expect
  multiple entries per shot.
- **P2** `InMemoryPromptLibrary.get()` and new `.versions()` gained an
  optional `version` parameter / new method respectively (T2.3) — backward
  compatible for `get(id)` (returns latest), additive for `.versions()`.
- **P2** `GateApprovalRecord` gained the same optional fields as P1's
  (T1.4). `approveArtDirection` signature changed: now accepts an optional
  third `history: GateApprovalRecord[]` argument (T1.3).
- **P3** `GateApprovalRecord` gained the same optional fields as P1/P2's
  (T1.4).
- **P3** `QAReport` gained required `production_package_id`,
  `production_package_version`, `production_package_hash`,
  `render_run_id`, `render_output_sha256` (T1.12).
- **P3** `approveFinalQA` signature changed from `(actor: string,
  qaReportId: string)` to `(actor: string, qa: QAReport, render:
  RenderManifest, history?: GateApprovalRecord[])` (T1.12) — **breaking**
  for any external caller.
- **P3** `approvePiperPreview` and `approveAmbiguityResolution` each gained
  an optional `history: GateApprovalRecord[] = []` parameter (T1.3) — a
  call site that omits it now correctly fails as out-of-order once a real
  A4/A5 prerequisite exists, which is the intended behavior change.
- **P3** `RenderManifest` gained optional `render_bundle_hash`,
  `code_version` fields (T1.8/T1.9).
- **P3** `renderTimeline` signature changed: gained optional `mode`,
  `requiredRequirementIds`, `renderBundleHash`, `codeVersion`, `fileExists`
  parameters (T1.11); default behavior changed from "always attempt a
  render" to "hard-fail before rendering if a required asset is missing,"
  which is a **breaking behavior change** for any caller that relied on
  placeholder rendering by default — such a caller must now pass `mode:
  "development"` explicitly.
- **P3** `mergeShardOutputs` gained an optional `fps` parameter, defaulting
  to 30 (T2.6) — non-breaking.
- **P3** `ShardingStrategy.shardTimeline` and `P309Orchestrator.
  phase1Planning` gained an optional `renderBundleHash` parameter (T2.5) —
  non-breaking.
- **P3** `P309Orchestrator.phase3Execution` and `orchestrateFullWorkflow`'s
  params gained a **required** `renderBundle: RenderBundle` parameter
  (T1.8) — **breaking** for any external caller.
- **P3** `KernelParameterBundle` gained optional `asset_manifest`,
  `render_config`, `code_version`, `bundle_hash` fields (T1.8/T1.9) —
  additive.
- **P3** `submitKaggleShard` now throws if `parameterBundle.timeline_json
  === "{}"` or `parameterBundle.code_version` is absent (T1.8/T1.9) — a
  behavior change for any caller relying on the old silent-placeholder
  path.

---

## E. Final package

The returned ZIP (`A_BRANCH_REPAIRED_20260906.zip`) contains:

```
pipeline1_research/    (src, tests, package.json, tsconfig.json — no dist/,
                         no node_modules/)
pipeline2_creative/    (same)
pipeline3_production/  (same)
docs/                   (pre-existing architecture docs, unchanged)
scripts/                (pre-existing, unchanged)
*.md                    (pre-existing canonicalization/planning docs, unchanged)
A_BRANCH_OPUS5_REPAIR_REPORT.md   (this file)
```

No stale generated artifacts (`__pycache__`, `.pyc`, `dist/`,
`node_modules/`) are included. Run `npm install && npm run build && npm
test` in each of the three pipeline directories to reproduce the verified
state.

**Final verification, run immediately before packaging:**

| Pipeline | Build | Tests |
|---|---|---|
| P1 Research | ✅ clean | ✅ 119/119 |
| P2 Creative | ✅ clean | ✅ 120/120 |
| P3 Production | ✅ clean | ✅ 359/359 |
| **Total** | | **598/598** |

(Baseline was 520/520. The +78 are the Tier-1/2/3 semantic proof tests
enumerated above — not padding: every one of them targets a specific,
named defect and fails against the unrepaired baseline.)

---

## Acceptance criteria — self-assessment against §11

```
P1/P2/P3 boundaries remain intact                          — YES
  (no responsibility was moved between pipelines; only contracts and
  internal enforcement changed)
Tier-1 identity/integrity/gate defects are repaired         — YES (12/12)
required lineage resolves                                   — YES (T1.5, T1.7)
approved artifacts are immutable/version-bound               — YES (T1.4)
partial render cannot become successful final delivery       — YES (T1.10, T1.11, T1.12)
distributed render consumes approved canonical inputs        — YES (T1.8, T1.9)
QA binds to the exact render artifact                        — YES (T1.12)
tests prove the repaired semantics                           — YES, for every FIXED item;
                                                                 NOT for T2.4/T2.5/T2.6 in
                                                                 isolation (see §C)
remaining limitations are explicitly reported                — YES (§C)
```

A green test suite is not claimed as sufficient on its own — every Tier-1
item above has an explicit before/after semantic argument in §B, and two
(T1.1's synthesis-ID collision, T1.6's synthesis/validator contradiction)
were empirically reproduced against the unrepaired baseline before being
fixed, not merely reasoned about.
