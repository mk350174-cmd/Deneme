// C2 (small improvements, P2.02 narrative tension / sensitive angles) —
// pure structuring tests: no fabrication (empty input -> empty arrays,
// never invented content), and this stays a standalone artifact, never a
// field on ContentStructure.

import { describe, expect, it } from "vitest";
import { recordCreativeAngleNotes } from "../src/creativeAngles.js";

describe("recordCreativeAngleNotes", () => {
  it("never fabricates content — an empty input yields all-empty arrays", () => {
    expect(recordCreativeAngleNotes({})).toEqual({
      controversial_points: [],
      intriguing_contrasts: [],
      provocative_angle_options: [],
      alternative_framings: [],
      ethics_risk_notes: [],
    });
  });

  it("only structures what the caller explicitly supplies, unchanged", () => {
    const notes = recordCreativeAngleNotes({
      controversial_points: ["the aqueduct's true purpose is debated among historians"],
      ethics_risk_notes: ["avoid overstating certainty about disputed dating"],
    });
    expect(notes.controversial_points).toEqual(["the aqueduct's true purpose is debated among historians"]);
    expect(notes.ethics_risk_notes).toEqual(["avoid overstating certainty about disputed dating"]);
    // Fields not supplied stay empty, never invented.
    expect(notes.intriguing_contrasts).toEqual([]);
    expect(notes.provocative_angle_options).toEqual([]);
    expect(notes.alternative_framings).toEqual([]);
  });
});
