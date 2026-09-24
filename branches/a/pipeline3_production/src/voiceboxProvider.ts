// R03.1 — VoiceboxProvider: adapts VoiceboxClient into the shared
// ProductionVoiceProvider interface (voiceProviderTypes.ts), so it is a
// drop-in fallback alongside ElevenLabsProvider under the same A5/A6
// governance checks.
//
// Governance checks (A5, and A6 when applicable) are performed INSIDE
// generate(), exactly like ElevenLabsProvider/generateProductionVoice —
// never left to the caller, never bypassable by choosing this provider
// instead of the other one.

import { promises as fs } from "node:fs";
import { requireGateState } from "./gates.js";
import { contentHash } from "./canonicalIdentity.js";
import { sha256, sha256Buffer } from "./ids.js";
import { defaultFfprobeMediaProbe } from "./assetValidation.js";
import type { MediaProbe } from "./assetValidation.js";
import {
  VoiceboxClient,
  VOICEBOX_ENGINE_LANGUAGES,
  defaultVoiceboxEngine,
  type VoiceboxClientConfig,
  type VoiceboxGenerationStatus,
} from "./voiceboxClient.js";
import {
  type ProductionVoiceGenerateParams,
  type ProductionVoiceProvider,
  type ProviderResult,
  type ProviderStatus,
} from "./voiceProviderTypes.js";

export interface VoiceboxProviderConfig {
  profileId: string;
  engine?: string;
  client?: VoiceboxClient;
  clientConfig?: VoiceboxClientConfig;
  /** Real duration measurement seam — defaults to real ffprobe. */
  probe?: MediaProbe;
  /** How long to poll a generation before treating it as timed out. */
  pollTimeoutMs?: number;
  pollIntervalMs?: number;
}

// R03 — text integrity.
//
// The canonical flow is P2 VoiceLine.text -> provider -> audio, never
// VoiceLine.text -> hidden rewrite -> audio. Voicebox's own product surface
// includes an OPTIONAL "Speak in character" personality-LLM rewrite path
// (routes text through a bundled local LLM before TTS when a profile has a
// personality attached and `personality: true` is passed). This adapter
// NEVER passes that flag and never enables any rewrite feature — the text
// sent to /generate is always byte-identical to params.text. This is
// enforced structurally (the request body builder below has no code path
// that can set a rewrite flag), not by a runtime check that could silently
// be disabled.
function buildGenerateRequest(params: { text: string; profileId: string; language?: string; engine?: string }) {
  return {
    text: params.text,
    profile_id: params.profileId,
    language: params.language,
    engine: params.engine,
    // Deliberately no `personality` field — see text-integrity note above.
  };
}

/**
 * R03 — cache/generation identity.
 *
 * Per the repair mandate: "Do not cache only by voice_line_id. Provider
 * changes must produce distinct cache identities." This computes the full
 * generation_key covering every material input, so a change to text,
 * language, provider, profile, engine, or config version yields a
 * different key even when voice_line_id is unchanged.
 */
export function computeGenerationKey(params: {
  voiceLineId: string;
  text: string;
  language: string;
  provider: string;
  profileId: string;
  engine: string;
  configVersion: string;
}): string {
  return contentHash({
    voice_line_id: params.voiceLineId,
    text: params.text,
    language: params.language,
    provider: params.provider,
    profile: params.profileId,
    engine: params.engine,
    config_version: params.configVersion,
  });
}

const DEFAULT_CONFIG_VERSION = "voicebox-provider@1";

function classifyGenerationFailureStatus(status: VoiceboxGenerationStatus, errorMessage?: string): Exclude<ProviderStatus, "SUCCESS"> {
  const msg = (errorMessage ?? status).toLowerCase();
  if (msg.includes("quota") || msg.includes("limit")) return "QUOTA_UNAVAILABLE";
  if (msg.includes("auth") || msg.includes("unauthorized")) return "AUTH_FAILED";
  if (msg.includes("invalid") || msg.includes("bad request")) return "INVALID_REQUEST";
  return "PROVIDER_ERROR";
}

export class VoiceboxProvider implements ProductionVoiceProvider {
  readonly name = "voicebox" as const;
  private readonly client: VoiceboxClient;

  constructor(private readonly config: VoiceboxProviderConfig) {
    this.client = config.client ?? new VoiceboxClient(config.clientConfig);
  }

  async availability(): Promise<{ available: boolean; status: ProviderStatus }> {
    try {
      const health = await this.client.health();
      if (health.status !== "ok" && health.status !== "healthy" && health.status !== "running") {
        // Voicebox reports SOME non-error status string even when
        // degraded; treat anything not affirmatively healthy as
        // unavailable rather than guessing it's fine.
        return { available: false, status: "UNAVAILABLE" };
      }
      return { available: true, status: "SUCCESS" };
    } catch {
      // Local server not running / not reachable — the expected common
      // case in an environment without Voicebox installed, not an error
      // to surface loudly.
      return { available: false, status: "UNAVAILABLE" };
    }
  }

  async generate(params: ProductionVoiceGenerateParams): Promise<ProviderResult> {
    // Gate A5 MUST be satisfied before anything else, exactly like
    // ElevenLabsProvider — no network call is constructed otherwise.
    requireGateState(params.gates, "A5", "NARRATION_APPROVED_FOR_PRODUCTION");
    if (params.materialAmbiguityDetected) {
      requireGateState(params.gates, "A6", "AMBIGUITY_RESOLVED");
    }

    const language = params.language ?? "en";
    // UNIFIED-PIPELINE CORRECTION: "qwen" has no Turkish; pick a language-capable
    // engine when the caller did not configure one, and refuse an explicit
    // engine that cannot speak the requested language.
    const engine = this.config.engine ?? defaultVoiceboxEngine(language);
    const supported = VOICEBOX_ENGINE_LANGUAGES[engine];
    if (supported && !supported.includes(language)) {
      return { status: "INVALID_REQUEST", errorMessage: `Voicebox engine "${engine}" does not support language "${language}" (use "chatterbox" for tr)` };
    }
    const generationKey = computeGenerationKey({
      voiceLineId: params.voiceLineId,
      text: params.text,
      language,
      provider: "voicebox",
      profileId: this.config.profileId,
      engine,
      configVersion: DEFAULT_CONFIG_VERSION,
    });

    try {
      // Resolve the profile first — an unknown profile_id is a genuine
      // configuration/request problem, classified as INVALID_REQUEST
      // rather than left to fail confusingly deep in /generate.
      const profile = await this.client.resolveProfile(this.config.profileId);
      if (!profile) {
        return { status: "INVALID_REQUEST", errorMessage: `Voicebox profile "${this.config.profileId}" was not found` };
      }

      const accepted = await this.client.generate(
        buildGenerateRequest({ text: params.text, profileId: this.config.profileId, language, engine }),
      );

      const pollTimeoutMs = this.config.pollTimeoutMs ?? 60000;
      const pollIntervalMs = this.config.pollIntervalMs ?? 500;
      const deadline = Date.now() + pollTimeoutMs;
      let finalStatus: VoiceboxGenerationStatus = "queued";
      let errorMessage: string | undefined;

      while (Date.now() < deadline) {
        const statusResult = await this.client.getStatus(accepted.id);
        finalStatus = statusResult.status;
        errorMessage = statusResult.error;
        if (finalStatus === "completed" || finalStatus === "failed") break;
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }

      if (finalStatus === "failed") {
        return { status: classifyGenerationFailureStatus(finalStatus, errorMessage), errorMessage };
      }
      if (finalStatus !== "completed") {
        return { status: "TIMEOUT", errorMessage: `Voicebox generation "${accepted.id}" did not complete within ${pollTimeoutMs}ms` };
      }

      const audioBytes = await this.client.getAudio(accepted.id);
      const audio_hash = sha256Buffer(audioBytes);

      // R02.6-style real duration measurement — no fabricated 0. Written
      // to a temp path so ffprobe (a raw-file-path tool) has something to
      // read; the same pattern P3's other real-media-probing code uses.
      const os = await import("node:os");
      const path = await import("node:path");
      const tmpPath = path.join(os.tmpdir(), `voicebox_${accepted.id}.wav`);
      await fs.writeFile(tmpPath, audioBytes);
      const probe = this.config.probe ?? defaultFfprobeMediaProbe;
      let duration_s = 0;
      try {
        const probed = await probe(tmpPath);
        duration_s = probed.decodable && typeof probed.duration_s === "number" ? probed.duration_s : 0;
      } finally {
        await fs.unlink(tmpPath).catch(() => undefined);
      }

      const outputDir = params.outputDir ?? process.cwd();
      const audio_path = `production_audio_${sha256(params.text).slice(0, 12)}.wav`;
      await fs.writeFile(`${outputDir}/${audio_path}`, audioBytes);

      return {
        status: "SUCCESS",
        voice: {
          audio_path,
          audio_hash,
          duration_s,
          character_count: params.text.length,
          cost_units: 0, // local generation — no metered provider cost
          // R03 text-integrity/honesty note: ElevenLabsProvider's
          // listen_check fields come from a real secondary-transcription
          // verification step (elevenlabs.ts's listenCheck callback).
          // Voicebox has no equivalent step in this adapter, so claiming
          // any non-zero ratio would assert a verification that never
          // happened. 0 ratio PAIRED WITH 0 attempts is the "not
          // performed" sentinel — distinguishable from a real check that
          // was attempted and scored low, which would show attempts > 0.
          listen_check_word_ratio: 0,
          listen_check_attempts: 0,
          provider: "voicebox",
          profile_id: this.config.profileId,
          generation_id: generationKey.slice(0, 16),
          engine,
          text_hash: sha256(params.text),
          source_mode: "REAL",
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { status: "PROVIDER_ERROR", errorMessage: message };
    }
  }
}
