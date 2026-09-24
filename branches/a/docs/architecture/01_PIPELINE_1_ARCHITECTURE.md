# A-Branch Architectural Principles

1. Source repositories (SOP, GRAFİK, Studio) are **capability pools** — engineering patterns, schemas, infrastructure to draw from. They are not A-Branch pipelines and do not define A-Branch scope.
2. **A-Branch owns the canonical contracts.** Source terminology does not automatically become A-Branch terminology — see `TERMINOLOGY_CONTRACT.md` and the canonical models defined in these documents.
3. Reuse **engineering patterns, schemas, and infrastructure** where suitable. Do not reuse historical **business logic** blindly just because code exists.
4. **No silent fabrication** — a claim, asset, or creative choice that cannot be substantiated is reported as missing/unknown, never invented.
5. **No silent creative decisions** — every creative choice is either explicitly approved by the user or explicitly logged as a system proposal awaiting approval.
6. **Human approval is a real state transition**, enforced in code, not documentation. A gate that only exists as a doc comment is not a gate.
7. **Every important artifact is traceable** — back to the research fact, creative decision, or requirement that produced it.
8. **Every pipeline handoff is machine-verifiable** — a receiving pipeline validates the handoff package's structure/integrity before acting on it, never infers missing context from prose.
9. **Fail loudly, resume cheaply** — errors stop the smallest possible unit and name exactly what's wrong; state is checkpointed so re-runs don't repeat completed work.
10. **Providers/engines are replaceable** where the architecture defines an interface for them (P1 research, P2 creative reasoning). Where a provider is explicitly locked (P3 voice path), it is not abstracted.
11. **P1 research is not repeated inside P2.** P2 consumes the Research Package; it does not re-derive subject knowledge.
12. **P2 creative intent is not invented inside P3.** P3 executes what P2 + the user decided; it does not make creative choices.
13. **P3 assembles and validates; it does not reinterpret creative decisions.** Missing or ambiguous creative information is reported upstream, never resolved locally.

**Pipeline boundary in one line each:**

`P1 = understand the subject` → `P2 = design what will be created` → `MANUAL GOOGLE FLOW = create the visual assets` → `P3 = assemble, render, and verify what has already been decided`.

These responsibilities do not leak across boundaries.

---

## Purpose

P1 understands the subject and produces an evidence-backed Research Package.

## Canonical Sequence

`P1.01 Input → P1.02 Topic & Source Discovery → P1.03 Domain Research → P1.04 Verification → P1.05 Synthesis → P1.06 Knowledge Package → P1.07 Handoff`

## P1.02 / P1.03 Boundary

**P1.02 owns**: research questions, constraints, source-type preferences, language preference, recency preference, candidate source-family proposals, approved research scope object. The approved research scope is frozen through human approval.

**P1.03 owns execution only**: searching, source acquisition, claim extraction, evidence gathering. P1.03 MUST operate within the approved scope object. The Research Engine interface requires `investigate(approved_scope, query)`. An out-of-scope direction must be flagged and returned upstream, never pursued silently.

## P1.03 as Squeeze Principle

**Intent**: P1.03 narrows the research universe from P1.02's broad proposal to a verified core.

**Flow**:
1. **P1.02 proposes wide scope**: candidate sources, research questions, constraints broadly defined
2. **P1.03 applies rigor**: investigates proposed sources, extracts claims, eliminates low-confidence or speculative findings
3. **P1.04+ verify remainder**: verifies high-value claims extracted by P1.03 to high confidence (VERIFIED or UNKNOWN with documented reason)

**This is SQUEEZE (narrowing), not expansion**: P1 never broadens scope mid-pipeline. A finding P1.03 returns is one P1.03 found evidence for; a finding P1.03 does not return is eliminated due to lack of evidence or low confidence, not deferred. P1.04 and P1.05 synthesize what P1.03 recovered, never invent new research directions.

**Constraint**: P1.03 is evidence-first. A claim without citation in a source P1.03 investigated is not passed to P1.04; it is discarded. This enforcement is non-negotiable per the Evidence & Provenance Contract.

## P1 Must Not

Plan scenes; plan shots; write Flow prompts; decide creative strategy; create visual assets; define final visual specifications.

## Evidence & Provenance Contract

Canonical chain: `SOURCE → EVIDENCE → CLAIM → VERIFICATION → SYNTHESIS`. A URL alone is not evidence.

**Source**: `source_id, origin, source_type, retrieved_at, access_method, reliability_notes`
**Evidence**: `evidence_id, source_id, excerpt_or_pointer, retrieved_at, extraction_method`
**Claim**: `claim_id, statement, evidence_refs[], derived_from, contradiction_refs[]`
**Verification**: `verification_id, claim_id, status, rationale, verified_at, contradiction_relationship`

**Enforcement**: a Claim is invalid unless `evidence_refs[]` is non-empty, OR `status == UNKNOWN AND unresolved_reason` exists. No silent provenance gaps.

The Knowledge Package carries `verification_state_schema_version`. `v1` vocabulary: `VERIFIED | INFERRED | UNKNOWN`. Future vocabularies are additive version bumps, not architectural rewrites.

## P1 → P2 Handoff

Machine-readable. Required top-level fields: `package_id, schema_version, project_id, manifest, integrity_hashes, research_scope, sources[], evidence[], claims[], knowledge_package, unresolved_questions[], handoff_notes`.

`knowledge_package` supports: facts, concepts, people, events, places, objects, processes, relationships, chronology, terminology, quantitative, visual, examples, interpretations, contradictions, unknowns, open_questions, production_context.

P2 must never infer missing research context from prose.

## Human Gates

**Gate A1** contains two distinct transitions:

1. Scope approval: `SCOPE_PROPOSED → (human approval) → SCOPE_APPROVED`
2. Package approval: `PACKAGE_DRAFTED → (human approval) → PACKAGE_APPROVED`

Approval record includes: `actor, timestamp, object/version being approved, state_before, state_after`.

## Research Engine Contract (provider selection remains deferred)

```
ResearchEngine
  discover(topic, constraints)        -> candidate_directions[]
  investigate(approved_scope, query)  -> findings[] + evidence_refs[]
  verify(claim, evidence_refs)        -> verification_status
```

**MUST**: stay within approved scope; attach evidence; return `UNKNOWN` with reason when evidence is insufficient; be replayable; avoid fabrication; preserve revisions explicitly.
**MUST NOT**: silently broaden scope; omit provenance; overwrite verification silently; invent sources; invent claims.

## Capability Classification

| Capability | Classification | Contract note |
|---|---|---|
| Evidence/Provenance model | ADAPT | Origin: SOP's tested EvidenceRef/EvidenceStatus pattern, extended per contract |
| Provider-state abstraction | ADAPT | Origin: SOP's AVAILABLE/CONFIGURED/CONNECTED/UNVERIFIED pattern |
| Secret redaction | REUSE | Origin: SOP |
| Deterministic ID hashing | REUSE | Origin: SOP |
| Incremental memory merge | ADAPT | Origin: SOP project-memory merge pattern |
| Manifest/integrity verification | REUSE | Origin: SOP |
| Knowledge-dimension structure | NEW | No source equivalent |
| Research Engine implementation | NEW / deferred | Behind the defined contract |

SOP's M02–M10 content-marketing entities are explicitly **not** reused as P1 domain logic.
