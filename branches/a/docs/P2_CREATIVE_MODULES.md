# P2.06 / P2.07 / P2.08: Creative Module Responsibilities

## Module Hierarchy

These three modules form an integrated chain: **Visual Direction → Asset Planning → Scene/Shot Orchestration**

### P2.06: Art Direction (Visual Language Definition)

**Purpose:** Define the *aesthetic and structural framework* for all visual elements.

**Input:** CreativeStrategy (P2.03) + References (P2.01) + MemoryRecords (creative history)

**Output:** ArtDirection
```typescript
{
  art_direction_id: string;
  visual_language: string;          // Descriptive: "documentary realism, natural light, stone textures"
  checklist: string[];              // Implementation guides: "Select character reference", "Define camera intention"
  decision_ids: string[];           // FK -> Decision.decision_id (approved format, camera choices, etc.)
}
```

**Scope:**
- Visual aesthetic (style, color palette, lighting, texture, composition philosophy)
- Camera language (shot types, movement patterns, framing conventions)
- Continuity anchors (what ties scenes together visually)
- Character/location reference philosophy
- Motion design direction (static vs. kinetic, transition styles)
- NOT asset counts, NOT scene/shot timing, NOT specific asset specifications

**Decision Points Traced:**
- Format choice (affects visual density, asset budget)
- Camera strategy (static vs. dynamic)
- Color/lighting treatment
- Reference selection (informs visual language)

**P2.06 Output Examples:**
```
visual_language: "Vibrant primary colors, kinetic motion, heavy typography overlays, 
                  fast cuts (1-2s average), documentary photography style with 
                  illustration inserts, flat design aesthetic"

checklist: [
  "Gather 3-5 reference images for primary visual style",
  "Define exact color palette (RGB values) for brand consistency",
  "Establish camera movement vocabulary (slide, pan, zoom ranges)",
  "Define transition strategy (cut vs. dissolve vs. motion emphasis)",
  "Establish text hierarchy and typography scale"
]
```

### P2.07: Asset Planning (Asset Budget & Specification)

**Purpose:** Determine *what assets are required, in what quantities, with what properties*.

**Input:** Shots (from P2.08) + ArtDirection (P2.06) + Format/Duration constraints (P2.04)

**Output:** AssetRequirement[]
```typescript
{
  asset_requirement_id: string;
  shot_id: string;                           // Link to specific Shot
  expected_media_type: string;               // "VISUAL_IMAGE" | "VISUAL_VIDEO" | etc.
  expected_media_properties: Record<string, unknown>;  // Resolution, duration, codec, etc.
  generation_method: string;                 // "google_flow" | "manual_upload" | etc.
  reference_lineage: string[];               // Reference.reference_id[] (which references informed this asset)
  required: boolean;
  asset_role?: AssetRole;                    // "primary_visual" | "transition" | etc. (P2-C5 addition)
}
```

**Scope:**
- Asset type per shot (image, video, animation, diagram, map)
- Asset count per shot (simple: 1 asset; complex: multiple roles)
- Media properties (resolution, bitrate, duration limits)
- Generation method (AI generation, manual upload, library selection)
- Asset role stratification (primary visual vs. detail insert vs. transition)
- NOT scene structure, NOT shot timing, NOT visual language (that's P2.06)

**Decision Points:**
- Format from P2.04 determines asset budget (short-form = high reuse, long-form = many unique)
- Duration from P2.04 determines shot density, which drives asset count
- ArtDirection visual_language determines media properties (e.g., "flat design" → specific resolution/codec)
- Narrative density determines how many distinct assets needed per minute

**P2.07 Workflow:**
1. For each Shot (from P2.08):
   a. Determine primary asset type (from Shot.asset_type)
   b. Check if multiple asset roles needed (via assetPlansByShotId optional param)
   c. Infer media properties from ArtDirection (color depth, resolution tier)
   d. Determine generation method (AI native vs. manual vs. library)
   e. Create one or more AssetRequirement
2. Output is deterministic per Shot + ArtDirection combination

**P2.07 Output Example:**
```
For shot "shot_wide_arch" (3-4s establishing shot of aqueduct):
  - asset_type: VISUAL_IMAGE
  - role: primary_visual
  - expected_media_type: "VISUAL_IMAGE"
  - expected_media_properties: {
      resolution: "1080p",
      color_space: "sRGB",
      aspect_ratio: "1920:1080"
    }
  - generation_method: "google_flow"
  - reference_lineage: ["ref_ancient_engineering_explained"]
  - required: true
```

### P2.08: Scene/Shot Planning (Concrete Sequence Orchestration)

**Purpose:** Produce *concrete scene and shot matrix with timing, continuity, and asset placement*.

**Input:** CreativeStrategy (P2.03) + ArtDirection (P2.06)

**Output:** { scenes: Scene[], shots: Shot[] }
```typescript
interface Scene {
  scene_id: string;
  purpose: string;                      // "establish the aqueduct system"
  shots: string[];                       // FK -> Shot.shot_id[]
  continuity_requirements: string[];    // "stone color consistent across shots"
  narrative_function: string;            // "opening" | "climax" | "resolution" | etc.
}

interface Shot {
  shot_id: string;
  scene_id: string;
  purpose: string;                       // "wide establishing shot of the aqueduct arches"
  duration_intention: string;            // "3-4s" (human-readable)
  camera: ShotCamera;                    // angle, movement, lens, framing
  action: string;                        // "camera holds on the aqueduct arches against the sky"
  continuity_anchors: string[];          // ["stone_color"] (what ties to other shots)
  reference_requirements: string[];      // References used to inform this shot
  asset_type: string;                    // "VISUAL_IMAGE" | "VISUAL_VIDEO" | "ANIMATION" | etc.
  generation_method: string;             // How asset should be created
}
```

**Scope:**
- Scene structure (narrative beats, order)
- Shot sequence per scene (which shots comprise the scene)
- Shot timing (duration_intention in human terms)
- Camera language specification (angle, movement, lens choice)
- Continuity mechanics (anchors that tie shots together)
- Asset type per shot (what kind of asset is needed)
- NOT asset count details (that's P2.07 when multiple roles per shot)
- NOT media properties (that's P2.07 detailed specification)
- NOT visual language rationale (that's ArtDirection in P2.06)

**Decision Points:**
- Narrative structure from CreativeStrategy
- Camera language from ArtDirection
- Duration/pacing from Format (P2.04) and narrative density

**P2.08 Workflow:**
1. From CreativeStrategy narrative_direction, determine scene beats
2. For each beat, determine shots needed to execute it
3. For each shot, specify:
   - Camera language (from ArtDirection camera philosophy)
   - Duration intention (from pacing strategy)
   - Action/content (what happens in frame)
   - Continuity anchors (visual elements that link scenes)
   - Asset type (what media category is needed)
4. Output is Scene[] + Shot[] (shot_id FK to Scene)

**P2.08 Output Example:**
```
Scene: "scene_aqueduct_intro"
  purpose: "establish the aqueduct system"
  shots: ["shot_wide_arch", "shot_water_flow"]
  narrative_function: "opening"
  continuity_requirements: ["stone color consistent across shots"]

Shot: "shot_wide_arch"
  scene_id: "scene_aqueduct_intro"
  purpose: "wide establishing shot of the aqueduct arches"
  duration_intention: "3-4s"
  camera: { angle: "low", movement: "static", lens: "wide", framing: "wide" }
  action: "camera holds on the aqueduct arches against the sky"
  continuity_anchors: ["stone_color"]
  asset_type: "VISUAL_IMAGE"
  generation_method: "google_flow"

Shot: "shot_water_flow"
  scene_id: "scene_aqueduct_intro"
  purpose: "close-up on flowing water in the channel"
  duration_intention: "2-3s"
  camera: { angle: "eye-level", movement: "slow push-in", lens: "macro", framing: "close_up" }
  action: "water flows steadily through the stone channel"
  continuity_anchors: ["stone_color"]
  asset_type: "VISUAL_VIDEO"
  generation_method: "google_flow"
```

## Integration Sequence

```
P2.03 CreativeStrategy
  ↓
P2.06 Art Direction
  (defines visual language, camera language, reference basis)
  ↓
P2.08 Scene/Shot Planning
  (uses ArtDirection to inform shot specifications + continuity)
  ↓
P2.07 Asset Planning
  (given concrete shots from P2.08, produces asset requirements per shot)
  ↓
P2.09 Flow Prompt Direction
  (given shots + asset requirements, generates individual visual prompts per asset)
```

## Key Boundaries

### P2.06 Does NOT:
- Specify scene count or shot sequence (that's P2.08)
- Determine asset count or media properties (that's P2.07)
- Write asset generation prompts (that's P2.09)

### P2.07 Does NOT:
- Define visual language or camera philosophy (that's P2.06)
- Determine shot sequence or scene structure (that's P2.08)
- Write generation prompts (that's P2.09)

### P2.08 Does NOT:
- Define visual language (that's P2.06)
- Determine asset counts or properties (that's P2.07)
- Calculate timing or frame counts (that's P3.07 when producing timeline)

## Module Integrity

Each module's output is **canonical and locked** once produced:
- P2.06 ArtDirection → locked at approveArtDirection() gate (Gate A2 transition 2)
- P2.08 Scene/Shot Planning → locked when fed to P2.07/P2.09
- P2.07 Asset Planning → locked when fed to P3.01 ingest

**No backflow:** Downstream modules cannot rewrite upstream creative decisions. If P2.07 needs different asset strategy, escalate back to P2.06 (ArtDirection review), never silent rewrites.
