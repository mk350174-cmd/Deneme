// P3.F finishing with REAL ffmpeg/ffprobe: a real 9:16 master with narration
// tone, a real music bed, burned captions, sidechain ducking, Gate F1, then
// Bridge 3 and the YouTube agent import of the finished file.
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  BridgeError,
  alignedCues,
  approveFinishing,
  buildCreativeDirective,
  signCommittedStrategy,
  buildStrategyInputBundle,
  buildYouTubeImport,
  estimateCues,
  fileSha256,
  finishMaster,
  toSrt,
} from "../src/index.js";
import { AT, OWNER, committedStrategy, finalDeliveryFor, productionPackageFor, runRealP1 } from "./helpers.js";

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe("caption timing", () => {
  it("estimates cues by character share and never overruns the narration", () => {
    const cues = estimateCues(["Taydula Hatun Altın Orda'nın en güçlü kadınlarından biriydi.", "Üç hanın tahta çıkışında belirleyici oldu."], 10, 32);
    expect(cues.length).toBeGreaterThanOrEqual(3);
    expect(cues[0]!.start).toBe(0);
    expect(cues.at(-1)!.end).toBeCloseTo(10, 5);
    expect(cues.every((c) => c.text.length <= 32)).toBe(true);
    expect(toSrt(cues)).toMatch(/^1\n00:00:00,000 --> 00:00:0\d,\d{3}\nTaydula Hatun/);
  });
  it("uses word timings when supplied and rejects broken ones", () => {
    const cues = alignedCues([{ text: "Taydula", start: 0.2, end: 0.7 }, { text: "Hatun.", start: 0.7, end: 1.1 }, { text: "Altın", start: 1.3, end: 1.6 }], 32);
    expect(cues.map((c) => [c.text, c.start, c.end])).toEqual([["Taydula Hatun.", 0.2, 1.1], ["Altın", 1.3, 1.6]]);
    expect(() => alignedCues([{ text: "x", start: 2, end: 1 }])).toThrow(BridgeError);
  });
});

describe.skipIf(!hasFfmpeg)("P3.F finishing with real ffmpeg", () => {
  let dir = "";
  let masterPath = "";
  let musicPath = "";
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "p3f-"));
    masterPath = join(dir, "final_master.mp4");
    musicPath = join(dir, "bed.mp3");
    // 3 s, 270x480 (9:16), 440 Hz "narration" tone
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0x223344:s=270x480:d=3:r=25", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", masterPath]);
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=110:duration=1.5", "-c:a", "libmp3lame", musicPath]);
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  async function chain() {
    const research = await runRealP1();
    const bundle = buildStrategyInputBundle(research, { now: () => AT });
    const { branch, states } = await committedStrategy();
    const directive = buildCreativeDirective(bundle, signCommittedStrategy({ branch, b05: states.b05, b06: states.b06, b07: states.b07, b11: states.b11 }), { now: () => AT });
    const pp = productionPackageFor(research);
    const narration = join(dir, "narration.wav");
    await writeFile(narration, Buffer.from("wav"));
    const fd = finalDeliveryFor(pp, { videoPath: masterPath, videoSha: await fileSha256(masterPath), audioPath: narration, audioSha: await fileSha256(narration) });
    return { research, directive, pp, fd };
  }

  it("burns captions, ducks a looped music bed under narration, and records everything", async () => {
    const { pp, fd } = await chain();
    const rec = await finishMaster({
      finalDelivery: fd,
      productionPackage: pp,
      options: { outDir: join(dir, "out"), captions: { enabled: true, language: "en" }, music: { path: musicPath, source: "test tone (fixture)", license: "generated in test", attested_by: OWNER, gain_db: -20 }, now: () => AT },
    });
    expect(rec.status).toBe("AWAITING_F1_REVIEW");
    expect(existsSync(rec.finished.path)).toBe(true);
    expect(rec.finished.sha256).not.toBe(rec.master.sha256);
    expect(rec.finished.width).toBe(270);
    expect(rec.finished.height).toBe(480);
    expect(rec.finished.duration_seconds).toBeGreaterThan(2.8);
    expect(rec.finished.duration_seconds).toBeLessThan(3.3);
    expect(rec.captions?.timing_basis).toBe("ESTIMATED_CHARACTER_SHARE");
    expect(await readFile(rec.captions!.path, "utf8")).toContain("Aqua Appia");
    expect(rec.music?.ducking).toBe("sidechaincompress");
    const streams = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", rec.finished.path], { encoding: "utf8" })).streams;
    expect(streams.map((s: any) => s.codec_type).sort()).toEqual(["audio", "video"]);
  });

  it("refuses a master that is not the file P3 rendered, and music without a license attestation", async () => {
    const { pp, fd } = await chain();
    const other = structuredClone(fd);
    other.render.outputs[0].sha256 = "0".repeat(64);
    await expect(finishMaster({ finalDelivery: other, productionPackage: pp, options: { outDir: join(dir, "x"), captions: { enabled: true } } })).rejects.toMatchObject({ code: "MASTER_HASH_MISMATCH" });
    await expect(finishMaster({ finalDelivery: fd, productionPackage: pp, options: { outDir: join(dir, "y"), music: { path: musicPath, source: "x", license: "", attested_by: OWNER } } })).rejects.toMatchObject({ code: "MUSIC_LICENSE_REQUIRED" });
  });

  it("Bridge 3 requires Gate F1 and then imports the FINISHED file with its captions", async () => {
    const { research, directive, pp, fd } = await chain();
    const rec = await finishMaster({ finalDelivery: fd, productionPackage: pp, options: { outDir: join(dir, "b3"), captions: { enabled: true, language: "en" }, now: () => AT } });
    expect(() => approveFinishing(rec, "<your name>")).toThrow(BridgeError);
    const f1 = approveFinishing(rec, OWNER, "watched on phone", () => AT);
    const forgedF1 = { ...f1, finished_sha256: "f".repeat(64) };
    expect(() => buildYouTubeImport({ finalDelivery: fd, productionPackage: pp, researchPackage: research, directive, finishing: { record: rec, approval: forgedF1 as any } })).toThrow(BridgeError);

    const yip = buildYouTubeImport({ finalDelivery: fd, productionPackage: pp, researchPackage: research, directive, finishing: { record: rec, approval: f1 }, options: { now: () => AT } });
    expect(yip.final_delivery.video_path).toBe(rec.finished.path);
    expect(yip.final_delivery.video_sha256).toBe(rec.finished.sha256);
    expect(yip.finishing?.master_sha256).toBe(rec.master.sha256);
    expect(yip.finishing?.captions?.timing_basis).toBe("ESTIMATED_CHARACTER_SHARE");

    const YT = resolve(__dirname, "../../../apps/youtube-agent");
    if (!existsSync(join(YT, "node_modules", "sqlite3"))) return;
    const yipPath = join(dir, "yip.json");
    const resultPath = join(dir, "import.json");
    await writeFile(yipPath, JSON.stringify(yip));
    execFileSync("node", [join(YT, "integration/import-production.js"), yipPath, "--db", join(dir, "yt.db"), "--out", resultPath], { cwd: YT, stdio: "ignore" });
    const imported = JSON.parse(await readFile(resultPath, "utf8"));
    expect(imported.status).toBe("imported");
    const probeDb = execFileSync("node", ["-e", `const {Database}=require('./database/db');(async()=>{const d=new Database();d.dbPath=${JSON.stringify(join(dir, "yt.db"))};await d.initialize();const b=await d.getProductionBundle(${JSON.stringify(yip.production_id)});process.stdout.write(JSON.stringify(b.assets.captions));d.db.close();})()`], { cwd: YT, encoding: "utf8" });
    const captions = JSON.parse(probeDb.trim().split("\n").at(-1)!);
    expect(captions).toMatchObject({ format: "srt", timingBasis: "ESTIMATED_CHARACTER_SHARE", burnedIn: true });
  });
});
