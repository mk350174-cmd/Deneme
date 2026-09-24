// Cross-runtime proof: envelopes sealed by the TypeScript bridges (B00 hash
// authority) are verified and imported by the YouTube agent's CommonJS code,
// and the agent's exported feed is consumed by the B08 transport.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { B08 } from "b-branch-strategic-control-plane";
import { buildCreativeDirective, buildStrategyInputBundle, buildYouTubeImport, collectLearningIntelligence, signCommittedStrategy } from "../src/index.js";
import { AT, committedStrategy, finalDeliveryFor, productionPackageFor, runRealP1 } from "./helpers.js";

const YT = resolve(__dirname, "../../../apps/youtube-agent");
const hasYt = existsSync(join(YT, "node_modules", "sqlite3"));
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

describe.skipIf(!hasYt)("TS bridges <-> YouTube agent (CommonJS) round trip", () => {
  it("P1 -> B -> directive -> P3 import -> YouTube Review Studio -> learning feed -> B08", async () => {
    const dir = await mkdtemp(join(tmpdir(), "unified-e2e-"));
    try {
      const video = Buffer.from(`mp4-${randomUUID()}`);
      const audio = Buffer.from(`wav-${randomUUID()}`);
      const videoPath = join(dir, "final_master.mp4");
      const audioPath = join(dir, "narration.wav");
      await writeFile(videoPath, video);
      await writeFile(audioPath, audio);

      const research = await runRealP1();
      const bundle = buildStrategyInputBundle(research, { brand: { brand_name: "History Vertical" }, now: () => AT });
      const { branch, states } = await committedStrategy();
      const directive = buildCreativeDirective(bundle, signCommittedStrategy({ branch, b05: states.b05, b06: states.b06, b07: states.b07, b11: states.b11 }), { now: () => AT });
      const pp = productionPackageFor(research);
      const fd = finalDeliveryFor(pp, { videoPath, videoSha: sha(video), audioPath, audioSha: sha(audio) });
      const yip = buildYouTubeImport({ finalDelivery: fd, productionPackage: pp, researchPackage: research, directive, options: { now: () => AT } });
      const yipPath = join(dir, "youtube_import.json");
      await writeFile(yipPath, JSON.stringify(yip));
      const dbPath = join(dir, "yt.db");

      const resultPath = join(dir, "import_result.json");
      execFileSync("node", [join(YT, "integration/import-production.js"), yipPath, "--db", dbPath, "--out", resultPath], { cwd: YT, stdio: "ignore" });
      const imported = JSON.parse(await readFile(resultPath, "utf8"));
      expect(imported.status).toBe("imported");
      expect(imported.identityHash).toBe(yip.identity.content_hash);
      // one INFERRED claim is narrated -> the agent keeps it blocked until a human resolves it
      expect(imported.reviewStatus).toBe("needs_attention");
      expect(imported.qualityBlocking).toContain("provenance");

      // Simulate the agent having published and measured the video (what its own analytics job writes).
      const seed = `
        const { Database } = require('./database/db');
        (async () => { const db = new Database(); db.dbPath = ${JSON.stringify(dbPath)}; await db.initialize();
          await db.executeQuery("INSERT INTO publish_schedule (id, production_id, title, publish_time, status, youtube_id) VALUES ('s1', ?, 't', '2026-09-20T15:00:00.000Z', 'published', 'abcDEF12345')", [${JSON.stringify(yip.production_id)}]);
          await db.savePerformanceSnapshot({ videoId: 'abcDEF12345', productionId: ${JSON.stringify(yip.production_id)}, measurementWindow: '7d', publishedAt: '2026-09-20T15:00:00.000Z', metrics: { views: 6120 }, contentAttributes: {}, simulated: false });
          db.db.close(); })();`;
      execFileSync("node", ["-e", seed], { cwd: YT, stdio: "ignore" });
      const feedPath = join(dir, "feed.json");
      execFileSync("node", [join(YT, "integration/export-learning-feed.js"), "--channel", directive.channel.channel_id, "--project", "history-vertical", "--db", dbPath, "--out", feedPath], { cwd: YT, stdio: "ignore" });
      const feed = JSON.parse(await readFile(feedPath, "utf8"));
      expect(feed.snapshots).toHaveLength(1);

      const intel = await collectLearningIntelligence(feed, [{ kpi_id: directive.kpis[0]!.kpi_id, youtube_metric: "views", unit: "views", measurement_window: "7d" }]);
      const perf = B08.externalObservations(intel, ["PerformanceObservation"], directive.channel.channel_id);
      expect(perf[0]!.measurement).toMatchObject({ metric_id: "kpi_views_7d", value: 6120, unit: "views" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
