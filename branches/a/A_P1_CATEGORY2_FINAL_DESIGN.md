# A_P1_CATEGORY2_FINAL_DESIGN.md

**P1 Category 2: Discovery & Acquisition Architecture**

**Date:** 2026-09-03  
**Version:** 1.0 (Final Design Lock)  
**Status:** APPROVED WITH CORRECTIONS  
**Authority:** User-approved corrections to design decisions  

---

## PURPOSE

P1 Category 2 (Discovery & Acquisition) adds systematic discovery and multi-provider acquisition to the live P1.03 (Domain Research) phase. Currently, P1.03 takes pre-supplied queries and calls `engine.investigate()` for each. This design extends P1.03 to:

1. Call `engine.discover()` to generate candidate sources
2. Track acquisition attempts across multiple providers (with fallback strategy)
3. Record discovery and acquisition lineage immutably
4. Maintain point-in-time observations on candidates and sources
5. Expose discovery/acquisition context to Pipeline 2 (B) for strategic evaluation, without committing strategic decisions to P1

**Key Constraint:** P1 discovers, acquires, and records. B evaluates, prioritizes, and decides.

---

## CURRENT LIVE P1.03 ANATOMY

**File:** pipeline1_research/src/pipeline.ts  
**Function:** runP103DomainResearch() (lines 169-238)

**Current Behavior:**
- Input: `approvedScope: ResearchScope`, `queries: string[]` (pre-supplied)
- Process: For each query, call `engine.investigate(approvedScope, query)`, collect results
- Output: Sources, Evidence, Claims (no discovery phase, no candidate tracking, no acquisition history)

**Missing:**
- No call to `engine.discover()` to generate candidate sources
- No discovery lifecycle state
- No acquisition attempt history
- No multi-provider fallback tracking
- No discovery lineage recording

---

## CANDIDATE MODEL (Internal P1.03 State)

**Definition:** A discovered-but-not-yet-acquired source candidate. Internal to P1.03 discovery phase.

**NOT a handoff entity.** Candidates do not export to Pipeline 2 or beyond.

### Identity & Lifecycle

**Deterministic Hash:** `candidate_id = hash(topic, discovery_method, discovered_resource_identifier)`

**Immutability:** Once created, Candidate record is immutable.

**Lifecycle:**
```
engine.discover()
  ↓
Candidate created (status: "discovered")
  ├→ acquisition phase begins (status: "acquiring")
  │    ├ AcquisitionAttempt #1 (Provider A) → FAILED
  │    ├ AcquisitionAttempt #2 (Provider B) → SUCCEEDED
  │    └ Source created (resolved_source_id)
  └ status transitions to "resolved" (acquisition succeeded) or "expired" (all attempts failed)
```

### Data Structure

```typescript
interface Candidate {
  candidate_id: string;                // Deterministic hash
  discovered_at: string;               // ISO 8601 timestamp
  topic: string;                       // From ResearchScope
  discovery_method: string;            // How found: "search", "api", "manual", etc.
  discovery_provider: string;          // Who discovered: "engine", "agent", etc.
  discovery_rationale: string;         // Why selected
  resource_description: string;        // What was found
  observable_signals: ObservableSignal[]; // Initial observations
  acquisition_attempts: string[];      // FK array to AcquisitionAttempt.attempt_id
  status: "discovered" | "acquiring" | "resolved" | "expired";
  resolved_source_id?: string;         // FK to Source (set when acquisition succeeds)
  scope_id: string;                    // FK to ResearchScope
}

interface ObservableSignal {
  signal_name: string;                 // "view_count", "creator_reputation", etc.
  signal_value: string | number;       // Observed value
  observed_at: string;                 // ISO 8601 (point-in-time)
  source_of_signal: string;            // "api", "scrape", "manual", etc.
}
```

### Visibility

- **P1.03 Internal:** Full Candidate lifecycle visible during acquisition loop
- **Handoff to B:** Candidate[] is NOT exported
- **Rationale:** Candidate is discovery-phase state; once resolved to Source, Candidate becomes historical. B evaluates Sources, not Candidates.

---

## ACQUISITIONATTEMPT MODEL (Immutable Attempt History)

**Definition:** One attempt to acquire a Candidate into a usable Source. Preserves multi-provider fallback history immutably.

### Scenario

```
URL discovered
  ↓
AcquisitionAttempt #1 (Provider: "piper")
  ├ status: "failed"
  ├ failure_reason: "rate_limited"
  ├ attempted_at: 2026-09-03T10:00:00Z
  
  ↓
AcquisitionAttempt #2 (Provider: "gtts")
  ├ status: "succeeded"
  ├ resolved_source_id: "SOURCE-voice-abc123"
  ├ completed_at: 2026-09-03T10:05:00Z
```

### Data Structure

```typescript
interface AcquisitionAttempt {
  attempt_id: string;                  // UUID or deterministic hash
  candidate_id: string;                // FK to Candidate
  provider: string;                    // "piper", "gtts", "elevenlabs", "api", etc.
  access_method: string;               // "local_subprocess", "http", "api", etc.
  requested_at: string;                // ISO 8601 (attempt start)
  completed_at?: string;               // ISO 8601 (attempt finish)
  status: "pending" | "in_progress" | "succeeded" | "failed";
  failure_reason?: string;             // "rate_limited", "not_found", "timeout", etc.
  resolved_source_id?: string;         // FK to Source (only if succeeded)
  duration_ms?: number;                // Time spent in attempt
  error_details?: {
    error_code?: string;
    error_message?: string;
    error_context?: Record<string, unknown>;
  };
}
```

### Immutability Guarantee

- Each AcquisitionAttempt is an immutable historical record
- Multiple attempts on same Candidate are allowed (array relationship)
- Latest attempt with status="succeeded" determines Source resolution
- Failed attempts remain in history for smart retry strategies
- Do NOT modify or delete attempts once recorded

### Design Decision: Multiple Attempts

One Candidate may have many AcquisitionAttempt records. This preserves:
- Provider fallback history (which providers failed, why, when)
- Smart retry strategies (B can inspect chain, decide re-attempt logic)
- Diagnostic trail (what was tried, what failed, why)

P1 does NOT:
- Automatically retry indefinitely
- Rank providers by cost
- Switch providers based on strategic value
- Commit to retry strategy

Decision deferred to B and configuration.

---

## OBSERVATION MODEL (Immutable Point-in-Time Snapshots)

**Definition:** An immutable observation of a metric or signal at a specific timestamp. Enforces exactly-one ownership: belongs to Candidate XOR Source, never both.

### Semantic Rule

```
candidate_id XOR source_id
```

Exactly one owner must exist:
- If `candidate_id` is set, `source_id` must be null
- If `source_id` is set, `candidate_id` must be null
- Never both set; never both null

### Data Structure

```typescript
interface Observation {
  observation_id: string;              // Deterministic hash (owner_id + metric + timestamp)
  candidate_id?: string;               // FK to Candidate (mutually exclusive with source_id)
  source_id?: string;                  // FK to Source (mutually exclusive with candidate_id)
  observed_at: string;                 // ISO 8601 (when observation made)
  metric_name: string;                 // "view_count", "engagement_rate", "like_ratio", etc.
  metric_value: string | number;       // Observed value
  source_of_observation: string;       // "api", "scrape", "manual", "realtime", etc.
  context?: Record<string, unknown>;   // Platform, region, demographic, etc.
  immutable: true;                     // Enforced: never update, only append new
}
```

### Temporal Behavior

- **Immutability:** Once recorded, observation is never modified or deleted
- **Append-Only:** To record value changes, create new Observation at new timestamp
- **Time-Series:** Multiple observations on same entity = time-series view
- **No Backfill:** Do not rebuild or correct historical observations; append corrections as separate records

### Lifecycle

- **On Candidate:** Captured during discovery phase (initial signals)
- **On Source:** Captured during/after acquisition and in later re-examination phases
- **Handoff:** Source Observations export to Pipeline 2 for strategic evaluation; Candidate Observations remain internal

---

## SOURCE BOUNDARY (Persistent Resource Identity)

**Definition:** A persistent acquired resource. Acquired exactly once, immutable post-acquisition.

### Identity

**Deterministic Hash:** `source_id = hash(origin, source_type, platform, region?)`

**Immutability:** Once created by successful acquisition, Source.source_id never changes.

**Uniqueness:** One URL/origin = one Source, regardless of how many times discovered or re-examined.

### Frozen Fields (Existing Contract)

```typescript
interface Source {
  source_id: string;              // Frozen: deterministic hash
  origin: string;                 // Frozen: URL, ID, or locator
  source_type: "primary" | "secondary" | "tertiary";  // Frozen: semantic classification
  retrieved_at: string;           // Frozen: ISO 8601 (first retrieval timestamp)
  access_method: string;          // Frozen: how we accessed (http, api, subprocess, manual, etc.)
  reliability_notes?: string;     // Optional: editorial notes on source reliability
}
```

### What NOT to Add to Source

- **Acquisition history:** That's AcquisitionAttempt[]
- **Observation history:** That's Observation[]
- **Discovery method:** That's Candidate.discovery_method
- **Provider information:** That's AcquisitionAttempt.provider
- **source_origin field:** Do not add now; existing source_type semantics remain intact

**Rationale:** Source represents the acquired resource identity only. Provenance, attempt history, and observations live elsewhere (see Provenance Preservation section below).

---

## DISCOVERY MODEL (P1.03.A Integration)

**Definition:** How engine.discover() integrates into P1.03 as a discovery sub-function.

### P1.03.A: Discovery Sub-Function

**Input:**
- `approvedScope: ResearchScope` (from P1.02)
- `engine: ResearchEngine` (concrete provider implementation)

**Process:**

1. Call `engine.discover(approvedScope.topic, approvedScope.constraints)`
2. Receive `DiscoverResult[]` from engine

   ```typescript
   interface DiscoverResult {
     direction: string;                 // Research direction/focus to pursue
     rationale: string;                 // Why this direction selected
   }
   ```

3. For each direction in DiscoverResult[]:
   - Generate queries (combining dimensions × directions)
   - For each query, call `engine.investigate(approvedScope, query)`
   - Collect findings into Candidate[] with discovery metadata
   - Record `ObservableSignal[]` captured during discovery

4. Output: `Candidate[]` (awaiting acquisition phase)

### Request Mode Guidance

**STANDARD_RESEARCH:** Discover primary sources matching topic
- Focus: Direct primary sources (research papers, interviews, primary data)
- Use: When systematic topic coverage needed

**CONCEPT_RESEARCH:** Discover external successful concepts for strategic evaluation
- Focus: Successful examples (YouTube series, Bilibili formats, creator strategies, content patterns)
- Output: Observable success signals (views, engagement, growth, audience engagement)
- Constraint: Do NOT evaluate strategic fit; that's B's job

**REFERENCE_ANALYSIS:** Discover reference materials
- Focus: Papers, books, documentation, authoritative texts
- Output: Source origin classification, reliability notes

**UPDATE_RESEARCH:** Re-discover existing topic
- Focus: Same topic as prior research run
- Output: New Candidates, compare against prior Observations, detect changes/obsolescence

---

## CONCEPT DISCOVERY (What P1 May & Must NOT Do)

**Definition:** P1 may discover successful external patterns and observable signals. P1 must NOT evaluate strategic value.

### What P1 May Discover

- YouTube series formats, Bilibili channel strategies, creator niches
- Content series patterns, cross-platform adaptations
- Observable public success signals: views, engagement rate, growth rate
- Language-specific variations, temporal patterns (seasonal, trending, evergreen)
- Creator/channel metadata (followers, posting frequency, audience demographic)

### What P1 Must NOT Do

- Evaluate "is this good for Tekno Polimat?"
- Rank by strategic value or competitive advantage
- Decide channel fit or adaptation feasibility
- Recommend adoption or strategic direction
- Assess competitive advantage or market positioning

Those are B responsibilities.

### Captured Metadata

```typescript
interface ConceptObservation {
  observation_id: string;
  concept_name: string;                // "YouTube Shorts series format", etc.
  source_id: string;                   // FK to Source (the example source)
  platform: string;                    // "youtube", "bilibili", "instagram", etc.
  region: string;                      // "US", "CN", "global", etc.
  language: string;                    // "en", "zh-CN", etc.
  creator_or_channel: string;          // Who executes this successfully
  observable_signals: {
    view_count?: number;
    engagement_rate?: number;
    series_length?: number;
    upload_frequency?: string;
    audience_demographic?: string;
  };
  pattern_observed: string;            // Structural observation (NOT evaluation)
  evidence_sources: string[];          // Links to source observations
  observed_at: string;                 // ISO 8601
}
```

---

## CROSS-MARKET & CROSS-LANGUAGE DISCOVERY

**Source Market:** Where content originates  
**Target Market:** Where Tekno Polimat might adapt (B decides)

### What P1 Captures

- Source market (CN, US, global)
- Source language (zh-CN, en, multilingual)
- Source platform (YouTube, Bilibili, Instagram)
- Source creator region (from metadata)
- Observable signals in source market
- Platform-specific adaptations of same content

### What P1 Does NOT Capture

- Target market viability assessment
- Language adaptation difficulty
- Regional competitiveness
- Cross-platform strategy implications

Those are B decisions.

### Platform Deduplication Rule (Corrected)

Do NOT model the same logical content across multiple platforms as one Source merely because content is similar.

**Platform-specific sources remain distinct** where they have distinct locators/platform identities:
- Same creator's YouTube video + Bilibili reuploaded version = 2 separate Sources (distinct URLs)
- Link them via Observation[] showing adaptation pattern, not by collapsing to one Source

**Future extensibility** (not implemented now):
```
Concept / Content Family (future model)
  ├ Source: YouTube version
  ├ Source: Bilibili version
  └ Source: Instagram Reels adaptation
```

Do NOT implement Concept as canonical entity yet. Keep Sources distinct by platform.

---

## ACCESS LAYER (Provider-Neutral Interface)

**Definition:** Abstracts discovery/investigation/verification from concrete provider implementations.

### Architecture

```
P1.03 Pipeline Logic
  ↓
Research Access Layer (Frozen Interface)
  ├── discover(topic, constraints) → DiscoverResult[]
  ├── investigate(scope, query) → InvestigateResult
  └── verify(claim, evidenceRefs) → VerifyResult
  ↓
Concrete Implementations
  ├── ManualResearchEngine (reference, deterministic)
  ├── Agent-Reach adapter (optional, replaceable)
  ├── Official API adapter (future)
  ├── Web/scrape adapter (future)
  └── Custom adapter (future)
```

### Provider Contract (Immutable)

```typescript
interface ResearchEngine {
  discover(topic: string, constraints: string[]): Promise<DiscoverResult[]>;
  investigate(approvedScope: ResearchScope, query: InvestigateQuery): Promise<InvestigateResult>;
  verify(claim: Claim, evidenceRefs: string[]): Promise<VerifyResult>;
}
```

**No interface changes.** Implementations adapt as needed.

### Constraints

- Agent-Reach is OPTIONAL (not mandatory)
- Agent-Reach is at ADAPTER LEVEL (not core)
- Core architecture must NOT depend on Agent-Reach
- ManualResearchEngine remains reference implementation
- All providers must implement same interface

---

## PROVIDER FALLBACK STRATEGY (Multi-Provider Acquisition)

**Scenario:** Voice synthesis acquisition chain

```
URL discovered
  ├ AcquisitionAttempt #1: provider="piper" → status="failed", reason="rate_limited"
  ├ AcquisitionAttempt #2: provider="gtts" → status="succeeded", resolved_source_id="SOURCE-voice-123"
```

### Smart Retry Logic (B Responsibility)

B can inspect AcquisitionAttempt[] chain and decide:
- "Rate-limited? Retry after cooldown, then fallback to gTTS"
- "Not found? Skip automatic retry (permanent unavailability)"
- "Timeout? Network issue; retry same provider"

### What P1 Does NOT Do

- Automatically retry indefinitely
- Decide which provider is "better"
- Rank providers by cost or quality
- Switch providers based on strategic value

**Decision deferred** to configuration, adapter selection, and B evaluation.

---

## PROVENANCE PRESERVATION (Three Distinct Layers)

**Rule:** Provenance layers must remain semantically distinct.

### Layer 1: Discovery Provenance

**What:** How a Candidate was found  
**Recorded On:** Candidate  
**Fields:** discovery_method, discovery_provider, discovery_rationale  
**Immutability:** Immutable once Candidate created  
**Example:** "found via engine.discover() → semantic search → DiscoverResult #3"

### Layer 2: Acquisition Provenance

**What:** How a Candidate became a Source  
**Recorded On:** AcquisitionAttempt[] + Source  
**Fields:** provider, access_method, retrieved_at, attempt history  
**Immutability:** Each AcquisitionAttempt immutable; Source.retrieved_at immutable  
**Example:** "acquired via gtts HTTP API on 2026-09-03T10:05:00Z after piper rate-limited"

### Layer 3: Evidence Provenance

**What:** Where a factual assertion came from  
**Recorded On:** Evidence, Claim  
**Fields:** source_id, excerpt_or_pointer, extraction_method  
**Immutability:** Immutable in frozen Evidence contract  
**Example:** "extracted from SOURCE-123, paragraph 5, via manual reading"

### Separation Guarantee

- `Candidate.discovery_method` ≠ `Source.access_method` ≠ `Evidence.extraction_method`
- Each records different stage of knowledge flow
- No field should conflate stages
- All three layers preserved for historical accuracy and audit trail

---

## CANDIDATE → SOURCE (Not "Transformation")

**Clarification:** Do not describe Candidate as literally transforming into Source.

**Correct Model:**
- Candidate is a discovery-phase lifecycle record
- Successful acquisition (first AcquisitionAttempt.status="succeeded") **resolves** a Source
- Source identity (source_id) is determined from origin/platform/type, not inherited from Candidate
- Candidate.resolved_source_id (FK) links historical record to resulting Source
- Candidate remains immutable historical state

**Why Matters:**
- Candidate is ephemeral discovery artifact
- Source is canonical resource identity
- Multiple Candidates may resolve to same Source (same resource re-discovered)
- Candidate → Source is a resolution relationship, not a state transition

---

## FROZEN HANDOFF STRATEGY (P1.06 ResearchPackageHandoff Extension)

### Current Contract (14 Frozen Fields)

```typescript
interface ResearchPackageHandoff {
  // Frozen fields (existing):
  package_id: string;
  schema_version: string;
  project_id: string;
  manifest: Manifest;
  integrity_hashes: Record<string, string>;
  research_scope: ResearchScope;
  sources: Source[];                    // ← Acquired sources
  evidence: Evidence[];
  claims: Claim[];
  verifications: Verification[];
  knowledge_package: KnowledgePackage;
  unresolved_questions: string[];
  handoff_notes: string;
  gates: Gate[];
}
```

### Extension: Optional category_2_context

```typescript
interface ResearchPackageHandoff {
  // ... existing 14 fields (frozen, unchanged) ...
  
  // NEW (optional):
  category_2_context?: {
    acquisition_history: AcquisitionAttempt[];  // What providers were tried, outcomes
    observations: Observation[];                 // Source observations only (not Candidate)
    discovery_lineage: {                         // How sources were discovered
      topic: string;
      discovery_method: string;
      discovery_provider: string;
      discovery_rationale: string;
    }[];
  };
}
```

### Handoff Rules (Corrected)

**MUST export:**
- Source[] (all acquired sources)
- Evidence[] (all evidence)
- Verification[] (all verifications)
- Knowledge (synthesized knowledge package)

**MUST NOT export:**
- Candidate[] (internal P1.03 discovery state only)

**MAY export (recommended):**
- Observation[] (Source observations only, for initial insights into signal patterns)
- AcquisitionAttempt[] (provider fallback history, for transparency)
- Discovery lineage (how sources were found, for context)

**Rationale:** 
- Candidate is ephemeral discovery artifact; not needed by B
- Sources, Evidence, Verification are canonical; required by B
- Observations and AcquisitionAttempt provide context for B evaluation without forcing strategic decisions onto P1

---

## C2 → C3 COMPATIBILITY (Evidence & Verification Flow)

**Flow Guarantee:**

```
P1.03 Discovery & Acquisition
  → Candidate[] (internal state, internal only)
  → AcquisitionAttempt[] (optional handoff context)
  → Source[] (MUST handoff)
  → Evidence[] (MUST handoff)
  → Observation[] (MUST handoff)
  ↓
P1.04 Verification
  → Verification[] (MUST handoff)
  ↓
P1.05/06 Synthesis & Handoff
  → Knowledge Package (canonical output)
```

### Constraints

- Candidate must NOT flow to C3 directly (C3 works with Sources, not Candidates)
- Source + Evidence + Observation form complete picture for C3
- C3 receives strategic context (Observation patterns) without P1 deciding strategy
- All three provenance layers intact (Discovery, Acquisition, Evidence)

### Test Case: Acquisition Failure

Scenario: Candidate fails all acquisition attempts
- Result: No Source created
- Flow to C3: Nothing exported (failed candidate = no source for verification)
- Status: Candidate remains as internal historical record only

---

## TEKNO POLIMAT EXTENSION POINT (Future Interdisciplinary)

**DO NOT implement now. Only preserve the extension point.**

### Future Vision (Not Implemented)

```
Topic
  ↓
Discipline A (Mathematics)
  ↓
Relationship: "applies_to" / "informs" / "contradicts"
  ↓
Discipline B (Technology)
  ↓
Evidence: source citations linking disciplines
  ↓
Verified Cross-Disciplinary Claim
```

### What C2 Preserves Now

In Candidate/Observation metadata, record (but do not act on):

```typescript
{
  related_disciplines?: string[];       // ["Physics", "Chemistry"]
  relationship_type?: string;           // "applies_to", "contradicts", etc.
  cross_reference_sources?: string[];   // Links to related discoveries
}
```

### Future C6 (Not in Scope)

Future interdisciplinary category can:
- Consume Candidate/Observation metadata with discipline tags
- Build Relationship graph across categories
- Verify cross-disciplinary claims

### Current C2 Constraints

- Do NOT build relationships
- Do NOT verify cross-disciplinary links
- Do NOT decide relevance to other disciplines
- Just preserve the metadata structure; let future layers interpret

---

## MULTI-PLATFORM TEST (One Creator, Multiple Platforms)

**Scenario:** Creator uploads same concept to YouTube, Bilibili, Instagram, TikTok, X

### Design Validation

```
Candidate (discovered concept)
  ├ discovery_method: "YouTube channel analysis"
  ├ discovery_source: "https://youtube.com/@creator"
  
  ├ AcquisitionAttempt[0] → Source-YouTube
  ├ AcquisitionAttempt[1] → Source-Bilibili
  ├ AcquisitionAttempt[2] → Source-Instagram
  ├ AcquisitionAttempt[3] → Source-TikTok
  └ AcquisitionAttempt[4] → Source-X

Observation[] (per Source):
  - YouTube: 1.2M views, 2.1% engagement, observed_at: 2026-09-03
  - Bilibili: 450K views, 3.8% engagement, observed_at: 2026-09-03
  - Instagram: 280K views, 1.9% engagement, observed_at: 2026-09-03
  - TikTok: 890K views, 5.2% engagement, observed_at: 2026-09-03
  - X: 42K impressions, 1.1% engagement, observed_at: 2026-09-03
```

### Design Answers

1. **One Candidate or many?** → One (same creator, same concept)
2. **One Source or many?** → Five (distinct URLs, distinct platforms, distinct platform-specific metrics)
3. **Deduplication?** → By origin URL + platform, not by concept similarity
4. **Observations?** → Per Source, distinct for each platform (platform-specific metrics are distinct)

**Key Invariant:** Do not model same logical content across platforms as one Source. Keep Sources distinct; link via Observations showing adaptation.

---

## MULTI-CHANNEL TEST (One Research, Multiple Applications)

**Scenario:** "Time-lapse Photography" researched for Main Tekno Polimat, Mathematics, Technology, Psychology, Art

### Knowledge Reuse Model

```
P1 creates ONE research knowledge base:
  └ Sources (scientific papers, YouTube tutorials, etc.)
  └ Evidence (verifiable facts)
  └ Observations (technique performance signals)
  └ Verifications (cross-checked claims)
  └ Knowledge (synthesized)

Each channel queries same knowledge base:
  ├ Main Tekno Polimat: "Accessible overview"
  ├ Mathematics: "Fractal application focus"
  ├ Technology: "Hardware/software deep dive"
  ├ Psychology: "Perception mechanics"
  └ Art: "Creative technique variations"
```

### P1 Responsibility

- Discover research across all channels (use request_mode to guide focus)
- Create reusable research (not channel-specific)
- Do NOT decide channel fit or applicability

### B Responsibility

- Evaluate channel applicability
- Decide which parts to use in each channel
- Adapt knowledge to channel context

### Design Answer

**Does P1 create separate research per channel?** → NO. One research, multiple channel applications.

---

## MAINTENANCE TEST (Research Evolution Across Runs)

**Scenario:** Same topic researched in Run 1 (Sept), Run 2 (Oct), Run 3 (Nov)

### Run Progression

```
Run 1 (Sept 2026):
  └ Candidates: A, B, C
  └ Sources: 1, 2, 3 (from successful acquisitions)
  └ Observations: {S1: views=1.2M}, {S2: views=800K}, {S3: views=450K}

Run 2 (Oct 2026):
  └ Re-discover same topic
  └ Candidates: A (stable), B (changed), C (expired), D (new)
  └ Sources: 1 (stable), 2 (stable), 4 (new acquisition)
  └ Observations: {S1: views=1.9M (new)}, {S2: views=920K (new)}, {S3: (gone)}, {S4: views=500K (new)}

Run 3 (Nov 2026):
  └ Re-discover same topic
  └ Candidates: A (stable), B (stable), C (still expired), D (stable)
  └ Sources: 1, 2, 4 (stable)
  └ Observations: {S1: views=2.3M (new)}, {S2: views=1.1M (new)}, {S4: views=750K (new)}
```

### Immutability Guarantees

- **Source identity:** Stable across runs (source_id never changes)
- **Observations:** Append-only (new observations at new timestamps, never replace)
- **Candidate identity:** Stable if same resource rediscovered
- **AcquisitionAttempt history:** Immutable per run; new attempts in new runs

### Knowledge Evolution

- Synthesis re-runs on each execution
- Verification re-checks based on new evidence
- Knowledge package updated per run
- Historical observations preserved for trend analysis

### Design Answer

**Can P1 be re-run?** → YES. Candidate and Source identity persist; Observations append; Knowledge updates.

---

## COST & PROVIDER POLICY (Provider Selection Hierarchy)

### Tier 1: Free / Open Sources (Preferred)

- Wikipedia, arXiv, academic repositories
- Public APIs with generous quotas
- Open datasets
- No cost barrier

### Tier 2: Low-Cost Providers (Next)

- Piper (local TTS, CPU cost only)
- gTTS (free-tier with reasonable volume limits)
- Free-tier APIs (with acceptable rate limits)

### Tier 3: Paid Providers (Justified Only)

- ElevenLabs (when quality requirement exceeds free alternatives)
- Kaggle compute (when processing scale exceeds local)
- Premium APIs (only if research cannot proceed otherwise)

### Provider Replaceability

- All providers implement same interface (ResearchEngine)
- Swapping providers requires only implementation change
- P1.03 logic does NOT depend on specific provider
- Cost decisions made at adapter level, not in core pipeline

### No Hardcoded Provider Decisions

P1.03 does NOT:
- Decide ElevenLabs is "better" than gTTS
- Rank providers by cost
- Optimize for provider efficiency
- Lock into single provider

**Decision deferred to:**
- Configuration (env vars, settings.json)
- Adapter selection (which concrete implementation to load)
- B evaluation (strategic cost/quality tradeoffs)

---

## INVARIANTS & IMMUTABILITY

### Immutable Structures

| Structure | Immutable? | Reason |
|-----------|-----------|--------|
| Candidate | ✅ YES (post-creation) | Discovery is point-in-time event |
| AcquisitionAttempt | ✅ YES (per attempt) | Attempt outcome is historical fact |
| Observation | ✅ YES (append-only) | Observations are point-in-time snapshots |
| Source | ✅ YES (post-acquisition) | Resource identity must be stable |

### Deduplication Rules

| Entity | Dedup Key | Rule |
|--------|-----------|------|
| Candidate | hash(topic, method, resource_id) | Same resource rediscovered = same Candidate |
| Source | hash(origin, source_type, platform) | Same URL = same Source (immutable identity) |
| Observation | hash(source_id, metric, timestamp) | Same metric at same moment = same snapshot |

### Lifecycle Transitions

| From | To | Condition |
|------|----|-|
| Candidate | Source | First successful AcquisitionAttempt |
| Candidate | Expired | All AcquisitionAttempts failed |
| Source | Evidence | Input to P1.04 |
| Evidence | Verification | Input to P1.05 |

---

## B VISIBILITY (What Exports to Pipeline 2)

### MUST Export (Required)

- **Source[]** (all acquired sources)
- **Evidence[]** (all evidence assertions)
- **Verification[]** (verification results)
- **Knowledge** (synthesized knowledge package)

### MUST NOT Export

- **Candidate[]** (internal P1.03 discovery state only)

### MAY Export (Optional, Recommended)

- **Observation[]** (Source observations only, for strategic evaluation)
- **AcquisitionAttempt[]** (provider fallback history, for transparency)
- **Discovery lineage** (topic, method, provider, rationale)

### B's Use of Context (Not P1's Role)

B will:
- Evaluate Observation patterns to understand signal trends
- Inspect AcquisitionAttempt history to understand provider reliability
- Review discovery lineage to understand source quality
- Make strategic decisions about channel fit, cost, source prioritization

P1 provides context. B makes strategic decisions.

---

## FINAL INVARIANT: Separation of Concerns

```
P1 Responsibility:
  ├ Discover candidates (engine.discover)
  ├ Acquire sources (engine.investigate + multi-provider fallback)
  ├ Record observations (immutable point-in-time)
  ├ Preserve provenance (discovery + acquisition + evidence layers)
  └ Expose context to B

B Responsibility:
  ├ Evaluate sources against strategic criteria
  ├ Prioritize sources by channel fit and value
  ├ Decide acquisition strategy for high-priority candidates
  ├ Assess cost/benefit of provider strategies
  └ Make strategic decisions (channel fit, content strategy, adaptation)
```

**Rule:** P1 discovers, acquires, and records. B evaluates, prioritizes, and decides.

---

## DEFERRED IMPLEMENTATION PHASES

**DO NOT execute these phases now.**

### Phase 1: Design Approval ✅ COMPLETE
- User reviewed and approved design with corrections
- 6 design decisions resolved
- No code changes in this phase

### Phase 2: Minimal C2 Implementation (BLOCKED)
- Implement Candidate type
- Implement AcquisitionAttempt type
- Wire engine.discover() into P1.03
- Integrate acquisition status tracking
- Update P1.06 handoff strategy

### Phase 3: Focused Tests (BLOCKED)
- Unit tests for Candidate creation
- Unit tests for AcquisitionAttempt chaining
- Integration test: discovery → candidate → acquisition → source
- Provider fallback test

### Phase 4: Typecheck & Build (BLOCKED)
- `npx tsc --noEmit` (P1: 0 errors)
- `npm run build` (P1: exit 0)
- `npm test` (P1: 46/46 or higher)

### Phase 5: Hostile Boundary Review (BLOCKED)
- Does C2 wrongly evaluate strategically? (Should not)
- Does C2 wrongly decide channel fit? (Should not)
- Does C2 wrongly rank by cost? (Should not)
- All strategic decisions remain with B

### Phase 6: Operational Validation (BLOCKED)
- Test with real engine.discover() output
- Test multi-platform deduplication
- Test multi-channel knowledge reuse
- Test maintenance / re-run evolution

---

## IMPLEMENTATION STATUS

🔴 **BLOCKED — Awaiting final user approval.**

**DO NOT:**
- Modify pipeline1_research source code
- Add Candidate type
- Add AcquisitionAttempt type
- Wire engine.discover()
- Install Agent-Reach
- Add tests
- Commit changes
- Push to remote
- Merge

**STOP.**

---

**Design Lock Date:** 2026-09-03  
**Design Version:** 1.0 (Final, User-Approved with Corrections)  
**Authority:** User-provided corrections to all 6 design decisions

