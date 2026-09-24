# A_P1_CATEGORY4_PLAN.md

**P1 Category 4: Synthesis & Knowledge — Minimum Production-Ready Design**

**Date:** 2026-09-03  
**Status:** PLANNING PHASE  
**Authority:** Live A-Branch source code inspection  
**Scope:** A-BRANCH ONLY (no B, no B00-B12)

---

## 0. PLANNING SUMMARY

P1 Category 4 currently consists of two functions:

1. **runP105And106Synthesis()** — transforms verified claims into dimensional buckets
2. **draftHandoff()** — packages research output for P2 (B)

This plan proposes the **minimum production-ready C4** that:
- Preserves and enhances current synthesis
- Adds reusable knowledge structure (one package per topic, reused across channels)
- Establishes Tekno Polimat relationship extension point (future disciplinary connections)
- Maintains temporal knowledge lifecycle (research run evolution)
- Keeps deterministic reproducibility
- Does NOT add graph database, ontology, scoring, or strategic decisions

**Key Finding:** C4 is underdeveloped relative to C1-C3. Its current scope is minimal (distribute claims to dimensions). Production readiness requires selective enhancements, not architectural overhaul.

---

## 1. PRE-IMPLEMENTATION CORRECTIONS (Design Lock Phase)

### Correction 1: Synthesis Run ID Definition

**Previous approach (REJECTED):**
```
synthesis_run_id = hash(project_id, sources.length, claims.length, verifications.length)
```

**Problem:** Collision risk across materially different research states (e.g., two runs with same number of sources but different content).

**Corrected approach:**
```
synthesis_run_id = hash(
  project_id +
  canonicalized_input_fingerprint +
  deterministic_ordering_marker
)

where canonicalized_input_fingerprint = hash(
  sorted_canonical_ids(sources.source_id) +
  sorted_canonical_ids(claims.claim_id) +
  sorted_canonical_ids(verifications.verification_id)
)
```

**Guarantee:** Deterministic and collision-resistant. Same research inputs → same synthesis_run_id (reproducible). Different inputs → different synthesis_run_id (no false collisions).

**Implementation Rule:** Do NOT include wall-clock time in synthesis_run_id. Execution timestamp is separate metadata.

---

### Correction 2: Timestamp vs Determinism Separation

**Principle:** KNOWLEDGE IDENTITY ≠ EXECUTION METADATA

**Synthesis Timestamp (Execution Metadata)**
- Records WHEN synthesis happened
- Included in output for audit trail
- Does NOT affect synthesis_run_id
- Does NOT affect deterministic ordering
- Does NOT affect reproducibility

**Synthesis Run ID (Knowledge Identity)**
- Identifies WHAT was synthesized
- Deterministic from input content
- Remains stable across repeated syntheses of same inputs
- No time component

**Guarantee:** Running P1.05 twice over identical research inputs (C3 output) must produce:
- ✅ Same synthesis_run_id (reproducible identity)
- ❌ Different synthesis_timestamp (different execution times)

This ensures knowledge versioning works correctly: same knowledge regardless of when re-synthesized.

---

### Correction 3: ProjectMemory Verification

**Current ProjectMemory Capabilities (Inspected from memory.ts):**

✅ **Supports:**
- Append-only multi-run research tracking (sources, evidence, claims)
- Deterministic deduplication by ID (source_id, evidence_id, claim_id)
- Changelog with timestamp, stage, summary per run
- Merge-not-drop semantics (incoming wins on conflict, prior never silently dropped)

❌ **Does NOT currently support:**
- Storage of synthesized KnowledgePackage output
- Versioning of synthesis metadata
- Querying "what was knowledge at timestamp X"
- Separating synthesis history from research input history

**Design Decision:** To support C4 versioning, extend ProjectMemory to store KnowledgePackage[] rather than creating new persistence layer.

**Proposed Extension:**
```typescript
interface ProjectMemory {
  project_id: string;
  research_scope: ResearchScope | null;
  sources: Source[];
  evidence: Evidence[];
  claims: Claim[];
  // NEW: synthesis history
  knowledge_packages: Array<{
    synthesis_run_id: string;
    knowledge_package: KnowledgePackage;
    synthesis_timestamp: string;
    metadata: SynthesisMetadata;
  }>;
  changelog: ProjectMemoryChangelogEntry[];
  updated_at: string;
}
```

**Guarantee:** Leverage existing deduplication pattern (by synthesis_run_id), maintain append-only semantics, no new database.

---

### Correction 4: Full Deterministic Ordering

**Requirement:** All unordered collections in C4 output must have defined stable ordering to ensure reproducibility.

**Collections requiring ordering:**

| Collection | Stable Sort Key | Rationale |
|---|---|---|
| facts, concepts, people, events, places, objects, processes, relationships, chronology, terminology, quantitative, visual, examples, interpretations, production_context | Lexicographic by claim_id | Deterministic array order within each dimension |
| contradictions | Lexicographic by claim_id | Deterministic contradiction bucket |
| unknowns | Lexicographic by claim_id | Deterministic unknown bucket |
| open_questions | Lexicographic string sort | Deterministic question order |
| evidence_refs[] (within each Claim) | Lexicographic by evidence_id | Deterministic evidence backreferences |
| contradiction_refs[] (within each Claim) | Lexicographic by claim_id | Deterministic contradiction references |

**Implementation Rule:** After all claims are bucketed into dimensions, sort each dimension array and the contradictions/unknowns arrays by claim_id before serializing KnowledgePackage.

**Guarantee:** Same input state → identical output structure (bit-for-bit reproducible JSON).

---

## 2. LIVE C4 ANATOMY

### Current Implementation

**File:** `pipeline1_research/src/pipeline.ts` (lines 426-485)

```typescript
export function runP105And106Synthesis(
  claims: Claim[],
  verifications: Verification[],
): { knowledge_package: KnowledgePackage; unresolved_questions: string[] }
```

**Behavior:**

1. Filter claims to those with Verification records (no unverified claims enter synthesis)
2. Distribute verified claims to KnowledgePackage dimension buckets based on claim.dimension
3. Mark UNKNOWN claims in unknowns array
4. Mark contradictory claims in contradictions array
5. Collect unresolved questions from UNKNOWN verifications
6. Return knowledge_package + unresolved_questions

**KnowledgePackage Type:**

```typescript
interface KnowledgePackage {
  verification_state_schema_version: "v1";
  facts: Claim[];
  concepts: Claim[];
  people: Claim[];
  events: Claim[];
  places: Claim[];
  objects: Claim[];
  processes: Claim[];
  relationships: Claim[];
  chronology: Claim[];
  terminology: Claim[];
  quantitative: Claim[];
  visual: Claim[];
  examples: Claim[];
  interpretations: Claim[];
  contradictions: Claim[];
  unknowns: Claim[];
  open_questions: string[];
  production_context: Claim[];
}
```

**18 dimensions total:**
- 15 topical buckets (facts, concepts, people, events, places, objects, processes, relationships, chronology, terminology, quantitative, visual, examples, interpretations, production_context)
- 2 status buckets (contradictions, unknowns)
- 1 question list (open_questions)

### Current Handoff Integration

**File:** `pipeline1_research/src/pipeline.ts` (lines 489-542)

```typescript
export function draftHandoff(params: {
  knowledge_package: KnowledgePackage;
  unresolved_questions: string[];
  // ... other fields including Category 2 context ...
}): ResearchPackageHandoff
```

**Handoff fields that include C4 outputs:**
- knowledge_package (18-dimensional structure)
- unresolved_questions (string[])
- source/evidence/claims (for provenance tracing)

**Handoff does NOT include:**
- Candidate[] (internal to P1.03)
- Synthesis metadata (run identity, version)
- Temporal history (only current snapshot)

### Current Tests

**File:** `pipeline1_research/tests/pipeline.test.ts` (lines 500+)

Tests verify:
1. knowledge_package.verification_state_schema_version = "v1"
2. Claims distributed to correct dimensions (facts, quantitative, people)
3. UNKNOWN claims in unknowns array
4. Contradictions preserved

**No tests for:**
- Temporal evolution
- Discipline relationships
- Knowledge reuse across channels
- Version management
- Synthesis metadata

### Supporting Infrastructure

**ProjectMemory (memory.ts):**
- Stores sources, evidence, claims across runs
- Merges new runs append-only (never silently drops)
- Maintains changelog with timestamps and summaries
- Uses deterministic IDs for deduplication (source_id, evidence_id, claim_id)

**Key Insight:** ProjectMemory already exists for multi-run knowledge persistence. C4 can leverage this.

---

## 2. CURRENT C4 STATUS

### What C4 Already Does ✓

- ✓ Filters unverified claims (only VERIFIED/INFERRED/UNKNOWN enter knowledge)
- ✓ Distributes claims to 15 topical dimensions
- ✓ Preserves contradictions in dedicated bucket
- ✓ Collects unresolved questions
- ✓ Supports multi-run knowledge via ProjectMemory
- ✓ Maintains claim provenance (claim.evidence_refs → sources)
- ✓ Distinguishes verification states (VERIFIED vs INFERRED vs UNKNOWN)

### What C4 Only Appears To Do ✗

- ✗ "Synthesize knowledge" — actually just buckets claims, does minimal synthesis
- ✗ "Preserve relationships" — relationships[] is empty, no connection logic
- ✗ "Build production knowledge" — no version, no metadata, no lifecycle tracking

### What C4 Does NOT Do ✗

- ✗ Normalize or cluster related claims
- ✗ Identify themes or patterns
- ✗ Build interdisciplinary relationships (Tekno Polimat requirement)
- ✗ Version knowledge packages
- ✗ Track synthesis metadata (run identity, timestamp)
- ✗ Support knowledge reuse across channels (creates per-channel copy instead of shared)
- ✗ Build semantic relationships between disciplines
- ✗ Validate contradiction resolution
- ✗ Suggest follow-up research

### Reusable Components

| Component | Current | Reusable? |
|-----------|---------|-----------|
| KnowledgePackage type | Defined, frozen | ✓ Core structure (expand carefully) |
| Dimension model | 15 dimensions | ✓ Extensible for future disciplines |
| ProjectMemory | Append-only merge | ✓ Perfect for multi-run evolution |
| Deterministic IDs | claim_id, evidence_id | ✓ Stable across runs |
| Claim provenance | evidence_refs | ✓ Traceability preserved |
| Contradiction tracking | contradiction_refs | ✓ Explicit conflicts preserved |
| Verification states | VERIFIED/INFERRED/UNKNOWN | ✓ Distinction maintained |

---

## 3. SYNTHESIS VS KNOWLEDGE BOUNDARY

### Synthesis (Current C4 Phase)

**Definition:** "What do the verified findings collectively say?"

**Current Behavior:**
- Input: verified claims (Claim[] + Verification[])
- Process: filter, bucket, collect unresolved
- Output: knowledge_package (organized claims)

**Scope:** Converting individual findings into structured knowledge

### Knowledge (Extended C4 Phase)

**Definition:** "What reusable structured information should the system retain?"

**Proposed Behavior:**
- Input: knowledge_package (from synthesis)
- Process: version, identify metadata, preserve for reuse
- Output: versioned knowledge + synthesis metadata

**Scope:** Managing knowledge lifecycle, version, reuse

### Proposed Boundary

```
C3: Evidence & Verification
        ↓
   Verified Claims
        ↓
C4.A: Synthesis
   (bucket claims by dimension)
        ↓
   knowledge_package
        ↓
C4.B: Knowledge Management
   (version, track metadata, support reuse)
        ↓
   Versioned Knowledge Package
        ↓
C5: Handoff & Governance
```

**Rationale:** Separate concerns cleanly:
- Synthesis = organizing what we learned
- Knowledge = managing reusable understanding

---

## 4. FACT / CLAIM / KNOWLEDGE SEPARATION

### Provenance Chain (Immutable)

```
Source
  ↓ (contains)
Evidence
  (excerpt or pointer to source material)
  ↓ (supports)
Claim
  (statement derived from evidence)
  ↓ (becomes)
Knowledge
  (synthesized understanding retained for reuse)
  ↓ (informs)
B Strategic Decision
  (channel fit, adoption, priority — NOT C4)
```

### Semantic Guarantees

| Level | Frozen? | Owns Provenance? | C4 Role |
|-------|---------|-----------------|---------|
| Source | Yes | Yes (URL, type, retrieved_at) | Consume |
| Evidence | Yes | Yes (source_id, excerpt) | Consume |
| Claim | Yes | Yes (evidence_refs, derived_from) | Consume + organize |
| Knowledge | No | Yes (claim refs) | Create + version |
| Strategy | No | No | NOT C4 (B only) |

### C4 Responsibility

- ✓ Preserve claim.evidence_refs (backward traceability)
- ✓ Preserve claim.derived_from (research context)
- ✓ Preserve claim.contradiction_refs (known conflicts)
- ✓ DO NOT create unsupported factual claims
- ✓ DO NOT modify evidence or source content
- ✗ DO NOT add strategic evaluation
- ✗ DO NOT rank by importance (that's B)

---

## 5. VERIFIED / INFERRED / UNKNOWN HANDLING

### Current Behavior (Live Code)

```typescript
const verifiedClaims = claims.filter((c) => 
  verificationByClaimId.has(c.claim_id)
);
// All claims with Verification records enter knowledge
// (regardless of status: VERIFIED, INFERRED, or UNKNOWN)

if (verification.status === "UNKNOWN") {
  kp.unknowns.push(claim);
  unresolved_questions.push(
    `${claim.statement} (${verification.unresolved_reason})`
  );
}
```

### Verification States (From types.ts)

```typescript
type EvidenceStatusV1 = "VERIFIED" | "INFERRED" | "UNKNOWN";
```

### C4 Synthesis Semantics

| Status | Knowledge Treatment | Bucket | Explanation |
|--------|-------------------|--------|-------------|
| VERIFIED | Added to topical bucket | facts, concepts, etc. | Independently cross-checked |
| INFERRED | Added to topical bucket | facts, concepts, etc. | Derived from evidence, not independently verified |
| UNKNOWN | Added to unknowns + open_questions | unknowns | Unresolved, needs follow-up research |

**Key Guarantee:** C4 must NOT convert:
- UNKNOWN → (implicit VERIFIED) ✗
- INFERRED → (implicit VERIFIED) ✗

All verification states must remain distinguishable.

### Proposed Enhancement

Add metadata to synthesized knowledge (with corrected synthesis_run_id per Correction 1):

```typescript
interface KnowledgePackageSynthesisMetadata {
  // KNOWLEDGE IDENTITY (deterministic, no time component):
  synthesis_run_id: string; // Deterministic hash of input sources/claims/verifications
  
  // EXECUTION METADATA (time-dependent, does NOT affect identity):
  synthesis_timestamp: string; // ISO 8601 (when synthesis actually ran)
  
  // CONFIDENCE BREAKDOWN:
  verified_facts_count: number;
  inferred_facts_count: number;
  unknown_count: number;
  contradictions_count: number;
  total_claims: number;
}
```

**Key Guarantee:** Same research inputs → same synthesis_run_id (reproducible). Different times → different synthesis_timestamp (not conflated).

This allows downstream consumers to:
- Understand confidence levels without loss of state
- Track knowledge evolution (compare run_ids across time)
- Verify reproducibility (same inputs produce same synthesis_run_id)

---

## 6. CONTRADICTION HANDLING

### Current Behavior

```typescript
if (claim.contradiction_refs.length > 0) {
  kp.contradictions.push(claim);
}

// Verification tracks:
contradiction_relationship: "NONE" | "PARTIAL" | "DIRECT";
```

### Example Scenario

```
Claim A: "Aqueducts used gravity flow"
  ├ status: VERIFIED
  ├ evidence_refs: [source-roman-engineering]
  └ contradiction_refs: [claim-b]

Claim B: "Aqueducts used pumped pressure"
  ├ status: INFERRED
  ├ evidence_refs: [source-ancient-texts]
  └ contradiction_refs: [claim-a]

Verification A: contradiction_relationship = "DIRECT"
Verification B: contradiction_relationship = "DIRECT"
```

### C4 Handling

**Current:** Both claims land in kp.contradictions (both recorded)

**Proposed Enhancement:** Preserve both provenance chains without arbitration:

```typescript
interface ContradictionRecord {
  claims: Claim[]; // All contradicting claims
  relationships: Array<{
    claim_id: string;
    status: "VERIFIED" | "INFERRED" | "UNKNOWN";
    contradiction_relationship: "DIRECT" | "PARTIAL" | "NONE";
  }>;
  resolution_status: "unresolved" | "partially_resolved" | "resolved";
  resolution_note?: string;
}
```

**Guarantee:** C4 does NOT choose winner; B (or future C5) may resolve.

---

## 7. UNRESOLVED QUESTIONS LIFECYCLE

### Current Behavior

```typescript
const unresolved_questions: string[] = [];

for (const claim of verifiedClaims) {
  const verification = verificationByClaimId.get(claim.claim_id)!;
  
  if (verification.status === "UNKNOWN") {
    unresolved_questions.push(
      `${claim.statement} (${verification.unresolved_reason})`
    );
  }
}

kp.open_questions = unresolved_questions;
```

### Flow in Handoff

```
knowledge_package.open_questions: string[]  // Current snapshot
unresolved_questions: string[]               // Same list
```

### Proposed Enhancement

```typescript
interface UnresolvedQuestion {
  question_id: string; // Deterministic hash(statement, first_appearance)
  statement: string;
  reason: string; // unresolved_reason from Verification
  source_claim_id: string; // Which claim raised this question
  first_identified: string; // ISO 8601
  research_attempts: number; // How many runs have tried?
  related_claims: string[]; // Other claims touching this
}
```

**Benefit:** Allows future research runs to:
- Target specific unresolved questions
- Track whether question was addressed
- Preserve history of research attempts
- Understand question evolution

---

## 8. REUSABLE KNOWLEDGE MODEL

### Current Behavior

Each research run produces ONE knowledge_package. But:
- If researched for Main Tekno Polimat, package stays there
- If later needed for History channel, research run again (duplication)

### Proposed: One Knowledge Base, Multiple Uses

```
Topic: "Roman Aqueduct Technology"
    ↓
Research Run (P1) → Knowledge Package V1
    ├ sources, evidence, claims, verifications
    ├ knowledge dimensions (facts, concepts, people, etc.)
    └ unresolved questions
    
Main Tekno Polimat:
  "How did Romans build aqueducts?"
    ↓ (uses V1)
    ├ select relevant facts
    ├ combine with other topics
    └ produce educational content
    
History Channel:
  "Roman engineering innovations"
    ↓ (reuses same V1)
    ├ select historical facts
    ├ emphasize technological context
    └ produce historical narrative
    
Mathematics Channel:
  "Geometry in Roman engineering"
    ↓ (reuses same V1)
    ├ select quantitative claims
    ├ emphasize mathematical relationships
    └ produce math educational content
```

### Implementation

**Same KnowledgePackage** shared across channels with:
- Channel-specific filtering (not duplication)
- Channel-specific synthesis (interpretation layer)
- Shared provenance (all cite original sources)

### C4 Responsibility

**NOW:** Produce ONE reusable knowledge package per topic

**B Responsibility (downstream):** Apply channel-specific interpretation

---

## 9. TEKNO POLIMAT RELATIONSHIP EXTENSION POINT

### Tekno Polimat Core Idea

"Meaningful relationships between disciplines"

Not just:
- Many disciplines (History, Math, Technology, etc.)

But:
- **Interdisciplinary connections** (How history informs technology choices; how math validates engineering; etc.)

### Design Requirement

C4 must **preserve the possibility** of future interdisciplinary relationships without building them now.

### Current State

- `KnowledgePackage.relationships: Claim[]` — empty, no logic
- No discipline field on Claim or ResearchScope
- No relationship type model

### Proposed Extension Point (Do NOT implement now)

Add metadata infrastructure only:

```typescript
// In KnowledgePackage (future extension):
relationships: RelationshipCandidate[];

interface RelationshipCandidate {
  relationship_id: string;
  source_claim_id: string;
  target_claim_id: string;
  relationship_type: string; // "applies_to", "informs", "contradicts", "extends", etc.
  confidence: "candidate" | "evidence_gathered" | "verified";
  evidence_refs?: string[]; // Supporting sources for the relationship
  notes?: string;
}
```

### Future Flow (Future C6, not C4)

```
Topic A (History): "Napoleon's logistics"
        ↓ (C4 creates knowledge)
        
Topic B (Mathematics): "Optimization theory"
        ↓ (C4 creates knowledge)
        
C6 (future): "Interdisciplinary Relationships"
        ↓
Research relationship candidates
        ↓
"Napoleon's logistics exemplifies optimization theory"
        ↓
Gather evidence, verify
        ↓
Verified cross-disciplinary knowledge
```

### C4 Safety Constraint

C4 must NOT:
- Invent relationship candidates without evidence ✗
- Recommend relationships to B ✗
- Score relationship strength ✗
- Rank by strategic value ✗

C4 MAY:
- Preserve claim metadata that future layers can reference
- Add relationship comment/note field
- Record when same research addresses multiple dimensions

---

## 10. DISCIPLINE MODEL (Deferred, Not Now)

### Key Question

Is a discipline:
- Source metadata? (Where research came from)
- Claim classification? (What the claim is about)
- Knowledge metadata? (How knowledge is organized)
- Relationship participant? (In future interdisciplinary connections)

### Current State

NO discipline field exists anywhere.

ResearchScope has:
- topic (e.g., "Roman Aqueducts")
- question (e.g., "How did Romans build them?")
- but NO "discipline" or "subject_area"

### Proposed Minimum (Future)

When implemented, discipline should be:

```typescript
// In ResearchScope:
disciplines?: string[];  // ["history", "technology", "engineering"]

// In Claim metadata (future):
discipline?: string;  // Which discipline claims this fact
```

**Guidance:** Disciplines should be:
- User-defined per research context (not hardcoded)
- Composable (claim can belong to multiple)
- Queryable (later synthesis can select by discipline)

### DO NOT NOW:
- Hardcode discipline list ✗
- Create discipline ontology ✗
- Add to current KnowledgePackage ✗

---

## 11. TEMPORAL KNOWLEDGE LIFECYCLE

### Scenario: Multi-Run Evolution

```
Run 1 (Sept 2026)
  → Knowledge V1
  → sources [A, B, C]
  → claims [1, 2, 3]
  → unresolved [Q1, Q2]

Run 2 (Oct 2026)
  → new source D
  → new claim 4
  → resolved Q1 ✓
  → new unresolved Q3

Run 3 (Nov 2026)
  → source D updated (more details)
  → new claim 5
  → Q2 still unresolved
```

### Current Behavior

ProjectMemory already handles this:
- Sources merged by source_id (no duplicates)
- Claims merged by claim_id (no duplicates)
- Changelog appends (never deletes)
- Updated_at tracks latest change

### C4's Role

**Synthesis Phase:**
1. Input: combined claims from ProjectMemory (all prior runs + current run)
2. Process: re-synthesize against all verified claims
3. Output: knowledge_package reflects cumulative understanding

**Knowledge Phase:**
1. Assign version identity based on run sequence
2. Track synthesis timestamp
3. Link to source run (run 1 vs run 2 vs run 3)
4. Preserve prior versions (historical snapshots)

### Proposed Extension

```typescript
interface KnowledgePackageVersion {
  package_id: string; // Deterministic hash (topic, claims_digest)
  version_number: number; // 1, 2, 3... sequential
  synthesized_from_run: string; // run_id of research that produced this
  previous_version_id?: string; // Linked history
  synthesis_timestamp: string; // ISO 8601
  claims_digest: string; // SHA-256 of sorted claim IDs
  state_snapshot: {
    verified_count: number;
    inferred_count: number;
    unknown_count: number;
  };
}
```

**Benefit:**
- Compare knowledge across versions
- Track evolution of understanding
- Understand which claims are stable vs changed

---

## 12. KNOWLEDGE VERSIONING STRATEGY

### Identity Model

**Knowledge Package ID:** Deterministic hash based on:
- topic (from ResearchScope)
- project_id
- digest of verified claims (sorted)

```typescript
package_id = stable hash(project_id + topic + sorted(claim_ids))
```

**Result:** Same topic + same verified claims = same package_id (deterministic)

### Version Numbering

**Sequence Model:**
- V1: Research Run 1 → Initial knowledge
- V2: Research Run 2 → Updated knowledge (new claims, some resolved)
- V3: Research Run 3 → Further evolution

**Stored as:**
```typescript
version: {
  package_id: string;
  sequence: number; // V1 = 1, V2 = 2, V3 = 3
  run_id: string;
  synthesized_at: string;
}
```

### Backward Compatibility

**Frozen Handoff:** ResearchPackageHandoff.knowledge_package remains:
- Single knowledge_package (current state)
- No version info (for now)

**Future Extension:** Add optional:
```typescript
knowledge_package_history?: KnowledgePackageVersion[];
```

---

## 13. DETERMINISM GUARANTEE

### Current Behavior

```typescript
const verificationByClaimId = new Map(verifications.map((v) => [v.claim_id, v]));
const verifiedClaims = claims.filter((c) => verificationByClaimId.has(c.claim_id));

for (const claim of verifiedClaims) {
  (kp[claim.dimension] as Claim[]).push(claim);
}
```

**Determinism Assessment:**

| Factor | Deterministic? | Why |
|--------|---|---|
| Claim filtering | ✓ | Keyed by claim_id (stable) |
| Dimension assignment | ✓ | Fixed by claim.dimension field |
| Order in bucket | ✗ | Depends on input claim array order |
| Bucket names | ✓ | Hardcoded dimension list |
| Verification lookup | ✓ | Map key (claim_id) is stable |

**Gap:** If input claims array order varies, output order varies.

**For versioning, this matters:**
- V1 synthesized from Run 1 claims (order A)
- V2 synthesized from Run 1+2 claims (order B, different)
- Same claims in different order = different package digest

### Proposed Fix

Deterministic claim ordering:

```typescript
const verifiedClaims = claims
  .filter((c) => verificationByClaimId.has(c.claim_id))
  .sort((a, b) => a.claim_id.localeCompare(b.claim_id));

for (const claim of verifiedClaims) {
  (kp[claim.dimension] as Claim[])
    .push(claim);
}

// Then sort each dimension bucket:
for (const dimension of CLAIM_DIMENSIONS) {
  kp[dimension] = kp[dimension]
    .sort((a, b) => a.claim_id.localeCompare(b.claim_id));
}
```

**Benefit:** Same claims always produce same order, same digest, same package_id.

---

## 14. PROVENANCE ARCHITECTURE

### Immutable Chain

```
Source (origin, retrieved_at, access_method)
    ↓
Evidence (source_id, excerpt_or_pointer)
    ↓
Claim (evidence_refs[], derived_from)
    ↓
Verification (claim_id, status, rationale)
    ↓
Knowledge (claim references, dimension assignment)
```

### Traceability Path

Forward (from source to knowledge):
```
"Which knowledge comes from source X?"
→ source_id in Evidence
→ evidence_id in Claim.evidence_refs
→ claim in KnowledgePackage.dimensions
```

Backward (from knowledge to source):
```
"What supports claim 123?"
→ Claim 123.evidence_refs → [evidence-a, evidence-b]
→ Evidence-a.source_id → Source-A
→ Evidence-a.excerpt_or_pointer → quote from Source-A
```

### C4 Responsibility

- ✓ Preserve Claim.evidence_refs (no modification)
- ✓ Preserve Claim.derived_from (context preserved)
- ✓ Create no new claims
- ✓ Add no new evidence_refs
- ✗ DO NOT break backward references

---

## 15. C4 OUTPUTS

### Primary Outputs (Handoff)

```typescript
knowledge_package: KnowledgePackage
unresolved_questions: string[]
```

### Secondary Outputs (Optional, Future)

```typescript
synthesis_metadata?: {
  verified_count: number;
  inferred_count: number;
  unknown_count: number;
  contradictions_count: number;
  synthesis_timestamp: string;
}

knowledge_version?: {
  package_id: string;
  version_number: number;
  claims_digest: string;
}
```

### What C4 Does NOT Output

- ✗ Recommendations
- ✗ Channel fit scores
- ✗ Production prompts
- ✗ Strategic priority
- ✗ Adoption decisions

---

## 16. P1.06 HANDOFF RELATIONSHIP

### Current ResearchPackageHandoff

```typescript
export interface ResearchPackageHandoff {
  // Frozen 14 fields:
  package_id: string;
  schema_version: "1.0.0";
  project_id: string;
  manifest: ManifestEntry[];
  integrity_hashes: IntegrityHashes;
  research_scope: ResearchScope;
  sources: Source[];
  evidence: Evidence[];
  claims: Claim[];
  verifications: Verification[];
  knowledge_package: KnowledgePackage;  // ← C4 output
  unresolved_questions: string[];       // ← C4 output
  handoff_notes: string;
  gates: GateApprovalRecord[];
  
  // Category 2 optional extension:
  category_2_context?: Category2Context;
}
```

### C4's Inputs to Handoff

- knowledge_package (required)
- unresolved_questions (required)
- All other fields prepared by C1, C2, C3, P1.06

### C4's Consumption of Handoff

C4 is called BEFORE draftHandoff:

```typescript
const { knowledge_package, unresolved_questions } = 
  runP105And106Synthesis(claims, verifications);

const draft = draftHandoff({
  knowledge_package,
  unresolved_questions,
  // ... other params ...
});
```

### No Changes Required to Handoff (For Now)

The frozen 14 fields + optional C2 extension are sufficient.

**Future Extension Point:** Add optional knowledge_version (if versioning implemented).

---

## 17. C4 → C5 BOUNDARY

### C4 (Synthesis & Knowledge)

- ✓ Organize verified claims into dimensions
- ✓ Preserve unresolved questions
- ✓ Package reusable knowledge
- ✓ Version knowledge (future)

**Does NOT do:**
- Approve knowledge ✗
- Apply gates ✗
- Finalize package ✗
- Route for delivery ✗

### C5 (Handoff & Governance) [Future]

**Expected responsibilities:**
- Apply gates to approved knowledge
- Finalize package for delivery
- Route to correct downstream system
- Manage approval lifecycle

**Does NOT do:**
- Synthesize knowledge ✗
- Make strategic decisions ✗
- Interpret for channels ✗

### Information Flow

```
C4: knowledge_package
    ↓
C5: Assess approval gates
    ↓
C5: Finalize delivery
    ↓
B: Use knowledge for channel strategy
```

---

## 18. C4 → B BOUNDARY

### What C4 Makes Available (Research Layer)

- Knowledge package (verified + inferred + unknown claims organized by dimension)
- Evidence/sources (for verification and attribution)
- Unresolved questions (research gaps)
- Metadata (synthesis timestamp, counts)

### What B Does with C4 Output (Strategy Layer)

- Evaluates channel fit
- Decides production approach
- Selects which knowledge to use
- Interprets for audience
- Combines with other topics

### What C4 Must NOT Do

- ✗ Create channel strategy
- ✗ Recommend which claims to use for which channel
- ✗ Score knowledge by strategic value
- ✗ Decide production format
- ✗ Propose adoption decisions

---

## 19. MULTI-CHANNEL TEST (Conceptual)

### Scenario

**Topic:** "Ancient Roman Architecture"

**Channels:**
- Main Tekno Polimat (general education)
- History (historical context)
- Mathematics (geometric principles)
- Technology (construction methods)
- Psychology (human scale/perception)

### Expected Behavior

```
Research Run (P1):
  → ONE KnowledgePackage
  → facts, concepts, people, events, places, objects, 
    processes, chronology, quantitative, visual, examples
  → evidence linked to all claims

Main Tekno Polimat:
  (uses same knowledge package)
  → selects architectural overview claims
  → combines with other topics
  → produces educational video

History Channel:
  (uses same knowledge package)
  → selects historical context claims
  → emphasizes timeline and historical significance
  → produces historical narrative

Mathematics Channel:
  (uses same knowledge package)
  → selects quantitative/geometry claims
  → emphasizes mathematical relationships
  → produces math tutorial

Technology Channel:
  (uses same knowledge package)
  → selects construction method claims
  → emphasizes material science and engineering
  → produces technical deep-dive

Psychology Channel:
  (uses same knowledge package)
  → selects people/perception claims
  → emphasizes human factors
  → produces perception study
```

### C4 Guarantee

**Same knowledge base used across all channels.**

No duplication, no channel-specific C4 variants.

Channel-specific interpretation happens in B (downstream).

---

## 20. MULTI-PLATFORM TEST (Conceptual)

### Scenario

**Topic:** "Time-lapse Photography Techniques"

**Sources:**
- YouTube video (English, creator from US)
- Bilibili video (Chinese, creator from China)
- Instagram Reels (English, creator from UK)

### Expected Behavior

```
C2 (Discovery):
  → Source-YouTube (observations: view_count, engagement)
  → Source-Bilibili (observations: view_count, engagement, regional)
  → Source-Instagram (observations: reach, engagement)
  → Same technique, different platforms
  → Different source_id per platform

C3 (Evidence):
  → Evidence from each source citing the platform-specific content
  → Claims about technique divorced from platform

C4 (Knowledge):
  → KnowledgePackage contains claims about time-lapse technique
  → Observations about platform performance NOT in knowledge
  → Observations remain in category_2_context (C2 data)
  → Platform-specific publication strategies NOT in knowledge
```

### C4 Guarantee

**Platform observations ≠ Knowledge claims.**

Observations about YouTube performance go in category_2_context.

Knowledge about time-lapse technique goes in knowledge_package.

---

## 21. RESEARCH UPDATE TEST (Conceptual)

### Scenario

**Topic:** "Medieval Water Mills"

#### Run 1 (Sept 2026)

```
Research → Knowledge V1
  facts: [claim-1, claim-2, claim-3]
  people: [claim-4]
  unknowns: [claim-5, claim-6]
  open_questions: [Q1, Q2]
```

#### Run 2 (Oct 2026)

```
New sources: X, Y
New claims: claim-7, claim-8
Resolved Q1: claim-5 → status changed UNKNOWN → VERIFIED

Re-synthesis → Knowledge V2
  facts: [claim-1, claim-2, claim-3, claim-5, claim-7, claim-8]
  people: [claim-4]
  unknowns: [claim-6]
  open_questions: [Q2]
```

#### Run 3 (Nov 2026)

```
New sources: Z
New claims: none
Q2 still unresolved
Source A has been updated (more details)

Re-synthesis → Knowledge V3
  facts: [claim-1, claim-2, claim-3, claim-5, claim-7, claim-8]
  people: [claim-4]
  unknowns: [claim-6]
  open_questions: [Q2]
  (same as V2, because no new verified claims)
```

### C4 Guarantee

- ✓ Same verified claims always produce same knowledge
- ✓ New verified claims expand knowledge
- ✓ Resolved questions removed from unknowns
- ✓ Prior versions preserved in ProjectMemory
- ✓ Version sequence tracked (V1 → V2 → V3)

---

## 22. KNOWLEDGE QUALITY TEST (Conceptual)

### Input Quality Matrix

| Input | Status | KP Treatment | Quality |
|-------|--------|--------------|---------|
| Claim A | VERIFIED | Topical bucket | Highest confidence |
| Claim B | INFERRED | Topical bucket | Medium confidence |
| Claim C | UNKNOWN | unknowns bucket | Lowest confidence |
| Claim D | VERIFIED + contradictions | topical + contradictions | Conflict preserved |

### Expected Output

```
KnowledgePackage {
  facts: [A, B],           // Mixed confidence explicitly
  unknowns: [C],           // Separated
  contradictions: [D],     // Separated
  open_questions: [Q_C]    // From C's unresolved_reason
}
```

### Quality Invariants

- ✓ No claim without Verification
- ✓ No UNKNOWN claim silently converted to VERIFIED
- ✓ No INFERRED claim promoted to VERIFIED
- ✓ All contradictions preserved
- ✓ All unresolved questions tracked
- ✓ No unsupported facts in canonical knowledge

---

## 23. NOW / LATER / DEFERRED ROADMAP

### NOW (Minimal Production-Ready C4)

Implement ONLY:

1. **Deterministic synthesis ordering**
   - Sort claims before distributing to dimensions
   - Sort each dimension bucket
   - Purpose: reproducible package_id

2. **Synthesis metadata**
   - Add counts (verified, inferred, unknown, contradictions)
   - Add synthesis_timestamp
   - Purpose: quality assessment

3. **Knowledge version identity**
   - Add package_id (deterministic hash of topic + claims)
   - Add run_id reference
   - Purpose: version tracking

4. **Enhanced unresolved questions**
   - Add question_id (deterministic hash)
   - Track first_identified timestamp
   - Purpose: future research targeting

5. **Tests**
   - Determinism test (same claims → same order)
   - Version test (version numbers increment)
   - Multi-run test (ProjectMemory merges correctly)

### LATER (After Production Use)

Implement after first real video:

1. **Knowledge versioning system**
   - Store prior versions in ProjectMemory
   - Compare versions for evolution tracking
   - Build version history UI

2. **Contradiction resolution tracking**
   - Model for partial/full resolution
   - Resolution evidence tracking
   - Contradiction lifecycle

3. **Discipline metadata**
   - Add optional discipline field to Claim (future)
   - Add disciplines[] to ResearchScope (future)
   - Purpose: Tekno Polimat infrastructure

4. **Relationship extension point**
   - Reserve relationships field in KnowledgePackage
   - Define RelationshipCandidate type (no logic yet)
   - Purpose: future C6 interdisciplinary layer

### DEFERRED (Not Yet Justified)

Do NOT build:

- ✗ Graph database (ProjectMemory JSON is enough)
- ✗ Ontology system (hardcoded dimensions sufficient for now)
- ✗ Knowledge scoring (that's B's job)
- ✗ Automatic relationship detection (needs human verification)
- ✗ Semantic normalization (current claim structure is enough)
- ✗ Vector embeddings (premature optimization)
- ✗ LLM orchestration (manual synthesis is more reliable)

---

## 24. IMPLEMENTATION PLAN (Phased)

### PHASE 1: Design Approval

**User confirms:**
- ✓ Synthesis boundary (organize claims into dimensions)
- ✓ Knowledge boundary (version + metadata)
- ✓ Tekno Polimat extension point (reserved, not implemented)
- ✓ Determinism requirement (sorted orders)
- ✓ NOW/LATER/DEFERRED split

**Output:** Approved A_P1_CATEGORY4_PLAN.md

### PHASE 2: Minimal C4 Implementation

**Files to modify:**
1. types.ts
   - Add KnowledgePackageSynthesisMetadata (optional)
   - Add KnowledgePackageVersion (optional)
   - Keep KnowledgePackage frozen

2. pipeline.ts (runP105And106Synthesis)
   - Add deterministic sorting of verified claims
   - Add deterministic sorting of each dimension bucket
   - Add synthesis metadata collection
   - Return metadata alongside knowledge_package

3. ids.ts
   - Add stableKnowledgePackageId(topic, claimIds)
   - Add stableQuestionId(statement)

### PHASE 3: Focused Tests

1. Determinism test
   - Same claims in different order → same KP structure
   
2. Version test
   - Same topic + claims → same package_id
   
3. Multi-run test
   - Run 1 → V1
   - Run 2 → V2 (new claims)
   - Verify version sequence

4. Quality test
   - VERIFIED, INFERRED, UNKNOWN all preserved
   - Contradictions tracked
   - No unsupported facts

### PHASE 4: Typecheck & Build

```
npx tsc --noEmit
npm run build
npm test
```

### PHASE 5: Boundary Review

Verify:
- C4 consumes C3 (claims + verifications) ✓
- C4 produces C5 (knowledge_package + unresolved_questions) ✓
- C4 does NOT produce strategic decisions ✓
- C4 does NOT emit channel recommendations ✓
- P1.06 handoff unchanged or only extended ✓

### PHASE 6: Acceptance

If PHASE 5 passes → GREEN (ready for first production run)

If issues → repair and re-run PHASE 5

---

## 25. COMPLEXITY CONTROL

### Use Existing, Don't Build New

✓ Prefer:
- KnowledgePackage type (expand with caution)
- Claim/Evidence/Source provenance (immutable)
- Verification states (VERIFIED/INFERRED/UNKNOWN)
- ProjectMemory (already handles multi-run)
- Deterministic IDs (claim_id, evidence_id)
- Contradiction tracking (contradiction_refs)

✗ Do NOT add:
- Database (ProjectMemory JSON sufficient)
- Graph database (not needed yet)
- Ontology engine (hardcoded dimensions work)
- Vector database (premature optimization)
- LLM orchestration (manual synthesis more reliable)
- External provider (keep internal)
- New dependency (use existing)

### Minimal Additions

Only add:
1. Deterministic sorting logic (< 20 lines)
2. Metadata structs (< 30 lines, types only)
3. ID functions (< 30 lines)
4. Tests (< 150 lines)

**Total: ~200 lines, no breaking changes**

---

## DECISIONS REQUIRING USER APPROVAL

### Decision 1: Synthesis Scope

**Question:** Should C4 organize claims by dimension, or do more?

**Options:**
- A) Minimal: Just bucket claims (current behavior + determinism)
- B) Standard: Bucket + metadata + versioning (proposed)
- C) Maximal: Bucket + metadata + versioning + relationship inference (too much)

**Recommendation:** Option B (Standard)

**Rationale:** Versioning is needed for multi-run knowledge evolution. Metadata needed for quality assessment. Relationship inference can wait.

---

### Decision 2: Determinism Requirement

**Question:** Should knowledge packages be deterministically reproducible?

**Options:**
- A) Yes: Sort claims, sort dimensions (costs ~20 lines)
- B) No: Accept order variations (simpler, but breaks versioning)

**Recommendation:** Option A (Yes)

**Rationale:** Determinism enables version comparison, quality audit, and reproducible builds.

---

### Decision 3: Discipline Model

**Question:** When should Tekno Polimat discipline support be added?

**Options:**
- A) Now: Add to KnowledgePackage, ResearchScope
- B) Later: Add after first production run
- C) Deferred: Wait for demand signal

**Recommendation:** Option B (Later)

**Rationale:** Discipline is needed for future interdisciplinary relationships (C6+), not for current production. Adding now adds complexity without immediate benefit.

---

### Decision 4: Versioning Persistence

**Question:** How should knowledge versions be stored?

**Options:**
- A) In ProjectMemory (extend existing structure)
- B) In KnowledgePackageHistory (new top-level array)
- C) In handoff (new optional field)

**Recommendation:** Option A (ProjectMemory)

**Rationale:** ProjectMemory already persists across runs. Reusing it keeps architecture simple. Handoff can reference versions without storing them.

---

### Decision 5: Relationship Extension Point

**Question:** Should C4 reserve space for future interdisciplinary relationships?

**Options:**
- A) Yes: Add RelationshipCandidate type (documented, no logic)
- B) No: Leave for C6 to define when needed
- C) Minimal: Just comment that relationships[] is future extension point

**Recommendation:** Option C (Minimal)

**Rationale:** Comment is sufficient. Adding full type now without usage risks API design mistakes. Better to design C6 when building it.

---

## 26. MINIMAL C4 SUMMARY

### What C4 Does

```
Verified Claims (from C3)
        ↓
Organize by Dimension
        ↓
Track Verification State
        ↓
Collect Unresolved Questions
        ↓
Bundle as KnowledgePackage
        ↓
Version for Reproducibility
        ↓
Hand to P1.06 (C5 input)
```

### What C4 Does NOT Do

- Strategic evaluation ✗
- Channel recommendations ✗
- Content generation ✗
- Interdisciplinary relationships ✗
- Production planning ✗

### Core Guarantee

"Same verified research always produces same knowledge package."

---

## 27. COST/RISK ASSESSMENT

### Implementation Cost

- Code: ~200 lines (types + functions + tests)
- Complexity: Low (no architectural changes)
- Testing: 4-5 focused tests
- Time: 2-4 hours development + review

### Risk Level

- **Contract Risk:** LOW (KnowledgePackage type unchanged)
- **Compatibility Risk:** LOW (backward compatible)
- **Performance Risk:** NONE (sorting is O(n log n))
- **Dependency Risk:** NONE (no external deps)

### Rollback Plan

If issues arise:
1. Revert to current minimal synthesis
2. Deploy without versioning
3. Add features incrementally

---

## 28. CORRECTED C4 ARCHITECTURE (Four Corrections Applied)

### Correction 1: Synthesis Run ID
- ✅ **Deterministic hash** of (project_id + sorted source IDs + sorted claim IDs + sorted verification IDs)
- ✅ **No time component** — reproducible identity
- ✅ **Collision-resistant** — different inputs produce different IDs

### Correction 2: Timestamp Separation
- ✅ **synthesis_run_id** = knowledge identity (time-independent)
- ✅ **synthesis_timestamp** = execution metadata (time-dependent)
- ✅ **Same inputs at different times** = same run_id, different timestamp

### Correction 3: ProjectMemory Versioning
- ✅ **Verified:** ProjectMemory already supports append-only multi-run tracking
- ✅ **Gap:** Does NOT currently store KnowledgePackage output
- ✅ **Solution:** Extend ProjectMemory.knowledge_packages[] with synthesis_run_id deduplication
- ✅ **No new database** — leverage existing deduplication pattern

### Correction 4: Full Deterministic Ordering
- ✅ **All unordered collections** must have stable sort rules:
  - Each dimension array: sort by claim_id (lexicographic)
  - contradictions array: sort by claim_id
  - unknowns array: sort by claim_id
  - open_questions array: sort lexicographic string
  - evidence_refs[] (per claim): sort by evidence_id
  - contradiction_refs[] (per claim): sort by claim_id
- ✅ **Guarantee:** Same input → identical byte-for-byte JSON output

---

## 29. IMPLEMENTATION FILES (Corrected Minimal List)

### Phase 2: C4 Implementation

**File: `pipeline1_research/src/types.ts`**
- Add SynthesisMetadata interface (~15 lines)
- No changes to KnowledgePackage type (frozen)
- Document relationship extension point (comment only)

**File: `pipeline1_research/src/pipeline.ts`**
- Update runP105And106Synthesis() with sorting logic (~50 lines)
- Compute synthesis_run_id deterministically (~10 lines)
- Add metadata computation (~10 lines)
- Update draftHandoff() call signature if needed (~5 lines)

**File: `pipeline1_research/src/memory.ts`** (Optional for Phase 2)
- Extend ProjectMemory.knowledge_packages?: KnowledgePackageVersion[] (~5 lines)
- Deferred to Phase 3 if low risk

**Total Phase 2 Addition:** ~95 lines (original estimate 200 lines now reduced by correction)

### Phase 3: Tests

**File: `pipeline1_research/tests/pipeline.test.ts`**
- Test deterministic sorting (same input → same output) (~30 lines)
- Test synthesis_run_id stability (~20 lines)
- Test metadata computation (~15 lines)
- Total: ~65 lines of new test code

---

## 30. UNRESOLVED RISKS & MITIGATIONS

| Risk | Severity | Mitigation |
|---|---|---|
| synthesis_run_id hash collision (extremely rare) | LOW | Use SHA-256 with 32-char prefix (collision resistance) |
| ProjectMemory extension breaks multi-run merge | MEDIUM | Inspect mergeUnique() logic, test with 3-run scenario |
| Deterministic ordering changes API contracts | LOW | KnowledgePackage type frozen; only array order changes (backward compatible) |
| Performance of sorting large claims (1000+) | LOW | O(n log n) sorting negligible; test with worst-case |

**Mitigation Plan:** Phase 5 boundary review catches all issues before acceptance.

---

## CONCLUSION

P1 Category 4 is underdeveloped relative to C1-C3. The **corrected minimum production-ready implementation:**

1. ✅ **Corrected synthesis_run_id** — deterministic, collision-resistant, time-independent
2. ✅ **Timestamp separation** — execution metadata distinct from knowledge identity
3. ✅ **ProjectMemory extension** — append-only versioning via existing deduplication
4. ✅ **Full deterministic ordering** — all collections have stable sort rules
5. ✅ **Preserves current behavior** — dimension bucketing unchanged
6. ✅ **Adds reproducibility** — same inputs always produce same output
7. ✅ **Reserves extension point** — future Tekno Polimat support (comment only)

**Result:** Reusable, reproducible, versionable knowledge that supports multi-channel use and research evolution.

---

## FINAL DECISION RECORD

**Approved Design Decisions:**
1. Metadata = Option B (Standard: counts + timestamps + run_id)
2. Determinism = Option A (Full sorting)
3. Discipline model = Later (after first production run)
4. Versioning = ProjectMemory (extend existing, no new database)
5. Relationship extension = Comment only (document, no type stub)

**Four Corrections Applied:**
1. ✅ synthesis_run_id corrected to deterministic content hash
2. ✅ timestamp vs determinism separated
3. ✅ ProjectMemory verified and extension defined
4. ✅ Full deterministic ordering rules defined for all collections

---

**Status:** PLANNING COMPLETE — READY FOR IMPLEMENTATION

**Next Step:** User confirms corrected architecture is acceptable, then Phase 1 → Phase 6 implementation proceeds.

---

**Plan Updated:** 2026-09-03 (Design Correction Phase)  
**Authority:** Live A-Branch source code inspection + four corrections  
**Scope:** A-BRANCH ONLY — Do NOT modify P2, P3, B, C1, C2, C3, C5
