// P3.05 ElevenLabs Production Voice — ADAPT of scripts/elevenlabs_client.py's
// exact REST shape (POST /v1/text-to-speech/{voice_id}, xi-api-key header,
// {text, model_id} body) and its _check_voice_lock pattern. ElevenLabs is a
// LOCKED provider — the only injectable seam is the raw HTTP-call function
// (invariant 9), never a swappable "VoiceProvider"/"TTSProvider".
//
// Code-enforced gate (invariant 8): requireGateState is called BEFORE any
// request is constructed. Without NARRATION_APPROVED_FOR_PRODUCTION, the
// call fails and the raw HTTP seam is never invoked.

import { requireGateState } from "./gates.js";
import { redactSecretsDeep } from "./secretGuard.js";
import { sha256 } from "./ids.js";
import { promises as fs } from "node:fs";
import type { GateApprovalRecord, ProductionVoiceResult } from "./types.js";

const API_BASE = "https://api.elevenlabs.io/v1/text-to-speech";

// Raw I/O seam only — one real implementation (defaultPostElevenLabsHttp).
export type PostElevenLabsHttp = (params: {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}) => Promise<{ status: number; bodyBytes: Buffer }>;

export const defaultPostElevenLabsHttp: PostElevenLabsHttp = async ({ url, headers, body }) => {
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const bodyBytes = Buffer.from(await res.arrayBuffer());
  return { status: res.status, bodyBytes };
};

export interface VoiceLock {
  providers: { elevenlabs?: { voice_id: string; model: string } };
}

export function checkVoiceLock(voiceLock: VoiceLock, voiceId: string, modelId: string): void {
  const entry = voiceLock.providers.elevenlabs;
  if (!entry || entry.voice_id !== voiceId || entry.model !== modelId) {
    throw new Error(
      `voice_lock mismatch: expected voice_id="${voiceId}" model="${modelId}", ` +
        `found ${entry ? `voice_id="${entry.voice_id}" model="${entry.model}"` : "no elevenlabs entry"}`,
    );
  }
}

export async function generateProductionVoice(
  params: {
    text: string;
    voiceId: string;
    modelId: string;
    apiKey: string;
    voiceLock: VoiceLock;
    gates: GateApprovalRecord[];
    listenCheck: (audio: Buffer, sourceText: string) => Promise<{ ratio: number; attempts: number }>;
    // AUDIT FIX (P3 final closure pass, correction 4): Gate A6 was recorded
    // (approveAmbiguityResolution in pipeline.ts) but never actually
    // enforced anywhere downstream — a preflight that flagged material
    // ambiguity did not block this call. When the caller's preflight
    // detected ambiguity, Gate A6 (AMBIGUITY_RESOLVED) must also be present
    // before any network call — checked in code, same as A5, not left as a
    // documentation-only expectation. Defaults to false so existing
    // call sites that never hit ambiguity are unaffected.
    materialAmbiguityDetected?: boolean;
    outputDir?: string;
  },
  postHttp: PostElevenLabsHttp = defaultPostElevenLabsHttp,
): Promise<ProductionVoiceResult> {
  // Gate A5 MUST be satisfied before anything else — checked first, no
  // network call is even constructed otherwise.
  requireGateState(params.gates, "A5", "NARRATION_APPROVED_FOR_PRODUCTION");

  // Gate A6: MATERIAL_AMBIGUITY_DETECTED -> HUMAN RESOLUTION -> AMBIGUITY_RESOLVED
  // -> ElevenLabs call permitted. Only required when the caller's preflight
  // actually flagged ambiguity — otherwise A6 never applied to this call.
  if (params.materialAmbiguityDetected) {
    requireGateState(params.gates, "A6", "AMBIGUITY_RESOLVED");
  }

  checkVoiceLock(params.voiceLock, params.voiceId, params.modelId);

  const url = `${API_BASE}/${params.voiceId}?output_format=pcm_24000`;
  const headers = { "xi-api-key": params.apiKey, "Content-Type": "application/json" };
  const body = { text: params.text, model_id: params.modelId };

  const response = await postHttp({ url, headers, body });
  if (response.status !== 200) {
    // Log the API response body (error diagnostics), not the request body.
    let responseBody: unknown = body; // default to request if response parsing fails
    try {
      responseBody = JSON.parse(response.bodyBytes.toString("utf-8"));
    } catch {
      // response is not JSON; keep the request body as fallback context
    }
    throw new Error(
      `ElevenLabs request failed with status ${response.status}: ${JSON.stringify(redactSecretsDeep(responseBody))}`,
    );
  }

  const { ratio, attempts } = await params.listenCheck(response.bodyBytes, params.text);

  // Response body is raw PCM, mono, 16-bit, 24kHz (elevenlabs_client.py's
  // exact output_format=pcm_24000) — duration derived directly from byte
  // count, same math the source client uses when wrapping it into a WAV.
  const PCM_SAMPLE_RATE = 24000;
  const PCM_BYTES_PER_SAMPLE = 2;
  const duration_s = response.bodyBytes.length / (PCM_SAMPLE_RATE * PCM_BYTES_PER_SAMPLE);

  const audio_path = `production_audio_${sha256(params.text).slice(0, 12)}.wav`;

  // Persist the PCM bytes to disk in the output directory.
  const outputDir = params.outputDir || process.cwd();
  await fs.writeFile(`${outputDir}/${audio_path}`, response.bodyBytes);

  return {
    audio_path,
    audio_hash: sha256(response.bodyBytes.toString("base64")),
    duration_s,
    character_count: params.text.length,
    cost_units: params.text.length,
    listen_check_word_ratio: ratio,
    listen_check_attempts: attempts,
  };
}
