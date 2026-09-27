// P3.06 Timing — items 17 (narration as master clock), 18 (timing conflict
// detection), plus the corrected model's explicit invariants: P2's
// duration_intention is never mutated; intended/allocated/actual stay
// distinct fields.

import { describe, expect, it } from "vitest";
import { computeTiming, parseDurationIntention } from "../src/timing.js";
import { PRODUCTION_PACKAGE_FIXTURE } from "./fixtures/production_package.fixture.js";

const shots = PRODUCTION_PACKAGE_FIXTURE.shots;

describe("duration_intention parsing (read-only)", () => {
  it("parses a range as its midpoint", () => {
    expect(parseDurationIntention("3-4s")).toBe(3.5);
  });

  it("parses a single value", () => {
    expect(parseDurationIntention("2s")).toBe(2);
  });

  it("refuses to invent a duration for unparseable text", () => {
    expect(() => parseDurationIntention("soon")).toThrow();
  });
});

describe("narration is the master clock (item 17)", () => {
  it("scales shot allocations to match the actual narration duration, not word-count guesses", () => {
    // Intended total: 3.5 (wide_arch) + 2.5 (water_flow) = 6s.
    const result = computeTiming(shots, 6); // actual matches intended exactly
    expect(result.actual_narration_duration_s).toBe(6);
    expect(result.intended_total_duration_s).toBe(6);
    expect(result.shot_timings.find((t) => t.shot_id === "shot_wide_arch")?.allocated_duration_s).toBeCloseTo(3.5, 1);
  });

  it("visuals bend to narration: allocated durations scale when actual differs from intended", () => {
    const result = computeTiming(shots, 12); // double the intended total
    const wideArch = result.shot_timings.find((t) => t.shot_id === "shot_wide_arch")!;
    expect(wideArch.allocated_duration_s).toBeCloseTo(7, 1); // 3.5 * 2
    // intended_duration_s must remain the original parsed value, unaffected
    // by the scaling applied to allocated_duration_s.
    expect(wideArch.intended_duration_s).toBeCloseTo(3.5, 1);
  });
});

describe("P2 duration_intention immutability (correction 3, tests 1-3)", () => {
  it("1: the original Shot.duration_intention string is never mutated by computeTiming", () => {
    const before = JSON.stringify(shots);
    computeTiming(shots, 20);
    const after = JSON.stringify(shots);
    expect(after).toBe(before);
  });

  it("2: allocated_duration_s can differ from intended_duration_s", () => {
    const result = computeTiming(shots, 60); // far off intended total
    const wideArch = result.shot_timings.find((t) => t.shot_id === "shot_wide_arch")!;
    expect(wideArch.allocated_duration_s).not.toBeCloseTo(wideArch.intended_duration_s, 1);
  });

  it("3: a >15% deviation produces a visible TimingConflict (item 18)", () => {
    const result = computeTiming(shots, 12); // 6s intended -> 100% deviation
    expect(result.conflicts.length).toBeGreaterThan(0);
    expect(result.conflicts[0]?.deviation_pct).toBeGreaterThan(15);
    expect(result.conflicts[0]?.note).toContain("recorded, not silently rewritten");
  });

  it("no conflict when deviation is within 15%", () => {
    const result = computeTiming(shots, 6.3); // ~5% deviation from 6s
    expect(result.conflicts).toHaveLength(0);
  });
});
