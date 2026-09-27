// Cycle status / chain audit, output secret guard, atomic writes, CLI hints.
import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  B_MODULES,
  assertNoSecrets,
  atomicWrite,
  auditCycle,
  buildCreativeDirective,
  buildStrategyInputBundle,
  buildYouTubeImport,
  classify,
  commitStrategy,
  decisionsTemplate,
  proposeStrategy,
  SecretLeakError,
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

async function fullCycle(dir: string, question?: string) {
  const research = await runRealP1(question);
  const bundle = buildStrategyInputBundle(research, { now: () => AT });
  const proposal = await proposeStrategy(bundle, BRIEF, { now: () => AT });
  const decisions = { ...decisionsTemplate(proposal), authority: OWNER, rationale: "cycle 1", approve: Object.fromEntries(B_MODULES.map((m) => [m, true])) };
  const strategy = await commitStrategy(bundle, BRIEF, proposal, decisions, { now: () => AT });
  const directive = buildCreativeDirective(bundle, strategy, { now: () => AT });
  const pp = productionPackageFor(research);
  const fd = finalDeliveryFor(pp);
  const yip = buildYouTubeImport({ finalDelivery: fd, productionPackage: pp, researchPackage: research, directive, options: { now: () => AT } });
  const files: Record<string, unknown> = { "research.json": research, "bundle.json": bundle, "brief.json": BRIEF, "proposal.json": proposal, "decisions.json": decisions, "strategy.json": strategy, "directive.json": directive, "production_package.json": pp, "final_delivery.json": fd, "youtube_import.json": yip };
  for (const [n, v] of Object.entries(files)) await writeFile(join(dir, n), JSON.stringify(v));
  return files;
}

describe("chain audit / cycle status", () => {
  it("classifies every artifact by content, not file name", async () => {
    const dir = await mkdtemp(join(tmpdir(), "audit-"));
    try {
      const files = await fullCycle(dir);
      expect(Object.fromEntries(Object.entries(files).map(([n, v]) => [n, classify(v)]))).toEqual({
        "research.json": "research", "bundle.json": "bundle", "brief.json": "brief", "proposal.json": "proposal", "decisions.json": "decisions",
        "strategy.json": "strategy", "directive.json": "directive", "production_package.json": "production", "final_delivery.json": "final_delivery", "youtube_import.json": "youtube_import",
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("passes an intact cycle and names the stage and next step", async () => {
    const dir = await mkdtemp(join(tmpdir(), "audit-"));
    try {
      await fullCycle(dir);
      const st = await auditCycle(dir);
      expect(st.checks.filter((c) => c.status === "FAIL")).toEqual([]);
      expect(st.ok).toBe(true);
      expect(st.stage).toContain("S11");
      expect(st.next).toContain("unified:import");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("pinpoints the broken link when one file is swapped or edited", async () => {
    const dir = await mkdtemp(join(tmpdir(), "audit-"));
    try {
      await fullCycle(dir);
      // the bridge itself refuses to pair a strategy with another cycle's bundle …
      const other = await runRealP1("A different question");
      const otherBundle = buildStrategyInputBundle(other, { now: () => AT });
      const strategy = JSON.parse(await readFile(join(dir, "strategy.json"), "utf8"));
      expect(() => buildCreativeDirective(otherBundle, strategy, { now: () => AT })).toThrow(/DIRECTIVE_BUNDLE_MISMATCH/);
      // … and a directive from ANOTHER cycle dropped into this folder is caught by the audit
      const otherDir = await mkdtemp(join(tmpdir(), "audit-other-"));
      await fullCycle(otherDir, "A different question");
      await writeFile(join(dir, "directive.json"), await readFile(join(otherDir, "directive.json"), "utf8"));
      await rm(otherDir, { recursive: true, force: true });
      let st = await auditCycle(dir);
      expect(st.ok).toBe(false);
      expect(st.checks.find((c) => c.link === "strategy → directive")?.status).toBe("FAIL");

      // restore, then hand-edit the proposal (seal breaks)
      await fullCycle(dir);
      const p = JSON.parse(await readFile(join(dir, "proposal.json"), "utf8"));
      p.readiness.ready = !p.readiness.ready;
      await writeFile(join(dir, "proposal.json"), JSON.stringify(p));
      st = await auditCycle(dir);
      expect(st.checks.find((c) => c.link === "bundle + brief → proposal")).toMatchObject({ status: "FAIL" });
      expect(st.next).toContain("FAIL");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses two cycles mixed in one folder, and reports a fresh folder as not started", async () => {
    const dir = await mkdtemp(join(tmpdir(), "audit-"));
    try {
      expect((await auditCycle(dir)).stage).toContain("S00");
      await fullCycle(dir);
      await writeFile(join(dir, "bundle_copy.json"), await readFile(join(dir, "bundle.json"), "utf8"));
      const st = await auditCycle(dir);
      expect(st.checks.some((c) => c.link === "bundle" && c.detail.includes("birden fazla"))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("CLI `status` exits 0 for an intact cycle and 2 for a broken one", async () => {
    const dir = await mkdtemp(join(tmpdir(), "audit-"));
    try {
      await fullCycle(dir);
      const ok = spawnSync("node", [CLI, "status", "--dir", dir], { encoding: "utf8" });
      expect(ok.status).toBe(0);
      expect(ok.stdout).toContain("Zincir: SAĞLAM");
      const y = JSON.parse(await readFile(join(dir, "youtube_import.json"), "utf8"));
      y.channel_id = "someone_else";
      await writeFile(join(dir, "youtube_import.json"), JSON.stringify(y));
      const bad = spawnSync("node", [CLI, "status", "--dir", dir], { encoding: "utf8" });
      expect(bad.status).toBe(2);
      expect(bad.stdout).toContain("Zincir: KIRIK");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("output safety", () => {
  it("refuses to write anything that looks like a credential", () => {
    const leaks = [
      { seo: { description: "key sk_" + "a".repeat(48) } },
      { note: "AIza" + "B".repeat(35) },
      { url: "https://api.example.com/x?api_key=supersecretvalue123" },
      { url: "https://user:pass@example.com/feed" },
      { k: "-----BEGIN RSA PRIVATE KEY-----" },
      { t: "Bearer abcdefghijklmnopqrstuvwxyz123456" },
    ];
    for (const l of leaks) expect(() => assertNoSecrets(l)).toThrow(SecretLeakError);
    expect(() => assertNoSecrets({ youtube: "https://www.youtube.com/watch?v=mE5bjjkQQRg", sha: "a".repeat(64) })).not.toThrow();
  });

  it("CLI refuses to write an envelope that would carry a secret, and prints a Turkish hint", async () => {
    const dir = await mkdtemp(join(tmpdir(), "leak-"));
    try {
      const research = await runRealP1();
      await writeFile(join(dir, "research.json"), JSON.stringify(research));
      await writeFile(join(dir, "ctx.json"), JSON.stringify({ brand: { brand_name: "X", positioning: "token=" + "Bearer abcdefghijklmnopqrstuvwxyz123456" } }));
      const r = spawnSync("node", [CLI, "research-to-strategy", "--research", join(dir, "research.json"), "--context", join(dir, "ctx.json"), "--out", join(dir, "bundle.json")], { encoding: "utf8" });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("Bearer token");
      expect(r.stderr).toContain("Ne yapmalı");
      expect((await readdir(dir)).includes("bundle.json")).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("CLI prints an actionable hint for bridge errors", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hint-"));
    try {
      const research = await runRealP1();
      research.claims[0].statement = "edited after approval";
      await writeFile(join(dir, "research.json"), JSON.stringify(research));
      const r = spawnSync("node", [CLI, "research-to-strategy", "--research", join(dir, "research.json")], { encoding: "utf8" });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("RESEARCH_PACKAGE_REJECTED");
      expect(r.stderr).toContain("→ Ne yapmalı: P1 paketi");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("atomic writes leave no partial or temp files behind", async () => {
    const dir = await mkdtemp(join(tmpdir(), "atomic-"));
    try {
      const p = join(dir, "x.json");
      await atomicWrite(p, "{\"a\":1}\n");
      await atomicWrite(p, "{\"a\":2}\n");
      expect(await readFile(p, "utf8")).toBe("{\"a\":2}\n");
      expect(await readdir(dir)).toEqual(["x.json"]);
      await expect(atomicWrite(join(dir, "missing-dir", "y.json"), "x")).rejects.toThrow();
      expect(await readdir(dir)).toEqual(["x.json"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

void execFileSync;
