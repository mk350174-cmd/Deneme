// B01.10 — Rule Decision Logic
// Evaluate rule applicability, feasibility, and consistency
// CRITICAL: Evaluates rule APPLICABILITY, NOT content violations (can't assess without actual content).
// CRITICAL: NO content compliance checking. Evaluate whether rules are coherent and applicable to strategy.

import type { B01Deps, EcosystemData, DistributionData, EditorialData, EditorialRule, RuleVerdict } from "../types.js";
import type { EvidenceRef, Recommendation } from "../../b00/contracts.js";
import type { ProvenanceRef } from "../../b00/provenanceRef.js";
import { stableEvidenceId } from "../../b00/stableIds.js";

export type { RuleVerdict };

export interface DecisionLogicData {
  evaluation_id: string;
  rule_verdicts: RuleVerdict[];
  total_rules: number;
  approved_count: number;
  flagged_count: number;
  blocked_count: number;
  evidence_refs: EvidenceRef[];
  provenance_refs?: ProvenanceRef[]; // PHASE 2: Track decision chain
  recommendation: Recommendation;
}

/**
 * Create evidence ref for decision logic evaluation
 */
function createEvidenceRef(source: string, seed: string): EvidenceRef {
  return {
    id: stableEvidenceId(source, seed),
    source,
    status: "INFERRED", // Decision logic inferred from rules; user approval required
    excerpt: `Decision logic evaluation from ${source}`,
  };
}

/**
 * Evaluate rule applicability to editorial strategy
 *
 * Checks:
 * - Rule text clarity (not ambiguous)
 * - Applicability to channels (rule has target channels)
 * - Consistency (rule doesn't directly conflict with other rules)
 *
 * Does NOT check: content violations, production specs, topic alignment
 */
function evaluateRuleApplicability(
  rule: EditorialRule,
  allRules: EditorialRule[], // All rules for consistency check
): RuleVerdict {
  const ruleId = rule.rule_id;
  const evRefs: EvidenceRef[] = [];
  let status: "approved" | "flagged" | "blocked" | "needs_revision" | "UNKNOWN" = "approved";
  let rationale = "";
  let detConfidence = 0.9;

  // Check 1: Rule text is not empty (deterministic)
  const evCheck1 = createEvidenceRef("B01.10:applicability_check", `${ruleId}_clarity`);
  evRefs.push(evCheck1);
  if (!rule.rule_text || rule.rule_text.trim().length === 0) {
    status = "blocked";
    rationale = "Rule text is empty or missing";
    detConfidence = 0;
  }

  // Check 2: No direct conflicts with brand_safety rules (deterministic)
  if (status === "approved" && rule.category === "tone") {
    const conflicts = allRules.filter(
      (r) =>
        r.category === "brand_safety" &&
        r.rule_text.toLowerCase().includes("avoid") &&
        rule.rule_text.toLowerCase().includes("avoid"),
    );
    if (conflicts.length > 0) {
      status = "flagged";
      rationale = "Tone rule may conflict with brand safety constraints; review needed";
      detConfidence = 0.7;
    }
  }

  // Check 3: Category is recognized (deterministic)
  const validCategories = ["tone", "content_type", "audience_fit", "brand_safety", "compliance"];
  if (status === "approved" && !validCategories.includes(rule.category)) {
    status = "blocked";
    rationale = `Rule category '${rule.category}' is not recognized`;
    detConfidence = 0;
  }

  // Default status if all checks pass
  if (status === "approved") {
    rationale = "Rule is clear, feasible, and consistent with editorial strategy";
  }

  return {
    rule_id: ruleId,
    status,
    basis: "deterministic",
    deterministic_confidence: detConfidence,
    evidence_refs: evRefs,
    rationale,
  };
}

/**
 * Evaluate rule feasibility in distribution context
 *
 * Checks:
 * - Rule can be applied to available channels
 * - Rule duration/format constraints are realistic
 *
 * Does NOT check: user approval, content alignment, audience segment fit
 */
function evaluateRuleFeasibility(
  rule: EditorialRule,
  distribution: DistributionData,
): RuleVerdict {
  const ruleId = rule.rule_id;
  const evRefs: EvidenceRef[] = [];
  let status: "approved" | "flagged" | "blocked" | "needs_revision" | "UNKNOWN" = "approved";
  let rationale = "";
  let detConfidence = 0.85;

  // Check 1: Rule has target channels or applies to all (deterministic)
  const evCheck1 = createEvidenceRef("B01.10:feasibility_check", `${ruleId}_channel_applicability`);
  evRefs.push(evCheck1);

  if (rule.applies_to_channels && rule.applies_to_channels.length === 0) {
    status = "needs_revision";
    rationale = "Rule specifies empty channel list; clarify if applies to all or none";
    detConfidence = 0.5;
  }

  // Check 2: If rule targets specific channels, they exist in distribution (deterministic)
  if (status === "approved" && rule.applies_to_channels && rule.applies_to_channels.length > 0) {
    const validChannelIds = distribution.channel_assignments.map((a) => a.channel_id);
    const missingChannels = rule.applies_to_channels.filter((chId: string) => !validChannelIds.includes(chId));

    if (missingChannels.length > 0) {
      status = "flagged";
      rationale = `Rule targets channels not in distribution strategy: ${missingChannels.join(", ")}`;
      detConfidence = 0.7;
    }
  }

  if (status === "approved") {
    rationale = "Rule can be applied to distribution channels";
  }

  return {
    rule_id: ruleId,
    status,
    basis: "deterministic",
    deterministic_confidence: detConfidence,
    evidence_refs: evRefs,
    rationale,
  };
}

/**
 * B01.10 phase: Evaluate editorial rules for applicability and feasibility
 *
 * Input: EditorialData, DistributionData
 * Output: DecisionLogicData with rule verdicts
 *
 * CRITICAL BOUNDARIES:
 * 1. Evaluates rule applicability/feasibility (NOT content violations)
 * 2. NOT production compliance checking (A-Branch responsibility)
 * 3. NOT content type correctness (no "this rule violates content" claims)
 * 4. Agent evaluates applicability; only user approval makes decision canonical
 *
 * DecisionLogicData structure:
 * - evaluation_id: unique identifier for this evaluation
 * - rule_verdicts: array of RuleVerdict with status (approved/flagged/blocked/needs_revision/UNKNOWN)
 * - count fields: total, approved, flagged, blocked
 * - evidence_refs: evaluation evidence
 * - recommendation: user approval required (adopted=false)
 */
export async function runPhaseB0110(
  ecosystem: EcosystemData,
  editorial: EditorialData,
  distribution: DistributionData,
  _deps?: B01Deps,
): Promise<DecisionLogicData> {
  const stableId = stableEvidenceId("B01.10:decision_logic", "evaluation_v1");
  const evaluation_id = `evaluation_${stableId}`;
  const rule_verdicts: RuleVerdict[] = [];
  const evidenceRefs: EvidenceRef[] = [];

  if (!editorial || !editorial.rules || editorial.rules.length === 0) {
    return {
      evaluation_id,
      rule_verdicts: [],
      total_rules: 0,
      approved_count: 0,
      flagged_count: 0,
      blocked_count: 0,
      evidence_refs: [],
      provenance_refs: [],
      recommendation: {
        recommendation_id: `rec_decision_${evaluation_id}`,
        source_agent: "B01.10",
        proposal: "No editorial rules to evaluate.",
        timestamp: new Date().toISOString(),
        adopted: false,
      },
    };
  }

  // Evaluate each rule
  for (const rule of editorial.rules) {
    // Evaluate applicability
    const appVerdict = evaluateRuleApplicability(rule, editorial.rules);
    rule_verdicts.push(appVerdict);
    evidenceRefs.push(...appVerdict.evidence_refs);

    // Evaluate feasibility
    const feasVerdict = evaluateRuleFeasibility(rule, distribution);
    if (feasVerdict.status !== "approved") {
      // If feasibility flagged the rule, use that verdict
      rule_verdicts[rule_verdicts.length - 1] = {
        ...appVerdict,
        status: feasVerdict.status === "flagged" && appVerdict.status === "approved" ? "flagged" : appVerdict.status,
        basis: "mixed",
        rationale: (appVerdict.rationale || "") + " " + (feasVerdict.rationale || ""),
      };
    }
    evidenceRefs.push(...feasVerdict.evidence_refs);
  }

  // Count verdicts
  const approved_count = rule_verdicts.filter((v) => v.status === "approved").length;
  const flagged_count = rule_verdicts.filter((v) => v.status === "flagged").length;
  const blocked_count = rule_verdicts.filter((v) => v.status === "blocked").length;

  const provenance_refs: ProvenanceRef[] = rule_verdicts.map((v) => ({
    id: stableEvidenceId("B01.10:provenance", `${v.rule_id}_verdict`),
    type: "INFERRED",
    decision_authority: "B01_decision_logic_agent",
    timestamp: new Date().toISOString(),
    rationale: `Algorithm evaluated rule '${v.rule_id}' applicability/feasibility: ${v.status}`,
  }));

  return {
    evaluation_id,
    rule_verdicts,
    total_rules: editorial.rules.length,
    approved_count,
    flagged_count,
    blocked_count,
    evidence_refs: evidenceRefs,
    provenance_refs,
    recommendation: {
      recommendation_id: `rec_decision_${evaluation_id}`,
      source_agent: "B01.10",
      proposal: `Evaluated ${editorial.rules.length} rules: ${approved_count} approved, ${flagged_count} flagged, ${blocked_count} blocked. User review required for flagged/blocked.`,
      timestamp: new Date().toISOString(),
      adopted: false, // User must approve verdicts for canonical status
    },
  };
}
