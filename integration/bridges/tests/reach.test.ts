// Agent Reach backends (yt-dlp YouTube search, feedparser RSS) as B08 transports.
// Hermetic by default (fixture exec seam). Set UNIFIED_LIVE_REACH=1 to also run
// a real yt-dlp search (network).
import { describe, expect, it } from "vitest";
import { B02, B08 } from "b-branch-strategic-control-plane";
import {
  FeedparserRssTransport,
  YtDlpSearchTransport,
  buildStrategyInputBundle,
  collectReachIntelligence,
  mergeIntelligence,
  proposeStrategy,
  type ExecSeam,
  type ReachPlan,
  type StrategyBrief,
} from "../src/index.js";
import { AT, runRealP1 } from "./helpers.js";

const YT_JSON = JSON.stringify({
  _type: "playlist",
  entries: [
    { _type: "url", id: "mE5bjjkQQRg", url: "https://www.youtube.com/watch?v=mE5bjjkQQRg", title: "Hanların Annesi, Devletin Aklı: Taydula Hatun", channel: "Gubâr-ı Tarih", channel_id: "UCxwdjciNRnyZmpd6V84hd1w", duration: 314, view_count: 12034, description: "Tarih çoğu zaman hanları anlatır…", cookies: "MUST-NOT-LEAK" },
    { _type: "url", id: "bad id with spaces", title: "dropped" },
  ],
});
const fakeExec = (calls: string[][]): ExecSeam => async (cmd, args) => {
  calls.push([cmd, ...args]);
  if (args[0] === "--version") return { code: 0, stdout: "2026.08.19\n" };
  if (cmd === "yt-dlp") return { code: 0, stdout: YT_JSON };
  if (args[0] === "-c" && args[1]!.includes("feedparser.parse")) {
    return { code: 0, stdout: JSON.stringify({ version: "6.0.11", bozo: false, feed_title: "Steppe History", entries: [{ title: "New paper on Jochid queens", link: "https://example.org/jochid-queens", published: "Mon, 01 Sep 2026", summary: "…" }, { title: "no link" }] }) };
  }
  return { code: 1, stdout: "" };
};

const PLAN: ReachPlan = {
  plan_type: "B08_REACH_PLAN",
  project_id: "history-vertical",
  channel_id: "ch_yt_main",
  items: [
    { id: "yt-taidula", backend: "youtube_search", query: "Taydula Hatun Altın Orda", observation_kind: "CompetitiveObservation", purpose: "Existing videos on the same figure", max_results: 5 },
    { id: "rss-steppe", backend: "rss", query: "https://example.org/feed.xml", observation_kind: "TrendObservation", purpose: "New scholarship on steppe women", max_results: 5 },
  ],
};

describe("Agent Reach backends through B08", () => {
  it("normalises YouTube search + RSS into validated, UNKNOWN-status B08 results with fixed argv", async () => {
    const calls: string[][] = [];
    const intel = await collectReachIntelligence(PLAN, { youtube: new YtDlpSearchTransport({ exec: fakeExec(calls), executable: "yt-dlp" }), rss: new FeedparserRssTransport({ exec: fakeExec(calls), python: "python3" }) });
    expect(intel.results.map((r) => r.status)).toEqual(["EXECUTED_REAL", "EXECUTED_REAL"]);
    expect(intel.results.every((r) => B08.validateExternalResult(r))).toBe(true);
    const yt = intel.results[0]!;
    expect(yt.sources).toHaveLength(1);
    expect(yt.sources[0]!.canonical_url).toBe("https://www.youtube.com/watch?v=mE5bjjkQQRg");
    expect(yt.sources[0]!.content).toContain("Taydula Hatun");
    expect(yt.sources[0]!.content).not.toContain("MUST-NOT-LEAK");
    expect(yt.evidence.every((e) => e.status === "UNKNOWN" && e.production_eligible === false)).toBe(true);
    expect(intel.results[1]!.sources[0]!.canonical_url).toBe("https://example.org/jochid-queens");
    const ytCall = calls.find((c) => c[0] === "yt-dlp" && c.includes("-J"))!;
    expect(ytCall).toEqual(["yt-dlp", "--flat-playlist", "--no-warnings", "--ignore-config", "-J", "ytsearch5:Taydula Hatun Altın Orda"]);
    expect(B08.externalObservations(intel, ["CompetitiveObservation"], "ch_yt_main")).toHaveLength(1);
  });

  it("refuses what the backends cannot do instead of pretending (geo/date filters, http feeds, bad plans)", async () => {
    const intel = await collectReachIntelligence(
      { ...PLAN, items: [{ ...PLAN.items[1]!, query: "http://insecure.example.org/feed" }] },
      { rss: new FeedparserRssTransport({ exec: fakeExec([]), python: "python3" }) },
    );
    expect(intel.results[0]!.status).toBe("UNSUPPORTED_CAPABILITY");
    expect(intel.results[0]!.evidence).toHaveLength(0);
    const adapter = new B08.AgentReachAdapter(new YtDlpSearchTransport({ exec: fakeExec([]), executable: "yt-dlp" }));
    const geo = await adapter.retrieve({ request_id: "g", project_id: "p", purpose: "x", query: "q", source_types: ["youtube_search"], platform: "youtube", geography: "TR", max_results: 3, observation_kind: "TrendObservation", channel_id: "c" });
    expect(geo.status).toBe("UNSUPPORTED_CAPABILITY");
    const missing = await new B08.AgentReachAdapter(new YtDlpSearchTransport({ exec: async () => ({ code: 127, stdout: "" }) })).retrieve({ request_id: "m", project_id: "p", purpose: "x", query: "q", source_types: ["youtube_search"], platform: "youtube", max_results: 3, observation_kind: "TrendObservation", channel_id: "c" });
    expect(missing.status).toBe("UNAVAILABLE");
  });

  it("feeds B02 and the orchestrator proposal as external intelligence", async () => {
    const intel = await collectReachIntelligence({ ...PLAN, project_id: "history-vertical" }, { youtube: new YtDlpSearchTransport({ exec: fakeExec([]), executable: "yt-dlp" }), rss: new FeedparserRssTransport({ exec: fakeExec([]), python: "python3" }) });
    const merged = mergeIntelligence(intel);
    const research = await runRealP1();
    const bundle = buildStrategyInputBundle(research, { now: () => AT });
    const brief: StrategyBrief = {
      brief_type: "OWNER_STRATEGY_BRIEF",
      brand: { brand_name: "History Vertical", positioning: "Source-based vertical documentaries about women of the Eurasian steppe" },
      channels: [{ channel_id: "ch_yt_main", name: "History Vertical", platform: "YouTube", audience_category: "niche" }],
      documentation: { channel_policies: "Published for viewers in Europe and Asia." },
      audience: { platform_analytics: [{ platform_id: "youtube", channel_id: "ch_yt_main", demographic_data: "25-44, history enthusiasts", geography: ["TR", "DE"], interests: ["history", "documentary"], source: "YouTube Analytics", verified_at: "2026-09-01T00:00:00Z" }] },
    };
    const proposal = await proposeStrategy(bundle, brief, { intelligence: merged, now: () => AT });
    expect(proposal.intelligence_hash).not.toBeNull();
    expect(proposal.readiness.blockers).toEqual([]);
    // Real B02 attaches the reviewed-or-not competitive source to the opportunity lineage.
    expect(B08.externalObservations(merged, ["CompetitiveObservation", "TrendObservation"], "ch_yt_main")).toHaveLength(2);
    expect(typeof B02.runB02).toBe("function");
  });

  it("names the real cause when undated analytics empty the strategy", async () => {
    const bundle = buildStrategyInputBundle(await runRealP1(), { now: () => AT });
    const brief: StrategyBrief = {
      brief_type: "OWNER_STRATEGY_BRIEF",
      brand: { brand_name: "H", positioning: "Source-based vertical documentaries" },
      channels: [{ channel_id: "ch_yt_main", name: "History Vertical", platform: "YouTube", audience_category: "niche" }],
      documentation: { channel_policies: "Published for viewers in Europe and Asia." },
      audience: { platform_analytics: [{ platform_id: "youtube", channel_id: "ch_yt_main", demographic_data: "25-44", geography: ["TR"], interests: ["history"], source: "YouTube Analytics" }] },
    };
    const p = await proposeStrategy(bundle, brief, { now: () => AT });
    expect(p.readiness.blockers[0]).toContain("no verified_at");
  });

  it("refuses to merge contexts from different projects", () => {
    expect(() => mergeIntelligence({ project_id: "a", results: [] }, { project_id: "b", results: [] })).toThrow("CROSS_PROJECT_MERGE");
  });

  it.skipIf(process.env.UNIFIED_LIVE_REACH !== "1")("LIVE: real yt-dlp search", async () => {
    const intel = await collectReachIntelligence({ ...PLAN, items: [PLAN.items[0]!] });
    expect(intel.results[0]!.status).toBe("EXECUTED_REAL");
    expect(intel.results[0]!.sources.length).toBeGreaterThan(0);
    expect(B08.validateExternalResult(intel.results[0]!)).toBe(true);
  }, 120000);
});
