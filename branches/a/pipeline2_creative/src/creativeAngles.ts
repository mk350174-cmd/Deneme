// Small-improvements addition (C2) — P2.02 narrative tension / sensitive
// angles. Same discipline as referenceDiscovery.ts's recordObservation:
// this only structures caller-supplied input, never invents controversial
// points, contrasts, angles, framings, or risk notes itself. Kept fully
// separate from ContentStructure (the FK-validated "verified content" type)
// — this module never touches facts and never presents unverified material
// as fact.

import type { CreativeAngleNotes } from "./types.js";

export function recordCreativeAngleNotes(input: Partial<CreativeAngleNotes>): CreativeAngleNotes {
  return {
    controversial_points: input.controversial_points ?? [],
    intriguing_contrasts: input.intriguing_contrasts ?? [],
    provocative_angle_options: input.provocative_angle_options ?? [],
    alternative_framings: input.alternative_framings ?? [],
    ethics_risk_notes: input.ethics_risk_notes ?? [],
  };
}
