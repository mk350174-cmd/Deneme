// Test helpers for the unified bridges.
//
// HONESTY NOTE — what is real and what is fixture here:
//   * P1: REAL pipeline1-research code (runP101..approvePackage) with the
//     deterministic ManualResearchEngine (no network) — same pattern as P1's
//     own golden test.
//   * P2 production package: P3's committed, sealed fixture, re-pointed at
//     the real P1 package (research ref/hash/voice_lines) and RE-SEALED with
//     P3's own sealer — exactly the fields P2.11 sets.
//   * P3 final delivery: REAL approveFinalQA (Gate A7) and REAL
//     assembleFinalDeliveryPackage (manifest/integrity); render/QA/narration
//     section contents are fixture values (no Remotion/ElevenLabs call).
//   * B: canonical module states are constructed with B00's REAL identity
//     authority (same technique as B's own verification/integration-fixture),
//     aggregated by the REAL B12 createBranchState and committed with the
//     REAL commitBranchState.

import { B00, B12 } from "b-branch-strategic-control-plane";
import {
  approvePackage,
  approveScope,
  draftHandoff,
  runP101Input,
  runP102ProposeScope,
  runP103DomainResearch,
  runP104Verification,
  runP105And106Synthesis,
} from "pipeline1-research/dist/pipeline.js";
import { ManualResearchEngine } from "pipeline1-research/dist/researchEngine.js";
import { approveFinalQA, assembleFinalDeliveryPackage } from "pipeline3-production/dist/pipeline.js";
import { PRODUCTION_PACKAGE_FIXTURE, sealProductionPackage } from "../../../branches/a/pipeline3_production/tests/fixtures/production_package.fixture.js";

export const AT = "2026-09-20T10:00:00.000Z";
export const OWNER = "channel-owner:mk350174";
export const TOPIC = "The Roman Aqueducts";

// ---------------------------------------------------------------- P1 (real)

export async function runRealP1(question = "How was Rome supplied with water?"): Promise<any> {
  const src = (origin: string) => ({ source_id: "", origin, source_type: "secondary" as const, retrieved_at: AT, access_method: "manual_entry" });
  const engine = new ManualResearchEngine({
    topic: TOPIC,
    findings: {
      "the roman aqueducts::facts::construction_history": [
        { statement: "The Aqua Appia, Rome's first aqueduct, was completed in 312 BC.", dimension: "facts", derived_from: "construction_history", source: src("https://example.org/frontinus-de-aquaeductu"), excerpt_or_pointer: "Frontinus records the Aqua Appia's completion in 312 BC.", extraction_method: "manual_entry" },
      ],
      "the roman aqueducts::quantitative::total_length": [
        { statement: "Rome's aqueduct network eventually exceeded 400 km in total length.", dimension: "quantitative", derived_from: "total_length", source: src("https://example.org/aqueduct-survey"), excerpt_or_pointer: "Combined length exceeds 400 km.", extraction_method: "manual_entry" },
      ],
      "the roman aqueducts::people::original_architect": [
        { statement: "The original architect of the first Aqua Appia is not reliably attested.", dimension: "people", derived_from: "original_architect", source: src("unknown"), excerpt_or_pointer: "", extraction_method: "manual_entry", unresolved_reason: "No surviving primary source names the architect." },
      ],
    },
    verifications: {
      "the aqua appia, rome's first aqueduct, was completed in 312 bc.": { status: "VERIFIED", rationale: "Cross-checked against two independent editions (fixture)." },
    },
  });
  const request = runP101Input({ topic: TOPIC, question, constraints: ["engineering focus"], target_context: { channel: "History Vertical" }, output_language: "en" } as any);
  const { scope, gate } = approveScope(runP102ProposeScope(request), OWNER);
  const { sources, evidence, claims } = await runP103DomainResearch(engine, scope, [
    { query: "construction_history", dimension: "facts" },
    { query: "total_length", dimension: "quantitative" },
    { query: "original_architect", dimension: "people" },
  ]);
  const { verifications } = await runP104Verification(engine, claims);
  const { knowledge_package, unresolved_questions } = runP105And106Synthesis(claims, verifications);
  const draft = draftHandoff({ approvedScope: scope, sources, evidence, claims, verifications, knowledge_package, unresolved_questions, gates: [gate], handoff_notes: "Unified pipeline bridge test run." });
  return JSON.parse(JSON.stringify(approvePackage(draft, OWNER).handoff));
}

// ------------------------------------------------------ P2 package (fixture re-pointed)

export function productionPackageFor(research: any): any {
  const claimIds: string[] = research.claims.map((c: any) => c.claim_id);
  const verified = research.verifications.find((v: any) => v.status === "VERIFIED").claim_id;
  const inferred = research.verifications.find((v: any) => v.status === "INFERRED").claim_id;
  const { manifest: _m, integrity_hashes: _i, ...content } = PRODUCTION_PACKAGE_FIXTURE as any;
  expect(claimIds.length).toBeGreaterThan(0);
  return sealProductionPackage({
    ...content,
    project_id: research.project_id,
    research_package_ref: research.package_id,
    research_package_content_hash: research.integrity_hashes.package_sha256,
    voice_script:
      "The Aqua Appia, Rome's first aqueduct, was completed in 312 BC. Over the following centuries the city kept adding new lines, " +
      "and the network eventually stretched for hundreds of kilometres, carrying water across valleys on arches of stone. " +
      "Water flowed steadily through the stone channel by gravity alone.",
    voice_lines: [
      { line_id: "vl_1", claim_id: verified, text: "The Aqua Appia, Rome's first aqueduct, was completed in 312 BC." },
      { line_id: "vl_2", claim_id: inferred, text: "The network eventually stretched for hundreds of kilometres." },
      { line_id: "vl_3", text: "Water flowed steadily through the stone channel by gravity alone." },
    ],
    pronunciation_flags: [],
  });
}

// ------------------------------------------------------ P3 final delivery (real gate + assembly)

export function finalDeliveryFor(pp: any, files: { videoPath?: string; videoSha?: string; audioPath?: string; audioSha?: string } = {}): any {
  const videoPath = files.videoPath ?? "/renders/final_master.mp4";
  const render = { run_id: "render_run_0001", scope: "master", target_id: pp.package_id, fps: 30, resolution: "1080x1920", codec: "h264", outputs: [{ path: videoPath, sha256: files.videoSha ?? "a".repeat(64), bytes: 4_200_000 }], result: "success" };
  const qa = { report_id: "qa_0001", scope: "master", target_id: pp.package_id, result: "pass", findings: [], human_review_required: false, production_package_id: pp.package_id, production_package_version: pp.production_package_version, production_package_hash: pp.integrity_hashes.package_sha256, render_run_id: render.run_id, render_output_sha256: render.outputs[0]!.sha256 };
  const a7 = approveFinalQA(OWNER, qa as any, render as any, []);
  return JSON.parse(
    JSON.stringify(
      assembleFinalDeliveryPackage({
        pkg: pp,
        resolvedAssets: [
          { asset_requirement_id: "astreq_wide_arch", shot_id: "shot_wide_arch", asset_file_id: "file_wide_arch_001", hash: "b".repeat(64), media_properties: {} },
          { asset_requirement_id: "astreq_water_flow", shot_id: "shot_water_flow", asset_file_id: "file_water_flow_001", hash: "c".repeat(64), media_properties: {} },
        ],
        narration: {
          piper_preview: { output_path: "preview.wav", measured_duration_s: 6, target_duration_s: 6, within_tolerance: true } as any,
          production_voice: { audio_path: files.audioPath ?? "/renders/narration.wav", audio_hash: files.audioSha ?? "d".repeat(64), duration_s: 64.2, character_count: 300, cost_units: 300, listen_check_word_ratio: 0.97, listen_check_attempts: 1, provider: "elevenlabs" } as any,
        },
        timing: { actual_narration_duration_s: 64.2, intended_total_duration_s: 60, shot_timings: [], conflicts: [] },
        timeline: { fps: 30, total_frames: 1926, entries: [
          { shot_id: "shot_wide_arch", asset_file_id: "file_wide_arch_001", start_frame: 0, duration_frames: 1100 },
          { shot_id: "shot_water_flow", asset_file_id: "file_water_flow_001", start_frame: 1100, duration_frames: 826 },
        ] },
        render: render as any,
        qa: qa as any,
        kaggle: { final_video_id: "fv_0001", kaggle_dataset_id: "user/fv-0001", created_at: AT, files: ["final_master.mp4"], large_asset_pointers: [] },
        gates: [a7],
      }),
    ),
  );
}

// ------------------------------------------------------ B (real identity + real B12)

const DEPS: Record<string, string[]> = { b01: [], b02: ["b01"], b03: ["b01"], b04: ["b01", "b02", "b03"], b05: ["b01", "b03", "b04"], b06: ["b01", "b03", "b04"], b07: ["b04", "b06"], b08: ["b01", "b06", "b07"], b09: ["b08", "b06"], b10: ["b09"], b11: ["b10"] };
const prov = (rationale: string) => ({ type: "DECIDED", decision_authority: OWNER, timestamp: AT, rationale });

function canonical(module: string, identities: Record<string, any>, extras: Record<string, unknown>): any {
  const base = { version: "v1.0", created_at: AT, updated_at: AT, user_decision_authority: OWNER, audit_trail: [{ version: "v1.0", changed_at: AT, changed_by: OWNER, summary: `${module} approved for unified cycle` }], decisions_made: [], recommendations_considered: [], evidence_refs: [], provenance_refs: [], governance_events: {}, decision_timestamp: AT, cannot_be_modified_until_next_version: true, ...extras };
  const parents = DEPS[module]!.map((p) => B00.parentReferenceFromIdentity(p.toUpperCase(), identities[p], "unified_test_parent"));
  const identity = B00.createCanonicalIdentity({ object_id: `${module}:v1.0:unified`, object_type: `${module.toUpperCase()}_CANONICAL_STATE`, version: "v1.0", artifact: base, parent_references: parents, created_at: AT });
  identities[module] = identity;
  return { ...base, identity };
}

export interface StrategyFixtureOptions {
  nonCompliant?: boolean;
  withB10?: boolean;
}

export async function committedStrategy(opts: StrategyFixtureOptions = {}): Promise<{ branch: any; states: Record<string, any>; uncommitted: any }> {
  const ids: Record<string, any> = {};
  const s: Record<string, any> = {};
  s.b01 = canonical("b01", ids, { brand_profile: { brand_name: "History Vertical", values: [] }, channels: [{ channel_id: "ch_yt_main", name: "History Vertical", platform: "YOUTUBE" }] });
  s.b02 = canonical("b02", ids, {});
  s.b03 = canonical("b03", ids, {});
  s.b04 = canonical("b04", ids, {});
  s.b05 = canonical("b05", ids, {
    b01_canonical_version: "v1.0",
    creative_angles: [
      { angle_id: "ang_engineering", campaign_id: "cmp1", title: "Engineering marvel", description: "", target_audience_segment: "seg1", core_message: "Gravity alone moved a city's water", content_types: ["explainer"], tone: "narrative", evidence_refs: [], provenance: prov("angle"), confidence: 0.5, confidence_basis: "HEURISTIC_DEFAULT", derivation_basis: "HEURISTIC" },
      { angle_id: "ang_owner", campaign_id: "cmp1", title: "Owner-chosen hook", description: "", target_audience_segment: "seg1", core_message: "Start with the 312 BC date", content_types: ["story"], tone: "narrative", evidence_refs: [], provenance: prov("owner"), confidence: 1, confidence_basis: "USER_PROVIDED", derivation_basis: "HUMAN_DECIDED" },
    ],
    messaging_strategies: [],
    creative_constraints: [
      { constraint_id: "con_forbidden", campaign_id: "cmp1", constraint_type: "forbidden_topics", description: "No modern political analogies", details: ["no current-events comparisons"], rationale: "Channel is strictly historical", evidence_refs: [], provenance: prov("constraint"), derivation_basis: "HUMAN_DECIDED" },
    ],
    creative_briefs: [{ brief_id: "brief1", campaign_id: "cmp1", content_objectives: ["Explain how the aqueducts worked in under 90 seconds"], creative_angles: [], messaging_strategies: [], creative_constraints: [], key_metrics: ["retention"], quality_standards: [], evidence_refs: [] }],
  });
  s.b06 = canonical("b06", ids, {
    b01_canonical_version: "v1.0",
    channel_selections: [{ selection_id: "sel1", campaign_id: "cmp1", channel_id: "ch_yt_main", role: "primary_channel", priority_rank: 1, rationale: "Owner's main channel", strategic_fit: 1, fit_basis: "USER_SELECTED", evidence_refs: [], provenance: prov("sel") }],
    content_schedules: [{ schedule_id: "sch1", campaign_id: "cmp1", channel_id: "ch_yt_main", posting_frequency: "weekly", optimal_posting_times: ["18:00"], timezone_adapted: true, schedule_basis: "USER_DEFINED", timezone_basis: "USER_DEFINED", source_timezone: "Europe/Istanbul", target_timezone: "Europe/Istanbul", conversion_method: "NONE", empirically_optimized: false, evidence_refs: [], provenance: prov("sch") }],
    format_rules: [{ rule_id: "fr1", campaign_id: "cmp1", channel_id: "ch_yt_main", preferred_content_formats: ["short_video"], forbidden_formats: ["horizontal_16_9"], duration_category: "short", rule_basis: "DEFAULT", quality_standards: ["burned-in captions"], evidence_refs: [], provenance: prov("fr") }],
    distribution_strategies: [],
  });
  s.b07 = canonical("b07", ids, {
    framework_state: "DEFINED",
    kpi_definitions: [{ kpi_id: "kpi_views_7d", campaign_id: "cmp1", channel_id: "ch_yt_main", metric_name: "Views (7d)", metric_category: "reach", calculation_method: "YouTube Analytics views", data_sources: ["YouTube Analytics"], target_value: 5000, target_unit: "views", target_definition: { value: 5000, unit: "views", basis: "USER_DEFINED", source: "owner", status: "UNKNOWN", version: "v1" }, benchmark_definition: { basis: "UNKNOWN", status: "UNKNOWN", version: "v1" }, evidence_refs: [], provenance: prov("kpi") }],
    measurement_plans: [],
    success_metrics: [],
  });
  s.b08 = canonical("b08", ids, {});
  s.b09 = canonical("b09", ids, {});
  s.b10 = canonical("b10", ids, {
    optimization_proposals: opts.withB10
      ? [{ proposal_id: "prop1", proposal_type: "strategy_refinement", target_module: "B05", parameter_name: "hook", current_state: "date-first", observed_problem: "7d retention below target", hypothesis: "visual hook first", proposed_change: "Open with the arches visual before the date", expected_effect: "higher 3s hold", required_approval: true, proposal_basis: "LEARNING_SIGNAL", current_value: "date-first", proposed_value: "visual-first", confidence: 0.4, confidence_basis: "SIGNAL_CHAIN", expected_impact: "retention", evidence_refs: [], provenance: prov("prop") }]
      : [],
    impact_assessments: [],
  });
  s.b11 = canonical("b11", ids, {
    compliance_rules: [{ rule_id: "rule_disclosure", rule_category: "platform", description: "Disclose realistic synthetic media", scope: ["youtube"], required: true, rule_basis: "USER_DEFINED", external_verified: false, evidence_refs: [], provenance: prov("rule") }],
    risk_assessments: [],
    compliance_checks: [{ check_id: "chk1", compliance_rule_id: "rule_disclosure", subject: { subject_id: "b10", subject_type: "B10_PROPOSAL", subject_version: "v1.0", subject_content_hash: ids.b10.content_hash, affected_modules: ["B10"] }, status: opts.nonCompliant ? "NON_COMPLIANT" : "UNKNOWN", check_basis: "NO_EVIDENCE", findings: opts.nonCompliant ? ["disclosure missing"] : [], finding_review_state: "UNREVIEWED", remediation_required: false, evidence_refs: [], provenance: prov("chk") }],
  });
  const reader: any = {};
  for (const m of Object.keys(s)) reader[m] = { load: async (v: string) => (v === "v1.0" ? s[m] : null), save: async () => {}, listVersions: async () => ["v1.0"], latest: async () => s[m] };
  const v = "v1.0";
  const uncommitted = await B12.createBranchState(v, v, v, v, v, v, v, v, v, v, v, { upstreamReader: reader, now: () => AT });
  const branch = await B12.commitBranchState(uncommitted, OWNER, "Approve strategy for the aqueduct Short", new B12.InMemoryB12Persistence(), { now: () => AT });
  return { branch: JSON.parse(JSON.stringify(branch)), states: JSON.parse(JSON.stringify(s)), uncommitted };
}

import { expect } from "vitest";
