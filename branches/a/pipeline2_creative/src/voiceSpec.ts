// P2.10 Voice + Production Spec — docs/architecture/02_PIPELINE_2_ARCHITECTURE.md
// (referenced via A_BRANCH_SPEC.md P2.10: "narration script, pronunciation/
// number handling notes"). NEW: no direct source implementation for this
// exact concern in P2 (Studio's number-detection lives in its Pipeline 3
// checklist scripts, a different pipeline's scope) — built new here, at the
// idea level informed by that concept, per the capability classification.
//
// Flags high-risk narration tokens (numbers, dates, units, capitalized
// multi-word terms as a proxy for special terminology) so P3's ElevenLabs
// preflight has concrete flags to validate, closing the loop the source
// repos never connected across pipelines.

import type { PronunciationFlag, VoiceLine } from "./types.js";
import { stableVoiceLineId } from "./ids.js";

const NUMBER_RE = /\b\d[\d,.]*\b/g;
const DATE_RE = /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,4}\s?(BC|AD|BCE|CE)\b/g;
const UNIT_RE = /\b\d[\d.,]*\s?(km|m|cm|mm|kg|g|mph|km\/h|%|°C|°F)\b/gi;
const TERMINOLOGY_RE = /\b([A-Z][a-z]+(?:\s[A-Z][a-z]+){1,3})\b/g;

export function buildVoiceScript(narrationLines: string[]): string {
  return narrationLines.join("\n\n");
}

// R01.3 REPAIR — VoiceLine <-> voice_script drift prevention.
//
// PROBLEM: runP210VoiceSpec previously built voice_script and voice_lines
// as two INDEPENDENT calls over the same input array
// (`buildVoiceScript(narrationLines.map(l => l.text))` and
// `buildVoiceLines(narrationLines)`). They agreed only by construction —
// nothing in the TYPE SYSTEM or at package-draft time enforced that they
// stay derived from the same ordered text. A future caller assembling a
// ProductionPackageHandoff by hand (or an edit path that touches one but
// not the other) could silently desynchronize them.
//
// REPAIR: voice_script is now DERIVED from voice_lines (single source of
// truth — never constructed in parallel), and
// verifyVoiceScriptConsistency() is a hard, callable invariant check used
// at package-draft time (see pipeline.ts::draftProductionPackage) so any
// OTHER construction path that produces a mismatched pair is caught, not
// just the canonical one.
export function voiceScriptFromLines(voiceLines: VoiceLine[]): string {
  return buildVoiceScript(voiceLines.map((l) => l.text));
}

export function verifyVoiceScriptConsistency(
  voiceScript: string,
  voiceLines: VoiceLine[],
): { valid: boolean; expected: string; actual: string } {
  const expected = voiceScriptFromLines(voiceLines);
  return { valid: expected === voiceScript, expected, actual: voiceScript };
}

// TIER-2 REPAIR T2.4 — voice lineage.
//
// PROBLEM: runP210VoiceSpec flattened narration lines straight into
// voice_script: string via buildVoiceScript(). The per-line claim_id that
// flagPronunciationRisks receives was used only to annotate pronunciation
// flags — the moment the script was flattened, the claim/line lineage
// itself was gone. P3 receives a single opaque string with no way to trace
// any sentence back to the claim it narrates.
//
// REPAIR: build the canonical VoiceLine[] structure (line_id, claim_id,
// text) alongside the flattened script, so lineage survives as a first-class
// object rather than only as a byproduct of pronunciation-flag annotation.
// voice_script remains the canonical rendered-text representation P3
// actually feeds to voice synthesis — VoiceLine[] is additive, never a
// replacement for it.
export function buildVoiceLines(
  narrationLines: Array<{ text: string; claim_id?: string }>,
): VoiceLine[] {
  // claim_id is intentionally never required or defaulted here — a line
  // that legitimately narrates no specific claim (a transition sentence, an
  // intro/outro) carries `claim_id: undefined`, not a fabricated one.
  return narrationLines.map((line, index) => ({
    line_id: stableVoiceLineId(index, line.text),
    claim_id: line.claim_id,
    text: line.text,
  }));
}

export function flagPronunciationRisks(
  narrationLines: Array<{ text: string; claim_id?: string }>,
): PronunciationFlag[] {
  const flags: PronunciationFlag[] = [];

  for (const line of narrationLines) {
    // Track date and unit token positions to avoid false positives in number detection.
    const capturedPositions: Array<{ start: number; end: number }> = [];

    for (const match of line.text.matchAll(DATE_RE)) {
      const start = match.index || 0;
      const end = start + match[0].length;
      capturedPositions.push({ start, end });
      flags.push({ claim_id: line.claim_id, token: match[0], flag_type: "date", note: "Date-like token; verify pronunciation." });
    }
    for (const match of line.text.matchAll(UNIT_RE)) {
      const start = match.index || 0;
      const end = start + match[0].length;
      capturedPositions.push({ start, end });
      flags.push({ claim_id: line.claim_id, token: match[0], flag_type: "unit", note: "Unit-bearing quantity; verify unit is read aloud correctly." });
    }
    for (const match of line.text.matchAll(NUMBER_RE)) {
      // Skip numbers that overlap with already-captured date/unit token positions.
      const start = match.index || 0;
      const end = start + match[0].length;
      const isOverlapped = capturedPositions.some((pos) => start < pos.end && end > pos.start);
      if (!isOverlapped) {
        flags.push({ claim_id: line.claim_id, token: match[0], flag_type: "number", note: "Numeric token; verify spoken form (cardinal vs ordinal)." });
      }
    }
    for (const match of line.text.matchAll(TERMINOLOGY_RE)) {
      flags.push({ claim_id: line.claim_id, token: match[0], flag_type: "special_terminology", note: "Proper-noun-like term; verify pronunciation." });
    }
  }

  return flags;
}
