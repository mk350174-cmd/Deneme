// ElevenLabs Preflight — the 9 checks required before any production voice
// call, explicitly enumerated (contract-correction pass item 3). Behavior
// unchanged from the architecture doc; this file makes the contract
// explicit and machine-checkable.

import type { CostLedger } from "./costLedger.js";
import type { PronunciationFlag } from "./types.js";

export interface PreflightCheckFns {
  checkApiConnectivity: () => Promise<boolean>; // (1)
  checkVoiceAvailability: (voiceId: string) => Promise<boolean>; // (2)
  checkModelAvailability: (modelId: string) => Promise<boolean>; // (3)
  getQuotaRemaining: () => Promise<number>; // (4)
}

export interface PreflightResult {
  proceed: boolean;
  checks: {
    api_connectivity: boolean; // (1)
    voice_availability: boolean; // (2)
    model_availability: boolean; // (3)
    quota_remaining_units: number; // (4)
    estimated_usage_units: number; // (5)
    within_hard_cost_limit: boolean; // (6)
    unresolved_number_date_unit_flags: PronunciationFlag[]; // (7)
    unresolved_terminology_flags: PronunciationFlag[]; // (8)
  };
  material_ambiguity: boolean; // (9) -> routes to Gate A6 when true
  route_to_gate_a6: boolean;
}

export async function runElevenLabsPreflight(params: {
  text: string;
  voiceId: string;
  modelId: string;
  pronunciationFlags: PronunciationFlag[];
  resolvedFlagTokens: Set<string>; // tokens the user has explicitly confirmed/resolved
  costLedger: CostLedger;
  provider: "elevenlabs";
  fns: PreflightCheckFns;
}): Promise<PreflightResult> {
  // (1)(2)(3)
  const api_connectivity = await params.fns.checkApiConnectivity();
  const voice_availability = await params.fns.checkVoiceAvailability(params.voiceId);
  const model_availability = await params.fns.checkModelAvailability(params.modelId);

  // (4)(5)(6)
  const quota_remaining_units = await params.fns.getQuotaRemaining();
  const estimated_usage_units = params.text.length;
  const wouldExceedQuota = estimated_usage_units > quota_remaining_units;
  const wouldExceedHardLimit = params.costLedger.wouldExceedHardLimit(params.provider, estimated_usage_units);
  const within_hard_cost_limit = !wouldExceedQuota && !wouldExceedHardLimit;

  // (7)(8) — never silently normalized: anything not explicitly resolved by
  // the caller stays "unresolved" and contributes to material ambiguity.
  const numberDateUnitTypes = new Set(["number", "date", "unit"]);
  const unresolved_number_date_unit_flags = params.pronunciationFlags.filter(
    (f) => numberDateUnitTypes.has(f.flag_type) && !params.resolvedFlagTokens.has(f.token),
  );
  const unresolved_terminology_flags = params.pronunciationFlags.filter(
    (f) => f.flag_type === "special_terminology" && !params.resolvedFlagTokens.has(f.token),
  );

  // (9)
  const material_ambiguity =
    !api_connectivity ||
    !voice_availability ||
    !model_availability ||
    !within_hard_cost_limit ||
    unresolved_number_date_unit_flags.length > 0 ||
    unresolved_terminology_flags.length > 0;

  return {
    proceed: !material_ambiguity,
    checks: {
      api_connectivity,
      voice_availability,
      model_availability,
      quota_remaining_units,
      estimated_usage_units,
      within_hard_cost_limit,
      unresolved_number_date_unit_flags,
      unresolved_terminology_flags,
    },
    material_ambiguity,
    route_to_gate_a6: material_ambiguity,
  };
}
