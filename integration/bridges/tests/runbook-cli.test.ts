// RUNBOOK smoke test: the documented CLI commands, in order, with the example
// brief from docs/examples — exactly what a user types. Only the human steps
// (filling decisions.json) are done by the test, with an explicit test name.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { productionPackageFor, finalDeliveryFor, runRealP1 } from "./helpers.js";

const CLI = resolve(__dirname, "../dist/cli.js");
const EXAMPLES = resolve(__dirname, "../../../docs/examples");

function unified(cwd: string, ...args: string[]) {
  const r = spawnSync("node", [CLI, ...args], { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`unified ${args[0]} exited ${r.status}\n${r.stderr}`);
  return r;
}

describe("RUNBOOK commands, end to end through the real CLI", () => {
  it("research → bundle → propose → (human) decisions → commit → directive → p2-inputs → to-youtube → status SAĞLAM", async () => {
    const root = await mkdtemp(join(tmpdir(), "runbook-"));
    const cyc = join(root, "cycle-001");
    try {
      await mkdir(cyc, { recursive: true });
      const research = await runRealP1();
      await writeFile(join(cyc, "research.json"), JSON.stringify(research));
      await copyFile(join(EXAMPLES, "brief.example.json"), join(cyc, "brief.json"));

      unified(cyc, "research-to-strategy", "--research", "research.json", "--out", "bundle.json");
      unified(cyc, "b-propose", "--bundle", "bundle.json", "--brief", "brief.json", "--store", "../b-store", "--out", "proposal.json", "--review", "review.md", "--decisions", "decisions.json");
      expect(await readFile(join(cyc, "review.md"), "utf8")).toContain("Proposal hash");

      // status before the human decision: waiting at the proposal
      const waiting = spawnSync("node", [CLI, "status", "--dir", cyc], { encoding: "utf8" });
      expect(waiting.status).toBe(0);
      expect(waiting.stdout).toContain("S03–S06");

      // committing the untouched template must be refused (no named authority)
      const refused = spawnSync("node", [CLI, "b-commit", "--bundle", "bundle.json", "--brief", "brief.json", "--proposal", "proposal.json", "--decisions", "decisions.json", "--store", "../b-store", "--out", "strategy.json"], { cwd: cyc, encoding: "utf8" });
      expect(refused.status).toBe(1);
      expect(refused.stderr).toMatch(/AUTHORITY_REQUIRED|MODULES_NOT_APPROVED/);

      // the human step: the owner fills decisions.json
      const decisions = JSON.parse(await readFile(join(cyc, "decisions.json"), "utf8"));
      decisions.authority = "Test Owner (runbook smoke test)";
      decisions.rationale = "reviewed review.md";
      for (const m of Object.keys(decisions.approve)) decisions.approve[m] = true;
      await writeFile(join(cyc, "decisions.json"), JSON.stringify(decisions));

      unified(cyc, "b-commit", "--bundle", "bundle.json", "--brief", "brief.json", "--proposal", "proposal.json", "--decisions", "decisions.json", "--store", "../b-store", "--out", "strategy.json");
      unified(cyc, "directive", "--bundle", "bundle.json", "--strategy", "strategy.json", "--out", "directive.json");
      unified(cyc, "p2-inputs", "--directive", "directive.json", "--research", "research.json", "--out", "p2-inputs.json");
      for (const f of ["bundle.json", "proposal.json", "directive.json"]) unified(cyc, "verify", "--file", f);

      // P2/P3 run outside the CLI; their sealed outputs are dropped in
      const pp = productionPackageFor(research);
      await writeFile(join(cyc, "production_package.json"), JSON.stringify(pp));
      await writeFile(join(cyc, "final_delivery.json"), JSON.stringify(finalDeliveryFor(pp)));
      unified(cyc, "to-youtube", "--final", "final_delivery.json", "--production", "production_package.json", "--research", "research.json", "--directive", "directive.json", "--external-p3", "--out", "youtube_import.json");
      unified(cyc, "verify", "--file", "youtube_import.json");

      const done = spawnSync("node", [CLI, "status", "--dir", cyc], { encoding: "utf8" });
      expect(done.stdout).toContain("Zincir: SAĞLAM");
      expect(done.stdout).toContain("S11");
      expect(done.status).toBe(0);

      // second cycle in its own folder: the shared store moves to v1.1
      const cyc2 = join(root, "cycle-002");
      await mkdir(cyc2, { recursive: true });
      for (const f of ["research.json", "brief.json", "bundle.json"]) await copyFile(join(cyc, f), join(cyc2, f));
      unified(cyc2, "b-propose", "--bundle", "bundle.json", "--brief", "brief.json", "--store", "../b-store", "--out", "proposal.json");
      expect(JSON.parse(await readFile(join(cyc2, "proposal.json"), "utf8")).version).toBe("v1.1");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 60_000);
});
