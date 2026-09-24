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

P2 designs what will be created.

## Canonical Sequence

`P2.01 Reference Discovery → P2.02 Content Understanding → P2.03 Creative Strategy → P2.04 Format → P2.05 Manual Creative/Reference Research → P2.06 Art Direction → P2.07 Asset Planning → P2.08 Scene/Shot Planning → P2.09 Flow Prompt Direction → P2.10 Voice/Production Spec → P2.11 Reverse QA + Production Package`

P2 consumes the P1 Research Package. P2 MUST NOT repeat subject research. P2 MUST NOT generate final visual assets. Google Flow is manual — P2 prepares what the human will use in Google Flow; it does not automate Google Flow.

## Canonical Scene/Shot Model

One model — GRAFİK's and Studio's separate scene/shot concepts are not maintained side by side.

**Shot**: `shot_id, scene_id, purpose, duration_intention, camera{angle, movement, lens, framing}, action, continuity_anchors, reference_requirements, asset_type, generation_method`

**Scene**: `scene_id, purpose, shots[], continuity_requirements, narrative_function`

## Canonical Prompt Architecture

The Prompt model stays provider-neutral. Four conceptual layers:

1. **Creative Intent**
2. **Structured Prompt Specification** — the canonical stored/versioned layer
3. **Provider-specific rendering representation**
4. **Google Flow prompt text**

Layer 2 required fields: `subject, action, environment, composition, camera, lighting, motion, style, materials, atmosphere, continuity, negative_constraints, prompt_family, axis_tags[], traceable_to`. `traceable_to` identifies `shot_id` and `decision_id`.

The Prompt Library stores Layer 2, not raw Flow text. It is permanent, versioned, cross-project, searchable, indexed by `prompt_family` and `axis_tags`. Google Flow is the first renderer — the internal prompt model must never become a Google Flow syntax model.

## AI Director

Strictly advisory. Flow: `PLAN → ANALYZE → IDENTIFY GAPS/RISKS → PROPOSE OPTIONS → RECOMMEND → HUMAN DECISION → RECORD DECISION`. It must not automatically approve its own recommendation.

**Decision object**: `decision_id, question, options_considered[], recommendation, rationale, status, approving_actor, timestamp, precedent_refs[]`

**Status**: `proposed | recommended | approved | rejected | modified | superseded`. System recommendation and human approval remain distinct states.

## Asset Traceability (P2 portion)

`RESEARCH FACT → CREATIVE DECISION → SCENE → SHOT → ASSET REQUIREMENT`. Every arrow is a stable FK. Relationships are never inferred from filenames, ordering, prose, or timestamps.

## P2 → P3 Handoff

Required: `package_id, production_package_version, project_id, research_package_ref, scenes[], shots[], asset_requirements[], prompts[], decision_log[], voice_script, pronunciation/number flags, user_approval_state, manifest, integrity_hashes`.

Each `asset_requirements[]` entry: `asset_requirement_id, expected media type/properties, generation_method, reference_lineage, required/optional`.

P3.01 validates internal consistency before accepting the package.

## Human Gates

**Gate A2** — reference/art-direction approval. **Gate A3** — Google Flow preparation approval. Both use: `state_before, approval_record, actor, timestamp, object_version, state_after, unlock`.

## Creative Reasoning Engine Contract (provider remains deferred)

```
CreativeReasoningEngine
  understand(research_package, references)       -> content_structure
  strategize(content_structure, user_goals)       -> creative_strategy
  direct_art(strategy, references, memory)        -> art_direction + decision_log[]
  plan_scene_shot(strategy, art_direction)         -> scenes[] + shots[]
  write_flow_prompt(shot, art_direction, library)  -> Structured Prompt Specification
```

**MUST**: ground outputs in the Research Package or explicit user input; produce Decision objects for creative choices; maintain traceability; avoid subject-research duplication.
**MUST NOT**: repeat P1 research; generate final assets; directly author Google Flow text.

## Capability Classification

| Capability | Classification | Contract note |
|---|---|---|
| JSON Schema contract layer | ADAPT | Origin: GRAFİK |
| Gate-sequence discipline | ADAPT | Origin: GRAFİK |
| Platform dimension table | REUSE | Origin: GRAFİK |
| Memory-bucket model | ADAPT + populate | Origin: GRAFİK |
| Consistency / anti-repetition / creative-memory engines | ADAPT + wire in | Origin: GRAFİK |
| Structured Flow-prompt fields | ADAPT | Origin: GRAFİK |
| Scene/Shot cinematic fields | ADAPT | Origin: Studio |
| Prompt family/axis taxonomy | ADAPT | Origin: Studio |
| AI Director design + Decision schema | ADAPT-from-spec | Origin: Studio |
| Reference-discovery UX | NEW | No source equivalent |
| Creative Reasoning Engine | NEW / deferred | Behind the defined contract |

GRAFİK's static/carousel/Instagram-specific modules are explicitly excluded from P2's core architecture.
