// B01.11 — Constraint Aggregation
// Combine all constraints from B01.01-B01.10 into canonical B00 shapes.
// Identify gaps where data is missing.
//
// CRITICAL (per canonical plan Decision E/F): B01.11 is a PURE constraint
// aggregator. It does NOT run its own conflict-detection algorithm — that
// would create a second, competing conflict engine whose output either gets
// silently discarded (the prior defect: this file used to detect conflicts,
// but orchestration.ts always overwrote its `conflicts` field with
// src/b01/conflicts.ts's separate top-level detectConflicts() pass) or,
// worse, disagree with the authoritative one. `src/b01/conflicts.ts` is the
// SOLE conflict-detection authority for B01 (see that file's module comment).
// The one real detection rule this phase used to run (a tone-rule
// "avoid"+"professional" string collision) has been migrated there.

import type { B01Deps, EcosystemData, DistributionData, EditorialData, AggregatedConstraint } from "../types.js";
import type { EvidenceRef, Recommendation, ConflictRecord, Gap } from "../../b00/contracts.js";
import type { ConstraintLevel } from "../../b00/terminology.js";
import type { ProvenanceRef } from "../../b00/provenanceRef.js";
import { stableEvidenceId } from "../../b00/stableIds.js";

export interface ConstraintAggregationData {
  aggregation_id: string;
  constraints: AggregatedConstraint[];
  conflicts: ConflictRecord[]; // Always empty from this phase; see module comment.
  gaps: Gap[];
  constraint_count: number;
  conflict_count: number;
  gap_count: number;
  evidence_refs: EvidenceRef[];
  provenance_refs?: ProvenanceRef[];
  recommendation: Recommendation;
}

/**
 * Create evidence ref for constraint aggregation
 */
function createEvidenceRef(source: string, seed: string): EvidenceRef {
  return {
    id: stableEvidenceId(source, seed),
    source,
    status: "INFERRED", // Aggregation inferred from phases; user approval required
    excerpt: `Constraint aggregation from ${source}`,
  };
}

/** required|recommended|informational (B01's aggregation-level judgment) maps
 *  1:1 onto B00's canonical ConstraintLevel — a real semantic correspondence,
 *  not a lossy cast: required=hard_blocker, recommended=soft_constraint,
 *  informational=guidance. */
function toConstraintLevel(level: "required" | "recommended" | "informational"): ConstraintLevel {
  switch (level) {
    case "required":
      return "hard_blocker";
    case "recommended":
      return "soft_constraint";
    case "informational":
      return "guidance";
  }
}

/**
 * Extract distribution constraints
 *
 * Constraints from B01.08 distribution strategy:
 * - Channel assignment constraints (what channels, priorities, timing)
 * - Format constraints (preferred formats, forbidden formats)
 */
function extractDistributionConstraints(
  distribution: DistributionData,
): { constraints: AggregatedConstraint[]; evidence: EvidenceRef[] } {
  const constraints: AggregatedConstraint[] = [];
  const evidence: EvidenceRef[] = [];

  if (!distribution || !distribution.channel_assignments) {
    return { constraints, evidence };
  }

  for (const assignment of distribution.channel_assignments) {
    const chanConstraintId = stableEvidenceId("B01.08:distribution", `channel_${assignment.channel_id}`);
    const chanEv = createEvidenceRef("B01.08:distribution", chanConstraintId);
    evidence.push(chanEv);

    constraints.push({
      constraint_id: chanConstraintId,
      description: `Channel '${assignment.channel_id}' has distribution role '${assignment.distribution_role}' with priority ${assignment.routing_priority}`,
      level: toConstraintLevel("required"),
      binding_module: "distribution",
      scope: [assignment.channel_id],
      evidence_refs: [chanEv],
    });

    if (assignment.format_rules && assignment.format_rules.preferred_formats.length > 0) {
      const fmtConstraintId = stableEvidenceId("B01.08:distribution", `format_${assignment.channel_id}`);
      const fmtEv = createEvidenceRef("B01.08:distribution", fmtConstraintId);
      evidence.push(fmtEv);

      constraints.push({
        constraint_id: fmtConstraintId,
        description: `Channel '${assignment.channel_id}' prefers formats: ${assignment.format_rules.preferred_formats.join(", ")}`,
        level: toConstraintLevel("recommended"),
        binding_module: "distribution",
        scope: [assignment.channel_id],
        evidence_refs: [fmtEv],
      });
    }
  }

  return { constraints, evidence };
}

/**
 * Extract editorial constraints
 *
 * Constraints from B01.09 editorial constitution: tone, content type, brand
 * safety, compliance rules.
 */
function extractEditorialConstraints(
  editorial: EditorialData | undefined,
): { constraints: AggregatedConstraint[]; evidence: EvidenceRef[] } {
  const constraints: AggregatedConstraint[] = [];
  const evidence: EvidenceRef[] = [];

  if (!editorial || !editorial.rules || editorial.rules.length === 0) {
    return { constraints, evidence };
  }

  for (const rule of editorial.rules) {
    const ruleConstraintId = stableEvidenceId("B01.09:editorial", rule.rule_id);
    const ruleEv = createEvidenceRef("B01.09:editorial", ruleConstraintId);
    evidence.push(ruleEv);

    const level = toConstraintLevel(rule.category === "brand_safety" ? "required" : "recommended");
    const scope = rule.applies_to_channels || [];
    const description = `${rule.category} rule: ${rule.rule_text}`;

    constraints.push({
      constraint_id: ruleConstraintId,
      description,
      level,
      binding_module: "editorial",
      scope,
      evidence_refs: [ruleEv],
    });
  }

  return { constraints, evidence };
}

/**
 * Identify gaps in data, expressed directly in B00's canonical Gap shape
 * (gap_id, description, required_for, priority) rather than a local shadow.
 *
 * Gaps occur when:
 * - Channels defined but no distribution strategy
 * - No editorial constitution
 */
function identifyGaps(
  ecosystem: EcosystemData,
  distribution: DistributionData,
  editorial: EditorialData,
): { gaps: Gap[]; evidence: EvidenceRef[] } {
  const gaps: Gap[] = [];
  const evidence: EvidenceRef[] = [];

  if (ecosystem?.channels && ecosystem.channels.length > 0) {
    if (!distribution || !distribution.channel_assignments || distribution.channel_assignments.length === 0) {
      const gapId = stableEvidenceId("B01.11:gap", "distribution_strategy_missing");
      const gapEv = createEvidenceRef("B01.11:gap", gapId);
      evidence.push(gapEv);

      gaps.push({
        gap_id: gapId,
        description: "Channels defined but distribution strategy is missing or empty",
        required_for: "distribution strategy definition",
        priority: "high",
      });
    }
  }

  if (!editorial || !editorial.rules || editorial.rules.length === 0) {
    const gapId = stableEvidenceId("B01.11:gap", "editorial_constitution_missing");
    const gapEv = createEvidenceRef("B01.11:gap", gapId);
    evidence.push(gapEv);

    gaps.push({
      gap_id: gapId,
      description: "Editorial constitution rules are missing or empty",
      required_for: "editorial constitution definition",
      priority: "medium",
    });
  }

  return { gaps, evidence };
}

/**
 * B01.11 phase: Aggregate all constraints from prior phases into canonical
 * B00 shapes. Does NOT detect conflicts (see module comment) — always
 * returns `conflicts: []`; src/b01/conflicts.ts is the sole authority.
 *
 * Input: EcosystemData, DistributionData, EditorialData
 * Output: ConstraintAggregationData with all constraints and gaps
 */
export async function runPhaseB0111(
  ecosystem: EcosystemData,
  distribution: DistributionData,
  editorial: EditorialData,
  _deps?: B01Deps,
): Promise<ConstraintAggregationData> {
  const stableId = stableEvidenceId("B01.11:constraint_aggregation", "aggregation_v1");
  const aggregation_id = `aggregation_${stableId}`;

  const allConstraints: AggregatedConstraint[] = [];
  const allEvidence: EvidenceRef[] = [];

  const { constraints: distConstraints, evidence: distEvidence } = extractDistributionConstraints(distribution);
  allConstraints.push(...distConstraints);
  allEvidence.push(...distEvidence);

  const { constraints: editConstraints, evidence: editEvidence } = extractEditorialConstraints(editorial);
  allConstraints.push(...editConstraints);
  allEvidence.push(...editEvidence);

  const { gaps, evidence: gapEvidence } = identifyGaps(ecosystem, distribution, editorial);
  allEvidence.push(...gapEvidence);

  const provenance_refs: ProvenanceRef[] = allConstraints.map((c) => ({
    id: stableEvidenceId("B01.11:provenance", c.constraint_id),
    type: "INFERRED",
    decision_authority: "B01_constraint_aggregator",
    timestamp: new Date().toISOString(),
    rationale: `Algorithm aggregated constraint from ${c.binding_module}: ${c.description}`,
  }));

  return {
    aggregation_id,
    constraints: allConstraints,
    conflicts: [], // B01.11 does not detect conflicts; conflicts.ts is authoritative.
    gaps,
    constraint_count: allConstraints.length,
    conflict_count: 0,
    gap_count: gaps.length,
    evidence_refs: allEvidence,
    provenance_refs,
    recommendation: {
      recommendation_id: `rec_constraints_${aggregation_id}`,
      source_agent: "B01.11",
      proposal: `Aggregated ${allConstraints.length} constraints, identified ${gaps.length} gaps. User review required.`,
      timestamp: new Date().toISOString(),
      adopted: false, // User must approve for canonical status
    },
  };
}
