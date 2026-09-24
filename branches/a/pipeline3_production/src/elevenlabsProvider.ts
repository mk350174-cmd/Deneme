// R03/R04 — ElevenLabsProvider: adapts the existing, UNMODIFIED
// elevenlabs.ts::generateProductionVoice into the ProductionVoiceProvider
// interface. The original function's exact behavior, gate checks
// (requireGateState for A5/A6, checked BEFORE any network call), and raw
// HTTP seam are all preserved untouched — this is a thin adapter, not a
// rewrite. Existing tests exercising generateProductionVoice/elevenlabs.ts
// directly are unaffected.
//
// CRITICAL RULE (R04): a governance failure (missing A5/A6, voice lock
// mismatch) must hard-fail, never be caught here and treated as a
// "provider unavailable, fall back" condition. requireGateState throws a
// GateStateError and checkVoiceLock throws a plain Error — NEITHER is
// caught by this adapter's try/catch, which only catches the network-level
// PostElevenLabsHttp seam's failures and this function's own
// status-code/timeout handling. A GateStateError or voice-lock Error
// propagates straight through, uncaught, exactly like it always did calling
// generateProductionVoice directly.

import { generateProductionVoice, defaultPostElevenLabsHttp } from "./elevenlabs.js";
import type { PostElevenLabsHttp, VoiceLock } from "./elevenlabs.js";
import { GateStateError } from "./errors.js";
import { sha256 } from "./ids.js";
import {
  ProviderConditionError,
  type ProductionVoiceGenerateParams,
  type ProductionVoiceProvider,
  type ProviderResult,
  type ProviderStatus,
} from "./voiceProviderTypes.js";

export interface ElevenLabsProviderConfig {
  voiceId: string;
  modelId: string;
  voiceLock: VoiceLock;
  listenCheck: (audio: Buffer, sourceText: string) => Promise<{ ratio: number; attempts: number }>;
  /**
   * Runtime secret ONLY. Never a literal default, never embedded, never
   * logged. Read from process.env by the caller (see readElevenLabsApiKey
   * below) — this config simply carries whatever value the caller
   * supplied.
   */
  apiKey: string | undefined;
  postHttp?: PostElevenLabsHttp;
}

/**
 * Reads ELEVENLABS_API_KEY from the environment. This is the ONLY place a
 * key value may originate — never a source-code literal, never a test
 * fixture default, never a ZIP-bundled file. Returns undefined (not an
 * empty string, not a placeholder) when unset, which
 * ElevenLabsProvider.availability() reports as NOT_CONFIGURED.
 */
export function readElevenLabsApiKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env.ELEVENLABS_API_KEY;
  return value && value.trim().length > 0 ? value : undefined;
}

function classifyHttpStatus(status: number): Exclude<ProviderStatus, "SUCCESS"> | undefined {
  if (status === 401 || status === 403) return "AUTH_FAILED";
  if (status === 429) return "QUOTA_UNAVAILABLE";
  if (status === 408 || status === 504) return "TIMEOUT";
  if (status >= 400 && status < 500) return "INVALID_REQUEST";
  if (status >= 500) return "PROVIDER_ERROR";
  return undefined;
}

export class ElevenLabsProvider implements ProductionVoiceProvider {
  readonly name = "elevenlabs" as const;

  constructor(private readonly config: ElevenLabsProviderConfig) {}

  async availability(): Promise<{ available: boolean; status: ProviderStatus }> {
    if (!this.config.apiKey) {
      return { available: false, status: "NOT_CONFIGURED" };
    }
    // Availability is a configuration check, not a network probe — an
    // actual outage/auth failure surfaces from generate() itself and is
    // handled there. Probing the real API here would spend a request (and
    // real cost/quota) just to answer "is this configured", which is
    // knowable locally.
    return { available: true, status: "SUCCESS" };
  }

  async generate(params: ProductionVoiceGenerateParams): Promise<ProviderResult> {
    if (!this.config.apiKey) {
      return { status: "NOT_CONFIGURED", errorMessage: "ELEVENLABS_API_KEY is not set" };
    }

    try {
      const result = await generateProductionVoice(
        {
          text: params.text,
          voiceId: this.config.voiceId,
          modelId: this.config.modelId,
          apiKey: this.config.apiKey,
          voiceLock: this.config.voiceLock,
          gates: params.gates,
          listenCheck: this.config.listenCheck,
          materialAmbiguityDetected: params.materialAmbiguityDetected,
          outputDir: params.outputDir,
        },
        this.config.postHttp ?? defaultPostElevenLabsHttp,
      );
      return {
        status: "SUCCESS",
        voice: {
          ...result,
          provider: "elevenlabs",
          generation_id: sha256(`${params.voiceLineId}::${result.audio_hash}`).slice(0, 16),
          engine: this.config.modelId,
          text_hash: sha256(params.text),
          source_mode: "REAL",
        },
      };
    } catch (err) {
      // GateStateError (A5/A6 governance) and the voice-lock mismatch Error
      // thrown by generateProductionVoice/checkVoiceLock are NOT provider
      // conditions — they must hard-fail, never fall back. Re-thrown as-is.
      if (err instanceof GateStateError) throw err;
      if (err instanceof Error && err.message.startsWith("voice_lock mismatch")) throw err;

      const message = err instanceof Error ? err.message : String(err);
      const statusMatch = message.match(/status (\d+)/);
      if (statusMatch) {
        const httpStatus = Number(statusMatch[1]);
        const classified = classifyHttpStatus(httpStatus);
        if (classified) {
          return { status: classified, errorMessage: message };
        }
      }
      // A genuine, unclassified provider-side failure (network error,
      // malformed response, listen-check exception, etc.) — a real
      // provider condition, not a governance one.
      return { status: "PROVIDER_ERROR", errorMessage: message };
    }
  }
}
