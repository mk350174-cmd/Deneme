// R03.1 — Voicebox client adapter (github.com/jamiepine/voicebox).
//
// SOURCE VERIFICATION: the endpoints and payload shapes below are taken
// from Voicebox's own published documentation and generated SDKs, not
// invented. Specifically:
//   - Default local base URL http://127.0.0.1:17493 — backend/README.md,
//     tryAGI.Voicebox SDK docs.
//   - GET /health -> { status, backend_type } — confirmed via the
//     generated tryAGI.Voicebox C# SDK (`HealthHealthGetAsync()` exposing
//     `.Status` / `.BackendType`).
//   - GET /profiles -> list of { id, name, language } and
//     POST /profiles -> create a profile — backend/README.md's own curl
//     examples, and the tryAGI SDK's `ListProfilesProfilesGetAsync()`.
//   - POST /generate -> { text, profile_id, language, engine? } —
//     backend/README.md's own curl example; `engine` confirmed via PR #487
//     (landing-page API example fix using `engine: "qwen_custom_voice"`
//     alongside `profile_id`).
//   - GET /generate/{id}/status -> Server-Sent Events status stream —
//     backend/README.md's own curl example list, and the "Async
//     Generation Queue" section of the product docs ("Generation is
//     non-blocking... Real-time SSE status streaming").
//
// ONE ENDPOINT IS NOT DIRECTLY CONFIRMED and is called out honestly rather
// than presented as certain: the exact path to retrieve a COMPLETED
// generation's audio bytes. The backend's own file-layout documentation
// places completed audio under `{data_dir}/generations/`, and a
// non-blocking generate+SSE-status design implies a distinct fetch step
// once status reports completion, but no source found during this repair
// documents the literal retrieval path. `resolveAudioUrl()` below isolates
// this single guess (`GET /generate/{id}/audio`, the most conventional
// pattern for this route family) behind one named, overridable function so
// it can be corrected the moment the real path is confirmed against a
// running server, without touching the rest of the adapter.
//
// This is a thin, real REST adapter — no vendoring of the Voicebox
// repository, no model files, no credentials, no browser/session state, no
// database, per the repair mandate's explicit constraints.

export interface VoiceboxHealth {
  status: string;
  backend_type?: string;
}

export interface VoiceboxProfile {
  id: string;
  name: string;
  language: string;
}

export interface VoiceboxGenerateRequest {
  text: string;
  profile_id: string;
  language?: string;
  engine?: string;
}

export interface VoiceboxGenerateAccepted {
  id: string;
  status: string;
}

export type VoiceboxGenerationStatus = "queued" | "running" | "completed" | "failed" | string;

export interface VoiceboxGenerationStatusResult {
  id: string;
  status: VoiceboxGenerationStatus;
  error?: string;
}

/** Raw HTTP seam — one real implementation, tests inject a fixture (invariant 9 pattern, same as elevenlabs.ts). */
export type VoiceboxHttpFetch = (params: {
  method: "GET" | "POST";
  url: string;
  body?: unknown;
}) => Promise<{ status: number; bodyText: string }>;

export const defaultVoiceboxHttpFetch: VoiceboxHttpFetch = async ({ method, url, body }) => {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const bodyText = await res.text();
  return { status: res.status, bodyText };
};

/** Raw binary-fetch seam for audio bytes, separate from the JSON seam above. */
export type VoiceboxAudioFetch = (url: string) => Promise<{ status: number; bytes: Buffer }>;

export const defaultVoiceboxAudioFetch: VoiceboxAudioFetch = async (url) => {
  const res = await fetch(url);
  const bytes = Buffer.from(await res.arrayBuffer());
  return { status: res.status, bytes };
};

/**
 * UNIFIED-PIPELINE CORRECTION (2026-09-22): `/generate/{id}/status` is a
 * Server-Sent Events stream (backend/routes/generations.py
 * `get_generation_status` → StreamingResponse, media_type
 * "text/event-stream", one `data: {json}` event per second, closing after
 * "completed" or "failed"). A plain GET therefore returns the concatenated
 * events, which the previous `JSON.parse(body)` could never parse. This
 * reads the LAST `data:` event; a bare JSON body is still accepted.
 */
export function parseVoiceboxStatusBody(bodyText: string): VoiceboxGenerationStatusResult {
  const events = bodyText
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter((line) => line.length > 0);
  const raw = events.length > 0 ? events[events.length - 1]! : bodyText.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new VoiceboxHttpError(200, "Voicebox status stream contained no parseable status event");
  }
  const obj = parsed as { id?: unknown; status?: unknown; error?: unknown };
  if (typeof obj.status !== "string") {
    throw new VoiceboxHttpError(200, "Voicebox status event has no status field");
  }
  return {
    id: typeof obj.id === "string" ? obj.id : "",
    status: obj.status,
    ...(typeof obj.error === "string" && obj.error ? { error: obj.error } : {}),
  };
}

/**
 * Voicebox engines by supported language, verified against
 * backend/backends/__init__.py (jamiepine/voicebox@51f49de). Only
 * "chatterbox" (Chatterbox TTS Multilingual) lists "tr"; the Qwen engines
 * cover zh/en/ja/ko/de/fr/ru/pt/es/it only.
 */
export const VOICEBOX_ENGINE_LANGUAGES: Readonly<Record<string, readonly string[]>> = {
  qwen: ["zh", "en", "ja", "ko", "de", "fr", "ru", "pt", "es", "it"],
  qwen_custom_voice: ["zh", "en", "ja", "ko", "de", "fr", "ru", "pt", "es", "it"],
  chatterbox: ["zh", "en", "ja", "ko", "de", "fr", "ru", "pt", "es", "it", "he", "ar", "da", "el", "fi", "hi", "ms", "nl", "no", "pl", "sv", "sw", "tr"],
  chatterbox_turbo: ["en"],
  luxtts: ["en"],
};

/** Default engine for a language when the caller did not choose one. */
export function defaultVoiceboxEngine(language: string): string {
  return (VOICEBOX_ENGINE_LANGUAGES.qwen ?? []).includes(language) ? "qwen" : "chatterbox";
}

export class VoiceboxHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "VoiceboxHttpError";
  }
}

export interface VoiceboxClientConfig {
  /** Defaults to the documented local default. */
  baseUrl?: string;
  httpFetch?: VoiceboxHttpFetch;
  audioFetch?: VoiceboxAudioFetch;
}

export class VoiceboxClient {
  private readonly baseUrl: string;
  private readonly httpFetch: VoiceboxHttpFetch;
  private readonly audioFetch: VoiceboxAudioFetch;

  constructor(config: VoiceboxClientConfig = {}) {
    this.baseUrl = config.baseUrl ?? "http://127.0.0.1:17493";
    this.httpFetch = config.httpFetch ?? defaultVoiceboxHttpFetch;
    this.audioFetch = config.audioFetch ?? defaultVoiceboxAudioFetch;
  }

  async health(): Promise<VoiceboxHealth> {
    const res = await this.httpFetch({ method: "GET", url: `${this.baseUrl}/health` });
    if (res.status !== 200) {
      throw new VoiceboxHttpError(res.status, `Voicebox /health returned ${res.status}`);
    }
    return JSON.parse(res.bodyText) as VoiceboxHealth;
  }

  async resolveProfile(profileId: string): Promise<VoiceboxProfile | undefined> {
    const res = await this.httpFetch({ method: "GET", url: `${this.baseUrl}/profiles` });
    if (res.status !== 200) {
      throw new VoiceboxHttpError(res.status, `Voicebox /profiles returned ${res.status}`);
    }
    const profiles = JSON.parse(res.bodyText) as VoiceboxProfile[];
    return profiles.find((p) => p.id === profileId);
  }

  async generate(request: VoiceboxGenerateRequest): Promise<VoiceboxGenerateAccepted> {
    const res = await this.httpFetch({ method: "POST", url: `${this.baseUrl}/generate`, body: request });
    if (res.status !== 200 && res.status !== 202) {
      throw new VoiceboxHttpError(res.status, `Voicebox /generate returned ${res.status}: ${res.bodyText}`);
    }
    return JSON.parse(res.bodyText) as VoiceboxGenerateAccepted;
  }

  /**
   * Polls the generation status endpoint. Voicebox's documented mechanism
   * is a Server-Sent Events STREAM at this same path
   * (`/generate/{id}/status`); this method performs a single plain GET
   * against it and parses one JSON status object. This is deliberately the
   * simpler, poll-based half of that endpoint's contract — sufficient for
   * this adapter's synchronous generate-and-wait use, and avoiding an SSE
   * client dependency for a single fallback TTS provider. A future
   * enhancement could stream the SSE events directly for lower latency;
   * documented here as a known simplification, not a hidden one.
   */
  async getStatus(generationId: string): Promise<VoiceboxGenerationStatusResult> {
    const res = await this.httpFetch({ method: "GET", url: `${this.baseUrl}/generate/${generationId}/status` });
    if (res.status !== 200) {
      throw new VoiceboxHttpError(res.status, `Voicebox /generate/${generationId}/status returned ${res.status}`);
    }
    return parseVoiceboxStatusBody(res.bodyText);
  }

  /**
   * UNIFIED-PIPELINE CORRECTION (2026-09-22): verified against the Voicebox
   * source (jamiepine/voicebox@51f49de, backend/routes/audio.py:
   * `@router.get("/audio/{generation_id}")`, served as a FileResponse of the
   * generation's default version). The earlier inferred path
   * `/generate/{id}/audio` does not exist on the server.
   */
  resolveAudioUrl(generationId: string): string {
    return `${this.baseUrl}/audio/${encodeURIComponent(generationId)}`;
  }

  async getAudio(generationId: string): Promise<Buffer> {
    const url = this.resolveAudioUrl(generationId);
    const res = await this.audioFetch(url);
    if (res.status !== 200) {
      throw new VoiceboxHttpError(res.status, `Voicebox audio fetch for generation "${generationId}" returned ${res.status}`);
    }
    return res.bytes;
  }
}
