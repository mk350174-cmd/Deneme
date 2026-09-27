# B-BRANCH — FINAL REPAIR + AGENT REACH INTEGRATION MASTER PLAN
## Fresh-Chat Context Package for ChatGPT Astra 6

**Date:** 2026-09-06  
**Scope:** B-Branch only, B00→B12  
**Current release baseline:** `B_BRANCH_V5_REPAIRED_FINAL_20260906`  
**Excluded:** Legacy SOP / M01–M10, Tekno Polimat identity, channel architecture, content/brand redesign

---

# 0. PURPOSE OF THIS DOCUMENT

This document is a complete context handoff for a NEW CHAT.

The previous conversation must NOT be assumed to exist.

The supplied ZIP is the current B-Branch implementation. The task is:

1. Close the remaining technical/verification gaps.
2. Preserve the repaired B00→B12 architecture.
3. Integrate `Panniantong/Agent-Reach` as B-Branch's external intelligence access layer.
4. Do NOT redesign Tekno Polimat yet.
5. Return a clean repaired ZIP and a truthful final verification report.

The objective is not to make B look more intelligent.

The objective is to make B:

- reliable
- traceable
- evidence-aware
- versioned
- governed
- honest about uncertainty
- capable of ingesting real external information safely
- ready for later strategic identity work

---

# 1. CURRENT B-BRANCH ARCHITECTURE

```text
B00 Governance / Contracts
        ↓
B01 Brand / Ecosystem Foundation
        ↓
B02 Opportunity Intelligence
        ↓
B03 Audience Intelligence
        ↓
B04 Strategic Planning
        ↓
B05 Positioning / Creative Strategy
        ↓
B06 Channel / Distribution Strategy
        ↓
B07 Performance Framework
        ↓
B08 Analytics / Intelligence Ops
        ↓
B09 Learning
        ↓
B10 Optimization
        ↓
B11 Governance / Risk / Compliance
        ↓
B12 Integration / Branch State
```

This architecture is canonical and must remain intact.

---

# 2. IMPORTANT EXCLUSIONS

Do NOT work on:

- legacy SOP / M01–M10
- old SOP CLI/runtime
- Tekno Polimat brand identity
- Tekno Polimat channel names
- channel network design
- final content taxonomy
- creative rebranding
- new autonomous agent architecture unrelated to B08

The user explicitly wants B-Branch technically hardened FIRST.

---

# 3. CURRENT VERIFIED STATE

The current release has already completed two controlled repair passes.

The current reports state:

- B00→B12 architecture preserved
- SHA-256 canonical identity/hashing repaired
- approval bound to exact object/version/content hash
- governance history enforcement repaired
- evidence/provenance semantics hardened
- MOCK/SYNTHETIC/UNKNOWN firewall repaired
- B02 opportunity semantics hardened
- B03 audience evidence inflation repaired
- B04 territory/lineage semantics hardened
- B05 heuristic/default semantics made explicit
- B06 timezone/default semantics repaired
- B07 framework-vs-actual measurement separation repaired
- B08 execution semantics added
- B09 learning eligibility hardened
- B10 hash-derived pseudo-risk/impact behavior removed
- B11 evidence-based compliance behavior repaired
- B12 readiness semantics separated

The current fallback verification reports:

```text
18/18 invariant harness       PASS
11/11 remaining-repair guards PASS
B00→B12 integration           PASS
source-policy scan            PASS
SHA-256 manifest verification PASS
ZIP integrity                 PASS
```

However:

```text
canonical npm install         NOT VERIFIED
canonical typecheck           NOT VERIFIED
canonical build               NOT VERIFIED
canonical Vitest              NOT VERIFIED
15 legacy B regression tests  NOT VERIFIED
3 repair tests runtime        NOT VERIFIED
live analytics/providers      NOT VERIFIED
external compliance authority NOT VERIFIED
```

Reason for canonical npm/Vitest blocker:

```text
npm registry DNS / EAI_AGAIN
```

Do not convert fallback tests into canonical Vitest results.

---

# 4. REMAINING TECHNICAL ITEMS

## R-FINAL-01 — Canonical npm/Vitest verification

Run, in this order:

```bash
npm install
npm run typecheck
npm run build
npm run test:legacy
npm run test:repair
npm test
npm run verify:critical
npm run verify:integration
npm run verify:remaining
npm run lint:policy
npm run manifest
npm run verify:manifest
```

Requirements:

- no test deletion
- no assertion weakening
- no test suppression
- no fabricated PASS
- canonical test result must be clearly separated from fallback harness result

If network remains unavailable:

```text
NOT VERIFIED — ENVIRONMENT BLOCKER
```

Do not claim production readiness.

---

## R-FINAL-02 — 15 preserved B regression files

The current release preserves 15 legacy B regression files.

They must actually run once Vitest is available.

Report:

```text
files
passed
failed
skipped
runner errors
```

Any failure must be investigated as a possible regression.

---

## R-FINAL-03 — Re-run repair layers

Keep these separate:

```text
canonical Vitest repair tests
standalone 18-invariant harness
remaining-repair 11/11 guards
B00→B12 standalone integration
```

Do not merge their counts.

---

## R-FINAL-04 — B01 platform/capability provenance

The current final release claims this is fixed.

Verify that real platform/capability provenance refs are aggregated and deduplicated without fabrication.

If correct:

```text VERIFIED
```

No further redesign.

---

## R-FINAL-05 — B01 contract-evolution drops

`CONTRACT_EVOLUTION_REQUIRED` drops remain explicit.

Do NOT silently expand frozen canonical contracts.

Verify:

- the drops are documented
- downstream current modules do not silently consume them
- no fake preservation is claimed

Leave deferred unless a real correctness issue is proven.

---

## R-FINAL-06 — B04 territorial strategies

`territorial_strategies` remains intentionally deferred/empty.

Do NOT invent territorial strategy.

Leave deferred unless the current contract demonstrably requires it.

---

## R-FINAL-07 — Default/heuristic semantics

These are acceptable ONLY when explicitly classified:

```text B04 timeline default
 B05 heuristic confidence
 B06 schedule defaults
 B07 threshold default
```

Required invariant:

```text DEFAULT ≠ VERIFIED
HEURISTIC ≠ OBSERVED
INFERRED ≠ VERIFIED
```

Do not over-repair already-correct explicit defaults.

---

## R-FINAL-08 — Dependency reproducibility

If registry access works:

- create/update a genuine lockfile from resolved dependencies
- verify a clean lock-based install
- do not fabricate package versions

If registry remains blocked:

```text DEFERRED — NETWORK/REGISTRY BLOCKER
```

---

## R-FINAL-09 — Tooling

The existing deterministic release-policy scanner is valid.

Do not add ESLint merely for appearance.

Only add conventional linting if it cleanly fits the current package/toolchain and provides real value.

---

# 5. NEW MAJOR DEVELOPMENT — AGENT REACH

## External project

`https://github.com/Panniantong/Agent-Reach`

Agent Reach is an external internet-access/router layer for AI agents. Its documented model includes multiple platform backends and setup levels, with capabilities covering web pages, YouTube, GitHub, RSS, X/Twitter, Reddit, Bilibili, LinkedIn, Instagram, XiaoHongShu, Facebook, V2EX, Xueqiu, podcasts and web search, with some channels requiring cookies, browser sessions, MCP or other configuration.

Important: capabilities and setup requirements can change over time.

Therefore B must treat Agent Reach as:

```text external mutable dependency
```

not as hard-coded domain logic.

---

# 6. CORRECT ARCHITECTURAL POSITION FOR AGENT REACH

Do NOT make Agent Reach a new B13.

Do NOT copy Agent Reach's internals into B.

Do NOT let every B module call Agent Reach directly.

Canonical position:

```text
                         B00
                 Governance / Identity
                          ↑
                          │
B02 ───────────────┐      │
B03 ───────────────┼──────┤
B07 ───────────────┘      │
                          │
                         B08
                  External Intelligence
                     Access Layer
                          │
                   Agent Reach Adapter
                          │
       ┌──────────────────┼──────────────────┐
       ↓                  ↓                  ↓
      WEB              SOCIAL            KNOWLEDGE
       │                  │                  │
     Web/RSS        X/Reddit/YouTube     GitHub/etc.
       │                  │                  │
       └──────────────────┼──────────────────┘
                          ↓
                   Raw External Result
                          ↓
                  B08 Normalization
                          ↓
              Evidence + Observation
                          ↓
                B02 / B03 / B07
                          ↓
                         B09
                          ↓
                         B10
```

Core rule:

> Agent Reach provides external access. B decides how the resulting information is classified, evidenced, validated and used.

---

# 7. AGENT REACH MUST NOT BYPASS B00

Agent Reach results must NEVER automatically become:

```text VERIFIED
PRODUCTION_ELIGIBLE
COMPLIANT
```

Instead:

```text Agent Reach result
       ↓
ExternalSource
       ↓
EvidenceRef
       ↓
ProvenanceRef
       ↓
B00 epistemic validation
       ↓
B08 normalized observation
```

The tool being able to retrieve something proves retrieval, not truth.

---

# 8. PROPOSED B08 EXTERNAL ACCESS CONTRACT

Introduce a thin B-owned abstraction similar to:

```text
ExternalAccessRequest {
    request_id
    project_id
    purpose
    query
    source_types[]
    platform?
    geography?
    time_range?
    max_results
}
```

and:

```text
ExternalAccessResult {
    request_id
    provider
    backend
    status
    source_mode
    retrieved_at
    sources[]
    evidence[]
    provenance[]
}
```

A source should carry enough information to reproduce its origin:

```text
ExternalSource {
    source_id
    platform
    canonical_url
    retrieval_method
    retrieved_at
    content_hash
    source_mode
    backend
}
```

Use existing B00 identity/evidence/provenance models rather than creating competing models.

---

# 9. AGENT REACH HEALTH ≠ EVIDENCE

Agent Reach's health/doctor information must remain operational telemetry:

```text AgentReachHealth
```

not research evidence.

For example:

```text YouTube backend healthy
```

does NOT mean:

```text YouTube research claim VERIFIED
```

Keep these separate.

---

# 10. REAL / MOCK / SYNTHETIC FIREWALL FOR AGENT REACH

Agent Reach integration must preserve:

```text REAL
MOCK
SYNTHETIC
UNKNOWN
```

source mode.

Development mocks must never enter B02/B03/B07/B09 as real-world evidence.

Recommended execution status:

```text EXECUTED_REAL
EXECUTED_MOCK
EXECUTED_SYNTHETIC
EXECUTED_UNKNOWN
FAILED
UNAVAILABLE
AUTH_REQUIRED
```

The exact enum may follow the existing B contract if already present.

---

# 11. AGENT REACH CAPABILITY REGISTRY

Do not hard-code a claim that every supported Agent Reach platform is always available.

Maintain a B-side capability registry such as:

```text capability
platform
backend
requires_auth
requires_cookie
requires_browser_session
requires_mcp
proxy_required
status
last_checked
```

The registry describes current operational capability, not truth of retrieved content.

Where possible, Agent Reach version/backend information should be recorded for reproducibility.

---

# 12. AGENT REACH → B08 → B02/B03/B07 USE CASES

## B02 Opportunity

```text strategic context
      ↓
ExternalAccessRequest
      ↓
Agent Reach
      ↓
real external sources
      ↓
evidence
      ↓
opportunity evaluation
```

## B03 Audience

```text audience question
      ↓
Agent Reach search/read
      ↓
Reddit/X/YouTube/etc.
      ↓
observations
      ↓
evidence aggregation
      ↓
audience synthesis
```

## B07/B08 Performance/Signals

Use only where the external source actually exposes relevant measurable data.

Do not turn generic web/social observations into KPI values.

---

# 13. B09 LEARNING WITH AGENT REACH

Agent Reach can introduce:

```text audience signal
trend signal
community signal
competitive signal
content signal
```

These are NOT automatically performance metrics.

Keep distinct observation types:

```text PerformanceObservation
AudienceObservation
CommunityObservation
TrendObservation
CompetitiveObservation
```

B09 should only claim learning from evidence-eligible actual observations.

No advanced causal/statistical claims unless actually implemented and evidenced.

---

# 14. B10 OPTIMIZATION WITH AGENT REACH

The desired future chain is:

```text external observation
       ↓
validated evidence
       ↓
B09 signal/learning
       ↓
B10 hypothesis
       ↓
proposed change
       ↓
risk / impact
       ↓
human approval
       ↓
external execution owner
```

B10 must NOT silently self-apply strategic changes.

---

# 15. SECURITY / SECRET BOUNDARY

Never put into the B repository:

- cookies
- session files
- browser profiles
- auth tokens
- provider credentials

Agent Reach should remain externally installed/configured.

B should contain only:

- adapter contracts
- provider/capability metadata
- normalized result mapping
- source/evidence/provenance logic
- health/status abstraction

---

# 16. AGENT REACH DEPENDENCY STRATEGY

Treat Agent Reach as an external provider dependency.

Do NOT blindly vendor or copy its upstream tools.

Prefer:

```text B08 AgentReachAdapter
        ↓
Agent Reach installation/runtime
        ↓
upstream platform tools
```

Pin/document the Agent Reach version or commit used for verified builds when practical.

The adapter must gracefully report:

```text unavailable
not installed
authentication required
unsupported capability
rate limited
backend failed
```

instead of fabricating data.

---

# 17. IMPORTANT CURRENT AGENT REACH LIMITATION

Agent Reach itself supports multiple access methods, and some require browser sessions, cookies, MCP or other configuration. Therefore “Agent Reach installed” is NOT equivalent to “all internet sources work”.

The B capability registry must reflect actual status.

A single provider being unavailable must not corrupt unrelated B functionality.

---

# 18. TEST PLAN FOR AGENT REACH

## Adapter unit tests

```text request serialization
result parsing
status mapping
source identity
content hash
source_mode
```

## Firewall tests

```text MOCK → cannot become VERIFIED
SYNTHETIC → cannot become VERIFIED
UNKNOWN → cannot become VERIFIED
```

## Failure tests

```text missing agent-reach
backend unavailable
auth required
rate limited
malformed provider result
```

## Provenance tests

```text retrieved source
→ ExternalSource
→ EvidenceRef
→ ProvenanceRef
```

must remain traceable.

## Integration tests

```text Agent Reach adapter
→ B08
→ B02/B03/B07
```

using controlled fixtures.

Do not require live third-party services for ordinary unit tests.

---

# 19. LIVE EXTERNAL VERIFICATION

After the implementation works locally, perform a separate live verification pass where environment/credentials permit.

At minimum distinguish:

```text installed
reachable
authenticated
retrieval works
data parsed
evidence generated
```

Do not collapse these into one PASS.

---

# 20. FINAL VERIFICATION MATRIX

Before declaring the B-Branch technical foundation complete:

```text [ ] npm install
[ ] npm run typecheck
[ ] npm run build
[ ] npm run test:legacy
[ ] npm run test:repair
[ ] npm test
[ ] npm run verify:critical
[ ] npm run verify:integration
[ ] npm run verify:remaining
[ ] npm run lint:policy
[ ] npm run manifest
[ ] npm run verify:manifest

[ ] 18-invariant harness
[ ] 11 remaining guards
[ ] B00→B12 integration
[ ] Agent Reach adapter tests
[ ] Agent Reach firewall tests
[ ] Agent Reach provenance tests
[ ] live provider checks where available
[ ] external compliance checks where available
```

---

# 21. FINAL OUTPUT REQUIREMENTS

Return:

```text
B_BRANCH_V5_FINAL_WITH_AGENT_REACH_20260906.zip
```

and:

```text
FINAL_B_BRANCH_REPAIR_REPORT.md
FINAL_B_BRANCH_STATUS_AND_RISKS.md
```

Reports must explicitly classify every item:

```text FIXED / VERIFIED
FIXED / PARTIALLY VERIFIED
NOT VERIFIED
DEFERRED
REJECTED
```

Never use a blanket production-ready statement when canonical or external gates remain unverified.

---

# 22. CRITICAL DESIGN RULES

Never:

- weaken tests
- delete failing tests
- fabricate evidence
- promote defaults to VERIFIED
- promote Agent Reach retrieval to VERIFIED truth
- make mock data production evidence
- create fake compliance results
- bypass B00 governance
- create B13
- redesign B00→B12
- redesign Tekno Polimat
- merge the legacy SOP pipeline into B

---

# 23. SUCCESS CONDITION

The repair is successful when:

```text
B00→B12 architecture intact
+
canonical identity/integrity/governance stable
+
evidence/provenance safe
+
lineage resolvable
+
defaults explicitly classified
+
B08 can safely access external information
+
Agent Reach is isolated behind a B-owned adapter
+
retrieved information becomes evidence only through B validation
+
B09 only learns from eligible observations
+
B10 creates traceable proposals
+
B11 refuses unsupported compliance claims
+
B12 truthfully reports readiness
+
canonical tests pass in a real dependency environment
+
external verification status is truthful
```

---

# 24. FUTURE PHASE — NOT PART OF THIS TASK

Only after B-Branch technical foundation is locked should the next separate project begin:

```text
Tekno Polimat identity
        ↓
brand philosophy
        ↓
channel architecture
        ↓
channel roles
        ↓
cross-channel relationships
        ↓
content ontology
        ↓
editorial system
```

That future work must be designed deliberately and is NOT to be invented during this repair.

---

# END OF MASTER PLAN