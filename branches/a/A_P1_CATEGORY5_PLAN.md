# A_P1_CATEGORY5_PLAN.md

**P1 Category 5: Governance & Handoff — Design Lock (PLAN MODE ONLY)**

**Date:** 2026-09-03  
**Phase:** Design Lock  
**Status:** 🟡 PLAN MODE ONLY — Designing C5 governance boundary  
**Deliverable:** A_P1_CATEGORY5_PLAN.md  
**Mode:** PLAN ONLY — no implementation, no code changes, no commits

---

## TASK AUTHORITY

This plan specifies P1 Category 5 (Governance & Handoff).

**Active task:** Design minimal C5 that validates package completeness, consistency, and safety for A→B handoff without assuming B responsibilities.

---

## CURRENT A/P1 BASELINE

| Component | Status | Ownership |
|-----------|--------|-----------|
| C1 (Intake & Scope) | ✅ FROZEN | Not in this task |
| C2 (Discovery & Acquisition) | ✅ COMPLETE | P1.03 (implementation done) |
| C3 (Evidence & Verification) | ✅ COMPLETE | P1.04 (implementation done) |
| C4 (Synthesis & Knowledge) | ✅ COMPLETE | P1.05/06 (implementation done) |
| **C5 (Governance & Handoff)** | 🟡 DESIGN LOCK | **CURRENT TASK** |
| P1.06 Handoff | ✅ LIVE | draftHandoff() & approvePackage() exist |
| P1.07 Handoff | ✅ LIVE | ResearchPackageHandoff (frozen structure) |

---

## LIVE C5 ANATOMY

### 1. Current Handoff Structure (draftHandoff function)

**Handoff Output Type:** `ResearchPackageHandoff` (14 frozen fields + optional C2 extension)

```typescript
interface ResearchPackageHandoff {
  // Identity & versioning (4 fields)
  package_id: string;                   // Deterministic hash of scope + claims
  schema_version: "1.0.0";              // Frozen for this era
  project_id: string;                   // From research scope
  
  // Integrity (2 fields)
  manifest: ManifestEntry[];            // Per-section hashes
  integrity_hashes: IntegrityHashes;    // package_sha256 + per_file hashes
  
  // Core research data (5 fields)
  research_scope: ResearchScope;        // Approved scope (frozen)
  sources: Source[];                    // Acquired sources
  evidence: Evidence[];                 // Extracted evidence
  claims: Claim[];                      // Dimension-classified claims
  verifications: Verification[];        // Verification verdicts
  
  // Synthesized knowledge (2 fields)
  knowledge_package: KnowledgePackage;  // 18-dimensional structure
  unresolved_questions: string[];       // Open questions for follow-up
  
  // Governance (1 field)
  gates: GateApprovalRecord[];          // Human approval records
  
  // Handoff metadata (1 field)
  handoff_notes: string;                // Machine-readable notes for P2
  
  // Optional C2 extension (not included if not provided)
  category_2_context?: Category2Context;  // Discovery/acquisition/observations
}
```

### 2. Current Gate System (Gate A1)

**Gate A1: Package Approval**
- Transition 1: `SCOPE_PROPOSED` → `SCOPE_APPROVED` (in P1.02)
- Transition 2: `PACKAGE_DRAFTED` → `PACKAGE_APPROVED` (in P1.07)
- Unlock: "Pipeline 2 may consume this Research Package"

**Gate Mechanics:**
- `recordGateApproval()`: Creates immutable approval record with timestamp, actor, state transition
- `requireGateState()`: Enforces gate state before proceeding (upstream to P2)
- Gate state is the LATEST transition in chronological order

**Current Requirement:** `requirePackageApproved()` checks Gate A1 = "PACKAGE_APPROVED"

### 3. Current Integrity Mechanism

**Manifest & Integrity:**
- 8 named sections hashed individually (research_scope, sources, evidence, claims, verifications, knowledge_package, unresolved_questions, handoff_notes)
- Each section hash canonicalized (JSON with sorted keys)
- Package hash = SHA-256(manifest entries sorted by path)
- Self-reference avoided: package_sha256 never includes itself in computation

**Verification Function:** `verifyIntegrity(sections, integrity)` returns boolean

**C2 Extension Note:** category_2_context NOT included in current manifest/integrity computation. **Question for C5:** Should it be?

### 4. Current C4 Metadata (SynthesisMetadata)

Returned by `runP105And106Synthesis()`:

```typescript
interface SynthesisMetadata {
  synthesis_run_id: string;         // Deterministic content hash
  synthesis_timestamp: string;      // Execution time (ISO 8601)
  verified_facts_count: number;     // Claims with status=VERIFIED
  inferred_facts_count: number;     // Claims with status=INFERRED
  unknown_count: number;            // Claims with status=UNKNOWN
  contradictions_count: number;     // Claims with contradiction_refs.length > 0
  total_claims: number;             // All claims examined
}
```

**Current Status:** Returned from P1.05/06 but NOT currently included in handoff. **Question for C5:** Should metadata travel in handoff?

### 5. Current C2 Optional Context (Category2Context)

Optionally provided to `draftHandoff()`:

```typescript
interface Category2Context {
  acquisition_history: AcquisitionAttempt[];  // Provider fallback chain
  observations: Observation[];                // Point-in-time metrics
  discovery_lineage: Array<{                  // How sources were found
    topic: string;
    discovery_method: string;
    discovery_provider: string;
    discovery_rationale: string;
  }>;
}
```

**Current Status:** Optional in handoff; Candidate[] explicitly NOT exported. Preserved for B diagnostics.

### 6. Validation Currently Exists (C3 Level)

**assertClaimHasProvenance(claim, verification):**
- Enforced: claim.evidence_refs.length > 0 OR (status=UNKNOWN AND unresolved_reason exists)
- Throws ValidationError if violated
- Called during P1.04 verification

**NOT Currently Validated by C5:**
- Referential integrity (do all evidence_ids exist?)
- Do all claim_ids referenced exist?
- Do all verification_ids match claims?
- Is manifest hash accurate?
- Is package_sha256 accurate?
- Is synthesis_run_id correctly computed?
- Is knowledge_package correctly sorted?

---

## C5 RESPONSIBILITY

### What C5 MUST Validate (Structural Completeness)

**Package Presence:**
- ✅ All 14 required fields present (except optional category_2_context)
- ✅ No null/undefined required fields
- ✅ schema_version = "1.0.0"
- ✅ package_id is non-empty string
- ✅ project_id matches scope.project_id

**Referential Integrity (Evidence Chain):**
- ✅ Every claim.evidence_refs[i] has matching Evidence with evidence_id
- ✅ Every Evidence.source_id has matching Source with source_id
- ✅ No orphaned evidence references

**Verification Consistency:**
- ✅ Every Verification.claim_id has matching Claim with claim_id
- ✅ No orphaned verification records
- ✅ Verification.status ∈ {VERIFIED, INFERRED, UNKNOWN}
- ✅ If status=UNKNOWN, unresolved_reason must be non-empty string

**Knowledge Quality (No Silent Conversions):**
- ✅ VERIFIED claims are bucketed in topical dimensions
- ✅ INFERRED claims are bucketed in topical dimensions
- ✅ UNKNOWN claims are in unknowns bucket (and NOT in topical buckets)
- ✅ CONTRADICTION claims (with contradiction_refs.length > 0) are in contradictions bucket
- ✅ No claim appears silently converted (UNKNOWN→VERIFIED, etc.)

**Provenance Chains:**
- ✅ claim.derived_from points to valid ResearchScope question/dimension
- ✅ claim.contradiction_refs[i] points to existing claim_id
- ✅ All contradiction relationships are mutual or documented as one-way

**Knowledge Package Integrity:**
- ✅ All 15 topical dimensions contain only Claim objects with matching claim_ids
- ✅ contradictions bucket contains only claims with contradiction_refs.length > 0
- ✅ unknowns bucket contains only claims with UNKNOWN verification status
- ✅ unresolved_questions array non-empty if knowledge_package.unknowns.length > 0
- ✅ No claim appears in multiple dimensions

**Synthesis Metadata (if present in C4 flow):**
- ✅ synthesis_run_id is non-empty string (format: syn_*)
- ✅ synthesis_timestamp is valid ISO 8601
- ✅ Counts sum correctly: verified + inferred + unknown ≤ total_claims
- ✅ contradictions_count ≤ total_claims
- ✅ Counts match actual knowledge_package content

**C2 Context (if provided):**
- ✅ Every AcquisitionAttempt.candidate_id corresponds to valid discovery flow
- ✅ Resolved AcquisitionAttempt.resolved_source_id points to existing Source
- ✅ Every Observation.source_id points to existing Source
- ✅ Observation timestamps are valid ISO 8601
- ✅ No circular acquisition chains

**Gates:**
- ✅ At least one gate record with gate_id = "A1"
- ✅ Latest Gate A1 record has state_after = "PACKAGE_APPROVED"
- ✅ Gate actor is non-empty string
- ✅ Gate timestamp is valid ISO 8601
- ✅ package_id matches object_version_being_approved in latest approval

**Manifest & Integrity:**
- ✅ manifest.length = 8 (one entry per section)
- ✅ manifest sorted by path
- ✅ All paths start with "handoff/"
- ✅ Per-section hashes are valid SHA-256
- ✅ Package SHA-256 computes correctly from manifest
- ✅ Recomputed integrity matches stored integrity_hashes

### What C5 Must NOT Do (Defer to B)

**NOT C5 Responsibility:**
- ✗ Evaluate strategic value of research
- ✗ Recommend which channel to use
- ✗ Decide content adoption
- ✗ Rank findings by importance
- ✗ Suggest editorial approach
- ✗ Assess production feasibility
- ✗ Estimate timeline or cost
- ✗ Build relationship graphs
- ✗ Cross-check with other channels/disciplines
- ✗ Score knowledge by reusability

**Those are B (Strategy) responsibilities.**

---

## VALIDATION LOGIC

### Blocking Conditions (MUST FAIL)

These prevent handoff approval:

1. **Referential Integrity Failure**
   - Evidence references missing Source
   - Verification references missing Claim
   - Claim references missing Evidence (unless UNKNOWN with unresolved_reason)

2. **Gate Failure**
   - Gate A1 not present in gates array
   - Latest Gate A1 state_after ≠ "PACKAGE_APPROVED"

3. **Integrity Failure**
   - Recomputed package_sha256 ≠ stored package_sha256
   - Any per-section hash mismatch

4. **Knowledge Quality Violation**
   - UNKNOWN claim in topical dimension bucket (silent conversion detected)
   - INFERRED claim treated as VERIFIED
   - Claim appears in multiple dimensions

5. **Required Field Absence**
   - Any of 14 core fields undefined/null
   - knowledge_package missing required dimension
   - unresolved_questions array missing when unknowns.length > 0

### Non-Blocking Warnings (May WARN)

These allow handoff but surface concerns:

1. **Unused Sources**
   - Source exists but not referenced by any Evidence

2. **Unused Evidence**
   - Evidence exists but not referenced by any Claim

3. **Contradiction Without Evidence**
   - Claim has contradiction_refs but no evidence_refs (allowed for UNKNOWN, else warns)

4. **Imbalanced Verification**
   - >50% of claims are UNKNOWN (data quality concern)
   - >30% of claims are contradictions (domain complexity warning)

5. **Empty Dimensions**
   - Some topical dimension buckets empty (ok if no claims fit that dimension)

6. **Large C2 Context**
   - Observation count > 1000 (potential performance concern for B)
   - Acquisition attempt count > 50 (high provider fallback activity)

### Validation Orchestration

**Function:** `validateResearchPackage(handoff: ResearchPackageHandoff): ValidationResult`

```typescript
interface ValidationResult {
  status: "valid" | "invalid" | "valid_with_warnings";
  errors: ValidationError[];        // Blocking conditions
  warnings: ValidationWarning[];     // Non-blocking concerns
  checks_run: number;                // Diagnostic count
  validation_timestamp: string;      // ISO 8601
}
```

**Responsibility:** Validates complete package against all conditions above.

---

## C4 METADATA HANDLING

### Current Issue: SynthesisMetadata Not in Handoff

`runP105And106Synthesis()` returns:
```typescript
{
  knowledge_package: KnowledgePackage,
  unresolved_questions: string[],
  synthesis_metadata: SynthesisMetadata
}
```

But `draftHandoff()` does NOT currently accept synthesis_metadata.

### Design Decision Required

**Option A: Include synthesis_metadata in handoff**
- Add to ResearchPackageHandoff as 15th frozen field
- Include in manifest/integrity
- B receives reproducibility info (synthesis_run_id, timestamps, counts)
- Pros: Complete reproducibility tracking, versioning support
- Cons: Changes frozen contract (but optional field avoids breaking)

**Option B: Keep synthesis_metadata separate (internal only)**
- Leave in P1 internal state; do NOT handoff
- B can compute its own knowledge confidence from verification counts
- Pros: Simpler contract, no extension needed
- Cons: B loses audit trail, reproducibility verification harder

**Recommendation:** Option A (include as optional field)
- Preserves frozen contract (14 required + 1 optional existing + 1 new optional)
- Supports multi-run versioning
- Minimal risk (purely additive)
- C5 can validate synthesis_metadata.counts match knowledge_package content

**Action for C5 Design Approval:**
- Decide: Should synthesis_metadata be included in handoff?

---

## C2 CONTEXT IN MANIFEST

### Current Issue: category_2_context Not Hashed

`buildManifestAndIntegrity()` hashes 8 sections; category_2_context is NOT included.

### Design Decision Required

**Option A: Add category_2_context to manifest (if present)**
- Hash category_2_context as 9th section (conditional)
- Package hash includes C2 data
- Pros: Full package integrity
- Cons: Hash changes if C2 context added/removed

**Option B: Keep category_2_context outside manifest**
- Remains optional data not covered by integrity check
- Pros: C2 is optional; integrity hash stable
- Cons: B can't verify C2 data hasn't been tampered with

**Recommendation:** Option B (keep outside manifest)
- C2 context is optional diagnostic data
- Core research (sources, evidence, claims, verifications) integrity sufficient
- If B needs C2 integrity, separate hash can be computed
- Simpler for Phase 1

**Action for C5 Design Approval:**
- Confirm: category_2_context stays outside manifest?

---

## HANDOFF SEQUENCE & GATES

### Current Sequence

```
P1.01 (Input)
  ↓
P1.02 (Scope Proposal)
  ↓ recordGateApproval (Transition 1: SCOPE_PROPOSED → SCOPE_APPROVED)
  ↓
P1.03 (Domain Research)
  ↓
P1.04 (Verification)
  ↓
P1.05/06 (Synthesis)
  ↓
P1.07 (Handoff)
  ├ draftHandoff() → creates ResearchPackageHandoff
  ├ approvePackage() → recordGateApproval (Transition 2: PACKAGE_DRAFTED → PACKAGE_APPROVED)
  ↓
C5 (Validation) ← **NEW: PROPOSED**
  ├ validateResearchPackage() → checks structural completeness
  ├ Result: valid | invalid | valid_with_warnings
  ↓
P2 (Strategy Evaluation)
  ├ requirePackageApproved() → verifies Gate A1 state
  ↓ decision point (B evaluates channel fit, etc.)
  ↓
P3 (Production)
```

### C5 Insertion Point

**Where:** After approvePackage() in P1.07, before P2 consumes

**When:** Synchronous validation during handoff creation (not deferred)

**Who Calls:** P1.07 code (or tests) after approvePackage

**Error Handling:**
- ValidationError thrown if blocking condition detected
- ValidationWarning collected if non-blocking concern surfaces
- Both returned in ValidationResult for caller inspection

### Gate Integration

C5 does NOT create new gates. Uses existing Gate A1.

**Validation Confirms:**
- Gate A1 = "PACKAGE_APPROVED" before allowing P2 consumption
- Gate actor, timestamp, version all present
- Gate chain immutable (no revisions, only new records)

---

## FIRST VIDEO TEST

### Scenario: One Topic → Complete Flow

```
Input: "Time-lapse photography techniques"

P1.01: Create ResearchRequest
  └→ topic, question, objective, constraints, request_mode

P1.02: Propose & Approve Scope
  └→ ResearchScope.state = "SCOPE_APPROVED"

P1.03: Domain Research (discover sources, extract evidence)
  └→ Sources[], Evidence[], Claims[]

P1.04: Verification (verify claims, assign status)
  └→ Verifications[]

P1.05/06: Synthesis (synthesize knowledge, generate open questions)
  └→ KnowledgePackage, unresolved_questions, synthesis_metadata

P1.07: Handoff (draft & approve)
  └→ ResearchPackageHandoff

C5: Validation (structural completeness check)
  ├─ Referential integrity?
  ├─ Verification consistency?
  ├─ Knowledge quality?
  ├─ Manifest/integrity?
  ├─ Gate state?
  └→ ValidationResult { status: "valid", errors: [], warnings: [] }

P2: Strategy (B evaluates channel applicability)
  ├─ Can this research support main Tekno Polimat?
  ├─ Can this research support Science channel?
  ├─ Can this research support Technology channel?
  └→ Channel assignments + editorial priorities

P3: Production (create video, adapt content for channels)
  └→ Content artifacts
```

**C5 Validation For This Flow:**
- ✅ Package contains complete research (sources, evidence, claims, verifications)
- ✅ All evidence_refs point to valid Evidence entries
- ✅ All Evidence entries point to valid Sources
- ✅ All Verifications reference valid Claims
- ✅ Knowledge dimensions correctly populated (no silent conversions)
- ✅ Manifest/integrity valid
- ✅ Gate A1 = "PACKAGE_APPROVED"
- ✅ unresolved_questions non-empty (follow-up queries for future research)

**C5 Does NOT:**
- ✗ Decide which channel gets what content
- ✗ Evaluate strategic value
- ✗ Recommend editorial direction
- ✗ Score research quality by external metrics

---

## MULTI-CHANNEL REUSE

### Principle: One Research Package, Multiple Applications

```
P1 Research (Time-lapse Photography)
  ├─ Sources: Documentary films, scientific papers, tutorials
  ├─ Evidence: Techniques, physics, equipment, results
  ├─ Claims: Dimension-classified facts, concepts, processes
  └─ Knowledge: Synthesized 18D structure

Available for B Strategic Evaluation:
  ├─ Main Channel: "Complete overview of time-lapse as technique"
  ├─ Science Channel: "Physics of motion blur and frame rates"
  ├─ Technology Channel: "Equipment, software, post-processing workflows"
  ├─ Art Channel: "Creative applications and visual storytelling"
  └─ Education Channel: "Teaching time-lapse in workshops"
```

**C5 Responsibility:**
- ✅ Ensure ONE reusable research package created
- ✅ Verify knowledge_package structure supports multiple interpretations
- ✅ Confirm all evidence chains traceable (B can follow references)
- ✅ Validate unresolved_questions sufficient for future refinement

**NOT C5 Responsibility:**
- ✗ Split research by channel
- ✗ Rank dimensions by channel value
- ✗ Pre-select which claims for which channel
- ✗ Decide channel allocation

---

## RERUN & MAINTENANCE

### Scenario: Research Run 1 → Run 2 → Run 3

```
Run 1 (Sept 2026): Initial research on "AI Safety"
  └→ Package 1 [synthesis_run_id = syn_abc123def456, timestamp = 2026-09-03T10:00Z]

Run 2 (Oct 2026): Re-research same topic (scope updated, new sources found)
  └→ Package 2 [synthesis_run_id = syn_xyz789ghi012, timestamp = 2026-10-01T14:30Z]
     (Same topic, different research state, new run_id, new timestamp)

Run 3 (Nov 2026): Third iteration (stable candidates, new observations)
  └→ Package 3 [synthesis_run_id = syn_pqr345stu678, timestamp = 2026-11-05T09:15Z]
```

**C5 Validation For Reruns:**
- ✅ Each package self-contained & independently valid
- ✅ synthesis_run_id differs if research state changed (expected)
- ✅ synthesis_run_id identical if inputs unchanged (reproducibility verified)
- ✅ Timestamps reflect execution times (audit trail)
- ✅ No partial/corrupted reruns accepted

**ProjectMemory Behavior:**
- Append-only log of synthesis runs with metadata
- Deduplication by synthesis_run_id (same research, same run_id)
- Observation history preserved (time-series metrics)

---

## MINIMAL C5 IMPLEMENTATION SCOPE

### Phase 1: Design Approval (This Document)

Required decisions:
1. Should synthesis_metadata be included in handoff? (Option A/B)
2. Should category_2_context be included in manifest? (Option A/B)
3. What are the exact blocking vs warning conditions?
4. Which validation checks are mandatory for Phase 2?

### Phase 2: Minimal Implementation

**New File:** `pipeline1_research/src/validation.ts` (~150-200 production lines)

**Exports:**
- `validateResearchPackage(handoff): ValidationResult`
- Helper functions: `validateReferentialIntegrity()`, `validateKnowledgeQuality()`, `validateIntegrity()`, `validateGates()`, `validateMetadata()`

**NOT in Phase 2:**
- Database of validation histories
- Graphical validation dashboard
- External validator API
- Temporal trend analysis
- ML-based quality scoring

**C5 Integration Points:**
- Called from P1.07 after approvePackage()
- Returns ValidationResult to caller
- Throws ValidationError if blocking condition detected
- Logs warnings to handoff_notes if non-blocking concerns

### Phase 3: Focused Tests

- Unit tests for each validation function
- Integration test: draftHandoff → validateResearchPackage → requirePackageApproved
- Edge case tests: empty dimensions, missing optional fields, gate state variations
- Multi-run test: two identical inputs → same validation result

### Phase 4: Typecheck & Build

- `npx tsc --noEmit` (C5: 0 errors)
- `npm run build` (C5: exit 0)
- `npm test` (C5: new tests pass, existing tests still pass)

### Phase 5: Boundary Review

- Does C5 wrongly evaluate strategically? NO (validation only)
- Does C5 wrongly decide channel fit? NO (validation only)
- Does C5 wrongly recommend adoption? NO (validation only)
- All governance decisions remain with human gates

### Phase 6: Acceptance

- Document C5 findings: minimal governance layer
- Classify: GREEN (if 0 defects)
- Mark C5 production-ready

---

## NOW vs LATER vs DEFERRED

### NOW (Required for Phase 1 Production)

- ✅ Referential integrity validation (evidence→source, verification→claim)
- ✅ Knowledge quality validation (no silent conversions, dimension correctness)
- ✅ Manifest/integrity verification (recompute and compare)
- ✅ Gate state enforcement (Gate A1 = "PACKAGE_APPROVED")
- ✅ Required field presence check (all 14 core fields + gates)
- ✅ C2 context validation (if present, data consistency)

### LATER (After Real Production Run)

- ⏳ Synthesis metadata validation (counts match content) — only if Phase A decides to include synthesis_metadata in handoff
- ⏳ Multi-run reproducibility validation (synthesis_run_id tracking across runs)
- ⏳ Observation time-series validation (for strategic trend analysis)
- ⏳ Cost/provider policy enforcement (from C2 acquisition history)

### DEFERRED (Future, Not Required)

- 🔄 Database of validation histories (use ProjectMemory append-only log instead)
- 🔄 Temporal governance evolution (multi-version package comparison)
- 🔄 Machine learning quality scoring (belongs to future intelligence layer)
- 🔄 Cross-discipline relationship validation (belongs to C6 future layer)
- 🔄 Channel-specific validation rules (belongs to B, not C5)

---

## ARCHITECTURE DECISION RECORD

### Decision 1: C5 Scope = Validation Only

**Context:** C5 could be "strategy evaluation engine" or "governance boundary."

**Decision:** C5 = validation boundary only. Enforce structural completeness and safety; defer all strategic decisions to B.

**Rationale:**
- Separation of concerns: A validates, B evaluates
- No premature optimization: first make it correct, then optimize
- Reusability: one validated package can serve multiple B strategies

**Acceptance:** Clear NO to C5 adding discipline scoring, relationship graphs, strategic ranking, or adoption recommendations.

### Decision 2: Gates Frozen; No New Gate Introduced

**Context:** Could introduce Gate A2 for C5 validation.

**Decision:** Use existing Gate A1 (PACKAGE_APPROVED). C5 validates gate state; does not create new gate.

**Rationale:**
- Gate A1 already enforces human approval
- C5 validates human approval happened (not creates it)
- Simpler governance model: one gate per major transition

**Acceptance:** C5's role is "gatekeeper" (enforces the gate exists), not "gate operator" (creates new gate).

### Decision 3: Integrity Includes Core Research Only; C2 Optional

**Context:** Should C2 context be included in integrity hash?

**Decision:** Manifest hashes 8 core sections. category_2_context remains optional, outside integrity check (if included, it's purely informational).

**Rationale:**
- C2 is discovery context (not core research)
- Optional field allows C2 to be added/removed without breaking integrity
- B can request full integrity validation if needed (separate check)

**Acceptance:** C2 integrity optional; core research (sources, evidence, claims, verifications) always integrity-checked.

### Decision 4: Validation Strictly Structural; No Domain Interpretation

**Context:** Could validation include domain-specific checks ("claims must reference secondary sources", "contradiction ratio must be <20%", etc.)?

**Decision:** Validation is purely structural (referential integrity, required fields, gate state). No domain rules.

**Rationale:**
- Domain depends on topic (time-lapse vs ai-safety have different standards)
- Domain decisions belong to B and domain experts
- C5 remains topic-agnostic

**Acceptance:** C5 asks "Is this structurally sound?" not "Is this scientifically rigorous?"

### Decision 5: SynthesisMetadata — Decision Deferred to Approval Phase

**Context:** Should synthesis metadata (run_id, counts, timestamp) travel in handoff?

**Decision:** Deferred. User approval required: Option A (include) or Option B (keep separate).

**Rationale:**
- Affects contract (adds optional field to ResearchPackageHandoff)
- Affects validation (new counts to verify)
- Affects B consumption (whether B receives reproducibility info)

**Action:** Requires explicit user decision in Design Approval phase.

---

## FAILURE MODES & MITIGATIONS

### Failure Mode 1: Orphaned Evidence References

**Scenario:** Claim references evidence_id that doesn't exist.

**Detection:** C5 validates every claim.evidence_refs[i] exists in evidence[] array.

**Mitigation:** ValidationError thrown; handoff blocked.

**Root Cause Prevention:** C3 should enforce this during verification; C5 is defense-in-depth check.

### Failure Mode 2: Silent Conversion (UNKNOWN→VERIFIED)

**Scenario:** Claim created as UNKNOWN but appears in topical bucket (not unknowns).

**Detection:** C5 cross-checks verification.status vs knowledge_package bucket assignment.

**Mitigation:** ValidationError if claim with UNKNOWN status found in topical buckets.

**Root Cause Prevention:** C4 synthesis logic ensures unknowns stay in unknowns bucket; C5 validates.

### Failure Mode 3: Manifest Tampering

**Scenario:** Package integrity_hashes changed after creation.

**Detection:** C5 recomputes package_sha256 from current manifest; compares to stored hash.

**Mitigation:** ValidationError if mismatch; handoff rejected.

**Root Cause Prevention:** Manifest immutable once created; integrity hash acts as tamper seal.

### Failure Mode 4: Gate State Not Recorded

**Scenario:** approvePackage() called but gate not actually recorded (code bug).

**Detection:** C5 checks gates[] contains Gate A1 with state_after="PACKAGE_APPROVED".

**Mitigation:** ValidationError if gate missing; handoff blocked.

**Root Cause Prevention:** C3 code enforces gate recording; C5 validates enforcement happened.

### Failure Mode 5: C2 Context Inconsistency

**Scenario:** AcquisitionAttempt references source_id that doesn't exist; or Observation references missing source.

**Detection:** C5 validates category_2_context references (if present).

**Mitigation:** ValidationWarning if inconsistency found (non-blocking; C2 is optional).

**Root Cause Prevention:** P1.03 should maintain C2 consistency; C5 surfaces remaining issues.

### Failure Mode 6: Multi-Run Package Collision

**Scenario:** Two different research runs produce same synthesis_run_id (hash collision).

**Detection:** Extremely unlikely (~1 in 2^128); C5 cannot prevent.

**Mitigation:** None in C5 (address in versioning layer if needed).

**Root Cause Prevention:** Use stable, content-based run_id; monitor collision risk if scale increases.

---

## MINIMAL C5 ARCHITECTURE

### Core Validation Function

```typescript
export function validateResearchPackage(
  handoff: ResearchPackageHandoff,
  options?: { skipC2?: boolean; skipMetadata?: boolean }
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // 1. Required fields
  errors.push(...validateRequiredFields(handoff));

  // 2. Referential integrity (blocking)
  errors.push(...validateReferentialIntegrity(handoff));

  // 3. Verification consistency (blocking)
  errors.push(...validateVerificationConsistency(handoff));

  // 4. Knowledge quality (blocking)
  errors.push(...validateKnowledgeQuality(handoff));

  // 5. Manifest & integrity (blocking)
  errors.push(...validateIntegrity(handoff));

  // 6. Gates (blocking)
  errors.push(...validateGates(handoff));

  // 7. C2 Context (non-blocking if present)
  if (!options?.skipC2 && handoff.category_2_context) {
    warnings.push(...validateC2Context(handoff));
  }

  // 8. Synthesis metadata (non-blocking if present)
  if (!options?.skipMetadata && handoff.synthesis_metadata) {
    warnings.push(...validateSynthesisMetadata(handoff));
  }

  // 9. Data quality warnings
  warnings.push(...validateDataQuality(handoff));

  return {
    status: errors.length > 0 ? "invalid" : warnings.length > 0 ? "valid_with_warnings" : "valid",
    errors,
    warnings,
    checks_run: 8, // or however many validations performed
    validation_timestamp: new Date().toISOString(),
  };
}
```

### Helper Functions (Each Focused)

- `validateRequiredFields()` — all 14 core fields present
- `validateReferentialIntegrity()` — evidence→source, verification→claim chains
- `validateVerificationConsistency()` — status values, unresolved_reason rules
- `validateKnowledgeQuality()` — no silent conversions, dimension correctness
- `validateIntegrity()` — manifest hash matches, section hashes valid
- `validateGates()` — Gate A1 state, actor, timestamp
- `validateC2Context()` — acquisition/observation references (warnings only)
- `validateDataQuality()` — unused sources, imbalanced verification ratios

### Return Type

```typescript
interface ValidationResult {
  status: "valid" | "invalid" | "valid_with_warnings";
  errors: ValidationError[];
  warnings: ValidationWarning[];
  checks_run: number;
  validation_timestamp: string;
}

interface ValidationError {
  code: string; // e.g., "REFERENTIAL_INTEGRITY_VIOLATED"
  field: string; // e.g., "claims[0].evidence_refs[1]"
  message: string;
}

interface ValidationWarning {
  code: string; // e.g., "UNUSED_EVIDENCE"
  field: string;
  message: string;
}
```

### Integration Point

Called in P1.07 after approvePackage():

```typescript
// In P1.07 workflow
const draft = draftHandoff({ /* params */ });
const { handoff } = approvePackage(draft, actor);

// NEW: Validate structural completeness
const validation = validateResearchPackage(handoff);
if (validation.status === "invalid") {
  throw new ValidationError("P1.07", "handoff", 
    `Package validation failed: ${validation.errors.map(e => e.message).join("; ")}`
  );
}
if (validation.status === "valid_with_warnings") {
  console.warn("Package valid but with warnings:", validation.warnings);
}

// Proceed to P2 with validated handoff
return handoff;
```

---

## A→B BOUNDARY GUARANTEE

### What A (P1) Delivers to B (P2)

**Complete Research Package:**
- ✅ Discovered sources (from P1.03)
- ✅ Extracted evidence (from P1.03)
- ✅ Verified claims (from P1.04)
- ✅ Verification status (VERIFIED/INFERRED/UNKNOWN/CONTRADICTION)
- ✅ Synthesized knowledge (18-dimensional, from P1.05/06)
- ✅ Unresolved questions (for future research follow-up)
- ✅ Optional discovery lineage (where sources came from)
- ✅ Optional acquisition history (provider fallback chains)
- ✅ Optional observations (initial metrics on sources)
- ✅ Cryptographically verified integrity (manifest/hash)
- ✅ Human approval record (Gate A1 state)
- ✅ Validation certificate (C5 validation result)

**Reusable Across Channels:**
- ONE knowledge package per topic
- Applicable to multiple channel strategies
- Evidence chains fully traceable
- Follow-up research directions identified

### What A (P1) Does NOT Deliver

**NOT A Responsibility:**
- ✗ Channel fit assessment ("Is this right for Science channel?")
- ✗ Editorial decisions ("Should we cover this?")
- ✗ Content strategy ("How should we present this?")
- ✗ Production approach ("Video? Article? Podcast?")
- ✗ Priority ranking ("Which topics first?")
- ✗ Adoption recommendations ("We should use this")
- ✗ Relationship graphs ("This connects to that discipline")
- ✗ Discipline classification ("This is mathematics")

**Those are B (Strategy) and downstream responsibilities.**

### Guarantee

**A Delivers Safe Baseline:** A guarantees package is structurally sound, internally consistent, traceable, and human-approved. Nothing more; nothing less.

**B Decides Value:** B evaluates strategic fit, business value, channel suitability, and production feasibility.

---

## RISKS & MITIGATION

### Risk 1: C5 Becomes Strategy Layer (Scope Creep)

**Likelihood:** Medium (tempting to add strategic validation to C5)

**Impact:** High (violates A/B separation; C5 becomes duplicate of B)

**Mitigation:**
- Explicitly document: "C5 validates structure; B validates strategy"
- Code review: reject any domain-specific validation rules
- Testing: only structural tests pass; strategic tests don't exist in C5

### Risk 2: Validation Misses Defects (False Negatives)

**Likelihood:** Low (focused validation rules)

**Impact:** High (defective package reaches B)

**Mitigation:**
- Phase 3 focused tests on all validation functions
- Code review for edge cases (empty arrays, null fields, etc.)
- Manual walk-through of validation logic against failure modes above

### Risk 3: Validation Blocks Valid Packages (False Positives)

**Likelihood:** Low (referential integrity rules are conservative)

**Impact:** Medium (valid research rejected; frustrating delay)

**Mitigation:**
- Warnings for non-blocking concerns (don't block; just warn)
- Phase 2 implementation only validates truly required conditions
- User approval required before tightening validation rules

### Risk 4: C5 Validation Slow for Large Packages

**Likelihood:** Very low (validation is linear in package size)

**Impact:** Low (P1 is offline batch process, not real-time API)

**Mitigation:**
- No nested O(n²) loops in validation
- Phase 2 target: validation completes in <100ms for typical package
- Monitor performance; optimize only if measured slowness occurs

### Risk 5: SynthesisMetadata Not Included in Handoff (Lost Reproducibility Info)

**Likelihood:** Medium (if Option B chosen in Design Approval)

**Impact:** Medium (B can't verify reproducibility without it)

**Mitigation:**
- Document tradeoff clearly in Design Approval
- If Option B chosen, advise B to request synthesis_run_id separately from P1
- Phase 3 can add synthesis_metadata retroactively (additive change)

---

## IMPLEMENTATION SEQUENCE

### PHASE 1 — Design Approval (This Document)

**Deliverable:** A_P1_CATEGORY5_PLAN.md (complete)

**Required User Decisions:**
1. Is C5 scope (validation boundary) approved?
2. Should synthesis_metadata be included in handoff? (Option A or B)
3. Should category_2_context be included in manifest? (Option A or B)
4. Which validation checks are mandatory for Phase 2 (vs Phase 3)?
5. Are blocking vs warning conditions correctly identified?

**Approval Condition:** User approves all 5 decisions OR provides revisions.

### PHASE 2 — Minimal Implementation

**Scope:** Core validation logic (~150-200 production lines)

**Files:**
- NEW: `pipeline1_research/src/validation.ts`
- MODIFY: `pipeline1_research/src/pipeline.ts` (add C5 validation call after approvePackage)
- MODIFY: `pipeline1_research/src/types.ts` (add ValidationResult type if not in validation.ts)

**Exports:**
- `validateResearchPackage(handoff, options?): ValidationResult`
- Helper functions (each focused on one validation concern)

**NOT in Phase 2:**
- Tests (deferred to Phase 3)
- Documentation (deferred to Phase 3)
- Performance optimization
- C2/C4 metadata validation (if users defer those)

### PHASE 3 — Focused Tests

**Files:**
- NEW: `pipeline1_research/tests/validation.test.ts`

**Test Coverage:**
- Unit tests for each helper function (referential integrity, knowledge quality, etc.)
- Integration test: draftHandoff → validateResearchPackage → requirePackageApproved flow
- Edge cases: empty dimensions, missing optional fields, invalid gate states
- Negative tests: validation correctly rejects defects
- Positive tests: validation correctly accepts valid packages

**Target:** All validation functions have focused tests; 100% of new C5 code exercised.

### PHASE 4 — Typecheck & Build

**Commands:**
- `npx tsc --noEmit` (C5: 0 errors)
- `npm run build` (C5: exit 0)
- `npm test` (C5: new tests pass; existing P1 tests still pass)

**Success Criteria:**
- No TypeScript errors in C5 code
- Build completes without warnings (related to C5)
- All tests pass (new + existing)

### PHASE 5 — One Diff/Boundary Review

**Scope:** Verify C5 stays within boundaries

**Questions:**
- Does C5 code evaluate strategically? (Should be NO)
- Does C5 code decide channel fit? (Should be NO)
- Does C5 code make adoption recommendations? (Should be NO)
- Does C5 boundary correctly separate A→B? (Should be YES)
- Are all validation rules structural, not domain-specific? (Should be YES)

**Reviewer:** User + codebase inspection

**Defect Severity:** HIGH (if C5 becomes strategy layer, task failed)

### PHASE 6 — Acceptance

**Deliverables:**
- A_P1_CATEGORY5_IMPLEMENTATION_REPORT.md (summarizing Phase 2-5 results)
- Green/Red classification
- Go/No-Go for P2 implementation

**Acceptance Criteria:**
- 0 defects found in Phase 5
- All tests passing
- C5 stays within governance boundary
- Documentation complete
- Ready for real production use

---

## FINAL VERDICT

### Architecture Assessment

**C5 Strengths:**
- ✅ Focused scope (validation only, not strategy)
- ✅ Minimal implementation (structural checks, not domain rules)
- ✅ Reuses existing infrastructure (gates, manifest, integrity)
- ✅ Supports multi-channel reuse (one package, many applications)
- ✅ Enables reproducibility tracking (synthesis_run_id, counts)
- ✅ Maintains A/B separation (validation vs strategy)

**C5 Risks:**
- ⚠️ Could drift toward strategy (scope creep; requires discipline)
- ⚠️ Validation might miss subtle defects (requires comprehensive tests)
- ⚠️ SynthesisMetadata inclusion TBD (decision deferred to approval)

**Recommendation:** Approve C5 as minimal governance boundary. Enables Phase 2-6 implementation after design decisions finalized.

---

## NEXT STEP

**User Action Required:**

Review and approve (or revise) these 5 design decisions:

1. **C5 Scope:** Is "validation boundary only" correct? Or should C5 do more/less?

2. **SynthesisMetadata in Handoff:** Option A (include as optional field) or Option B (keep separate)?

3. **Category2Context in Manifest:** Option A (add as 9th section) or Option B (keep outside)?

4. **Mandatory Validations for Phase 2:** Which checks must Phase 2 implement? Which defer to Phase 3?

5. **Blocking vs Warning Conditions:** Are the severity classifications correct?

**After Approval:**

Proceed to PHASE 2 implementation (minimal C5 code).

---

**Plan Date:** 2026-09-03  
**Plan Status:** 🟡 AWAITING DESIGN APPROVAL  
**Planned By:** Design analysis of live A-Branch code  
**Mode:** PLAN ONLY — no implementation, no commits  
**Next Step:** User design decision approval → PHASE 2 implementation
