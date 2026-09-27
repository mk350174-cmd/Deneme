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

P3 assembles, renders, and verifies what has already been decided.

## Canonical Sequence

`P3.01 Ingest → P3.02 Asset Validation → P3.03 Asset Matching → P3.04 Piper Preview → HUMAN APPROVAL → P3.05 ElevenLabs Production Voice → P3.06 Timing → P3.07 Timeline/Remotion → P3.08 Render → P3.09 QA → P3.10 Kaggle Delivery`

## P3 Hard Boundary

**MAY**: validate, match, reject, schedule, assemble, render, QA, deliver.
**MAY NOT**: invent creative decisions; silently substitute assets; rewrite creative strategy; change shot meaning; invent timing intent; reinterpret ambiguity.

If information is missing: STOP. Return a structured upstream error naming exact field, object, reason, and required action. Never locally resolve creative ambiguity.

## Asset Traceability (continuation)

`ASSET REQUIREMENT → GENERATED ASSET FILE → FINAL TIMELINE → FINAL VIDEO`

Generated asset: `asset_file_id, hash, media properties`. P3.03 resolves the file to `asset_requirement_id` using stable IDs, hashes, and validated media properties only. Filename similarity, ordering, and timestamp proximity are not valid resolution mechanisms. If no valid requirement can be resolved: `USER_ACTION_REQUIRED`.

## Narration State Machine

Locked voice path: `Piper → human approval → ElevenLabs`. No Gemini path.

Transition: `PIPER_PREVIEW_GENERATED → (human approval) → NARRATION_APPROVED_FOR_PRODUCTION`.

Approval record: `state_before, approval_record, approving_actor, timestamp, object_version_being_approved, state_after, downstream_operation_unlocked`.

The ElevenLabs client checks this state in code before executing. Without `NARRATION_APPROVED_FOR_PRODUCTION`, the ElevenLabs call must fail.

## ElevenLabs Preflight

After approval, before production voice: verify API connectivity; verify voice/model availability; inspect credits/quota; estimate usage; enforce hard cost limit; validate numbers, dates, units, and special terminology from P2. If material ambiguity remains: **Gate A6**.

## Timing / Assembly / QA

Narration is the master clock — final timing is never derived from word count alone; approved production narration determines it; visuals bend to it.

Remotion executes the approved timeline. It does not make creative decisions or reinterpret shot intent.

**Automated QA**: missing assets, decode errors, codec, fps, dimensions, audio presence, A/V sync, duration, caption timing, black frames, render integrity, package integrity.
**Human QA**: narrative quality, continuity, aesthetics, emotion. The system reports findings; it does not claim human taste.

## Kaggle Rule

Exactly one new Kaggle dataset per final video. Never a shared dataset across final videos; never silent reuse of a previous final-video's dataset. If large assets cannot travel in the delivery zip, use an explicit Kaggle pointer in the manifest — never silently omitted.

## Human Gates

**Gate A4** — manual asset creation / Production Delivery received. **Gate A5** — Piper approval. **Gate A6** — ElevenLabs preflight if material ambiguity exists. **Gate A7** — final human creative QA. All use: `state_before, approval_record, actor, timestamp, object_version, state_after, unlock`.

## Error Taxonomy

`MISSING_ASSET | WRONG_ASSET | PLAN_ERROR | ASSET_ERROR | USER_ACTION_REQUIRED`. Fail loudly, resume cheaply. No silent asset substitution. No silent creative correction.

## Provider Position

Unlike P1/P2, provider selection is locked: Piper, ElevenLabs, Remotion. No abstraction layer is introduced for these. Gemini TTS is explicitly excluded.

## Capability Classification

| Capability | Classification | Contract note |
|---|---|---|
| Orchestration kernel | REUSE | Origin: Studio |
| Piper preview | REUSE | Origin: Studio |
| ElevenLabs client | ADAPT | Origin: Studio + enforced approval gate |
| Approval/voice-lock record | ADAPT | Origin: Studio |
| Whisper listen-check | REUSE | Origin: Studio |
| Narration timing math | ADAPT | Origin: Studio |
| Remotion composition pattern | ADAPT | Origin: Studio |
| Kaggle upload hardening | ADAPT | Origin: Studio |
| Cost governance | ADAPT | Unified from existing implementations |
| QA suite | NEW + ADAPT | Unified QA layer |
| Asset Matching / traceability resolution | NEW | Defined by A-Branch |

Explicitly excluded: Gemini TTS; superseded/duplicate Remotion composition; unrelated marketplace agent skills.
