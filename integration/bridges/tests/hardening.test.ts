// Final-review hardening: every finding from the independent review has a test.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, unlink, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  B_MODULES,
  alignedCues,
  approveFinishing,
  assertHumanAuthority,
  assertNoSecrets,
  auditCycle,
  buildCreativeDirective,
  buildStrategyInputBundle,
  buildYouTubeImport,
  commitStrategy,
  decisionsTemplate,
  filePersistence,
  proposeStrategy,
  reachRequests,
  isInternalHost,
  sealEnvelope,
  verifyEnvelope,
  loadSealKey,
  SecretLeakError,
  toSrt,
  type StrategyBrief,
} from "../src/index.js";
import { AT, OWNER, finalDeliveryFor, productionPackageFor, runRealP1 } from "./helpers.js";

const CLI = resolve(__dirname, "../dist/cli.js");
const BRIEF: StrategyBrief = {
  brief_type: "OWNER_STRATEGY_BRIEF",
  brand: { brand_name: "History Vertical", positioning: "Source-based vertical documentaries about women of the Eurasian steppe" },
  channels: [{ channel_id: "ch_yt_main", name: "History Vertical", platform: "YouTube", audience_category: "niche" }],
  documentation: { channel_policies: "Published for viewers in Europe and Asia." },
  audience: { platform_analytics: [{ platform_id: "youtube", channel_id: "ch_yt_main", demographic_data: "25-44", geography: ["TR"], interests: ["history"], source: "YouTube Analytics", verified_at: "2026-09-01T00:00:00Z" }] },
  owner_goals: ["Open with the strongest primary-source detail"],
};

async function cycle(dir?: string) {
  const research = await runRealP1();
  const bundle = buildStrategyInputBundle(research, { now: () => AT });
  const proposal = await proposeStrategy(bundle, BRIEF, { now: () => AT });
  const decisions = { ...decisionsTemplate(proposal), authority: OWNER, rationale: "cycle 1", approve: Object.fromEntries(B_MODULES.map((m) => [m, true])) };
  const strategy = await commitStrategy(bundle, BRIEF, proposal, decisions, { now: () => AT });
  const directive = buildCreativeDirective(bundle, strategy, { now: () => AT });
  const pp = productionPackageFor(research);
  const fd = finalDeliveryFor(pp);
  const yip = buildYouTubeImport({ finalDelivery: fd, productionPackage: pp, researchPackage: research, directive, options: { now: () => AT } });
  const files: Record<string, unknown> = { "research.json": research, "bundle.json": bundle, "brief.json": BRIEF, "proposal.json": proposal, "decisions.json": decisions, "strategy.json": strategy, "directive.json": directive, "production_package.json": pp, "final_delivery.json": fd, "youtube_import.json": yip };
  if (dir) for (const [n, v] of Object.entries(files)) await writeFile(join(dir, n), JSON.stringify(v));
  return { research, bundle, proposal, decisions, strategy };
}

describe("strategy.json cannot carry unapproved owner goals", () => {
  it("the owner goals and the bundle are bound into the sealed B12 decision", async () => {
    const { bundle, strategy } = await cycle();
    const decision = strategy.branch.state_transitions.at(-1)!;
    expect(decision.rationale).toMatch(/^cycle 1 \[unified bundle=[0-9a-f]{64} owner_goals=[0-9a-f]{64}\]$/);

    const edited = JSON.parse(JSON.stringify(strategy));
    edited.owner_goals.goals = ["Something the owner never approved"];
    expect(() => buildCreativeDirective(bundle, edited, { now: () => AT })).toThrow(/OWNER_GOALS_TAMPERED/);

    const dropped = JSON.parse(JSON.stringify(strategy));
    delete dropped.owner_goals;
    expect(() => buildCreativeDirective(bundle, dropped, { now: () => AT })).toThrow(/OWNER_GOALS_TAMPERED/);
  });

  it("status reports an edited strategy.json as a broken link", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hard-"));
    try {
      await cycle(dir);
      const s = JSON.parse(await readFile(join(dir, "strategy.json"), "utf8"));
      s.owner_goals.constraints = ["new rule nobody approved"];
      await writeFile(join(dir, "strategy.json"), JSON.stringify(s));
      const st = await auditCycle(dir);
      expect(st.ok).toBe(false);
      expect(st.checks.find((c) => c.link.startsWith("proposal → strategy"))?.status).toBe("FAIL");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("B-4: real B chain is no longer semantically INVALID", () => {
  it("B12 sees subject-bound B11 provenance; only honest open items remain", async () => {
    const { proposal } = await cycle();
    expect(proposal.readiness.semantic_validity).not.toBe("INVALID");
    expect(proposal.readiness.semantic_findings.join(" ")).not.toContain("MISSING_SUBJECT_BINDING");
  });
});

describe("human gates accept only a named person", () => {
  it("rejects placeholders and preview/system markers in any case or spacing", () => {
    for (const bad of ["", "  ", "PREVIEW", "Preview", "PREVIEW:not-approved", "System", "system bot", " <your name>", "<adınız>", "unknown", "TODO"]) {
      expect(() => assertHumanAuthority("t", bad)).toThrow(/AUTHORITY_REQUIRED/);
    }
    expect(assertHumanAuthority("t", "  Mehmet Koyuncu ")).toBe("Mehmet Koyuncu");
  });

  it("b-commit refuses PREVIEW / System as authority", async () => {
    const research = await runRealP1();
    const bundle = buildStrategyInputBundle(research, { now: () => AT });
    const proposal = await proposeStrategy(bundle, BRIEF, { now: () => AT });
    for (const authority of ["PREVIEW", "System", " <adınız>"]) {
      const decisions = { ...decisionsTemplate(proposal), authority, rationale: "x", approve: Object.fromEntries(B_MODULES.map((m) => [m, true])) };
      await expect(commitStrategy(bundle, BRIEF, proposal, decisions, { now: () => AT })).rejects.toThrow(/AUTHORITY_REQUIRED/);
    }
  });

  it("Gate F1 refuses a padded placeholder or PREVIEW, accepts a name", () => {
    const record = sealEnvelope<any>({ record_type: "P3F_FINISHING_RECORD", finished: { sha256: "a".repeat(64) } }, { object_id: "p3f_x", object_type: "UNIFIED_P3F_FINISHING_RECORD", version: "v1", created_at: AT });
    for (const bad of [" <your name>", "PREVIEW", "System"]) expect(() => approveFinishing(record, bad)).toThrow(/AUTHORITY_REQUIRED/);
    expect(approveFinishing(record, " Mehmet Koyuncu ", "", () => AT).actor).toBe("Mehmet Koyuncu");
  });
});

describe("chain audit: gaps and unreadable files break the chain", () => {
  it("a deleted middle file is a FAIL, not a quiet MISSING", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hard-"));
    try {
      await cycle(dir);
      await unlink(join(dir, "proposal.json"));
      const st = await auditCycle(dir);
      expect(st.ok).toBe(false);
      expect(st.checks.find((c) => c.link === "bundle + brief → proposal")?.status).toBe("FAIL");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("a truncated JSON is reported, and subfolders are ignored", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hard-"));
    try {
      await cycle(dir);
      const text = await readFile(join(dir, "strategy.json"), "utf8");
      await writeFile(join(dir, "strategy.json"), text.slice(0, 200));
      await mkdir(join(dir, "finish.json"));
      const st = await auditCycle(dir);
      expect(st.ok).toBe(false);
      expect(st.checks.some((c) => c.link === "dosya strategy.json" && c.status === "FAIL")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("secrets", () => {
  it("catches AWS, Slack, GitHub fine-grained and Google keys ending in '-'", () => {
    const leaks = ["AKIA" + "ABCDEFGHIJKLMNOP", "xoxb-" + "1234567890-abcdefghij", "github_pat_" + "A".repeat(40), "key AIza" + "B".repeat(34) + "- here"];
    for (const l of leaks) expect(() => assertNoSecrets({ l })).toThrow(SecretLeakError);
  });

  it("a brief carrying a key is refused before review.md or the store is written", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hard-"));
    try {
      const { bundle } = await cycle();
      await writeFile(join(dir, "bundle.json"), JSON.stringify(bundle));
      await writeFile(join(dir, "brief.json"), JSON.stringify({ ...BRIEF, owner_goals: ["use key sk-proj-" + "x".repeat(40)] }));
      const r = spawnSync("node", [CLI, "b-propose", "--bundle", join(dir, "bundle.json"), "--brief", join(dir, "brief.json"), "--store", join(dir, "store"), "--out", join(dir, "proposal.json"), "--review", join(dir, "review.md")], { encoding: "utf8" });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("OpenAI-style API key");
      expect((await readdir(dir)).sort()).toEqual(["brief.json", "bundle.json"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("store, finishing and reach inputs fail loudly", () => {
  it("a corrupt store index is an error, never an empty store (no silent restart at v1.0)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hard-"));
    try {
      await writeFile(join(dir, "index.json"), "[\"v1.0\", ");
      await expect(filePersistence(dir).latest()).rejects.toThrow(/corrupt/);
      await expect(filePersistence(join(dir, "empty")).latest()).resolves.toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("caption text cannot inject libass override tags, and out-of-order word timings are rejected", () => {
    expect(toSrt([{ index: 1, start: 0, end: 1, text: "Hatun {\\fs80}büyük" }])).toContain("Hatun (\\fs80)büyük");
    expect(() => alignedCues([{ text: "b", start: 1, end: 1.2 }, { text: "a", start: 0.5, end: 0.8 }])).toThrow(/out of order/);
  });

  it("to-youtube refuses --f1 without --finishing", () => {
    const r = spawnSync("node", [CLI, "to-youtube", "--f1", "f1.json"], { encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("FINISHING_F1_PAIR");
  });

  it("reach plan max_results must be a sane integer", () => {
    const plan = { plan_type: "B08_REACH_PLAN", project_id: "p", channel_id: "c", items: [{ id: "x", backend: "youtube_search", query: "q", purpose: "competitor_scan", observation_kind: "competitor_content", max_results: Number("abc") }] } as any;
    expect(() => reachRequests(plan)).toThrow(/max_results/);
  });
});

describe("seal key: an edited-and-resealed file no longer verifies", () => {
  const withKey = <T>(value: string | undefined, fn: () => T): T => {
    const prev = process.env.UNIFIED_SEAL_KEY;
    if (value === undefined) delete process.env.UNIFIED_SEAL_KEY;
    else process.env.UNIFIED_SEAL_KEY = value;
    try {
      return fn();
    } finally {
      if (prev === undefined) delete process.env.UNIFIED_SEAL_KEY;
      else process.env.UNIFIED_SEAL_KEY = prev;
    }
  };
  const KEY_A = "a".repeat(64);
  const KEY_B = "b".repeat(64);
  const body = { package_type: "P3_TO_YOUTUBE_IMPORT", channel_id: "ch_yt_main", title: "Taydula Hatun" };
  const meta = { object_id: "yt_1", object_type: "UNIFIED_YOUTUBE_IMPORT", version: "v1", created_at: AT };

  it("signs with the local key and verifies", () => {
    withKey(KEY_A, () => {
      const env = sealEnvelope<any>(body, meta);
      expect(env.identity.signature).toMatchObject({ alg: "HMAC-SHA256", key_id: expect.stringMatching(/^[0-9a-f]{16}$/) });
      expect(() => verifyEnvelope("t", env, "UNIFIED_YOUTUBE_IMPORT")).not.toThrow();
    });
  });

  it("refuses a file resealed without the key, one with a copied signature, and one from another installation", () => {
    const original = withKey(KEY_A, () => sealEnvelope<any>(body, meta));
    const edited = { ...original, channel_id: "someone_else" };
    delete edited.identity;
    const resealedNoKey = withKey("none", () => sealEnvelope<any>(edited, meta));
    const resealedCopiedSig = withKey("none", () => sealEnvelope<any>(edited, meta));
    resealedCopiedSig.identity.signature = original.identity.signature;
    const otherInstall = withKey(KEY_B, () => sealEnvelope<any>(body, meta));
    withKey(KEY_A, () => {
      expect(() => verifyEnvelope("t", resealedNoKey, "UNIFIED_YOUTUBE_IMPORT")).toThrow(/ENVELOPE_UNSIGNED/);
      expect(() => verifyEnvelope("t", resealedCopiedSig, "UNIFIED_YOUTUBE_IMPORT")).toThrow(/SIGNATURE_INVALID/);
      expect(() => verifyEnvelope("t", otherInstall, "UNIFIED_YOUTUBE_IMPORT")).toThrow(/SIGNED_WITH_OTHER_KEY/);
    });
    // without any key (signing not set up) only the content hash is checked
    withKey("none", () => expect(() => verifyEnvelope("t", resealedNoKey, "UNIFIED_YOUTUBE_IMPORT")).not.toThrow());
  });

  it("the YouTube agent (CommonJS) accepts the TS signature and refuses a reseal", () => {
    const script = `
      const { verifyEnvelope } = require(${JSON.stringify(resolve(__dirname, "../../../apps/youtube-agent/integration/envelope.js"))});
      const [good, bad] = JSON.parse(require("fs").readFileSync(0, "utf8"));
      verifyEnvelope(good, "UNIFIED_YOUTUBE_IMPORT");
      try { verifyEnvelope(bad, "UNIFIED_YOUTUBE_IMPORT"); console.log("ACCEPTED"); } catch (e) { console.log(e.message.split(":")[0]); }`;
    const good = withKey(KEY_A, () => sealEnvelope<any>(body, meta));
    const bad = withKey("none", () => sealEnvelope<any>({ ...body, channel_id: "x" }, meta));
    const r = spawnSync("node", ["-e", script], { input: JSON.stringify([good, bad]), encoding: "utf8", env: { ...process.env, UNIFIED_SEAL_KEY: KEY_A } });
    expect(r.stderr).toBe("");
    expect(r.stdout.trim()).toBe("ENVELOPE_UNSIGNED");
  });

  it("strategy.json carries a commit signature; removing it is refused", async () => {
    const { bundle, strategy } = await cycle();
    if (loadSealKey()) {
      expect(strategy.commit_signature?.alg).toBe("HMAC-SHA256");
      const stripped = JSON.parse(JSON.stringify(strategy));
      delete stripped.commit_signature;
      expect(() => buildCreativeDirective(bundle, stripped, { now: () => AT })).toThrow(/UNSIGNED/);
    }
  });
});

describe("RSS feeds never reach local or private-network hosts", () => {
  it("classifies internal hosts", () => {
    for (const h of ["localhost", "a.localhost", "router.local", "intranet", "127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "[::1]", "fd00::1", "::ffff:10.0.0.1"]) expect(isInternalHost(h)).toBe(true);
    for (const h of ["example.org", "feeds.bbci.co.uk", "8.8.8.8", "172.32.0.1"]) expect(isInternalHost(h)).toBe(false);
  });
});
