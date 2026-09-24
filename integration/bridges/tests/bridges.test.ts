import { describe, expect, it } from "vitest";
import { B00, B07, B08, B09 } from "b-branch-strategic-control-plane";
import { runB01 } from "../../../branches/b/src/b01/orchestration.js";
import { decideFormat, buildFormatDecisionMatrix } from "pipeline2-creative/dist/pipeline.js";
import {
  BridgeError,
  assertDirectiveMatchesResearch,
  buildCreativeDirective,
  signCommittedStrategy,
  buildFeedRequests,
  buildStrategyInputBundle,
  buildYouTubeImport,
  collectLearningIntelligence,
  prepareObservationReview,
  toP2FormatInput,
  toP2Memory,
  toP2UserGoals,
  UNIFIED_CYCLE,
  verifyEnvelope,
  type LearningFeed,
} from "../src/index.js";
import { AT, OWNER, committedStrategy, finalDeliveryFor, productionPackageFor, runRealP1 } from "./helpers.js";

const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return e instanceof BridgeError ? e.code : `NON_BRIDGE:${(e as Error).message}`;
  }
  return "NO_ERROR";
};

async function directiveFixture(opts: Parameters<typeof committedStrategy>[0] = {}) {
  const research = await runRealP1();
  const bundle = buildStrategyInputBundle(research, { brand: { brand_name: "History Vertical" }, now: () => AT });
  const { branch, states, uncommitted } = await committedStrategy(opts);
  return { research, bundle, branch, states, uncommitted };
}

describe("Bridge 1 — P1 -> B", () => {
  it("accepts a real, Gate-A1-approved P1 package and produces a sealed bundle that real B01 runs on", async () => {
    const research = await runRealP1();
    const bundle = buildStrategyInputBundle(research, { brand: { brand_name: "History Vertical" }, now: () => AT });
    verifyEnvelope("t", bundle, "UNIFIED_STRATEGY_INPUT_BUNDLE");
    expect(bundle.lineage.research_package_sha256).toBe(research.integrity_hashes.package_sha256);
    expect(bundle.lineage.verified_claim_ids).toHaveLength(1);
    expect(bundle.lineage.unknown_claim_ids).toHaveLength(1);
    expect(bundle.b01_input.known_channels?.[0]?.name).toBe("History Vertical");
    expect(bundle.b01_input.known_channels?.[0]?.source).toBe("p1:research_scope.target_context.channel");
    const digest = bundle.b03_audience_sources.documentation?.market_research ?? "";
    expect(digest).toContain("[VERIFIED]");
    expect(digest).toContain("NOT audience measurement");
    expect(digest).toContain("[INFERRED — not independently cross-checked]");
    // The UNKNOWN claim is never presented as a finding.
    expect(digest).not.toContain("[VERIFIED] (people)");
    const candidate = await runB01(bundle.b01_input);
    expect(candidate.candidate_id).toBeTruthy();
  });

  it("rejects a tampered research package and one without Gate A1", async () => {
    const research = await runRealP1();
    const tampered = structuredClone(research);
    tampered.claims[0].statement = "Rewritten after approval";
    expect(code(() => buildStrategyInputBundle(tampered))).toBe("RESEARCH_PACKAGE_REJECTED");
    const noGate = structuredClone(research);
    noGate.gates = noGate.gates.filter((g: any) => g.state_after !== "PACKAGE_APPROVED");
    expect(code(() => buildStrategyInputBundle(noGate))).toBe("RESEARCH_PACKAGE_REJECTED");
  });

  it("detects a tampered bundle envelope", async () => {
    const research = await runRealP1();
    const bundle = buildStrategyInputBundle(research, { now: () => AT });
    const forged = { ...bundle, b01_input: { ...bundle.b01_input, user_input: "forged" } };
    expect(code(() => verifyEnvelope("t", forged, "UNIFIED_STRATEGY_INPUT_BUNDLE"))).toBe("ENVELOPE_TAMPERED");
  });
});

describe("Bridge 2 — committed B strategy -> P2", () => {
  it("builds a sealed directive from a committed B12 snapshot and feeds real P2 entry points", async () => {
    const { research, bundle, branch, states } = await directiveFixture({ withB10: true });
    const d = buildCreativeDirective(bundle, signCommittedStrategy({ branch, b05: states.b05, b06: states.b06, b07: states.b07, b11: states.b11, b10: states.b10 }), { now: () => AT });
    verifyEnvelope("t", d, "UNIFIED_CREATIVE_DIRECTIVE");
    expect(d.branch_state.committed_by).toBe(OWNER);
    expect(d.channel.channel_id).toBe("ch_yt_main");
    expect(d.format.aspect_ratio).toBe("9:16");
    expect(d.kpis.map((k) => k.kpi_id)).toEqual(["kpi_views_7d"]);
    expect(d.compliance.unresolved).toHaveLength(1);
    assertDirectiveMatchesResearch(d, research);

    const goals = toP2UserGoals(d);
    expect(goals.some((g) => g.startsWith("[HEURISTIC — not evidence-backed]"))).toBe(true);
    expect(goals).toContain("Angle \"Owner-chosen hook\": Start with the 312 BC date (tone: narrative)");

    const { format, constraints } = toP2FormatInput(d);
    const decision = decideFormat(format, constraints);
    expect(decision.constraints).toContain("Aspect ratio 9:16 (vertical delivery standard)");
    expect(buildFormatDecisionMatrix("fd_1", decision.format, decision.constraints).chain).toHaveLength(10);

    const memory = toP2Memory(d);
    const avoid = memory.find((m) => m.bucket === "AVOID_MEMORY");
    expect(avoid?.locked).toBe(true);
    expect(memory.find((m) => m.bucket === "CAMPAIGN_MEMORY")?.content).toContain("Open with the arches visual");
  });

  it("strict mode drops heuristic goals instead of labelling them", async () => {
    const { bundle, branch, states } = await directiveFixture();
    const d = buildCreativeDirective(bundle, signCommittedStrategy({ branch, ...states } as any), { include_heuristics: false, now: () => AT });
    expect(d.user_goals.every((g) => g.basis !== "HEURISTIC")).toBe(true);
  });

  it("refuses an uncommitted branch, a swapped module state and B11 NON_COMPLIANT", async () => {
    const { bundle, branch, states, uncommitted } = await directiveFixture();
    const strat = { branch, b05: states.b05, b06: states.b06, b07: states.b07, b11: states.b11 };
    expect(code(() => buildCreativeDirective(bundle, signCommittedStrategy({ ...strat, branch: JSON.parse(JSON.stringify(uncommitted)) })))).toBe("BRANCH_NOT_COMMITTED");

    const swapped = structuredClone(states.b05);
    swapped.creative_briefs[0].content_objectives = ["Something the owner never approved"];
    swapped.identity = B00.createCanonicalIdentity({ ...swapped.identity, artifact: swapped });
    expect(code(() => buildCreativeDirective(bundle, signCommittedStrategy({ ...strat, b05: swapped })))).toBe("MODULE_BRANCH_MISMATCH");

    const edited = structuredClone(states.b06);
    edited.format_rules[0].duration_category = "long";
    expect(code(() => buildCreativeDirective(bundle, signCommittedStrategy({ ...strat, b06: edited })))).toBe("MODULE_STATE_TAMPERED");

    const blocked = await committedStrategy({ nonCompliant: true });
    expect(code(() => buildCreativeDirective(bundle, signCommittedStrategy({ branch: blocked.branch, b05: blocked.states.b05, b06: blocked.states.b06, b07: blocked.states.b07, b11: blocked.states.b11 })))).toBe("COMPLIANCE_BLOCKED");
  });

  it("refuses to let P2 use a directive built for a different research package", async () => {
    const { bundle, branch, states } = await directiveFixture();
    const d = buildCreativeDirective(bundle, signCommittedStrategy({ branch, b05: states.b05, b06: states.b06, b07: states.b07, b11: states.b11 }), { now: () => AT });
    const other = await runRealP1("Who maintained the aqueducts?");
    expect(other.integrity_hashes.package_sha256).not.toBe(d.lineage.research_package_sha256);
    expect(code(() => assertDirectiveMatchesResearch(d, other))).toBe("DIRECTIVE_RESEARCH_MISMATCH");
  });
});

describe("Bridge 3 — P3 final delivery -> YouTube agent", () => {
  it("imports only a Gate-A7, integrity-verified delivery and maps provenance fail-closed", async () => {
    const { research, bundle, branch, states } = await directiveFixture();
    const d = buildCreativeDirective(bundle, signCommittedStrategy({ branch, b05: states.b05, b06: states.b06, b07: states.b07, b11: states.b11 }), { now: () => AT });
    const pp = productionPackageFor(research);
    const fd = finalDeliveryFor(pp);
    const yip = buildYouTubeImport({ finalDelivery: fd, productionPackage: pp, researchPackage: research, directive: d, options: { now: () => AT } });
    verifyEnvelope("t", yip, "UNIFIED_YOUTUBE_IMPORT");

    expect(yip.final_delivery.video_path).toBe("/renders/final_master.mp4");
    expect(yip.publishing_hints.content_type).toBe("short");
    expect(yip.publishing_hints.privacy_status).toBe("private");
    expect(yip.script_text.length).toBeGreaterThanOrEqual(200);
    expect(yip.seo_draft.description.length).toBeGreaterThanOrEqual(50);
    // VERIFIED + URL-backed claim => supported; INFERRED => pending (blocks until a human resolves it)
    const statuses = yip.provenance.claims.map((c) => c.status).sort();
    expect(statuses).toEqual(["pending", "supported"]);
    expect(yip.provenance.sources.filter((s) => s.status === "verified")).toHaveLength(1);
    expect(yip.open_human_gates).toContain("YT:evidence_desk_pending_claims(1)");
    expect(yip.open_human_gates).toContain("YT:media_rights_attestation");
    expect(yip.scenes.every((s) => s.locked && s.rightsConfirmed === false)).toBe(true);
    expect(yip.scenes[0]!.duration).toBeCloseTo(1926 / 30, 1);
  });

  it("rejects a delivery without Gate A7, a tampered delivery and a broken lineage", async () => {
    const { research, bundle, branch, states } = await directiveFixture();
    const d = buildCreativeDirective(bundle, signCommittedStrategy({ branch, b05: states.b05, b06: states.b06, b07: states.b07, b11: states.b11 }), { now: () => AT });
    const pp = productionPackageFor(research);
    const fd = finalDeliveryFor(pp);

    const noA7 = structuredClone(fd);
    noA7.gates = [];
    expect(code(() => buildYouTubeImport({ finalDelivery: noA7, productionPackage: pp, researchPackage: research, directive: d }))).toBe("GATE_A7_MISSING");

    const swappedVideo = structuredClone(fd);
    swappedVideo.render.outputs[0].path = "/tmp/some_other_video.mp4";
    expect(code(() => buildYouTubeImport({ finalDelivery: swappedVideo, productionPackage: pp, researchPackage: research, directive: d }))).toBe("FINAL_DELIVERY_TAMPERED");

    const otherResearch = await runRealP1();
    otherResearch.handoff_notes = "changed";
    expect(code(() => buildYouTubeImport({ finalDelivery: fd, productionPackage: pp, researchPackage: otherResearch, directive: d }))).toBe("RESEARCH_PACKAGE_REJECTED");
  });
});

describe("Bridge 4 — YouTube learning feed -> B08 -> B07 / B09", () => {
  const feed: LearningFeed = {
    feed_type: "YOUTUBE_AGENT_LEARNING_FEED",
    schema_version: "unified-1.0.0",
    exported_at: "2026-09-28T09:00:00.000Z",
    exporter: "youtube-agent@2.10.0",
    channel_id: "ch_yt_main",
    project_id: "proj_x",
    snapshots: [
      { video_id: "abcDEF12345", production_id: "up_1", measurement_window: "7d", published_at: "2026-09-20T15:00:00.000Z", measured_at: "2026-09-27T16:00:00.000Z", simulated: false, metrics: { views: 6120, ctr: 5.1, retention: 61.5 } },
      { video_id: "simVID00001", production_id: "up_2", measurement_window: "7d", published_at: "2026-09-20T15:00:00.000Z", measured_at: "2026-09-27T16:00:00.000Z", simulated: true, metrics: { views: 999999 } },
    ],
    engagement: [{ video_id: "abcDEF12345", production_id: "up_1", analyzed_at: "2026-09-27T12:00:00.000Z", comment_count: 42, themes: [{ theme: "Viewers ask for a video on the Aqua Claudia", count: 7 }], analysis_method: "ai" }],
  };
  const bindings = [{ kpi_id: "kpi_views_7d", youtube_metric: "views", unit: "views", measurement_window: "7d" }];

  it("never plans a request for simulated analytics", () => {
    const reqs = buildFeedRequests(feed, bindings);
    expect(reqs.map((r) => r.query)).toEqual(["yt-perf:abcDEF12345:kpi_views_7d", "yt-comments:abcDEF12345"]);
  });

  it("routes real YouTube numbers through B08 and sets a B07 actual only after an independent review", async () => {
    const intel = await collectLearningIntelligence(feed, bindings, { now: () => "2026-09-28T09:00:00.000Z" });
    expect(intel.results.every((r) => B08.validateExternalResult(r))).toBe(true);
    const perf = B08.externalObservations(intel, ["PerformanceObservation"], "ch_yt_main");
    expect(perf).toHaveLength(1);
    expect(perf[0]!.measurement?.value).toBe(6120);
    expect(perf[0]!.evidence_refs[0]!.status).toBe("UNKNOWN"); // retrieval never becomes VERIFIED by itself

    const b04: any = { candidate_id: "b04", campaigns: [{ campaign_id: "cmp1", campaign_name: "Unified", primary_objective: "Growth" }] };
    const b06: any = { candidate_id: "b06", distribution_strategies: [{ campaign_id: "cmp1", channel_selections: [{ channel_id: "ch_yt_main", channel_name: "YouTube" }] }] };
    const base = await B07.runB07(b04, b06);
    const kpi = base.kpi_definitions[0]!;
    const boundFeed = { ...feed, snapshots: feed.snapshots.map((s) => s) };
    const boundIntel = await collectLearningIntelligence(boundFeed, [{ ...bindings[0]!, kpi_id: kpi.kpi_id, unit: kpi.target_definition.unit }], { now: () => "2026-09-28T09:00:00.000Z" });
    const unreviewed = await B07.runB07(b04, b06, { external_intelligence: boundIntel });
    expect(unreviewed.kpi_definitions[0]!.actual_metric_value).toBeUndefined();

    const obs = B08.externalObservations(boundIntel, ["PerformanceObservation"], "ch_yt_main")[0]!;
    const review = prepareObservationReview(obs, {
      authority: OWNER,
      reviewed_at: "2026-09-28T10:00:00.000Z",
      confirmation_evidence: [{ id: "studio-export-2026-09-28", source: "youtube-studio:export:abcDEF12345", status: "VERIFIED", origin: "PROVIDER_DATA", basis: "OBSERVED", source_mode: "REAL", production_eligible: true }],
    });
    const measured = await B07.runB07(b04, b06, { external_intelligence: { ...boundIntel, reviews: [review] } });
    expect(measured.kpi_definitions[0]!.actual_metric_value).toBe(6120);
  });

  it("refuses a review whose confirmation is just the retrieval evidence or not VERIFIED", async () => {
    const intel = await collectLearningIntelligence(feed, bindings, { now: () => "2026-09-28T09:00:00.000Z" });
    const obs = B08.externalObservations(intel, ["PerformanceObservation"], "ch_yt_main")[0]!;
    expect(code(() => prepareObservationReview(obs, { authority: OWNER, reviewed_at: AT, confirmation_evidence: [obs.evidence_refs[0]!] }))).toBe("CONFIRMATION_NOT_VERIFIED");
    expect(code(() => prepareObservationReview(obs, { authority: OWNER, reviewed_at: AT, confirmation_evidence: [{ id: "x", source: "me", status: "VERIFIED", origin: "USER_ASSERTION", basis: "ASSERTED", source_mode: "REAL" }] }))).toBe("CONFIRMATION_NOT_VERIFIED");
  });

  it("feeds reviewed comment themes to B09 as neutral observations", async () => {
    const intel = await collectLearningIntelligence(feed, bindings, { now: () => "2026-09-28T09:00:00.000Z" });
    const community = B08.externalObservations(intel, ["CommunityObservation"], "ch_yt_main");
    expect(community).toHaveLength(1);
    expect(community[0]!.statement).toContain("not measured audience demographics");
    expect(typeof B09.runB09).toBe("function");
  });

  it("refuses requests for another channel or project (fail closed, no evidence)", async () => {
    const { YouTubeFeedTransport } = await import("../src/youtubeToB.js");
    const adapter = new B08.AgentReachAdapter(new YouTubeFeedTransport(feed, bindings, () => AT), 20000, () => AT);
    const req = buildFeedRequests(feed, bindings)[0]!;
    const wrongChannel = await adapter.retrieve({ ...req, channel_id: "someone_else" });
    expect(wrongChannel.status).toBe("FAILED");
    expect(wrongChannel.evidence).toHaveLength(0);
    const wrongProject = await adapter.retrieve({ ...req, project_id: "other_project" });
    expect(wrongProject.status).toBe("FAILED");
  });
});

describe("Unified cycle definition", () => {
  it("has every bridge between the owning systems and a human gate before each irreversible hop", () => {
    const ids = UNIFIED_CYCLE.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const order = UNIFIED_CYCLE.map((s) => s.owner).join(">");
    expect(order).toBe("A-P1>BRIDGE>B>B>B>B>B>BRIDGE>A-P2>A-P3>A-P3>BRIDGE>YT>YT>YT>BRIDGE>B");
    for (const s of UNIFIED_CYCLE.filter((x) => x.id === "S01" || x.id === "S07" || x.id === "S10" || x.id === "S12")) expect(s.human_gate).toBeTruthy();
  });
});
