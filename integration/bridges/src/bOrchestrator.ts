// B-Branch orchestrator — runs the REAL B01→B11 chain and the B12 commit
// from a StrategyInputBundle (Bridge 1) plus a channel-owner StrategyBrief,
// with a two-step human review:
//
//   1. proposeStrategy  → dry run with authority "PREVIEW:not-approved".
//                          Nothing is persisted. Produces a sealed proposal
//                          (per-module fingerprints, readiness, B's own gaps and
//                          semantic findings) and a Markdown review.
//   2. commitStrategy   → the owner signs decisions (per-module approval +
//                          rationale). The chain is re-run in canonical
//                          dependency order under the owner's name; every
//                          module's fingerprint must equal the reviewed one,
//                          otherwise NOTHING is committed. Then B12 snapshot +
//                          commitBranchState (gate G-B). States are persisted
//                          only after the whole chain passed.
//
// Downstream modules are always built from CANONICAL upstream states, so the
// B12 lineage check does not report PARENT_IDENTITY_MISMATCH.
//
// The orchestrator never edits B, never approves on its own and never hides
// an empty strategy: if B04/B05/B06/B07 produce nothing, the proposal lists
// B's own gaps and commit refuses (STRATEGY_NOT_READY).

import { B00, B01, B02, B03, B04, B05, B06, B07, B08, B09, B10, B11, B12 } from "b-branch-strategic-control-plane";
import type { StrategyInputBundle, CanonicalIdentity } from "./contracts.js";
import { UNIFIED_SCHEMA_VERSION } from "./contracts.js";
import { BridgeError, assertHumanAuthority, hashValue, sealEnvelope, shortHash, verifyEnvelope } from "./identity.js";
import { assertNoSecrets } from "./safety.js";
import { signCommittedStrategy, type CommittedStrategy } from "./bToP2.js";

const BRIDGE = "B-orchestrator";
export const B_MODULES = ["b01", "b02", "b03", "b04", "b05", "b06", "b07", "b08", "b09", "b10", "b11"] as const;
export type BModuleName = (typeof B_MODULES)[number];
export const PREVIEW_AUTHORITY = "PREVIEW:not-approved";

// ---------------------------------------------------------------- inputs

export interface StrategyBrief {
  brief_type: "OWNER_STRATEGY_BRIEF";
  /** Written by the channel owner. Nothing here is inferred from research. */
  brand: NonNullable<B01.B01Input["brand_context"]>;
  channels: NonNullable<B01.B01Input["known_channels"]>;
  platforms?: B01.B01Input["known_platforms"];
  documentation?: B01.B01Input["documentation"];
  /** Merged into B03 audience_sources next to the research digest. */
  audience?: {
    platform_analytics?: NonNullable<B03.B03Input["audience_sources"]>["platform_analytics"];
    user_research?: NonNullable<B03.B03Input["audience_sources"]>["user_research"];
    documentation?: NonNullable<NonNullable<B03.B03Input["audience_sources"]>["documentation"]>;
  };
  /** USER_DEFINED goals / constraints carried into the creative directive. */
  owner_goals?: string[];
  owner_constraints?: string[];
}

export interface ModuleSummary {
  fingerprint: string;
  counts: Record<string, number>;
  highlights: string[];
  gaps: string[];
}

export interface StrategyProposal {
  proposal_type: "B_STRATEGY_PROPOSAL";
  schema_version: typeof UNIFIED_SCHEMA_VERSION;
  bundle_hash: string;
  brief_hash: string;
  intelligence_hash: string | null;
  /** Version every module will be committed as (derived from the store). */
  version: string;
  modules: Record<BModuleName, ModuleSummary>;
  readiness: {
    ready: boolean;
    blockers: string[];
    semantic_validity: string;
    semantic_findings: string[];
    operational_readiness: string;
    operational_findings: string[];
  };
  created_at: string;
  identity: CanonicalIdentity;
}

export interface StrategyDecisions {
  authority: string;
  rationale: string;
  /** Every module must be explicitly approved (true). */
  approve: Partial<Record<BModuleName, boolean>>;
  /** Hash of the proposal the owner reviewed. */
  proposal_hash: string;
}

export interface StrategyCommitResult extends CommittedStrategy {
  commit_type: "B_STRATEGY_COMMIT";
  bundle_hash: string;
  brief_hash: string;
  proposal_hash: string;
  states: Record<BModuleName, unknown>;
}

export interface StatePersistence {
  save(state: any): Promise<void>;
  load(key: string): Promise<any | null>;
  listVersions(): Promise<string[]>;
  listStates(): Promise<string[]>;
  latest(): Promise<any | null>;
}

export function memoryPersistence(): StatePersistence {
  const m = new Map<string, any>();
  return {
    save: async (s) => void m.set(s.version && !s.state_id ? s.version : s.state_id ?? s.version, s),
    load: async (k) => m.get(k) ?? null,
    listVersions: async () => [...m.keys()],
    listStates: async () => [...m.keys()],
    latest: async () => [...m.values()].at(-1) ?? null,
  };
}

// ---------------------------------------------------------------- fingerprint

/** Keys that change with WHO approved or WHEN, not with WHAT the strategy says. */
const VOLATILE = new Set([
  "identity", "created_at", "updated_at", "decision_timestamp", "timestamp", "reviewed_at", "retrieved_at", "observed_at", "last_checked",
  "audit_trail", "governance_events", "governance_history", "provenance", "provenance_refs", "provenance_chains", "approvals",
  "user_decision_authority", "decisions_made", "decision_authority", "parent_references", "candidate_id", "approval_id",
  "cannot_be_modified_until_next_version", "related_decision_id", "prior_provenance_id", "canonical_state_id",
]);

function strip(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strip);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (!VOLATILE.has(k) && !k.endsWith("_version")) out[k] = strip(v);
    return out;
  }
  return value;
}

/** Content fingerprint of a canonical module state: what the owner actually reviews. */
export function strategyFingerprint(state: unknown): string {
  return hashValue(strip(state));
}

// ---------------------------------------------------------------- chain

function b01InputFrom(bundle: StrategyInputBundle, brief: StrategyBrief): B01.B01Input {
  return {
    ...bundle.b01_input,
    brand_context: brief.brand,
    known_channels: brief.channels,
    ...(brief.platforms ? { known_platforms: brief.platforms } : {}),
    ...(brief.documentation ? { documentation: brief.documentation } : {}),
  };
}

function audienceFrom(bundle: StrategyInputBundle, brief: StrategyBrief): NonNullable<B03.B03Input["audience_sources"]> {
  const a = brief.audience ?? {};
  return {
    ...bundle.b03_audience_sources,
    ...(a.platform_analytics ? { platform_analytics: a.platform_analytics } : {}),
    ...(a.user_research ? { user_research: a.user_research } : {}),
    documentation: { ...(bundle.b03_audience_sources.documentation ?? {}), ...(a.documentation ?? {}) },
  };
}

function b01ItemIds(c: any): string[] {
  const ids = new Set<string>();
  const take = (arr: any[] | undefined, key: string) => (arr ?? []).forEach((x) => x && typeof x[key] === "string" && ids.add(x[key]));
  take(c.ecosystem?.channels, "channel_id");
  take(c.ecosystem?.platforms, "platform_id");
  take(c.territories?.territories, "territory_id");
  take(c.editorial?.rules, "rule_id");
  take(c.constraints?.strategic_constraints, "constraint_id");
  take(c.distribution?.channel_assignments, "assignment_id");
  return [...ids];
}

interface ChainRun {
  states: Record<BModuleName, any>;
  candidates: Record<BModuleName, any>;
}

async function runChain(
  bundle: StrategyInputBundle,
  brief: StrategyBrief,
  authority: string,
  version: string,
  persist: Record<BModuleName, StatePersistence>,
  intel?: B08.ExternalIntelligenceContext,
  gate?: (module: BModuleName, state: any) => void,
): Promise<ChainRun> {
  const s = {} as Record<BModuleName, any>;
  const c = {} as Record<BModuleName, any>;
  const prior = async (m: BModuleName) => (await persist[m].latest()) ?? undefined;
  const done = (m: BModuleName, state: any) => {
    s[m] = state;
    gate?.(m, state);
  };
  const extDeps = intel ? { external_intelligence: intel } : {};

  c.b01 = await B01.runB01(b01InputFrom(bundle, brief));
  const approved01 = B01.approveCandidate(c.b01, b01ItemIds(c.b01), [], authority);
  done("b01", await B01.commitVersion(approved01, version, authority, persist.b01, await prior("b01")));

  const step = async (m: BModuleName, mod: any, cand: any, deps?: any) => {
    c[m] = cand;
    const approved = await mod.approveCandidate(cand, authority, deps);
    done(m, await mod.commitVersion(approved, version, authority, persist[m], await prior(m), deps));
  };
  await step("b02", B02, await B02.runB02(s.b01, extDeps as any), extDeps);
  await step("b03", B03, B03.runB03(s.b01, { b01_canonical_state: s.b01, audience_sources: audienceFrom(bundle, brief), ...(intel ? { external_intelligence: intel } : {}) }));
  // Canonical upstream states are passed where B's runtime accepts them, so
  // parent references match what B12 aggregates.
  await step("b04", B04, await B04.runB04(s.b01, s.b02 as any, s.b03 as any));
  await step("b05", B05, await B05.runB05(s.b01, s.b03 as any, s.b04));
  await step("b06", B06, await B06.runB06(s.b01, s.b03 as any, s.b04));
  await step("b07", B07, await B07.runB07(s.b04, s.b06, extDeps as any), extDeps);
  await step("b08", B08, await B08.runB08(s.b07, s.b06, s.b01, extDeps as any), extDeps);
  await step("b09", B09, await B09.runB09(s.b08, s.b06));
  await step("b10", B10, await B10.runB10(s.b09));
  await step("b11", B11, await B11.runB11(s.b10));
  return { states: s, candidates: c };
}

function persistences(): Record<BModuleName, StatePersistence> {
  return Object.fromEntries(B_MODULES.map((m) => [m, memoryPersistence()])) as Record<BModuleName, StatePersistence>;
}

function gapTexts(candidate: any): string[] {
  const gaps = Array.isArray(candidate?.gaps) ? candidate.gaps : [];
  const fromGaps = gaps.map((g: any) => (typeof g === "string" ? g : g.description ?? g.gap_id ?? JSON.stringify(g)));
  const blocking = candidate?.completeness?.blocking_decisions ?? [];
  const missing = candidate?.completeness?.missing_inputs ?? [];
  return [...new Set([...fromGaps, ...blocking, ...missing].map(String))].slice(0, 12);
}

function summarize(m: BModuleName, state: any, candidate: any): ModuleSummary {
  const n = (x: unknown) => (Array.isArray(x) ? x.length : 0);
  const counts: Record<string, number> = {};
  const highlights: string[] = [];
  switch (m) {
    case "b01":
      counts.channels = n(state.channels);
      counts.content_territories = n(state.content_territories);
      highlights.push(`Brand: ${state.brand_profile?.brand_name} — ${state.brand_profile?.positioning ?? "positioning UNKNOWN"}`);
      for (const t of state.content_territories ?? []) highlights.push(`Territory (from documentation keywords): ${t.territory_id ?? t.name ?? JSON.stringify(t).slice(0, 60)}`);
      break;
    case "b02":
      counts.opportunities = n(state.opportunities);
      for (const o of state.opportunities ?? []) highlights.push(`${o.title} — relevance ${o.strategic_relevance} (${o.strategic_relevance_basis})`);
      break;
    case "b03":
      counts.segments = n(state.audience_segments);
      for (const g of state.audience_segments ?? []) highlights.push(`${g.segment_name} (${g.segment_basis}, confidence ${g.confidence})`);
      break;
    case "b04":
      counts.campaigns = n(state.campaigns);
      for (const k of state.campaigns ?? []) highlights.push(`${k.campaign_name}: ${k.primary_objective} (${k.confidence_basis})`);
      break;
    case "b05":
      counts.angles = n(state.creative_angles);
      counts.briefs = n(state.creative_briefs);
      counts.constraints = n(state.creative_constraints);
      for (const a of state.creative_angles ?? []) highlights.push(`Angle "${a.title}" [${a.derivation_basis}]: ${a.core_message}`);
      break;
    case "b06":
      counts.channel_selections = n(state.channel_selections);
      counts.format_rules = n(state.format_rules);
      counts.schedules = n(state.content_schedules);
      for (const f of state.format_rules ?? []) highlights.push(`Format ${f.preferred_content_formats?.join("/")} · ${f.duration_category} [${f.rule_basis}]`);
      for (const sc of state.content_schedules ?? []) highlights.push(`Schedule ${sc.posting_frequency} at ${sc.optimal_posting_times?.join(", ")} [${sc.schedule_basis}]`);
      break;
    case "b07":
      counts.kpis = n(state.kpi_definitions);
      for (const k of state.kpi_definitions ?? []) highlights.push(`KPI ${k.metric_name}: target ${k.target_definition?.value} ${k.target_definition?.unit} [${k.target_definition?.basis}]`);
      break;
    case "b08":
      counts.analytics_results = n(state.analytics_results);
      break;
    case "b09":
      counts.observations = n(state.observations);
      counts.signals = n(state.signals);
      break;
    case "b10":
      counts.proposals = n(state.optimization_proposals);
      for (const p of state.optimization_proposals ?? []) highlights.push(`Proposal: ${p.proposed_change} [${p.proposal_basis}]`);
      break;
    case "b11":
      counts.rules = n(state.compliance_rules);
      counts.checks = n(state.compliance_checks);
      for (const k of state.compliance_checks ?? []) if (k.status !== "COMPLIANT") highlights.push(`Compliance ${k.status}: ${k.compliance_rule_id}`);
      break;
  }
  return { fingerprint: strategyFingerprint(state), counts, highlights: highlights.slice(0, 12), gaps: gapTexts(candidate) };
}

function blockersOf(states: Record<BModuleName, any>, candidates: Record<BModuleName, any>, brief?: StrategyBrief): string[] {
  const b: string[] = [];
  // B03 gives zero confidence to analytics without verified_at, which silently
  // empties B04–B07. Name the cause instead of only the symptom.
  const segs: any[] = states.b03.audience_segments ?? [];
  const unverified = (brief?.audience?.platform_analytics ?? []).filter((a: any) => !a.verified_at);
  if (segs.length > 0 && segs.every((g) => !g.confidence) && unverified.length) {
    b.push(`B03 audience segments have confidence 0: ${unverified.length} platform_analytics entr${unverified.length === 1 ? "y has" : "ies have"} no verified_at. Add the date you read the numbers in YouTube Studio (B treats undated analytics as unverified).`);
  }
  const empty = (m: BModuleName, what: string, arr: unknown) => {
    if (!Array.isArray(arr) || arr.length === 0) b.push(`${m.toUpperCase()} produced no ${what}. B's own gaps: ${gapTexts(candidates[m]).join("; ") || "none reported"}`);
  };
  empty("b02", "opportunities (needs channels with audience_category and a brand positioning)", states.b02.opportunities);
  empty("b03", "audience segments (needs audience evidence that names the channel or platform, e.g. platform_analytics)", states.b03.audience_segments);
  empty("b04", "campaigns", states.b04.campaigns);
  empty("b05", "creative angles", states.b05.creative_angles);
  empty("b06", "channel selections", states.b06.channel_selections);
  empty("b07", "KPIs", states.b07.kpi_definitions);
  for (const c of states.b11.compliance_checks ?? []) if ((c.final_compliance_decision ?? c.status) === "NON_COMPLIANT") b.push(`B11 NON_COMPLIANT: ${c.compliance_rule_id}`);
  return b;
}

async function snapshot(states: Record<BModuleName, any>, persist: Record<BModuleName, StatePersistence>, version: string, now?: () => string) {
  const reader = Object.fromEntries(B_MODULES.map((m) => [m, persist[m]])) as any;
  const v = version;
  return B12.createBranchState(v, v, v, v, v, v, v, v, v, v, v, { upstreamReader: reader, ...(now ? { now } : {}) });
}

function assertBrief(brief: StrategyBrief): void {
  if (!brief || brief.brief_type !== "OWNER_STRATEGY_BRIEF") throw new BridgeError(BRIDGE, "NOT_A_BRIEF", "brief_type must be OWNER_STRATEGY_BRIEF");
  // The brief flows into review.md, the store and the directive: no credentials in it.
  assertNoSecrets(brief, "$brief");
  if (!brief.brand?.brand_name) throw new BridgeError(BRIDGE, "BRIEF_BRAND_REQUIRED", "brief.brand.brand_name is required");
  if (!brief.channels?.length) throw new BridgeError(BRIDGE, "BRIEF_CHANNELS_REQUIRED", "brief.channels must list at least one channel");
}

/** Tag appended to the B12 commit rationale; verified by buildCreativeDirective. */
export function commitBindingTag(bundleHash: string, og: CommittedStrategy["owner_goals"] | undefined): string {
  return `[unified bundle=${bundleHash} owner_goals=${og ? hashValue(og) : "none"}]`;
}

function ownerGoals(brief: StrategyBrief) {
  const goals = brief.owner_goals ?? [];
  const constraints = brief.owner_constraints ?? [];
  return goals.length || constraints.length ? { goals, constraints, brief_hash: hashValue(brief) } : undefined;
}

// ---------------------------------------------------------------- public API

export type StrategyStore = Record<BModuleName | "b12", StatePersistence>;

/** Next vX.Y after the newest version found in the store (v1.0 when empty). */
export async function nextVersion(store?: StrategyStore): Promise<string> {
  let best: [number, number] | null = null;
  for (const m of B_MODULES) {
    for (const v of (await store?.[m].listVersions()) ?? []) {
      const mm = /^v(\d+)\.(\d+)$/.exec(v);
      if (mm) {
        const t: [number, number] = [Number(mm[1]), Number(mm[2])];
        if (!best || t[0] > best[0] || (t[0] === best[0] && t[1] > best[1])) best = t;
      }
    }
  }
  return best ? `v${best[0]}.${best[1] + 1}` : "v1.0";
}

async function seeded(store?: StrategyStore): Promise<Record<BModuleName, StatePersistence>> {
  const work = persistences();
  if (store) for (const m of B_MODULES) { const p = await store[m].latest(); if (p) await work[m].save(p); }
  return work;
}

export async function proposeStrategy(
  bundle: StrategyInputBundle,
  brief: StrategyBrief,
  options: { intelligence?: B08.ExternalIntelligenceContext; now?: () => string; store?: StrategyStore } = {},
): Promise<StrategyProposal> {
  verifyEnvelope(BRIDGE, bundle, "UNIFIED_STRATEGY_INPUT_BUNDLE");
  assertBrief(brief);
  const version = await nextVersion(options.store);
  const persist = await seeded(options.store);
  const run = await runChain(bundle, brief, PREVIEW_AUTHORITY, version, persist, options.intelligence);
  const snap = await snapshot(run.states, persist, version, options.now);
  const cs = snap.completeness_summary as any;
  const blockers = blockersOf(run.states, run.candidates, brief);
  const modules = Object.fromEntries(B_MODULES.map((m) => [m, summarize(m, run.states[m], run.candidates[m])])) as Record<BModuleName, ModuleSummary>;
  const created_at = (options.now ?? (() => new Date().toISOString()))();
  const body: Omit<StrategyProposal, "identity"> = {
    proposal_type: "B_STRATEGY_PROPOSAL",
    schema_version: UNIFIED_SCHEMA_VERSION,
    bundle_hash: bundle.identity.content_hash,
    brief_hash: hashValue(brief),
    intelligence_hash: options.intelligence ? hashValue(options.intelligence) : null,
    version,
    modules,
    readiness: {
      ready: blockers.length === 0,
      blockers,
      semantic_validity: String(cs.semantic_validity ?? "UNKNOWN"),
      semantic_findings: [...new Set<string>(cs.semantic_findings ?? [])],
      operational_readiness: String(cs.operational_readiness ?? "UNKNOWN"),
      operational_findings: [...new Set<string>(cs.operational_findings ?? [])],
    },
    created_at,
  };
  return sealEnvelope<StrategyProposal>(body, {
    object_id: `bprop_${shortHash(body.bundle_hash)}_${shortHash(body.brief_hash)}`,
    object_type: "UNIFIED_B_STRATEGY_PROPOSAL",
    version: "v1",
    created_at,
  });
}

export function decisionsTemplate(proposal: StrategyProposal): StrategyDecisions {
  return {
    authority: "<your name>",
    rationale: "<why this strategy is approved>",
    approve: Object.fromEntries(B_MODULES.map((m) => [m, false])) as Record<BModuleName, boolean>,
    proposal_hash: proposal.identity.content_hash,
  };
}

export async function commitStrategy(
  bundle: StrategyInputBundle,
  brief: StrategyBrief,
  proposal: StrategyProposal,
  decisions: StrategyDecisions,
  options: {
    intelligence?: B08.ExternalIntelligenceContext;
    now?: () => string;
    /** Durable stores; states are written only after the whole chain passed. */
    store?: StrategyStore;
  } = {},
): Promise<StrategyCommitResult> {
  verifyEnvelope(BRIDGE, bundle, "UNIFIED_STRATEGY_INPUT_BUNDLE");
  verifyEnvelope(BRIDGE, proposal, "UNIFIED_B_STRATEGY_PROPOSAL");
  assertBrief(brief);
  if (decisions.proposal_hash !== proposal.identity.content_hash) throw new BridgeError(BRIDGE, "DECISIONS_FOR_OTHER_PROPOSAL", "decisions.proposal_hash does not match the proposal");
  const authority = assertHumanAuthority(BRIDGE, decisions.authority, "decisions.authority");
  const rationale = decisions.rationale?.trim() ?? "";
  if (!rationale || rationale.startsWith("<")) throw new BridgeError(BRIDGE, "RATIONALE_REQUIRED", "decisions.rationale is required");
  const notApproved = B_MODULES.filter((m) => decisions.approve[m] !== true);
  if (notApproved.length) throw new BridgeError(BRIDGE, "MODULES_NOT_APPROVED", `not approved: ${notApproved.join(", ")} — change the brief/inputs and propose again`);
  if (proposal.bundle_hash !== bundle.identity.content_hash) throw new BridgeError(BRIDGE, "INPUT_CHANGED", "bundle differs from the reviewed proposal");
  if (proposal.brief_hash !== hashValue(brief)) throw new BridgeError(BRIDGE, "INPUT_CHANGED", "brief differs from the reviewed proposal");
  if (proposal.intelligence_hash !== (options.intelligence ? hashValue(options.intelligence) : null)) throw new BridgeError(BRIDGE, "INPUT_CHANGED", "external intelligence differs from the reviewed proposal");
  if (!proposal.readiness.ready) throw new BridgeError(BRIDGE, "STRATEGY_NOT_READY", proposal.readiness.blockers.join(" | "));

  const version = proposal.version;
  if (version !== (await nextVersion(options.store))) {
    throw new BridgeError(BRIDGE, "STORE_CHANGED", `store moved on since the proposal (expected to commit ${version}); propose again`);
  }
  // Work in memory first (seeded with prior versions for audit diffs); persist only on success.
  const work = await seeded(options.store);
  const run = await runChain(bundle, brief, authority, version, work, options.intelligence, (m, state) => {
    const fp = strategyFingerprint(state);
    if (fp !== proposal.modules[m].fingerprint) {
      throw new BridgeError(BRIDGE, "FINGERPRINT_MISMATCH", `${m} differs from what was reviewed (${shortHash(proposal.modules[m].fingerprint)} → ${shortHash(fp)}); propose again`);
    }
  });
  const snap = await snapshot(run.states, work, version, options.now);
  const b12Store = options.store?.b12 ?? memoryPersistence();
  // The owner's own goals and the bundle are bound into the sealed, human-committed
  // B12 decision so a later edit of strategy.json cannot slip in unapproved goals.
  const og = ownerGoals(brief);
  const bound = `${rationale} ${commitBindingTag(bundle.identity.content_hash, og)}`;
  const branch = await B12.commitBranchState(snap, authority, bound, memoryPersistence(), options.now ? { now: options.now } : undefined);
  // Nothing that looks like a credential may reach the durable store.
  assertNoSecrets({ states: run.states, branch }, "$strategy");
  if (options.store) {
    for (const m of B_MODULES) await options.store[m].save(run.states[m]);
    await b12Store.save(branch);
  }
  const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
  const result: StrategyCommitResult = {
    commit_type: "B_STRATEGY_COMMIT",
    bundle_hash: bundle.identity.content_hash,
    brief_hash: proposal.brief_hash,
    proposal_hash: proposal.identity.content_hash,
    branch: clone(branch),
    b05: clone(run.states.b05),
    b06: clone(run.states.b06),
    b07: clone(run.states.b07),
    b10: clone(run.states.b10),
    b11: clone(run.states.b11),
    ...(og ? { owner_goals: og } : {}),
    states: clone(run.states),
  };
  return signCommittedStrategy(result);
}

// ---------------------------------------------------------------- review

export function proposalMarkdown(p: StrategyProposal, brief: StrategyBrief): string {
  const L: string[] = [];
  L.push(`# B stratejisi — inceleme (${p.identity.object_id})`, "");
  L.push(`Proposal hash: \`${p.identity.content_hash}\`  `, `Bundle: \`${shortHash(p.bundle_hash)}\` · Brief: \`${shortHash(p.brief_hash)}\` · Dış veri: ${p.intelligence_hash ? `\`${shortHash(p.intelligence_hash)}\`` : "yok"}`, "");
  L.push(p.readiness.ready ? "**Durum: onaya hazır.**" : "**Durum: HAZIR DEĞİL — commit reddedilecek.**", "");
  if (p.readiness.blockers.length) L.push("## Engeller", ...p.readiness.blockers.map((b) => `- ${b}`), "");
  L.push("## Sahibin kendi hedefleri (USER_DEFINED)", ...(brief.owner_goals?.length ? brief.owner_goals.map((g) => `- ${g}`) : ["- (yok — directive yalnızca B'nin şablon/heuristik hedeflerini taşıyacak)"]), "");
  L.push("## Modüller", "", "Köşeli parantezler B'nin kendi epistemik etiketidir. TEMPLATE/HEURISTIC/DEFAULT = kanıta dayanmıyor; directive'e bu etiketle girer.", "");
  for (const m of B_MODULES) {
    const s = p.modules[m];
    L.push(`### ${m.toUpperCase()} — \`${shortHash(s.fingerprint)}\``, `Sayılar: ${Object.entries(s.counts).map(([k, v]) => `${k}=${v}`).join(", ") || "-"}`);
    if (s.highlights.length) L.push(...s.highlights.map((h) => `- ${h}`));
    if (s.gaps.length) L.push(`- _B'nin bildirdiği eksikler:_ ${s.gaps.join("; ")}`);
    L.push("");
  }
  L.push("## B12 değerlendirmesi", `- Semantik geçerlilik: **${p.readiness.semantic_validity}**`, ...p.readiness.semantic_findings.map((f) => `  - ${f}`), `- Operasyonel hazırlık: **${p.readiness.operational_readiness}**`, ...p.readiness.operational_findings.map((f) => `  - ${f}`), "");
  L.push("## Onay", "`decisions.json` dosyasında her modülü `true` yapın, `authority` ve `rationale` alanlarını doldurun, sonra `unified b-commit` çalıştırın. Girdiler (bundle, brief, dış veri) değişirse commit reddedilir; yeniden `b-propose` gerekir.");
  return L.join("\n") + "\n";
}
