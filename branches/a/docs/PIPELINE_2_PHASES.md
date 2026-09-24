# Pipeline 2 Phases Clarification

## P2.05 Storyboard Review ≠ P2.09 Flow Prompt Generation

**Critical Boundary:** P2.05 and P2.09 serve different purposes and must not be conflated.

### P2.05: Storyboard Review (Mental Preview Checkpoint)

> **Implementation status (this pass, verified against source):** the capped
> TXT-storyboard structure described below is **design intent / planned
> behavior, not yet implemented**. The current P2.05 code
> (`pipeline2_creative/src/referenceDiscovery.ts`, `recordObservation()`) is an
> unstructured, uncapped observation-recorder — no TXT output format, no
> "max 4" enforcement, no `Storyboard` type exists anywhere in `src/*.ts`. Treat
> everything below as the target design, not a description of current
> behavior, until it is actually built.

**Input:** ContentStructure (P2.02) + CreativeStrategy (P2.03) + ArtDirection (P2.06)

**Output (planned):** Text storyboard (TXT format), max 4 visuals per video with descriptive captions

**Purpose:** User reviews creative vision BEFORE production lock-in. Text descriptions allow rapid iteration without expensive asset generation.

**Characteristics:**
- No Flow prompts generated
- No visual assets generated
- No AI integration required for asset creation
- User can mentally preview the sequence and adjust creative direction
- Review checkpoint: user approves storyboard or requests revisions
- Once approved, storyboard is locked (no rewrites in P2.06+)

**Workflow:**
1. P2.02 Understand produces ContentStructure (key claims)
2. P2.03 Strategize produces CreativeStrategy (narrative direction)
3. P2.04 Format produces FormatDecision + FormatDecisionMatrix
4. P2.06 ArtDirection produces visual language guide + decision log
5. **P2.05 records user observations** from references (manual research)
6. **Generate storyboard from ContentStructure + CreativeStrategy + ArtDirection**
   - Scene descriptions (4 max)
   - Visual language per scene (from ArtDirection)
   - Narrative arc
   - **Output: TXT file only**
7. **User reviews and approves storyboard** (checkpoint)
8. Approved storyboard is canonical; gates downstream progression

### P2.09: Flow Prompt Direction (Asset Generation Direction)

**Input:** Scenes + Shots (P2.08) + ArtDirection (P2.06) + Storyboard approval from P2.05

**Output:** RenderedPromptRecord[] — one Flow prompt per visual asset (NOT one per video)

**Purpose:** Generate generation instructions for each discrete visual asset. Each prompt is customized per asset, referencing specific ArtDirection elements.

**Characteristics:**
- **One prompt per visual asset** (not one per video)
- Provider-neutral structured prompts (PromptSpecification)
- Provider-specific rendered prompts (GoogleFlowRenderer output)
- Individual asset quality > batch processing efficiency
- Each prompt traces to: shot_id, decision_id, visual language elements
- Prompts are NOT user-facing; they're system-generated asset directives

**Workflow:**
1. P2.08 Scene/Shot Planning produces concrete scene/shot matrix
2. P2.07 Asset Planning determines asset types/counts
3. **P2.09 generates individual visual prompts**
   - For each shot requiring a visual asset:
     - Structured PromptSpecification (subject, composition, style, constraints)
     - References ArtDirection (color palette, lighting, visual language)
     - Traces to decision_id (rationale for this asset choice)
   - Renders prompt to provider format (GoogleFlow, etc.)
   - Stores PromptSpecification (canonical) + RenderedPrompt (derived)
4. P3 receives individual asset prompts and executes generation per asset

### Boundary Summary

| Aspect | P2.05 Storyboard | P2.09 Flow Prompts |
|--------|------------------|-------------------|
| **When** | After P2.06 ArtDirection | After P2.08 Scene/Shot Planning |
| **Input** | ContentStructure + CreativeStrategy + ArtDirection | Scenes + Shots + ArtDirection |
| **Output** | TXT storyboard (4 scenes max) — **planned, not yet implemented**; current P2.05 code is unstructured `recordObservation()` | RenderedPromptRecord[] (1 per asset) |
| **User Facing** | Yes (review + approval) | No (system-generated directives) |
| **Generator** | Structured narrative template | PromptSpecification builder + renderer |
| **Scope** | Narrative flow + visual direction summary | Individual asset generation specs |
| **No. of Items** | 4 max | Variable (one per unique asset) |
| **Approval** | User reviews & locks storyboard | Automatic (no user review step) |
| **Locked After** | P2.05 completion | P2.09 completion (ready for P3) |

### No Backflow: P2.09 Cannot Rewrite P2.05

- P2.09 generates technical directives (prompts) for assets
- P2.09 must NOT re-imagine scenes, narrative, or creative direction
- If P2.09 needs creative adjustments, escalation goes back to P2.06 (ArtDirection review), never rewriting P2.05
- This enforces: user controls narrative (P2.05), system executes on that narrative (P2.09)

### Implementation Notes

**P2.05 in referenceDiscovery.ts:**
- `recordObservation()` structures observations the user makes about approved references
- Observations feed into storyboard description layer (visual language evidence)
- No claim fabrication, no creative invention — only structured user input

**P2.09 in promptArchitecture.ts:**
- `writeFlowPrompt(shot, artDirection, library)` generates PromptSpecification per shot
- One PromptSpecification per shot (or per unique asset if multiple assets per shot)
- References ArtDirection (visual language, color, lighting) as input
- Produces RenderedPromptRecord (spec + rendered) for P3 consumption

---

**Canonical Rule (from architecture docs):**
> P2 creative intent is not invented inside P3. P3 executes what P2 + the user decided; it does not make creative choices.

This extends upstream: **P2.05 user review controls narrative; P2.09 execution serves that narrative.**
