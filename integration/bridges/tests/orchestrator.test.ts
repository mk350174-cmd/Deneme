// B orchestrator — runs the REAL B01→B11 chain + B12 commit (no fixtures on the B side).
import { describe, expect, it } from "vitest";
import {
  BridgeError,
  buildCreativeDirective,
  buildStrategyInputBundle,
  commitStrategy,
  decisionsTemplate,
  proposalMarkdown,
  proposeStrategy,
  toP2UserGoals,
  memoryPersistence,
  B_MODULES,
  type StrategyBrief,
} from "../src/index.js";
import { AT, runRealP1 } from "./helpers.js";

const BRIEF: StrategyBrief = {
  brief_type: "OWNER_STRATEGY_BRIEF",
  brand: { brand_name: "History Vertical", positioning: "Source-based vertical documentaries about women of the Eurasian steppe" },
  channels: [{ channel_id: "ch_yt_main", name: "History Vertical", platform: "YouTube", audience_category: "niche", url: "https://www.youtube.com/@historyvertical" }],
  documentation: { channel_policies: "Published for viewers in Europe and Asia; Turkish and English narration." },
  audience: {
    platform_analytics: [{ platform_id: "youtube", channel_id: "ch_yt_main", demographic_data: "25-44, history enthusiasts", geography: ["TR", "DE"], interests: ["history", "documentary"], source: "YouTube Analytics", verified_at: "2026-09-01T00:00:00Z" }],
  },
  owner_goals: ["Open with the strongest primary-source detail in the first 3 seconds"],
  owner_constraints: ["Every dated claim must come from a VERIFIED P1 claim"],
};

async function setup() {
  const research = await runRealP1();
  const bundle = buildStrategyInputBundle(research, { now: () => AT });
  return { research, bundle };
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "NO_ERROR";
  } catch (e) {
    return e instanceof BridgeError ? e.code : `NON_BRIDGE:${(e as Error).message}`;
  }
};

describe("B orchestrator (real B01→B12)", () => {
  it("proposes, commits after owner approval, and the result drives a directive", async () => {
    const { research, bundle } = await setup();
    const proposal = await proposeStrategy(bundle, BRIEF, { now: () => AT });
    expect(proposal.readiness.ready).toBe(true);
    expect(proposal.modules.b05.counts.angles).toBeGreaterThan(0);
    expect(proposal.modules.b07.counts.kpis).toBeGreaterThan(0);
    const md = proposalMarkdown(proposal, BRIEF);
    expect(md).toContain("onaya hazır");

    const decisions = { ...decisionsTemplate(proposal), authority: "channel-owner:mk350174", rationale: "Approve cycle 1 strategy", approve: Object.fromEntries(B_MODULES.map((m) => [m, true])) };
    const store = Object.fromEntries([...B_MODULES, "b12"].map((m) => [m, memoryPersistence()])) as any;
    const committed = await commitStrategy(bundle, BRIEF, proposal, decisions, { now: () => AT, store });

    expect(committed.branch.cannot_be_modified_until_next_version).toBe(true);
    expect(committed.branch.module_versions.every((v: any) => v.identity_status === "VERIFIED")).toBe(true);
    // Downstream modules were built from canonical parents: no lineage mismatch.
    expect((committed.branch.completeness_summary as any).semantic_findings.some((f: string) => f.includes("PARENT_IDENTITY_MISMATCH"))).toBe(false);
    expect(await store.b05.latest()).not.toBeNull();
    expect(await store.b12.latest()).not.toBeNull();

    const d = buildCreativeDirective(bundle, committed, { now: () => AT });
    const goals = toP2UserGoals(d);
    expect(goals[0]).toBe("Open with the strongest primary-source detail in the first 3 seconds");
    // B's generic campaign text is not presented as a human decision.
    expect(d.user_goals.filter((g) => g.source_ref.startsWith("B05:brief:")).every((g) => g.basis === "TEMPLATE")).toBe(true);
    expect(d.format.constraints.some((c) => c.text === "Every dated claim must come from a VERIFIED P1 claim" && c.basis === "USER_DEFINED")).toBe(true);
    expect(d.lineage.research_package_id).toBe(research.package_id);

    // strict mode keeps only USER_DEFINED / HUMAN_DECIDED / EVIDENCE_BACKED goals
    const strict = buildCreativeDirective(bundle, committed, { include_heuristics: false, now: () => AT });
    expect(strict.user_goals.map((g) => g.basis)).toEqual(["USER_DEFINED"]);
  });

  it("an empty strategy is reported with B's own gaps and cannot be committed", async () => {
    const { bundle } = await setup();
    const thin: StrategyBrief = { brief_type: "OWNER_STRATEGY_BRIEF", brand: { brand_name: "X" }, channels: [{ channel_id: "c1", name: "X", platform: "YouTube" }] };
    const proposal = await proposeStrategy(bundle, thin, { now: () => AT });
    expect(proposal.readiness.ready).toBe(false);
    expect(proposal.readiness.blockers.join(" ")).toContain("B02 produced no opportunities");
    const decisions = { ...decisionsTemplate(proposal), authority: "owner", rationale: "try", approve: Object.fromEntries(B_MODULES.map((m) => [m, true])) };
    expect(await code(commitStrategy(bundle, thin, proposal, decisions))).toBe("STRATEGY_NOT_READY");
  });

  it("refuses unapproved modules, anonymous approval, and inputs changed after review", async () => {
    const { bundle } = await setup();
    const proposal = await proposeStrategy(bundle, BRIEF, { now: () => AT });
    const all = Object.fromEntries(B_MODULES.map((m) => [m, true]));
    const ok = { ...decisionsTemplate(proposal), authority: "owner", rationale: "r", approve: all };
    expect(await code(commitStrategy(bundle, BRIEF, proposal, { ...ok, approve: { ...all, b05: false } }))).toBe("MODULES_NOT_APPROVED");
    expect(await code(commitStrategy(bundle, BRIEF, proposal, { ...ok, authority: "<your name>" }))).toBe("AUTHORITY_REQUIRED");
    expect(await code(commitStrategy(bundle, { ...BRIEF, owner_goals: ["changed"] }, proposal, ok))).toBe("INPUT_CHANGED");
    const forged = { ...proposal, readiness: { ...proposal.readiness, ready: true, blockers: [] }, modules: { ...proposal.modules, b05: { ...proposal.modules.b05, fingerprint: "0".repeat(64) } } };
    expect(await code(commitStrategy(bundle, BRIEF, forged as any, { ...ok, proposal_hash: proposal.identity.content_hash }))).toBe("ENVELOPE_TAMPERED");
  });
});

describe("strategy fingerprint", () => {
  it("ignores who/when but not what", async () => {
    const { strategyFingerprint } = await import("../src/index.js");
    const a = { version: "v1.0", created_at: "t1", user_decision_authority: "PREVIEW", creative_angles: [{ title: "A", core_message: "m", provenance: { timestamp: "t1" } }] };
    const b = { ...a, created_at: "t2", user_decision_authority: "owner", creative_angles: [{ title: "A", core_message: "m", provenance: { timestamp: "t9" } }] };
    const c = { ...a, creative_angles: [{ title: "A", core_message: "different", provenance: { timestamp: "t1" } }] };
    expect(strategyFingerprint(a)).toBe(strategyFingerprint(b));
    expect(strategyFingerprint(a)).not.toBe(strategyFingerprint(c));
  });

  it("second cycle commits v1.1 on top of the stored v1.0", async () => {
    const { bundle } = await setup();
    const store = Object.fromEntries([...B_MODULES, "b12"].map((m) => [m, memoryPersistence()])) as any;
    const approve = Object.fromEntries(B_MODULES.map((m) => [m, true]));
    const p1 = await proposeStrategy(bundle, BRIEF, { now: () => AT, store });
    await commitStrategy(bundle, BRIEF, p1, { ...decisionsTemplate(p1), authority: "owner", rationale: "c1", approve }, { now: () => AT, store });
    const p2 = await proposeStrategy(bundle, BRIEF, { now: () => AT, store });
    expect(p2.version).toBe("v1.1");
    const c2 = await commitStrategy(bundle, BRIEF, p2, { ...decisionsTemplate(p2), authority: "owner", rationale: "c2", approve }, { now: () => AT, store });
    expect(c2.b05.version).toBe("v1.1");
    expect(await code(commitStrategy(bundle, BRIEF, p2, { ...decisionsTemplate(p2), authority: "owner", rationale: "again", approve }, { store }))).toBe("STORE_CHANGED");
  });
});
