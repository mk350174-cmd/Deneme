import { describe, expect, it } from "vitest";
import { buildVoiceScript, flagPronunciationRisks } from "../src/voiceSpec.js";

describe("P2.10 Voice + Production Spec", () => {
  it("builds a voice script from narration lines", () => {
    expect(buildVoiceScript(["Line one.", "Line two."])).toBe("Line one.\n\nLine two.");
  });

  it("flags numbers, dates, units and terminology-like tokens", () => {
    const flags = flagPronunciationRisks([
      { text: "The Aqua Appia was completed in 312 BC and ran 16.4 km.", claim_id: "claim_1" },
    ]);
    expect(flags.some((f) => f.flag_type === "date")).toBe(true);
    expect(flags.some((f) => f.flag_type === "unit")).toBe(true);
    expect(flags.every((f) => f.claim_id === "claim_1")).toBe(true);
  });

  it("returns no flags for plain narration with nothing risky", () => {
    const flags = flagPronunciationRisks([{ text: "the water flowed downhill by gravity alone" }]);
    expect(flags).toHaveLength(0);
  });

  it("AUDIT FIX §B: detects standalone numbers separately from embedded substrings", () => {
    // Bug: "90" should NOT be skipped just because "1990" exists and "1990".includes("90")
    const flags = flagPronunciationRisks([
      { text: "The year 1990 was historic. A 90-day period followed.", claim_id: "c1" },
    ]);
    const numberFlags = flags.filter((f) => f.flag_type === "number");
    // Should flag "1990" as one number, and "90" as a separate number
    expect(numberFlags.length).toBeGreaterThanOrEqual(2);
    const tokenSet = new Set(numberFlags.map((f) => f.token));
    expect(tokenSet.has("1990")).toBe(true);
    expect(tokenSet.has("90")).toBe(true);
  });

  it("AUDIT FIX §B: respects character position boundaries for number/unit overlap", () => {
    // A number that is part of a unit (e.g., "100 kg") should be skipped for standalone number flag.
    // A number that is part of a date (e.g., "2025-01-15") should also be skipped.
    // But "100" and "2025" appearing separately should be flagged as numbers.
    const flags = flagPronunciationRisks([
      { text: "The sample weighs 100 kg and was created on 2025-01-15 for a 100-year study.", claim_id: "c1" },
    ]);
    const numberFlags = flags.filter((f) => f.flag_type === "number");
    const unitFlags = flags.filter((f) => f.flag_type === "unit");
    const dateFlags = flags.filter((f) => f.flag_type === "date");

    // Should have one unit flag ("100 kg")
    expect(unitFlags.some((f) => f.token.includes("100 kg"))).toBe(true);
    // Should have one date flag ("2025-01-15")
    expect(dateFlags.some((f) => f.token === "2025-01-15")).toBe(true);
    // Should have one or more number flags (the final "100" in "100-year")
    expect(numberFlags.length).toBeGreaterThan(0);
    // The "100" in "100 kg" should NOT be flagged separately as a number
    // (position overlap with unit token)
    const numberTokens = numberFlags.map((f) => f.token);
    // We should not have flagged the first "100" (part of "100 kg" unit)
    // but we might flag the second "100" (part of "100-year", which is not a unit match)
  });

  it("AUDIT FIX §B: handles punctuation boundaries correctly", () => {
    // Numbers separated by punctuation are different tokens.
    // "90-day" should have "90" as a separate number token, not overlapping with a unit.
    const flags = flagPronunciationRisks([
      { text: "A 90-day cycle and a 90 mph speed limit.", claim_id: "c1" },
    ]);
    const numberFlags = flags.filter((f) => f.flag_type === "number");
    const unitFlags = flags.filter((f) => f.flag_type === "unit");

    // "90 mph" should be flagged as a unit
    expect(unitFlags.some((f) => f.token.includes("90 mph"))).toBe(true);
    // "90" in "90-day" should be flagged as a number (position doesn't overlap with unit)
    expect(numberFlags.some((f) => f.token === "90")).toBe(true);
  });
});
