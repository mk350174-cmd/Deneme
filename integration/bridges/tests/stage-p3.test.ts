// P3 stage runner (src/stages/p3.ts). Hermetic by default: every external
// boundary uses the SAME raw I/O seams P3's own tests use (gTTS/Piper exec,
// ElevenLabs HTTP, Remotion exec, media probe) plus the runner's mux seam —
// no network, no ElevenLabs, no Chrome. The P3 library code, the gates,
// the Final Delivery assembly and the YouTube bridge are all REAL.
//
// UNIFIED_REAL_RENDER=1 additionally runs one real 9:16 Remotion render with
// ffmpeg-generated assets and a synthetic sine narration.

import { describe, expect, it } from "vitest";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, readdir, stat, writeFile, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  B_MODULES,
  buildCreativeDirective,
  buildStrategyInputBundle,
  buildYouTubeImport,
  commitStrategy,
  decisionsTemplate,
  fileSha256,
  proposeStrategy,
  type StrategyBrief,
  loadSealKey,
} from "../src/index.js";
import {
  P3_STATE_FILE,
  p3Approve,
  p3ApproveVoice,
  p3Ingest,
  p3Plan,
  p3Preview,
  p3Render,
  p3ResolveAmbiguity,
  p3Status,
  p3Voice,
  parseP3Config,
  readElevenLabsKey,
  type MuxNarration,
  type P3MediaProbe,
  assertFinalDeliveryBound,
} from "../src/stages/p3.js";
import type { ExecGttsSubprocess } from "pipeline3-production/dist/gtts.js";
import type { PostElevenLabsHttp } from "pipeline3-production/dist/elevenlabs.js";
import type { GetElevenLabsHttp } from "pipeline3-production/dist/elevenlabsConnectivity.js";
import type { ExecRemotionRender } from "pipeline3-production/dist/render.js";
import { sealProductionPackage } from "../../../branches/a/pipeline3_production/tests/fixtures/production_package.fixture.js";
import { AT, OWNER, productionPackageFor, runRealP1 } from "./helpers.js";

const execFileAsync = promisify(execFile);

// A value shaped exactly like an ElevenLabs key, so assertNoSecrets would also catch a leak.
const FAKE_KEY = "sk_" + "0123456789abcdef".repeat(3);
const KEY_ENV = { ELEVENLABS_API_KEY: FAKE_KEY } as NodeJS.ProcessEnv;
const NO_DOTENV = "/nonexistent/p3/.env";
const NARRATION_S = 6.2;

// ------------------------------------------------------------------ fixture seams

const fixtureProbe: P3MediaProbe = async (p) =>
  p.endsWith(".mp4") ? { decodable: true, codec: "h264", width: 1080, height: 1920, fps: 30, duration_s: 3, has_audio: false } : { decodable: true, codec: "png", width: 1080, height: 1920 };

const fixtureGtts: ExecGttsSubprocess = async ({ outputPath }) => {
  await writeFile(outputPath, "fixture gTTS preview bytes");
  return { measuredDurationS: 6.1 };
};

function pcm(seconds: number, sine = false): Buffer {
  const n = Math.round(seconds * 24000);
  const b = Buffer.alloc(n * 2);
  if (sine) for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / 24000)), i * 2);
  return b;
}

function fixtureTts(seconds: number, sine = false): { post: PostElevenLabsHttp; calls: () => number; sawKey: () => boolean } {
  let calls = 0;
  let sawKey = false;
  return {
    post: async ({ headers }) => {
      calls++;
      sawKey = headers["xi-api-key"] === FAKE_KEY;
      return { status: 200, bodyBytes: pcm(seconds, sine) };
    },
    calls: () => calls,
    sawKey: () => sawKey,
  };
}

const fixtureGet: GetElevenLabsHttp = async ({ url }) => {
  if (url.endsWith("/user")) return { status: 200, bodyJson: { subscription: { character_limit: 100_000, character_count: 0 } } };
  if (url.includes("/voices/")) return { status: 200, bodyJson: {} };
  if (url.endsWith("/models")) return { status: 200, bodyJson: [{ model_id: "eleven_multilingual_v2" }] };
  return { status: 404, bodyJson: undefined };
};

const fixtureRender: ExecRemotionRender = async ({ outputPath, timeline }) => {
  const bytes = Buffer.from(`fixture-video frames=${timeline.total_frames}`);
  await writeFile(outputPath, bytes);
  return { bytes: bytes.length };
};

const fixtureMux: MuxNarration = async ({ videoPath, audioPath, outputPath }) => {
  await writeFile(outputPath, Buffer.concat([await readFile(videoPath), await readFile(audioPath)]));
};

const ELEVEN = { voiceId: "voice_owner_tr", modelId: "eleven_multilingual_v2" };

// ------------------------------------------------------------------ helpers

async function newDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "p3stage-"));
}

async function putAssets(outDir: string, which = ["astreq_wide_arch.png", "astreq_water_flow.mp4"]): Promise<void> {
  for (const f of which) await writeFile(join(outDir, "assets", f), `fixture bytes for ${f}`);
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as { code?: string }).code ?? (e as Error).message;
  }
  return "NO_ERROR";
}

async function allFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const d of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, d.name);
    if (d.isDirectory()) out.push(...(await allFiles(p)));
    else out.push(p);
  }
  return out;
}

/** Runs plan → ingest → preview → A5 (the part every scenario shares). */
async function throughA5(pp: any, outDir: string, confirmedPronunciations?: string[]) {
  await p3Plan({ productionPackage: pp, outDir, language: "en" });
  await putAssets(outDir);
  await p3Ingest({ outDir, productionPackage: pp, actor: OWNER, probe: fixtureProbe });
  await p3Preview({ outDir, productionPackage: pp, execGtts: fixtureGtts });
  await p3ApproveVoice({ outDir, productionPackage: pp, actor: OWNER, confirmedPronunciations });
}

const BRIEF: StrategyBrief = {
  brief_type: "OWNER_STRATEGY_BRIEF",
  brand: { brand_name: "History Vertical", positioning: "Source-based vertical documentaries about women of the Eurasian steppe" },
  channels: [{ channel_id: "ch_yt_main", name: "History Vertical", platform: "YouTube", audience_category: "niche" }],
  documentation: { channel_policies: "Published for viewers in Europe and Asia." },
  audience: { platform_analytics: [{ platform_id: "youtube", channel_id: "ch_yt_main", demographic_data: "25-44", geography: ["TR"], interests: ["history"], source: "YouTube Analytics", verified_at: "2026-09-01T00:00:00Z" }] },
  owner_goals: ["Open with the strongest primary-source detail"],
};

async function directiveFor(research: any) {
  const bundle = buildStrategyInputBundle(research, { now: () => AT });
  const proposal = await proposeStrategy(bundle, BRIEF, { now: () => AT });
  const decisions = { ...decisionsTemplate(proposal), authority: OWNER, rationale: "p3 stage test", approve: Object.fromEntries(B_MODULES.map((m) => [m, true])) };
  const strategy = await commitStrategy(bundle, BRIEF, proposal, decisions, { now: () => AT });
  return buildCreativeDirective(bundle, strategy, { now: () => AT });
}

// ------------------------------------------------------------------ tests

describe("P3 stage runner — plan", () => {
  it("lists every shot with its exact file name, Google Flow prompt and the voice script", async () => {
    const pp = productionPackageFor(await runRealP1());
    const outDir = await newDir();
    const r = await p3Plan({ productionPackage: pp, outDir, language: "en" });
    const md = await readFile(r.checklistPath, "utf8");
    expect(r.expected.map((e) => e.shot_id).sort()).toEqual(pp.shots.map((s: any) => s.shot_id).sort());
    for (const req of pp.asset_requirements) expect(r.expected.some((e) => e.asset_requirement_id === req.asset_requirement_id)).toBe(true);
    expect(r.expected.map((e) => e.file_name)).toEqual(["astreq_wide_arch.png", "astreq_water_flow.mp4"]);
    for (const e of r.expected) expect(md).toContain(`\`${e.file_name}\``);
    for (const p of pp.prompts) expect(md).toContain(p.rendered.prompt_text);
    expect(md).toContain(pp.voice_script);
    expect(md).toContain("1080×1920");
    expect((await p3Status(outDir)).completed).toEqual(["plan"]);
  });

  it("validates the p3_input example config and refuses a key in it", async () => {
    const example = JSON.parse(await readFile(join(__dirname, "../../../docs/examples/p3_input.example.json"), "utf8"));
    expect(await code(Promise.resolve().then(() => parseP3Config(example)))).toBe("P3_CONFIG_INVALID"); // <…> placeholders must be filled
    const filled = { ...example, elevenlabs: { ...example.elevenlabs, voice_id: "abc123" }, voicebox: { ...example.voicebox, profile_id: "my-voice" } };
    expect(parseP3Config(filled).language).toBe("tr");
    expect(await code(Promise.resolve().then(() => parseP3Config({ ...filled, elevenlabs: { ...filled.elevenlabs, api_key: "x" } })))).toBe("P3_CONFIG_INVALID");
    expect(await code(Promise.resolve().then(() => parseP3Config({ ...filled, provider: "gtts" })))).toBe("P3_PROVIDER_NOT_PRODUCTION");
  });
});

describe("P3 stage runner — ingest (Gate A4)", () => {
  it("refuses missing asset files, naming each one, and records no gate", async () => {
    const pp = productionPackageFor(await runRealP1());
    const outDir = await newDir();
    await p3Plan({ productionPackage: pp, outDir, language: "en" });
    await putAssets(outDir, ["astreq_wide_arch.png"]);
    const err = await p3Ingest({ outDir, productionPackage: pp, actor: OWNER, probe: fixtureProbe }).catch((e) => e);
    expect(err.code).toBe("P3_ASSETS_MISSING");
    expect(err.message).toContain("astreq_water_flow.mp4");
    expect(err.message).not.toContain("astreq_wide_arch.png (");
    expect((await p3Status(outDir)).gates).toEqual([]);

    // a still image where the shot needs video is a type error, not a silent match
    await writeFile(join(outDir, "assets", "astreq_water_flow.png"), "x");
    expect(await code(p3Ingest({ outDir, productionPackage: pp, actor: OWNER, probe: fixtureProbe }))).toBe("P3_ASSET_WRONG_TYPE");
  });

  it("refuses a placeholder / preview / blank actor", async () => {
    const pp = productionPackageFor(await runRealP1());
    const outDir = await newDir();
    await p3Plan({ productionPackage: pp, outDir, language: "en" });
    await putAssets(outDir);
    for (const actor of ["<your name>", "PREVIEW", "system", "", undefined as unknown as string]) {
      expect(await code(p3Ingest({ outDir, productionPackage: pp, actor, probe: fixtureProbe }))).toBe("AUTHORITY_REQUIRED");
    }
    const ok = await p3Ingest({ outDir, productionPackage: pp, actor: OWNER, probe: fixtureProbe });
    expect(ok.gate.gate_id).toBe("A4");
    expect(ok.gate.actor).toBe(OWNER);
    expect(ok.resolvedAssets).toHaveLength(2);
  });

  it("refuses an undecodable file", async () => {
    const pp = productionPackageFor(await runRealP1());
    const outDir = await newDir();
    await p3Plan({ productionPackage: pp, outDir, language: "en" });
    await putAssets(outDir);
    const broken: P3MediaProbe = async (p) => (p.endsWith(".mp4") ? { decodable: false } : fixtureProbe(p));
    const err = await p3Ingest({ outDir, productionPackage: pp, actor: OWNER, probe: broken }).catch((e) => e);
    expect(err.code).toBe("P3_ASSET_INVALID");
    expect(err.message).toContain("astreq_water_flow.mp4");
  });
});

describe("P3 stage runner — voice", () => {
  it("ElevenLabs without a key fails clearly before any network call; Piper/gTTS are refused as production voice", async () => {
    const pp = productionPackageFor(await runRealP1());
    const outDir = await newDir();
    await throughA5(pp, outDir);
    const tts = fixtureTts(NARRATION_S);
    const err = await p3Voice({ outDir, productionPackage: pp, provider: "elevenlabs", elevenlabs: ELEVEN, env: {}, dotenvPath: NO_DOTENV, postElevenLabsHttp: tts.post, getElevenLabsHttp: fixtureGet }).catch((e) => e);
    expect(err.code).toBe("P3_ELEVENLABS_KEY_MISSING");
    expect(err.message).toContain("ELEVENLABS_API_KEY");
    expect(tts.calls()).toBe(0);
    expect(await code(p3Voice({ outDir, productionPackage: pp, provider: "gtts" as any }))).toBe("P3_PROVIDER_NOT_PRODUCTION");

    // .env fallback is read (and never persisted)
    const dotenv = join(outDir, "p3.env");
    await writeFile(dotenv, `# P3\nELEVENLABS_API_KEY="${FAKE_KEY}"\n`);
    const v = await p3Voice({ outDir, productionPackage: pp, provider: "elevenlabs", elevenlabs: ELEVEN, env: {}, dotenvPath: dotenv, postElevenLabsHttp: tts.post, getElevenLabsHttp: fixtureGet });
    expect(v.durationS).toBeCloseTo(NARRATION_S, 1);
    expect(tts.sawKey()).toBe(true);
    const state = await readFile(join(outDir, P3_STATE_FILE), "utf8");
    expect(state).not.toContain(FAKE_KEY);
    expect(state).toContain('"key_source": "dotenv"');
  });

  it("voice before Gate A5 is refused", async () => {
    const pp = productionPackageFor(await runRealP1());
    const outDir = await newDir();
    await p3Plan({ productionPackage: pp, outDir, language: "en" });
    await putAssets(outDir);
    await p3Ingest({ outDir, productionPackage: pp, actor: OWNER, probe: fixtureProbe });
    await p3Preview({ outDir, productionPackage: pp, execGtts: fixtureGtts });
    expect(await code(p3Voice({ outDir, productionPackage: pp, provider: "elevenlabs", elevenlabs: ELEVEN, env: KEY_ENV, dotenvPath: NO_DOTENV }))).toBe("P3_STEP_ORDER");
  });

  it("unconfirmed pronunciation flags require Gate A6 (or a confirmation at A5)", async () => {
    const research = await runRealP1();
    const base = productionPackageFor(research);
    const { manifest: _m, integrity_hashes: _i, ...content } = base;
    const pp = sealProductionPackage({ ...content, pronunciation_flags: [{ token: "312 BC", flag_type: "date", note: "Date-like token; verify pronunciation." }] });

    const outDir = await newDir();
    await throughA5(pp, outDir);
    const tts = fixtureTts(NARRATION_S);
    const call = () => p3Voice({ outDir, productionPackage: pp, provider: "elevenlabs", elevenlabs: ELEVEN, env: KEY_ENV, dotenvPath: NO_DOTENV, postElevenLabsHttp: tts.post, getElevenLabsHttp: fixtureGet });
    const err = await call().catch((e) => e);
    expect(err.code).toBe("P3_AMBIGUITY_A6_REQUIRED");
    expect(err.message).toContain("312 BC");
    expect(tts.calls()).toBe(0);
    expect(await code(p3ResolveAmbiguity({ outDir, productionPackage: pp, actor: "<name>" }))).toBe("AUTHORITY_REQUIRED");
    const a6 = await p3ResolveAmbiguity({ outDir, productionPackage: pp, actor: OWNER });
    expect(a6.gate.state_after).toBe("AMBIGUITY_RESOLVED");
    await call();
    expect(tts.calls()).toBe(1);
    expect((await p3Status(outDir)).gates.map((g) => g.split(":")[0])).toEqual(["A4", "A5", "A6"]);

    // alternative: the actor confirms the token at A5 — no A6 needed
    const outDir2 = await newDir();
    await throughA5(pp, outDir2, ["312 BC"]);
    await p3Voice({ outDir: outDir2, productionPackage: pp, provider: "elevenlabs", elevenlabs: ELEVEN, env: KEY_ENV, dotenvPath: NO_DOTENV, postElevenLabsHttp: fixtureTts(NARRATION_S).post, getElevenLabsHttp: fixtureGet });
    expect((await p3Status(outDir2)).gates.map((g) => g.split(":")[0])).toEqual(["A4", "A5"]);
  });

  it("Voicebox production voice goes through P3's VoiceboxProvider under the same gates", async () => {
    const pp = productionPackageFor(await runRealP1());
    const outDir = await newDir();
    await throughA5(pp, outDir);
    const wav = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(200)]);
    const client = {
      health: async () => ({ status: "ok" }),
      resolveProfile: async (id: string) => ({ id, name: "owner" }),
      generate: async () => ({ id: "gen1", status: "queued" }),
      getStatus: async () => ({ id: "gen1", status: "completed" }),
      getAudio: async () => wav,
    };
    const v = await p3Voice({ outDir, productionPackage: pp, provider: "voicebox", voicebox: { profileId: "owner-voice" }, voiceboxClient: client as any, probe: async () => ({ decodable: true, duration_s: 6.0 }) });
    expect(v.provider).toBe("voicebox");
    expect(v.durationS).toBe(6);
    const state = JSON.parse(await readFile(join(outDir, P3_STATE_FILE), "utf8"));
    expect(state.voice.result.provider).toBe("voicebox");
    expect(state.voice.result.engine).toBe("qwen"); // language "en" → qwen; "tr" would be chatterbox
  });
});

describe("P3 stage runner — full run to a Final Delivery the YouTube bridge accepts", () => {
  it("plan → A4 → preview → A5 → ElevenLabs → render + QA → A7 → final_delivery.json", async () => {
    const research = await runRealP1();
    const pp = productionPackageFor(research);
    const outDir = await newDir();
    await throughA5(pp, outDir);
    const tts = fixtureTts(NARRATION_S);
    const voiceArgs = { outDir, productionPackage: pp, provider: "elevenlabs" as const, elevenlabs: ELEVEN, env: KEY_ENV, dotenvPath: NO_DOTENV, postElevenLabsHttp: tts.post, getElevenLabsHttp: fixtureGet };
    await p3Voice(voiceArgs);
    const again = await p3Voice(voiceArgs); // resumable: never pays twice
    expect(again.reused).toBe(true);
    expect(tts.calls()).toBe(1);
    const narration = await readFile(join(outDir, "voice", "narration.wav"));
    expect(narration.subarray(0, 4).toString()).toBe("RIFF");

    const r = await p3Render({ outDir, productionPackage: pp, execRender: fixtureRender, mux: fixtureMux });
    expect(r.qa.result).toMatch(/^pass/);
    expect(r.mp4Path).toBe(join(outDir, "render", "master.mp4"));
    expect(await fileSha256(r.mp4Path)).toBe(r.sha256);

    // no default actor, no placeholder
    expect(await code(p3Approve({ outDir, productionPackage: pp, actor: undefined as unknown as string }))).toBe("AUTHORITY_REQUIRED");
    expect(await code(p3Approve({ outDir, productionPackage: pp, actor: "preview" }))).toBe("AUTHORITY_REQUIRED");
    const { finalDeliveryPath, finalDelivery: fd } = await p3Approve({ outDir, productionPackage: pp, actor: OWNER, notes: "Watched full render; arches read clearly." });

    expect(fd.gates.map((g) => `${g.gate_id}:${g.state_after}`)).toEqual(["A4:PRODUCTION_DELIVERY_RECEIVED", "A5:NARRATION_APPROVED_FOR_PRODUCTION", "A7:FINAL_QA_APPROVED"]);
    expect(fd.gates.every((g) => g.actor === OWNER)).toBe(true);
    expect(fd.render.outputs[0]!.sha256).toBe(await fileSha256(fd.render.outputs[0]!.path));
    expect(fd.narration.production_voice.provider).toBe("elevenlabs");
    expect(fd.timing.actual_narration_duration_s).toBeCloseTo(NARRATION_S, 1);
    expect(fd.timeline.total_frames).toBe(Math.round(NARRATION_S * 30));
    expect(fd.kaggle.kaggle_dataset_id).toBe("NOT_ARCHIVED");
    expect(fd.human_qa?.notes[0]).toContain(OWNER);

    // the file on disk is what downstream reads
    const onDisk = JSON.parse(await readFile(finalDeliveryPath, "utf8"));
    const directive = await directiveFor(research);
    const yip = buildYouTubeImport({ finalDelivery: onDisk, productionPackage: pp, researchPackage: research, directive, options: { now: () => AT } });
    expect(yip.final_delivery.video_sha256).toBe(await fileSha256(join(outDir, "render", "master.mp4")));
    expect(yip.final_delivery.gate_a7_record_id).toBe(fd.gates[2]!.approval_record_id);
    expect(yip.publishing_hints.content_type).toBe("short");

    // the key never reached any file the runner wrote
    for (const f of await allFiles(outDir)) expect((await readFile(f)).includes(FAKE_KEY)).toBe(false);
    expect((await p3Status(outDir)).next).toMatch(/^bitti/);

    // downstream refuses forged gate records and an edited final_delivery.json
    await expect(assertFinalDeliveryBound(finalDeliveryPath)).resolves.toBeUndefined();
    const forged = JSON.parse(JSON.stringify(onDisk));
    for (const g of forged.gates) g.actor = "system";
    expect(() => buildYouTubeImport({ finalDelivery: forged, productionPackage: pp, researchPackage: research, directive, options: { now: () => AT } })).toThrow(/GATE_ACTOR_INVALID/);
    await writeFile(finalDeliveryPath, JSON.stringify({ ...onDisk, gates: onDisk.gates.slice(2) }, null, 2));
    expect(await code(assertFinalDeliveryBound(finalDeliveryPath))).toBe("P3_FINAL_DELIVERY_CHANGED");
  });
});

describe("P3 stage runner — paid narration is never bought twice", () => {
  it("swapping an image after the narration (re-ingest → preview → A5) reuses the signed cached narration", async () => {
    const research = await runRealP1();
    const pp = productionPackageFor(research);
    const outDir = await newDir();
    await throughA5(pp, outDir);
    const tts = fixtureTts(NARRATION_S);
    const voiceArgs = { outDir, productionPackage: pp, provider: "elevenlabs" as const, elevenlabs: ELEVEN, env: KEY_ENV, dotenvPath: NO_DOTENV, postElevenLabsHttp: tts.post, getElevenLabsHttp: fixtureGet };
    await p3Voice(voiceArgs);
    await writeFile(join(outDir, "assets", "astreq_wide_arch.png"), "a different Google Flow image");
    await p3Ingest({ outDir, productionPackage: pp, actor: OWNER, probe: fixtureProbe });
    // A5 must be given again (the gates are not skipped) …
    expect(await code(p3Voice(voiceArgs))).toBe("P3_STEP_ORDER");
    await p3Preview({ outDir, productionPackage: pp, execGtts: fixtureGtts });
    await p3ApproveVoice({ outDir, productionPackage: pp, actor: OWNER });
    // … but ElevenLabs is not called again
    const again = await p3Voice(voiceArgs);
    expect(again.reused).toBe(true);
    expect(tts.calls()).toBe(1);
    // a tampered cache is not trusted: after another re-ingest it regenerates
    const cachePath = join(outDir, "voice", "narration_cache.json");
    const c = JSON.parse(await readFile(cachePath, "utf8"));
    if (loadSealKey()) {
      expect(c.signature?.alg).toBe("HMAC-SHA256");
      c.record.voice.result.duration_s = 99;
      await writeFile(cachePath, JSON.stringify(c));
      await p3Ingest({ outDir, productionPackage: pp, actor: OWNER, probe: fixtureProbe });
      await p3Preview({ outDir, productionPackage: pp, execGtts: fixtureGtts });
      await p3ApproveVoice({ outDir, productionPackage: pp, actor: OWNER });
      expect((await p3Voice(voiceArgs)).reused).toBe(false);
      expect(tts.calls()).toBe(2);
    }
  });
});

describe("P3 stage runner — tamper and input-change detection", () => {
  it("a hand-edited p3_state.json is refused", async () => {
    const pp = productionPackageFor(await runRealP1());
    const outDir = await newDir();
    await p3Plan({ productionPackage: pp, outDir, language: "en" });
    await putAssets(outDir);
    await p3Ingest({ outDir, productionPackage: pp, actor: OWNER, probe: fixtureProbe });
    const p = join(outDir, P3_STATE_FILE);
    const s = JSON.parse(await readFile(p, "utf8"));
    s.ingest.gate_a4.actor = "someone-else";
    await writeFile(p, JSON.stringify(s, null, 2));
    expect(await code(p3Preview({ outDir, productionPackage: pp, execGtts: fixtureGtts }))).toBe("P3_STATE_TAMPERED");
    await writeFile(p, "{ half-written");
    expect(await code(p3Status(outDir))).toBe("P3_STATE_TAMPERED");
  });

  it("a changed production package, a changed asset, narration or MP4 are each detected", async () => {
    const pp = productionPackageFor(await runRealP1());
    const outDir = await newDir();
    await throughA5(pp, outDir);
    expect(await code(p3Preview({ outDir, productionPackage: { ...pp, production_package_version: "1.0.1" }, execGtts: fixtureGtts }))).toBe("P3_INPUT_CHANGED");

    await p3Voice({ outDir, productionPackage: pp, provider: "elevenlabs", elevenlabs: ELEVEN, env: KEY_ENV, dotenvPath: NO_DOTENV, postElevenLabsHttp: fixtureTts(NARRATION_S).post, getElevenLabsHttp: fixtureGet });

    const staged = join(outDir, "staging", "astreq_wide_arch.png");
    const original = await readFile(staged);
    await appendFile(staged, "edited");
    expect(await code(p3Render({ outDir, productionPackage: pp, execRender: fixtureRender, mux: fixtureMux }))).toBe("P3_ARTIFACT_CHANGED");
    await writeFile(staged, original);

    const r = await p3Render({ outDir, productionPackage: pp, execRender: fixtureRender, mux: fixtureMux });
    await appendFile(r.mp4Path, "re-encoded elsewhere");
    expect(await code(p3Approve({ outDir, productionPackage: pp, actor: OWNER }))).toBe("P3_ARTIFACT_CHANGED");

    // re-running an earlier step discards later steps and their gates
    await p3Preview({ outDir, productionPackage: pp, execGtts: fixtureGtts });
    const st = await p3Status(outDir);
    expect(st.completed).toEqual(["plan", "ingest", "preview"]);
    expect(st.gates.map((g) => g.split(":")[0])).toEqual(["A4"]);
    expect(await code(p3Render({ outDir, productionPackage: pp, execRender: fixtureRender, mux: fixtureMux }))).toBe("P3_STEP_ORDER");
  });
});

// ------------------------------------------------------------------ real render (opt-in)

const REAL = process.env.UNIFIED_REAL_RENDER === "1";

describe.runIf(REAL)("P3 stage runner — REAL Remotion render (UNIFIED_REAL_RENDER=1)", () => {
  it(
    "renders a 9:16 MP4 with the narration muxed in, and the final delivery binds its hash",
    async () => {
      const research = await runRealP1();
      const pp = productionPackageFor(research);
      const outDir = await newDir();
      await p3Plan({ productionPackage: pp, outDir, language: "en" });
      const assets = join(outDir, "assets");
      execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=0x8B5A2B:s=1080x1920", "-frames:v", "1", join(assets, "astreq_wide_arch.png")]);
      execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=0x1E6FB0:s=1080x1920:r=30", "-t", "3", "-c:v", "libx264", "-pix_fmt", "yuv420p", join(assets, "astreq_water_flow.mp4")]);
      await p3Ingest({ outDir, productionPackage: pp, actor: OWNER }); // real ffprobe
      await p3Preview({ outDir, productionPackage: pp, execGtts: fixtureGtts });
      await p3ApproveVoice({ outDir, productionPackage: pp, actor: OWNER });
      await p3Voice({ outDir, productionPackage: pp, provider: "elevenlabs", elevenlabs: ELEVEN, env: KEY_ENV, dotenvPath: NO_DOTENV, postElevenLabsHttp: fixtureTts(NARRATION_S, true).post, getElevenLabsHttp: fixtureGet });
      const r = await p3Render({ outDir, productionPackage: pp }); // real Remotion + real ffmpeg mux
      expect(r.qa.result).toMatch(/^pass/);

      const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", r.mp4Path]);
      const probe = JSON.parse(stdout);
      const v = probe.streams.find((s: any) => s.codec_type === "video");
      const a = probe.streams.find((s: any) => s.codec_type === "audio");
      expect([v.width, v.height]).toEqual([1080, 1920]);
      expect(v.codec_name).toBe("h264");
      expect(a).toBeDefined();
      expect(Number(probe.format.duration)).toBeCloseTo(NARRATION_S, 0);
      console.log(`real render: ${r.mp4Path} ${(await stat(r.mp4Path)).size} bytes, ${probe.format.duration}s, audio ${a.codec_name}`);

      // No debug label burned into real frames: the bottom-left corner of the first
      // shot must be the plain asset colour (0x8B5A2B), not a dark text box.
      const corner = execFileSync("ffmpeg", ["-v", "error", "-ss", "0.5", "-i", r.mp4Path, "-frames:v", "1", "-vf", "crop=520:140:0:1780", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
      let off = 0;
      for (let i = 0; i < corner.length; i += 3) if (Math.abs(corner[i]! - 0x8b) + Math.abs(corner[i + 1]! - 0x5a) + Math.abs(corner[i + 2]! - 0x2b) > 40) off++;
      expect(off / (corner.length / 3)).toBeLessThan(0.01);
      execFileSync("ffmpeg", ["-y", "-v", "error", "-ss", "0.5", "-i", r.mp4Path, "-frames:v", "1", "-vf", "scale=270:480", join(tmpdir(), "p3-real-render-frame.png")]);

      const { finalDelivery } = await p3Approve({ outDir, productionPackage: pp, actor: OWNER });
      expect(finalDelivery.render.outputs[0]!.sha256).toBe(await fileSha256(r.mp4Path));
    },
    300_000,
  );
});

describe("ElevenLabs key resolution", () => {
  it("a real sk_ key wins over a non-key value in the other source; env still wins between two real keys", async () => {
    const dir = await mkdtemp(join(tmpdir(), "p3-key-"));
    const dotenv = join(dir, "p3.env");
    await writeFile(dotenv, `ELEVENLABS_API_KEY=${FAKE_KEY}\n`);
    const keyId = "3".repeat(64);
    expect(readElevenLabsKey({ ELEVENLABS_API_KEY: keyId }, dotenv)).toEqual({ key: FAKE_KEY, source: "dotenv" });
    const otherKey = "sk_" + "f".repeat(48);
    expect(readElevenLabsKey({ ELEVENLABS_API_KEY: otherKey }, dotenv)).toEqual({ key: otherKey, source: "env" });
    // no sk_ key anywhere: previous behaviour (env first) is kept
    expect(readElevenLabsKey({ ELEVENLABS_API_KEY: keyId }, join(dir, "missing.env"))).toEqual({ key: keyId, source: "env" });
  });
});
