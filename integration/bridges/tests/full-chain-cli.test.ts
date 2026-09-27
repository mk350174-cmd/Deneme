// The whole A→B→A chain through the REAL CLI, the way a user (or Claude Code on
// their behalf) runs it: docs/examples inputs → P1 (A1) → B (G-B) → directive →
// P2 (A2/A3) → P3 plan → Google Flow files → P3 ingest (A4). Every human gate is
// passed with an explicit test name. The voice/render steps need real providers
// (ElevenLabs/Voicebox, Remotion); they are covered by stage-p3.test.ts.
import { describe, expect, it } from "vitest";
import { spawnSync, execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLI = resolve(__dirname, "../dist/cli.js");
const EX = resolve(__dirname, "../../../docs/examples");
const NAME = "Test Owner (full chain)";
const P2_EXAMPLE_CLAIMS = ["claim_3f9a1c2b7d4e8a10", "claim_8b2e4d6f1a3c5e79", "claim_c47d2a9e0b1f6a33"];

function u(cwd: string, ...args: string[]) {
  const r = spawnSync("node", [CLI, ...args], { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`unified ${args[0]} exited ${r.status}\n${r.stderr}`);
  return r;
}
const status = (cwd: string) => spawnSync("node", [CLI, "status", "--dir", "."], { cwd, encoding: "utf8" }).stdout;

describe("full chain through the CLI (P1 → B → P2 → P3 ingest)", () => {
  it("runs every documented command in order and status follows each stage", async () => {
    const root = await mkdtemp(join(tmpdir(), "fullchain-"));
    const c = join(root, "cycle-001");
    try {
      await mkdir(c, { recursive: true });
      expect(status(c)).toContain("p1-scope");

      // ── P1: the user's research, placeholders filled; one finding has no source → UNKNOWN
      const p1 = JSON.parse(await readFile(join(EX, "p1_input.example.json"), "utf8"));
      p1.findings.forEach((f: any, i: number) => {
        f.source.origin = `https://example.org/kaynak-${i}`;
        f.excerpt = `s. ${20 + i}`;
      });
      p1.findings[2].source.origin = "unknown";
      p1.findings[2].excerpt = "";
      p1.findings[2].unresolved_reason = "Baskı henüz kontrol edilmedi.";
      p1.verifications = [{ statement: p1.findings[0].statement, status: "VERIFIED", rationale: "İki bağımsız kaynakta aynı bilgi (test).", cross_checked_with: ["https://example.org/bagimsiz-kaynak"] }];
      await writeFile(join(c, "p1_input.json"), JSON.stringify(p1));
      u(c, "p1-scope", "--input", "p1_input.json", "--out", "scope.json", "--review", "p1_scope.md");
      expect(status(c)).toContain("S01 P1 kapsamı önerildi");
      u(c, "p1-draft", "--input", "p1_input.json", "--scope", "scope.json", "--scope-approved-by", NAME, "--out", "research_draft.json", "--review", "p1_review.md");
      expect(status(c)).toContain("Gate A1 onayı bekliyor");
      u(c, "p1-approve", "--draft", "research_draft.json", "--actor", NAME, "--review", "p1_review.md", "--out", "research.json");
      expect(status(c)).toContain("S01 araştırma (P1) hazır");

      // ── B
      await copyFile(join(EX, "brief.example.json"), join(c, "brief.json"));
      u(c, "research-to-strategy", "--research", "research.json", "--out", "bundle.json");
      u(c, "b-propose", "--bundle", "bundle.json", "--brief", "brief.json", "--store", "../b-store", "--out", "proposal.json", "--review", "review.md", "--decisions", "decisions.json");
      const d = JSON.parse(await readFile(join(c, "decisions.json"), "utf8"));
      d.authority = NAME;
      d.rationale = "review.md okundu";
      for (const m of Object.keys(d.approve)) d.approve[m] = true;
      await writeFile(join(c, "decisions.json"), JSON.stringify(d));
      u(c, "b-commit", "--bundle", "bundle.json", "--brief", "brief.json", "--proposal", "proposal.json", "--decisions", "decisions.json", "--store", "../b-store", "--out", "strategy.json");
      u(c, "directive", "--bundle", "bundle.json", "--strategy", "strategy.json", "--out", "directive.json");
      expect(status(c)).toContain("p2-draft");

      // ── P2: the creative input, its example claim ids pointed at this research
      const research = JSON.parse(await readFile(join(c, "research.json"), "utf8"));
      const ids = ["VERIFIED", "INFERRED", "UNKNOWN"].map((s) => research.verifications.find((v: any) => v.status === s).claim_id);
      let p2 = await readFile(join(EX, "p2_input.example.json"), "utf8");
      P2_EXAMPLE_CLAIMS.forEach((cl, i) => (p2 = p2.split(cl).join(ids[i])));
      // the unsourced (UNKNOWN) claim may stay in a scene but not in the narration
      const p2obj = JSON.parse(p2);
      for (const l of p2obj.narration) if (l.claim_id === ids[2]) delete l.claim_id;
      p2 = JSON.stringify(p2obj, null, 2);
      await writeFile(join(c, "p2_input.json"), p2); // approvals still "<adınız>"
      const refused = spawnSync("node", [CLI, "p2-draft", "--input", "p2_input.json", "--research", "research.json", "--directive", "directive.json", "--out", "p2_draft.json"], { cwd: c, encoding: "utf8" });
      expect(refused.status).toBe(1);
      expect(refused.stderr).toContain("P2_APPROVAL_REQUIRED");
      expect(refused.stderr).toContain("→ Ne yapmalı");
      await writeFile(join(c, "p2_input.json"), p2.split("<adınız>").join(NAME));
      u(c, "p2-draft", "--input", "p2_input.json", "--research", "research.json", "--directive", "directive.json", "--out", "p2_draft.json", "--review", "p2_review.md");
      expect(status(c)).toContain("Gate A3 onayı bekliyor");
      u(c, "p2-approve", "--draft", "p2_draft.json", "--actor", NAME, "--review", "p2_review.md", "--out", "production_package.json");
      expect(status(c)).toContain("S09 P2 üretim paketi hazır");

      // ── P3: plan → the user's Google Flow files → ingest (A4)
      const plan = JSON.parse(u(c, "p3-plan", "--production", "production_package.json", "--dir", ".").stdout);
      expect(plan.expected.length).toBeGreaterThan(0);
      expect(await readFile(join(c, "assets_checklist.md"), "utf8")).toContain("npm run unified -- p3-ingest");
      for (const e of plan.expected) {
        const out = join(c, "assets", e.file_name);
        if (e.kind === "image") execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=0x8B5A2B:s=1080x1920", "-frames:v", "1", out]);
        else execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=0x1E6FB0:s=1080x1920:r=30", "-t", "3", "-c:v", "libx264", "-pix_fmt", "yuv420p", out]);
      }
      const noName = spawnSync("node", [CLI, "p3-ingest", "--production", "production_package.json", "--dir", ".", "--actor", "<adınız>"], { cwd: c, encoding: "utf8" });
      expect(noName.status).toBe(1);
      u(c, "p3-ingest", "--production", "production_package.json", "--dir", ".", "--actor", NAME);
      // the way users type it: `npm run unified -- …` from inside the cycle folder (npm runs from the
      // repo root; the CLI resolves paths from INIT_CWD). --prefix stands in for "repo above cwd".
      const viaNpm = spawnSync("npm", ["--prefix", resolve(__dirname, "../../.."), "run", "--silent", "unified", "--", "status", "--dir", "."], { cwd: c, encoding: "utf8", shell: process.platform === "win32" });
      expect(viaNpm.stdout).toContain("S10 P3 sürüyor");

      const st = status(c);
      expect(st).toContain("S10 P3 sürüyor");
      expect(st).toContain("p3-preview");
      expect(st).toContain("Zincir: SAĞLAM");

      // Optional: real offline preview with the installed Piper voice (npm run setup:voice).
      if (process.env.UNIFIED_REAL_PREVIEW === "1") {
        const pv = JSON.parse(u(c, "p3-preview", "--production", "production_package.json", "--dir", ".").stdout);
        expect(pv.provider).toBe("piper");
        u(c, "p3-approve-voice", "--production", "production_package.json", "--dir", ".", "--actor", NAME);
        expect(status(c)).toContain("p3-voice");
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 180_000);
});
