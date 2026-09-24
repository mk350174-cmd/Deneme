# P3.07: Motion Execution Coordinator

## Purpose

P3.07 orchestrates where P2's creative motion decisions meet P3's production timeline. Motion planning from P2 (camera movements, transition types, animation specs) flows into the concrete timeline that P3.08 Remotion executes.

## Input: P2 Motion Planning

From P2.08 Scene/Shot Planning:

```typescript
interface Shot {
  shot_id: string;
  camera: ShotCamera;           // angle, movement, lens, framing
  action: string;               // "camera holds", "slow pan", "quick cut", etc.
  duration_intention: string;   // "3-4s" — pacing signal
  continuity_anchors: string[]; // Visual elements tying shots together
  // ... other fields
}

interface ShotCamera {
  angle: string;        // "low", "high", "eye-level"
  movement: string;     // "static", "slow pan", "push-in", "slide"
  lens: string;         // "wide", "macro", "standard", "telephoto"
  framing: string;      // "close_up", "medium", "wide"
}
```

From P2.06 Art Direction:

```typescript
interface ArtDirection {
  visual_language: string;   // Aesthetic (colors, lighting, style)
  checklist: string[];       // Implementation guides
  decision_ids: string[];    // Approved creative decisions
}
```

## P3.07 Timeline with Motion Metadata

Enhanced `TimelineEntry` carries motion execution specs:

```typescript
interface TimelineEntry {
  shot_id: string;
  asset_file_id: string;
  start_frame: number;
  duration_frames: number;
  // P3-A: Motion execution metadata (optional)
  motion?: {
    camera_movement: string;      // "static" | "pan" | "zoom" | "slide" | "crane"
    movement_duration_frames: number;  // How long the movement takes
    transition_type: string;       // "cut" | "dissolve" | "fade" | "wipe" | "motion_emphasis"
    transition_duration_frames: number;
    easing?: string;              // "linear" | "ease_in" | "ease_out" | "ease_in_out"
  };
}
```

## Motion Coordination Workflow

### P2 → P3 Handoff

1. **P2.06 Art Direction** specifies visual language (color, lighting, continuity philosophy)
2. **P2.08 Scene/Shot Planning** specifies camera language per shot (angle, movement, lens, framing)
3. **P2.04 Format Decision** specifies narrative pacing (shots/minute, density)
4. **P3.07 Timeline** merges these:
   - Canonical shot sequence (from Scene.shots[])
   - Timing (from P3.06 ShotTiming)
   - Motion specs (from Shot.camera + Shot.action)
   - Transition strategy (derived from narrative rhythm + art direction)

### P3.07 Motion Coordination Rules

1. **Camera movement from Shot.camera.movement:**
   - "static" → no movement (cut-based transitions)
   - "slow pan" → pan motion over 70% of shot duration
   - "push-in" → zoom/dolly motion, 50% duration
   - "slide" → lateral movement, smooth 80% duration

2. **Transition selection from narrative pacing:**
   - Dense narrative (>3 cuts/min) → cuts (no duration waste)
   - Moderate narrative (1-3 cuts/min) → dissolves (0.5s), fades
   - Sparse, contemplative pacing → longer dissolves, motion emphasis

3. **Easing from visual language:**
   - Documentary (naturalistic) → linear, ease_out
   - Kinetic (motion-forward) → ease_in_out (snappy)
   - Contemplative → ease_in, extended duration

### P3.07 Does NOT

- Invent motion not specified in P2
- Reinterpret Shot.camera language
- Ignore Shot.action directives
- Change shot order (Scene.shots[] is canonical)
- Adjust timing (shot duration is from P3.06 ShotTiming, locked)

## Implementation in P3.07

```typescript
export function buildTimeline(
  scenes: readonly Scene[],
  timing: TimingResult,
  resolvedAssets: readonly ResolvedAsset[],
  artDirection?: ArtDirection,  // Optional: motion metadata enrichment
): Timeline {
  // ... existing frame-counting logic ...

  // NEW: Enrich entries with motion metadata (if artDirection provided)
  if (artDirection) {
    for (const entry of entries) {
      entry.motion = computeMotionMetadata(
        entry,
        scenesAndShotsMap.get(entry.shot_id),
        artDirection,
      );
    }
  }

  return { fps: FPS, total_frames: frameCursor, entries };
}

function computeMotionMetadata(
  entry: TimelineEntry,
  shot: Shot,
  artDirection: ArtDirection,
): TimelineEntry["motion"] {
  const cameraMovement = shot.camera.movement || "static";
  const narrativePacing = artDirection.visual_language; // infer from language

  return {
    camera_movement: cameraMovement,
    movement_duration_frames: computeMovementDuration(cameraMovement, entry.duration_frames),
    transition_type: selectTransition(cameraMovement, narrativePacing),
    transition_duration_frames: selectTransitionDuration(narrativePacing),
    easing: selectEasing(narrativePacing),
  };
}
```

## Motion Execution in P3.08 Remotion

P3.08 receives `Timeline` with optional `motion` metadata per entry and:

1. Creates Remotion composition with `AbsoluteFill` layers per entry
2. Applies camera movement via CSS transforms / Remotion motion APIs
3. Applies transition between entries (cut vs. dissolve per motion.transition_type)
4. Applies easing per motion.easing
5. Renders final video at target resolution/FPS

## Example: 3-Shot Scene

**P2 Input:**
- Shot 1: Camera at "low angle, static" → "establish aqueduct"
- Shot 2: Camera at "eye-level, slow pan" → "pan across arch details"
- Shot 3: Camera at "macro, push-in" → "close-up water flow"

**P3.07 Motion Metadata Output:**
```
Entry 1:
  start_frame: 0
  duration_frames: 90 (3s @ 30fps)
  motion:
    camera_movement: "static"
    movement_duration_frames: 0
    transition_type: "cut"
    easing: "linear"

Entry 2:
  start_frame: 90
  duration_frames: 60 (2s)
  motion:
    camera_movement: "pan"
    movement_duration_frames: 54 (70% of shot, easing end)
    transition_type: "cut"
    easing: "ease_out"

Entry 3:
  start_frame: 150
  duration_frames: 60 (2s)
  motion:
    camera_movement: "push_in"
    movement_duration_frames: 30 (50% of shot)
    transition_type: "dissolve"
    transition_duration_frames: 15 (0.5s)
    easing: "ease_in_out"
```

**P3.08 Renders:**
- Frame 0-90: Static shot (no motion)
- Frame 90-144: Pan motion (54 frames, ease_out)
- Frame 144-150: Pan settling (6 frames, no motion)
- Frame 150-151: Dissolve transition (15 frames, overlapping entry 3)
- Frame 151-180: Push-in motion with dissolve blend, easing in and out

**Result:** Seamless video combining user's visual assets with system's motion execution, all traced back to P2 creative decisions.

## No Autonomous Motion Invention

- P3.07 does NOT add motion that P2 didn't specify
- P3.07 coordinates existing motion specs, does NOT reinterpret them
- If creative motion needs change, escalation goes back to P2.06/P2.08 (Art Direction / Scene-Shot review)
- P3 executes, P2 decides

## Design Tool Selection (No Forced Cascade)

Research quality tools per project needs:

- **Remotion (primary P3.08):** React-based video composition, perfect for timeline-driven motion, 30 FPS + easing, deterministic output
- **FFmpeg:** Frame manipulation, transitions, format conversion, proven reliability
- **Motion alternatives (if needed):**
  - GSAP: Lightweight web animation for simple motion (not primary for P3.08 render)
  - Blender: Offline 3D motion (research separately for complex 3D requirements)
  - After Effects: Outsourced complex motion (not P3 in-house responsibility)

No automatic fallback cascade: use best tool for the project, document rationale.
