// R03 — P3-level production voice provider abstraction.
//
// ARCHITECTURAL NOTE (Principle 2 — do not silently redefine terminology):
// elevenlabs.ts's own header comment states "ElevenLabs is a LOCKED
// provider — the only injectable seam is the raw HTTP-call function
// (invariant 9), never a swappable 'VoiceProvider'/'TTSProvider'." This
// module deliberately introduces exactly that swappable abstraction. This
// is not a silent reversal of that decision — it is the explicit mandate
// of the final repair instructions (R03: "Use one P3-level provider
// abstraction... ProductionVoiceProvider ├── ElevenLabsProvider └──
// VoiceboxProvider"). The original invariant-9 raw-HTTP-seam pattern is
// preserved INSIDE each provider (ElevenLabsProvider still calls the
// unmodified elevenlabs.ts::generateProductionVoice, which still takes only
// a raw HTTP seam) — this layer sits ABOVE that, choosing WHICH provider to
// call, not replacing how either one calls out.
//
// Preview generation (Piper/gTTS) is NOT part of this abstraction and is
// unaffected — it remains a separately governed step ahead of Gate A5
// (see pipeline.ts::runP304VoicePreviewWithFallback). This abstraction
// covers only PRODUCTION voice, which is gated behind A5 (and A6 when
// applicable).

import type { GateApprovalRecord, ProductionVoiceResult } from "./types.js";

/**
 * R04 — normalized provider failure states.
 *
 * SUCCESS is the only status carrying a result. Every other status is a
 * genuine provider-availability/failure condition (never a governance
 * failure — see the critical rule in generateWithFallback below).
 */
export type ProviderStatus =
  | "NOT_CONFIGURED"
  | "UNAVAILABLE"
  | "AUTH_FAILED"
  | "QUOTA_UNAVAILABLE"
  | "TIMEOUT"
  | "INVALID_REQUEST"
  | "PROVIDER_ERROR"
  | "SUCCESS";

export interface ProviderResult {
  status: ProviderStatus;
  voice?: ProductionVoiceResult; // present iff status === "SUCCESS"
  errorMessage?: string;
}

/**
 * Thrown for a GENUINE provider condition (credential missing, provider
 * down, quota, timeout, malformed provider response). Caught by
 * generateWithFallback and normalized into a ProviderResult — this is what
 * may legitimately trigger a fallback to the next provider.
 *
 * NEVER thrown for a governance condition (missing A5/A6, package/hash
 * mismatch, invalid VoiceLine, broken lineage, malformed canonical input).
 * Those remain ordinary thrown Errors (or the existing GateStateError /
 * P3Error / TraceabilityError types) that propagate straight through
 * generateWithFallback uncaught — hard failures, never fallback triggers.
 */
export class ProviderConditionError extends Error {
  constructor(
    public readonly status: Exclude<ProviderStatus, "SUCCESS">,
    message: string,
  ) {
    super(message);
    this.name = "ProviderConditionError";
  }
}

export interface ProductionVoiceGenerateParams {
  /** The exact canonical text to synthesize — see R03.1's text-integrity rule. */
  text: string;
  /** The VoiceLine this generation corresponds to, for cache/generation identity (R03.1's generation_key). */
  voiceLineId: string;
  language?: string;
  gates: GateApprovalRecord[];
  materialAmbiguityDetected?: boolean;
  outputDir?: string;
}

/**
 * One production voice provider. Both ElevenLabsProvider and
 * VoiceboxProvider implement this; A4/A5/A6 governance checks live INSIDE
 * generate() (via requireGateState, unchanged from the pre-existing
 * elevenlabs.ts pattern) so a provider can never be reached without the
 * same gate checks either provider always had.
 */
export interface ProductionVoiceProvider {
  readonly name: "elevenlabs" | "voicebox";
  /**
   * Genuine availability/configuration check — does NOT perform generation
   * and does NOT check gates (availability is a provider-infrastructure
   * question, independent of whether this particular request is
   * authorized).
   */
  availability(): Promise<{ available: boolean; status: ProviderStatus }>;
  generate(params: ProductionVoiceGenerateParams): Promise<ProviderResult>;
}
