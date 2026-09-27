// P3.06 Timing — narration is the master clock. Corrected model
// (contract-correction pass item 3): intended_duration_s, allocated_duration_s,
// and actual_narration_duration_s are distinct fields, never merged.
// Shot.duration_intention (P2's original string) is READ ONLY here — this
// module never writes back to the Shot objects it's given (invariant 5).

import type { Shot, TimingConflict, TimingResult } from "./types.js";

const DEVIATION_THRESHOLD_PCT = 15; // reused exactly from Studio's Piper deviation threshold

// Parses "3-4s" / "2.5s" / "3s" into a numeric midpoint estimate. Never
// invents a duration for a shot that has none — throws instead (fail loud,
// per "P3 MUST NOT invent timing intent that is absent from P2").
export function parseDurationIntention(intention: string): number {
  const match = intention.match(/(\d+(?:\.\d+)?)\s*(?:-\s*(\d+(?:\.\d+)?))?\s*s/i);
  if (!match) {
    throw new Error(`Cannot parse duration_intention "${intention}" — no numeric intent found, refusing to invent one`);
  }
  const low = Number(match[1]);
  const high = match[2] !== undefined ? Number(match[2]) : low;
  return (low + high) / 2;
}

export function computeTiming(shots: readonly Shot[], actualNarrationDurationS: number): TimingResult {
  // Read-only pass: `shots` is never mutated. intended_duration_s is parsed
  // fresh each time from Shot.duration_intention, never written back to it.
  const intended = shots.map((shot) => ({ shot, intended_duration_s: parseDurationIntention(shot.duration_intention) }));
  const intended_total_duration_s = intended.reduce((sum, s) => sum + s.intended_duration_s, 0);

  const scale = intended_total_duration_s > 0 ? actualNarrationDurationS / intended_total_duration_s : 1;

  const shot_timings = intended.map(({ shot, intended_duration_s }) => ({
    shot_id: shot.shot_id,
    intended_duration_s,
    allocated_duration_s: Math.round(intended_duration_s * scale * 100) / 100,
  }));

  const conflicts: TimingConflict[] = [];

  const packageDeviationPct =
    intended_total_duration_s > 0
      ? Math.round(((actualNarrationDurationS - intended_total_duration_s) / intended_total_duration_s) * 1000) / 10
      : 0;
  if (Math.abs(packageDeviationPct) > DEVIATION_THRESHOLD_PCT) {
    conflicts.push({
      intended_duration_s: intended_total_duration_s,
      actual_duration_s: actualNarrationDurationS,
      deviation_pct: packageDeviationPct,
      note:
        `Approved narration duration (${actualNarrationDurationS}s) deviates ${packageDeviationPct}% from P2's ` +
        `intended total (${intended_total_duration_s}s). Visuals bend to narration; this conflict is recorded, not silently rewritten.`,
    });
  }

  return { actual_narration_duration_s: actualNarrationDurationS, intended_total_duration_s, shot_timings, conflicts };
}
