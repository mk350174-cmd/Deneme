// Bridge 2 — B-Branch (committed strategy) -> A-Branch P2 (Creative)
//
// Position in the unified flow:  B12 commitBranchState --> THIS --> P2.03 / P2.04 / P2 memory
//
// Gate G-B (new, unified): P2 may only be directed by a B12 branch snapshot
// that the channel owner COMMITTED (commitBranchState ->
// cannot_be_modified_until_next_version = true), and only with module states
// whose canonical identities match that snapshot exactly.
//
// Mapping (all into existing, unchanged P2 entry points):
//   B05 briefs / angles / messaging   -> P2.03 runP203Strategize(userGoals)
//   B06 format rule + 9:16 standard   -> P2.04 decideFormat(format, constraints)
//   B05 constraints, B11 open checks  -> P2.04 constraints + P2 AVOID/BRAND memory
//   B10 canonical (approved) proposals-> P2 CAMPAIGN_MEMORY
//   B07 KPIs, B06 schedule            -> carried to P3 -> YouTube agent (publishing hints)
//
// B11 NON_COMPLIANT on anything => no directive (hard stop).

import { B00, type B05, type B06, type B07, type B10, type B11, type B12 } from "b-branch-strategic-control-plane";
import type {
  DirectiveItem,
  DirectiveKpi,
  DirectiveMemoryRecord,
  EpistemicBasis,
  StrategicCreativeDirective,
  StrategyInputBundle,
} from "./contracts.js";
import { UNIFIED_SCHEMA_VERSION } from "./contracts.js";
import { BridgeError, assertHumanAuthority, hashValue, sealEnvelope, shortHash, signValue, verifyEnvelope, verifyValueSignature, type EnvelopeSignature } from "./identity.js";
import { researchLineage } from "./p1ToB.js";

const BRIDGE = "B->P2";

export interface CommittedStrategy {
  branch: B12.BranchCanonicalState;
  b05: B05.B05CanonicalState;
  b06: B06.B06CanonicalState;
  b07: B07.B07CanonicalState;
  b11: B11.B11CanonicalState;
  /** Optional: approved optimization proposals from the previous learning loop. */
  b10?: B10.B10CanonicalState;
  /** Optional: goals the channel owner wrote in the strategy brief (USER_DEFINED). */
  owner_goals?: { goals: string[]; constraints?: string[]; brief_hash: string };
  /** Set by commitStrategy: the bundle this strategy was committed for. */
  bundle_hash?: string;
  brief_hash?: string;
  proposal_hash?: string;
  /** HMAC with this installation's seal key over strategyCommitPayload(). */
  commit_signature?: EnvelopeSignature;
}

/** What the commit signature covers: the committed B12 snapshot and every binding around it. */
export function strategyCommitPayload(s: CommittedStrategy): unknown {
  return {
    bundle_hash: s.bundle_hash ?? null,
    brief_hash: s.brief_hash ?? null,
    proposal_hash: s.proposal_hash ?? null,
    branch_hash: s.branch?.identity?.content_hash ?? null,
    owner_goals: s.owner_goals ?? null,
  };
}

export interface DirectiveOptions {
  /** Pick a specific B06 channel; default = highest-priority primary_channel. */
  channel_id?: string;
  /** Unified production standard. Default "9:16". */
  aspect_ratio?: string;
  /** When false, HEURISTIC/TEMPLATE/DEFAULT goals are dropped instead of labelled. */
  include_heuristics?: boolean;
  max_goals?: number;
  now?: () => string;
}

function basisOf(derivation: string | undefined): EpistemicBasis {
  switch (derivation) {
    case "EVIDENCE_BACKED":
      return "EVIDENCE_BACKED";
    case "HUMAN_DECIDED":
      return "HUMAN_DECIDED";
    case "USER_DEFINED":
    case "USER_PROVIDED":
    case "USER_SELECTED":
      return "USER_DEFINED";
    case "TEMPLATE":
      return "TEMPLATE";
    case "DEFAULT":
    case "FRAMEWORK_DEFAULT":
      return "DEFAULT";
    default:
      return "HEURISTIC";
  }
}

const WEAK: ReadonlySet<EpistemicBasis> = new Set(["HEURISTIC", "TEMPLATE", "DEFAULT"]);

function assertStateBoundToBranch(
  module: "b05" | "b06" | "b07" | "b10" | "b11",
  state: { identity: B00.CanonicalIdentity; version: string },
  branch: B12.BranchCanonicalState,
): string {
  const self = B00.validateCanonicalIdentity(state, state.identity);
  if (!self.valid) {
    throw new BridgeError(BRIDGE, "MODULE_STATE_TAMPERED", `${module} identity invalid: ${self.errors.join(", ")}`);
  }
  const entry = branch.module_versions.find((v) => v.module === module);
  if (!entry) throw new BridgeError(BRIDGE, "MODULE_NOT_IN_BRANCH", `${module} is not part of branch ${branch.state_id}`);
  if (entry.identity_status !== "VERIFIED") {
    throw new BridgeError(BRIDGE, "MODULE_IDENTITY_UNVERIFIED", `${module} identity_status=${entry.identity_status} in branch`);
  }
  if (entry.content_hash !== state.identity.content_hash || entry.version !== state.version) {
    throw new BridgeError(
      BRIDGE,
      "MODULE_BRANCH_MISMATCH",
      `${module}@${state.version} (${shortHash(state.identity.content_hash)}) is not the version committed in branch ` +
        `(${entry.version}, ${shortHash(entry.content_hash)})`,
    );
  }
  return entry.content_hash;
}

function assertCommittedBranch(branch: B12.BranchCanonicalState): B12.BranchCanonicalState["state_transitions"][number] {
  const self = B00.validateCanonicalIdentity(branch, branch.identity);
  if (!self.valid) throw new BridgeError(BRIDGE, "BRANCH_TAMPERED", self.errors.join(", "));
  if (branch.cannot_be_modified_until_next_version !== true) {
    throw new BridgeError(BRIDGE, "BRANCH_NOT_COMMITTED", "B12 snapshot was never committed by the channel owner (commitBranchState)");
  }
  const decision = [...branch.state_transitions].reverse().find((t) => t.triggered_by === "user_decision");
  if (!decision) throw new BridgeError(BRIDGE, "NO_HUMAN_COMMIT", "B12 snapshot has no user_decision transition by a named authority");
  try {
    assertHumanAuthority(BRIDGE, decision.decision_authority, "B12 commit authority");
  } catch {
    throw new BridgeError(BRIDGE, "NO_HUMAN_COMMIT", `B12 commit authority ${JSON.stringify(decision.decision_authority)} is not a named person`);
  }
  return decision;
}

const BINDING = /\[unified bundle=([0-9a-f]{64}) owner_goals=([0-9a-f]{64}|none)\]\s*$/;

/**
 * strategy.json is not an envelope, so its bundle and owner goals are checked
 * against the tag commitStrategy wrote into the sealed B12 decision.
 */
export function assertCommitBinding(bundle: StrategyInputBundle, strategy: CommittedStrategy, rationale: string): void {
  const bundleHash = bundle.identity.content_hash;
  if (strategy.bundle_hash !== undefined && strategy.bundle_hash !== bundleHash) {
    throw new BridgeError(BRIDGE, "DIRECTIVE_BUNDLE_MISMATCH", `strategy was committed for bundle ${shortHash(strategy.bundle_hash)}, not ${shortHash(bundleHash)}`);
  }
  const m = BINDING.exec(rationale ?? "");
  if (!m) {
    // Branches committed outside the orchestrator carry no binding: owner goals cannot be trusted.
    if (strategy.owner_goals) throw new BridgeError(BRIDGE, "OWNER_GOALS_TAMPERED", "owner_goals present but the B12 commit does not bind them");
    return;
  }
  if (m[1] !== bundleHash) throw new BridgeError(BRIDGE, "DIRECTIVE_BUNDLE_MISMATCH", `B12 commit is bound to bundle ${shortHash(m[1]!)}, not ${shortHash(bundleHash)}`);
  const actual = strategy.owner_goals ? hashValue(strategy.owner_goals) : "none";
  if (actual !== m[2]) throw new BridgeError(BRIDGE, "OWNER_GOALS_TAMPERED", "owner_goals differ from what the channel owner committed");
}

/** Last line of defence for strategy.json (not an envelope): the installation's seal key. */
export function assertStrategySigned(strategy: CommittedStrategy): void {
  verifyValueSignature(BRIDGE, "strategy.json", strategyCommitPayload(strategy), strategy.commit_signature);
}

/** Signs a committed strategy with this installation's seal key (commitStrategy does this; use it for B12 branches committed through B's own API). */
export function signCommittedStrategy<T extends CommittedStrategy>(strategy: T): T {
  const { commit_signature: _old, ...rest } = strategy;
  const sig = signValue(strategyCommitPayload(rest as T));
  return (sig ? { ...rest, commit_signature: sig } : rest) as T;
}

export function buildCreativeDirective(
  bundle: StrategyInputBundle,
  strategy: CommittedStrategy,
  options: DirectiveOptions = {},
): StrategicCreativeDirective {
  verifyEnvelope(BRIDGE, bundle, "UNIFIED_STRATEGY_INPUT_BUNDLE");
  const { branch, b05, b06, b07, b11, b10 } = strategy;
  const commit = assertCommittedBranch(branch);
  assertCommitBinding(bundle, strategy, commit.rationale);
  assertStrategySigned(strategy);
  const module_hashes: Record<string, string> = {
    b05: assertStateBoundToBranch("b05", b05, branch),
    b06: assertStateBoundToBranch("b06", b06, branch),
    b07: assertStateBoundToBranch("b07", b07, branch),
    b11: assertStateBoundToBranch("b11", b11, branch),
  };
  if (b10) module_hashes.b10 = assertStateBoundToBranch("b10", b10, branch);

  // --- Compliance gate (B11) -------------------------------------------------
  const blocking: string[] = [];
  const unresolved: string[] = [];
  const rules = new Map(b11.compliance_rules.map((r) => [r.rule_id, r]));
  for (const check of b11.compliance_checks) {
    const status = check.final_compliance_decision ?? check.status;
    const label = `${rules.get(check.compliance_rule_id)?.description ?? check.compliance_rule_id} [${check.subject.subject_type}]`;
    if (status === "NON_COMPLIANT") blocking.push(`${label}: ${check.findings.join("; ") || "non-compliant"}`);
    else if (status === "UNKNOWN" || status === "PENDING") unresolved.push(`${label}: ${status} (${check.check_basis})`);
  }
  if (blocking.length) {
    throw new BridgeError(BRIDGE, "COMPLIANCE_BLOCKED", `B11 NON_COMPLIANT: ${blocking.join(" | ")}`);
  }

  // --- Channel (B06) ---------------------------------------------------------
  const selections = [...b06.channel_selections].sort((a, b) => a.priority_rank - b.priority_rank);
  const selection = options.channel_id
    ? selections.find((s) => s.channel_id === options.channel_id)
    : selections.find((s) => s.role === "primary_channel") ?? selections[0];
  if (!selection) {
    throw new BridgeError(BRIDGE, "NO_CHANNEL_SELECTED", options.channel_id ? `channel ${options.channel_id} not in B06` : "B06 has no channel selection");
  }
  const channelId = selection.channel_id;
  const formatRule = b06.format_rules.find((r) => r.channel_id === channelId);
  const schedule = b06.content_schedules.find((s) => s.channel_id === channelId);

  // --- Goals (B05) -----------------------------------------------------------
  const includeWeak = options.include_heuristics ?? true;
  const goals: DirectiveItem[] = [];
  // Owner goals first: the only goals that are USER_DEFINED by construction.
  for (const [i, text] of (strategy.owner_goals?.goals ?? []).entries()) {
    goals.push({ text, basis: "USER_DEFINED", source_ref: `owner:brief:${shortHash(strategy.owner_goals!.brief_hash)}:goal:${i}` });
  }
  // B05 brief objectives are carried over from B04 campaign synthesis, whose
  // objectives are framework templates ("Engage N audience segment(s)…").
  // Canonical approval does not change where the text came from, so they
  // stay TEMPLATE.
  for (const brief of b05.creative_briefs) {
    for (const objective of brief.content_objectives) {
      goals.push({ text: objective, basis: "TEMPLATE", source_ref: `B05:brief:${brief.brief_id}` });
    }
  }
  for (const angle of b05.creative_angles) {
    goals.push({
      text: `Angle "${angle.title}": ${angle.core_message} (tone: ${angle.tone})`,
      basis: basisOf(angle.derivation_basis),
      source_ref: `B05:angle:${angle.angle_id}`,
    });
  }
  for (const m of b05.messaging_strategies) {
    goals.push({
      text: `Message: ${m.primary_message}. Value: ${m.value_proposition}. Desired outcome: ${m.desired_outcome}`,
      basis: basisOf(m.derivation_basis),
      source_ref: `B05:messaging:${m.messaging_id}`,
    });
  }
  const keptGoals = goals.filter((g) => includeWeak || !WEAK.has(g.basis)).slice(0, options.max_goals ?? 12);
  if (keptGoals.length === 0) {
    throw new BridgeError(BRIDGE, "NO_USABLE_GOALS", includeWeak ? "B05 produced no goals" : "no evidence-backed or human-decided goals remain");
  }

  // --- Format & constraints (B06 + B05 + B11) --------------------------------
  const aspect = options.aspect_ratio ?? "9:16";
  const constraints: DirectiveItem[] = [
    { text: `Aspect ratio ${aspect} (vertical delivery standard)`, basis: "USER_DEFINED", source_ref: "unified:production_standard" },
  ];
  if (formatRule) {
    const rb = basisOf(formatRule.rule_basis);
    constraints.push({ text: `Duration category: ${formatRule.duration_category}${formatRule.duration_guidance ? ` — ${formatRule.duration_guidance}` : ""}`, basis: rb, source_ref: `B06:format_rule:${formatRule.rule_id}` });
    for (const f of formatRule.forbidden_formats ?? []) constraints.push({ text: `Forbidden format: ${f}`, basis: rb, source_ref: `B06:format_rule:${formatRule.rule_id}` });
    for (const q of formatRule.quality_standards) constraints.push({ text: `Quality standard: ${q}`, basis: rb, source_ref: `B06:format_rule:${formatRule.rule_id}` });
  }
  const memory: DirectiveMemoryRecord[] = [];
  for (const [i, text] of (strategy.owner_goals?.constraints ?? []).entries()) {
    const ref = `owner:brief:${shortHash(strategy.owner_goals!.brief_hash)}:constraint:${i}`;
    constraints.push({ text, basis: "USER_DEFINED", source_ref: ref });
    memory.push({ bucket: "BRAND_MEMORY", record_type: "RULE", content: text, reason: "Channel owner constraint", source_ref: ref, basis: "USER_DEFINED" });
  }
  for (const c of b05.creative_constraints) {
    const basis = basisOf(c.derivation_basis);
    const text = `${c.description}${c.details.length ? `: ${c.details.join("; ")}` : ""}`;
    constraints.push({ text, basis, source_ref: `B05:constraint:${c.constraint_id}` });
    memory.push({
      bucket: c.constraint_type === "forbidden_topics" ? "AVOID_MEMORY" : "BRAND_MEMORY",
      record_type: "RULE",
      content: text,
      reason: c.rationale,
      source_ref: `B05:constraint:${c.constraint_id}`,
      basis,
    });
  }
  for (const u of unresolved) {
    constraints.push({ text: `Compliance not yet established — ${u}`, basis: "DEFAULT", source_ref: "B11:unresolved" });
  }
  for (const p of b10?.optimization_proposals ?? []) {
    memory.push({
      bucket: "CAMPAIGN_MEMORY",
      record_type: "PREFERENCE",
      content: `${p.proposed_change} (target ${p.target_module}.${p.parameter_name}: ${p.current_value} -> ${p.proposed_value})`,
      reason: `Approved B10 proposal ${p.proposal_id}; observed: ${p.observed_problem}; expected: ${p.expected_effect}`,
      source_ref: `B10:proposal:${p.proposal_id}`,
      basis: p.proposal_basis === "LEARNING_SIGNAL" ? "EVIDENCE_BACKED" : basisOf(p.proposal_basis),
    });
  }

  // --- KPIs (B07) --------------------------------------------------------------
  const kpis: DirectiveKpi[] = b07.kpi_definitions
    .filter((k) => k.channel_id === channelId)
    .map((k) => ({
      kpi_id: k.kpi_id,
      channel_id: k.channel_id,
      metric_name: k.metric_name,
      metric_category: k.metric_category,
      target_value: k.target_definition.value,
      target_unit: k.target_definition.unit,
      target_basis: k.target_definition.basis,
      data_sources: k.data_sources,
    }));

  const now = options.now ?? (() => new Date().toISOString());
  const created_at = now();
  const body: Omit<StrategicCreativeDirective, "identity"> = {
    directive_type: "B_TO_P2_CREATIVE_DIRECTIVE",
    schema_version: UNIFIED_SCHEMA_VERSION,
    project_id: bundle.lineage.project_id,
    lineage: bundle.lineage,
    strategy_input_bundle_hash: bundle.identity.content_hash,
    branch_state: {
      state_id: branch.state_id,
      content_hash: branch.identity.content_hash,
      committed_by: commit.decision_authority,
      committed_at: commit.timestamp,
      rationale: commit.rationale,
      module_hashes,
    },
    channel: {
      channel_id: channelId,
      role: selection.role,
      rationale: selection.rationale,
      fit_basis: selection.fit_basis,
    },
    user_goals: keptGoals,
    format: {
      format: formatRule?.preferred_content_formats[0] ?? "short_video",
      duration_category: formatRule?.duration_category ?? "flexible",
      aspect_ratio: aspect,
      constraints,
    },
    memory,
    kpis,
    schedule: schedule
      ? {
          posting_frequency: schedule.posting_frequency,
          optimal_posting_times: schedule.optimal_posting_times,
          timezone: schedule.target_timezone,
          basis: schedule.schedule_basis,
        }
      : null,
    compliance: { blocking, unresolved },
    created_at,
  };
  return sealEnvelope<StrategicCreativeDirective>(body, {
    object_id: `scd_${shortHash(branch.identity.content_hash)}_${shortHash(bundle.lineage.research_package_sha256)}`,
    object_type: "UNIFIED_CREATIVE_DIRECTIVE",
    version: "v1",
    created_at,
    parents: [B00.parentReferenceFromIdentity("B12", branch.identity, "committed_strategy")],
  });
}

// ---------------------------------------------------------------------------
// P2-side adapters. They only shape arguments for the EXISTING P2 functions.
// ---------------------------------------------------------------------------

/** Call before P2.02: the directive must describe the very package P2 ingests. */
export function assertDirectiveMatchesResearch(directive: StrategicCreativeDirective, rawResearchPackage: unknown): void {
  verifyEnvelope(BRIDGE, directive, "UNIFIED_CREATIVE_DIRECTIVE");
  const lineage = researchLineage(rawResearchPackage);
  if (
    lineage.research_package_id !== directive.lineage.research_package_id ||
    lineage.research_package_sha256 !== directive.lineage.research_package_sha256
  ) {
    throw new BridgeError(
      BRIDGE,
      "DIRECTIVE_RESEARCH_MISMATCH",
      `directive was built for ${directive.lineage.research_package_id}@${shortHash(directive.lineage.research_package_sha256)}, ` +
        `P2 is ingesting ${lineage.research_package_id}@${shortHash(lineage.research_package_sha256)}`,
    );
  }
}

function labelled(item: DirectiveItem): string {
  return WEAK.has(item.basis) ? `[${item.basis} — not evidence-backed] ${item.text}` : item.text;
}

/** -> runP203Strategize(engine, contentStructure, userGoals, priorApproaches) */
export function toP2UserGoals(directive: StrategicCreativeDirective): string[] {
  return directive.user_goals.map(labelled);
}

/** -> decideFormat(format, constraints) / buildFormatDecisionMatrix(id, format, constraints) */
export function toP2FormatInput(directive: StrategicCreativeDirective): { format: string; constraints: string[] } {
  return { format: directive.format.format, constraints: directive.format.constraints.map(labelled) };
}

export interface P2MemoryRecordShape {
  record_id: string;
  bucket: DirectiveMemoryRecord["bucket"];
  record_type: DirectiveMemoryRecord["record_type"];
  content: string;
  reason?: string;
  created_at: string;
  locked?: boolean;
}

/** -> P2 MemoryRecord[] (runP203Strategize priorApproaches, runP206ArtDirection memory) */
export function toP2Memory(directive: StrategicCreativeDirective): P2MemoryRecordShape[] {
  return directive.memory.map((m) => ({
    record_id: `mem_${shortHash(hashValue({ d: directive.identity.content_hash, s: m.source_ref, c: m.content }), 16)}`,
    bucket: m.bucket,
    record_type: m.record_type,
    content: WEAK.has(m.basis) ? `[${m.basis}] ${m.content}` : m.content,
    reason: `${m.reason} (from ${m.source_ref}, branch ${shortHash(directive.branch_state.content_hash)})`,
    created_at: directive.created_at,
    // Human-decided / evidence-backed rules are locked so P2 cannot drop them silently.
    locked: !WEAK.has(m.basis),
  }));
}
