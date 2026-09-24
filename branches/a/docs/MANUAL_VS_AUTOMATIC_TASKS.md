# Manual vs. Automatic Tasks: The Responsibility Boundary

## Canonical Principle

**User provides:** Visual assets (images, illustrations, screenshots) + Silent video clips (AI-generated video, footage, animation — max 10 seconds per clip)

**System provides:** Everything else (voice, music, SFX, captions, motion coordination, rendering)

This boundary is enforced at contract level and in P2/P3 code.

---

## Manual Tasks (User Responsibility)

### Visual Assets

**Image formats:** JPG, PNG, SVG, GIF (static or animated)

**Illustrations:** Hand-drawn, vector, digital art

**Screenshots:** Application UI, website captures, documentation images

**Animated GIFs:** User-created or sourced animations

**Constraints:**
- No narration or dialogue
- No music or ambient sound
- No text overlays (system adds captions/subtitles)
- Quality > quantity (user curates, system doesn't fill gaps)
- User owns sourcing decisions (copyright, licensing, authenticity)

### Silent Video Clips

**Definition:** Video without narration, dialogue, music, or SFX.

**Maximum length:** 10 seconds per clip (enforced by P3 ingest validation)

**Sources:**
- AI-generated video (Runway, Synthesia, Stable Diffusion video, etc.)
- Footage (stock footage, personal video, archival)
- Animation (user-created or sourced)
- Screen recording (no audio)

**Constraints:**
- Zero audio track (validation fails if audio detected)
- Matches visual language from P2.06 (color, lighting, style consistency with generated assets)
- Loops or standalone? Loops must be seamless or marked for transition padding

**Example Valid Workflow:**
1. User reviews P2.05 storyboard (4-scene TXT preview — planned design, see
   `docs/PIPELINE_2_PHASES.md`; not yet implemented as of this pass)
2. User decides scene 1 needs "stock footage of water flowing" (not AI-generated)
3. User sources 3-second stock clip, downloads as silent H.264 MP4
4. System receives clip in P3.01 ingest, validates: zero audio, ≤10s, H.264 codec ✓
5. System places clip in scene 1 timeline

---

## Automatic Tasks (System Responsibility)

### Voice/Narration

**Primary path:** Piper (free, local) → generates preview/taslak MP3

**Fallback if Piper fails:** gTTS (Google Text-to-Speech, free, online)

**Fallback chain stops here:** If both Piper and gTTS fail → return error to user (do NOT escalate to ElevenLabs automatically)

**Production path (if user chooses at Gate A5):** ElevenLabs (requires explicit user approval, not automatic)

**User role:** Reviews Piper taslak (preview), approves or requests re-recording. For production voice (ElevenLabs), user selects voice variant, tone, pacing at Gate A5 → system executes.

**System manages:**
- Narration script generation (from P2.10 voice spec + claim tracing)
- TTS generation (Piper/gTTS/ElevenLabs per user choice)
- Phoneme timing and sync
- Pronunciation risk flagging (PronunciationFlag records)
- Audio normalization (level matching voice to music/SFX)

### Music

**Source:** Royalty-free music libraries (Epidemic Sound, Artlist, AudioJungle, etc.)

**System responsibilities:**
- Genre/mood matching to creative strategy
- Timing to match scene pacing
- BPM alignment with visual rhythm
- Licensing verification
- Audio normalization

**User role:** Approves music selection at review gate (if gate exists; otherwise system selects)

### Sound Effects (SFX)

**Source:** Royalty-free SFX libraries (Freesound, Epidemic Sound, BBC Sound Library, etc.)

**System responsibilities:**
- SFX selection per scene action (water flowing → water SFX, etc.)
- Timing to match visual events (footstep SFX timed to character movement)
- Audio normalization + mixing with voice and music
- Panning/spatialization for stereo mix

**User role:** Receives final mix with SFX already applied (review only)

### Captions / Subtitles

**Source:** Auto-generated from narration track or manual input

**System responsibilities:**
- Speech-to-text generation from voice track
- Caption formatting (line breaks, timing)
- Caption styling (font, size, color, position per visual language)
- Sync to video timeline

**User role:** Reviews caption accuracy (if review gate exists); system applies styling

### Transitions

**Definition:** Visual transitions between scenes (cut, dissolve, fade, wipe, motion emphasis)

**Source:** Computed from P2.08 Scene/Shot continuity anchors + P2.06 visual language direction

**System responsibilities:**
- Transition type selection (cut vs. dissolve per narrative rhythm)
- Timing/duration (computed from narrative pacing)
- Motion graphics execution (if visual transition needed)

**User role:** Incorporated in storyboard review (P2.05); user sees transition strategy at that gate

### Motion Graphics / Animation

**Definition:** System-generated motion, keyframes, timing, video effects

**System responsibilities:**
- Motion plan from P2.08 (camera movements, timing)
- Effect execution (transitions, text animations, object motion)
- Timing coordination across all motion elements

**Motion tool selection:** Research quality tools first (not forced cascade):
- **Remotion** (primary for P3.08 single-machine render): React-based video composition
- **FFmpeg** (transitions, frame manipulation, format conversion)
- **Motion graphics alternatives** (if project needs exceed Remotion scope): Research on per-project basis
  - GSAP (lightweight animation for web-based motion)
  - Blender (offline 3D motion)
  - After Effects (if outsourced; not P3 responsibility)

**User role:** Approves motion strategy in P2.05/P2.06 review; system executes

### Final Render (MP4)

**Definition:** Combining all elements (visuals, voice, music, SFX, captions, motion) into playable video file

**System responsibilities:**
- Remotion render (P3.08): Composes all elements at 30 FPS
- Codec selection: H.264 video + AAC audio (standard compatibility)
- Resolution: As specified in P2.04 format decision
- Duration: Trimmed to target length (±1s tolerance)
- Audio mixing: Voice, music, SFX balanced and normalized
- Distributed rendering (P3.09 optional): Large videos sharded across workers, merged via FFmpeg

**User role:** Final review of rendered MP4; approval gate (if exists)

---

## Boundary Enforcement

### In P2 Code

**pipeline2_creative/src/pipeline.ts:**
- `runP202Understand()`: Only structures ContentStructure from ingested research (no fabrication)
- `runP203Strategize()`: Only processes creative strategy from engine (no script writing)
- `runP204 + buildFormatDecisionMatrix()`: Format + constraints only, no asset specification
- `runP206ArtDirection()`: Visual language, no scene structure or asset counts
- `runP207AssetPlanning()`: Asset type/count per shot, no generation prompts
- `runP208SceneShotPlanning()`: Scene/shot sequence, no asset properties
- `runP209FlowPromptDirection()`: One prompt per asset, no "batch flow prompts"
- `runP210VoiceSpec()`: Script structure from claims + pronunciation flags, no voice provider selection

### In P3 Code

**pipeline3_production/src/ (core ingest modules):**
- `P3.01 Ingest`: Validates user visuals (images present) + silent videos (≤10s, no audio)
- `P3.02 Validation`: Checks asset types match asset_requirements
- `P3.03 Asset Matching`: Links visual assets to shot requirements
- `P3.04 Voice (Piper preview)`: Generates taslak via Piper → gTTS fallback
- `P3.05 Voice (ElevenLabs production)`: Only if Gate A5 user approval
- `P3.06 Timing`: Computes frame counts per shot

**pipeline3_production/src/timeline.ts (P3.07):**
- Orchestrates all system-managed elements (motion, transitions, timing)
- Integrates motion_planning from P2.08
- Produces timeline metadata for Remotion render

**pipeline3_production/src/remotion.ts (P3.08):**
- Renders final MP4
- Combines: user visuals + system voice + music + SFX + captions + motion
- Never creates assets or makes creative choices

---

## What This Boundary Prevents

### ❌ System Does NOT:

- **Request custom narration from user** (user only provides images/video; voice is system-generated)
- **Ask user for music selection** (system curates from libraries; user approves, not selects)
- **Cascade automatically from Piper → gTTS → ElevenLabs** (stops at gTTS fallback; ElevenLabs requires explicit Gate A5 approval)
- **Generate visual assets the user should provide** (if storyboard requires visual asset, user sources it; system doesn't invent)
- **Rewrite creative decisions during production** (P2 decisions are locked; P3 executes only)
- **Force motion graphics tool selection** (research quality tools first per project needs)

### ❌ User Does NOT:

- **Write narration scripts** (system generates from P2.10 voice spec + claims)
- **Select music from libraries** (system curates and applies; user approves final result)
- **Apply SFX or sound design** (system manages audio mixing)
- **Time shots or frames** (system computes timing from P2 creative direction)
- **Decide voice provider escalation** (Piper primary, gTTS fallback, ElevenLabs only at Gate A5)
- **Execute rendering** (system handles Remotion + FFmpeg)

---

## Test Enforcement (P2 & P3 Integration)

### P2 Contract Tests

**pipeline2_creative/tests/pipeline.integration.test.ts:**
- Verify manual assets NOT requested in P2 output
- Verify voice_script generated (not user-provided)
- Verify decision_log traces to user approvals only
- Verify no autonomous creative decisions

### P3 Contract Tests

**pipeline3_production/tests/ (ingest suite):**
- Verify P3.01 rejects: audio in "silent" video, video >10s, non-image image formats
- Verify P3.04 Piper fallback works: Piper fail → gTTS try → error if both fail
- Verify P3.05 ElevenLabs requires Gate A5 flag (not automatic)
- Verify P3.08 Remotion does not create assets (only renders provided ones)

---

## Example End-to-End Workflow

**Scenario: 3-minute Turkish philosophy documentary**

**P2 Output (Creative Intent):**
- ContentStructure: claims about Ottoman philosophers + narrative arc
- CreativeStrategy: "documentary, evidence-led, scholarly tone"
- FormatDecision: "horizontal long-form, 180s"
- ArtDirection: "muted earth tones, slow transitions, Ottoman manuscript aesthetics"
- Scene/Shot Planning: 12 scenes, 24 shots (specific camera language + timing)
- Asset Requirements: 28 unique visual assets (mostly images, 2 videos)
- VoiceSpec: 180s narration script + pronunciation flags for Turkish terms
- Flow Prompts: 28 individual visual generation prompts (one per asset)

**User Responsibility (P2 → P3 Handoff):**
1. Reviews P2.05 storyboard (4 scenes, narrative summary — planned design, not
   yet implemented as of this pass; see `docs/PIPELINE_2_PHASES.md`) ✓
2. Sources visual assets:
   - Ottoman manuscript images (12 from archives)
   - Portrait illustrations (4 commissioned)
   - 2-second video clip of calligraphy (personal shot)
   - 5-second video of scholar presenting (stock footage)
3. Uploads 28 visual assets + 2 video clips to P3 ingest ✓
4. Reviews Piper narration taslak (180s Turkish TTS) ✓
5. At Gate A5, chooses ElevenLabs production voice (Turkish + specific tone) ✓
6. Reviews final MP4 (180s, all elements combined, Ottoman aesthetic locked in) ✓

**System Responsibility (P2 → P3 Execution):**
- Generate 180s Turkish narration (Piper preview → ElevenLabs production)
- Select + apply royalty-free Ottoman-inspired music
- Generate SFX (page turns, quill strokes, ambient palace sounds)
- Auto-generate captions from narration
- Compute transitions (slow dissolves per creative strategy)
- Execute Remotion render: combine user visuals + system voice + music + SFX + captions + motion
- Output: 180s H.264 MP4 (Turkish philosophy documentary, ready for YouTube)

**Result:** User invested in visual curation and approval gates. System handled production mechanics. No custom narration requested. No forced voice provider cascade. No arbitrary creative decisions by system.

---

## Implementation Checklist

- [ ] P2 pipeline: No voice_script request in user-facing functions
- [ ] P2 pipeline: No manual asset request in decision output
- [ ] P3 ingest: Validates user images + silent video (≤10s, no audio)
- [ ] P3.04 Voice: Piper → gTTS fallback, stops if both fail
- [ ] P3.04 Voice: No automatic ElevenLabs escalation
- [ ] P3.05 Voice: ElevenLabs only with Gate A5 approval flag
- [ ] P3.08 Render: Never creates assets (only combines provided ones)
- [ ] Tests: Full boundary validation in integration tests
