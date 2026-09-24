// R04 — production voice provider routing.
//
// Policy (from the final repair instructions):
//
//   A5/A6 valid?
//       |
//   Is ElevenLabs available/configured?
//       |
//    YES -> ElevenLabs        NO -> Voicebox
//
// CRITICAL RULE, enforced structurally, not just by convention:
//
//   Fallback is triggered ONLY by a genuine provider availability/failure
//   condition — missing credential, unavailable provider, quota, timeout,
//   provider service failure. These arrive here as a ProviderResult with a
//   non-SUCCESS ProviderStatus, returned by a provider's generate() (never
//   thrown).
//
//   A governance condition — missing A5/A6, package/hash mismatch, invalid
//   VoiceLine, broken lineage, malformed canonical input — must hard-fail.
//   These arrive as a THROWN error (GateStateError, P3Error,
//   TraceabilityError, or a plain Error from a lineage/hash check) from
//   EITHER provider's generate(), and this function does not catch them.
//   They propagate straight out of generateWithFallback uncaught. A caller
//   cannot "fall through" a governance failure to the other provider by
//   construction: there is no try/catch around the governance-throwing
//   code path here that could swallow it.
//
// Both providers perform their OWN A5/A6 checks internally (see
// elevenlabsProvider.ts / voiceboxProvider.ts) — this router does not
// duplicate or relax them. If ElevenLabs is skipped because it is
// unavailable, Voicebox's generate() still independently re-checks A5/A6
// from scratch; a request that was never actually authorized fails on
// EITHER provider, not just the first one tried.

import type {
  ProductionVoiceGenerateParams,
  ProductionVoiceProvider,
  ProviderResult,
} from "./voiceProviderTypes.js";

export interface RoutingAttempt {
  provider: "elevenlabs" | "voicebox";
  result: ProviderResult;
}

export interface RoutingOutcome {
  result: ProviderResult;
  attempts: RoutingAttempt[];
  /** Which provider's result was ultimately used. */
  usedProvider: "elevenlabs" | "voicebox";
}

const FALLBACK_ELIGIBLE_STATUSES = new Set([
  "NOT_CONFIGURED",
  "UNAVAILABLE",
  "AUTH_FAILED",
  "QUOTA_UNAVAILABLE",
  "TIMEOUT",
  "PROVIDER_ERROR",
]);

/**
 * INVALID_REQUEST is deliberately NOT in FALLBACK_ELIGIBLE_STATUSES.
 *
 * A malformed request to ElevenLabs (e.g. its own API rejecting the text or
 * parameters) is not evidence that Voicebox would behave differently for
 * the SAME request — retrying an invalid request against a different
 * provider is more likely to waste a call than recover one, and masks a
 * genuine request-shape bug behind an apparent "fallback success" if
 * Voicebox happens to be more permissive. INVALID_REQUEST is surfaced
 * directly to the caller instead.
 */
export function isFallbackEligible(status: ProviderResult["status"]): boolean {
  return FALLBACK_ELIGIBLE_STATUSES.has(status);
}

/**
 * Routes a production voice generation request between ElevenLabs (primary,
 * when configured/available) and Voicebox (fallback). Returns the full
 * attempt trail so a caller/QA step can see exactly what was tried and why,
 * per the mandate's "never inflate readiness" principle.
 */
export async function generateWithFallback(params: {
  elevenLabs: ProductionVoiceProvider;
  voicebox: ProductionVoiceProvider;
  request: ProductionVoiceGenerateParams;
}): Promise<RoutingOutcome> {
  const attempts: RoutingAttempt[] = [];

  const elevenLabsAvailability = await params.elevenLabs.availability();
  if (elevenLabsAvailability.available) {
    // Governance errors thrown from generate() are NOT caught here — they
    // propagate straight out of generateWithFallback, uncaught, as the
    // module-level policy requires.
    const elevenLabsResult = await params.elevenLabs.generate(params.request);
    attempts.push({ provider: "elevenlabs", result: elevenLabsResult });

    if (elevenLabsResult.status === "SUCCESS") {
      return { result: elevenLabsResult, attempts, usedProvider: "elevenlabs" };
    }
    if (!isFallbackEligible(elevenLabsResult.status)) {
      // A non-success, non-fallback-eligible status (INVALID_REQUEST) is
      // surfaced directly — not retried against Voicebox.
      return { result: elevenLabsResult, attempts, usedProvider: "elevenlabs" };
    }
    // Falls through to Voicebox below — a genuine provider condition.
  } else {
    attempts.push({
      provider: "elevenlabs",
      result: { status: elevenLabsAvailability.status, errorMessage: "ElevenLabs is not available/configured" },
    });
  }

  // Voicebox's generate() independently re-checks A5/A6 — see module header.
  const voiceboxResult = await params.voicebox.generate(params.request);
  attempts.push({ provider: "voicebox", result: voiceboxResult });
  return { result: voiceboxResult, attempts, usedProvider: "voicebox" };
}
