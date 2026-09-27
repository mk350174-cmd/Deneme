// AUDIT FIX (P3 final closure pass, §13.7) — real implementations of the
// EXISTING PreflightCheckFns interface (preflight.ts), which was already
// fully specified and fully tested with fixtures but never had a real
// backing implementation. Kept in its own file, separate from the locked
// elevenlabs.ts production-voice-call path (preflight/connectivity is a
// different concern, already modeled by preflight.ts). No new abstraction —
// this mirrors elevenlabs.ts's existing PostElevenLabsHttp raw-fetch
// pattern one-for-one, as a GET seam alongside the existing POST seam.

import type { PreflightCheckFns } from "./preflight.js";

const API_BASE = "https://api.elevenlabs.io/v1";

// Raw I/O seam only — one real implementation (defaultGetElevenLabsHttp).
export type GetElevenLabsHttp = (params: {
  url: string;
  headers: Record<string, string>;
}) => Promise<{ status: number; bodyJson: unknown }>;

export const defaultGetElevenLabsHttp: GetElevenLabsHttp = async ({ url, headers }) => {
  const res = await fetch(url, { method: "GET", headers });
  const bodyJson: unknown = await res.json().catch(() => undefined);
  return { status: res.status, bodyJson };
};

// Real implementation of the existing PreflightCheckFns seam. apiKey is an
// explicit parameter (same discipline as elevenlabs.ts's generateProductionVoice)
// — never read from process.env inside this function; env reads belong only
// in the one-off live-verification call site, never in library code.
export function buildElevenLabsPreflightCheckFns(
  apiKey: string,
  getHttp: GetElevenLabsHttp = defaultGetElevenLabsHttp,
): PreflightCheckFns {
  const headers = { "xi-api-key": apiKey };

  return {
    checkApiConnectivity: async () => {
      const res = await getHttp({ url: `${API_BASE}/user`, headers });
      return res.status === 200;
    },
    checkVoiceAvailability: async (voiceId: string) => {
      const res = await getHttp({ url: `${API_BASE}/voices/${voiceId}`, headers });
      return res.status === 200;
    },
    checkModelAvailability: async (modelId: string) => {
      const res = await getHttp({ url: `${API_BASE}/models`, headers });
      if (res.status !== 200) return false;
      const models = res.bodyJson as Array<{ model_id?: string }> | undefined;
      return Array.isArray(models) && models.some((m) => m.model_id === modelId);
    },
    getQuotaRemaining: async () => {
      const res = await getHttp({ url: `${API_BASE}/user`, headers });
      if (res.status !== 200) return 0;
      const sub = (res.bodyJson as { subscription?: { character_limit?: number; character_count?: number } } | undefined)?.subscription;
      return Math.max(0, (sub?.character_limit ?? 0) - (sub?.character_count ?? 0));
    },
  };
}
