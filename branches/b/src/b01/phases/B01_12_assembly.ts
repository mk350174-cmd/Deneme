// B01.12 — Canonical State Assembly
// Aggregate all phases (B01.01-B01.11) into B01CandidateState.
// Calculate completeness, identify blocking decisions, assemble pre-decision state.
// CRITICAL: B01.12 is ASSEMBLY ONLY. Versioning/persistence is future B12 responsibility.
//
// This phase previously accepted only `EcosystemData` and hardcoded every
// other phase's output to `undefined`, despite its own doc-comment claiming
// to assemble all 11 prior phases — the real assembly happened inline in
// `runB01()` instead (a defect this rewrite fixes: `runB01()` now calls this
// function with the real outputs of B01.01-B01.11, and this function does
// the actual aggregation work its name and docs always claimed).

import type {
  B01Deps,
  B01CandidateState,
  EcosystemData,
  BrandArchitecture,
  RoleMap,
  RelationshipGraph,
  PlatformRegistry,
  ChannelFitMap,
  TerritoryData,
  DistributionData,
  EditorialData,
  RuleVerdict,
} from "../types.js";
import type { Recommendation } from "../../b00/contracts.js";
import type { EvidenceRef } from "../../types/entities.js";
import type { ProvenanceRef } from "../../b00/provenanceRef.js";
import type { ConstraintAggregationData } from "./B01_11_constraint_aggregation.js";
import { calculateCompleteness } from "../completeness.js";

export interface B0112AssemblyInput {
  candidateId: string;
  ecosystem: EcosystemData;
  brand_arch: BrandArchitecture;
  role_map: RoleMap;
  relationship_graph: RelationshipGraph;
  platform_registry: PlatformRegistry;
  channel_fit: ChannelFitMap;
  territories: TerritoryData;
  distribution: DistributionData;
  editorial: EditorialData;
  rule_verdicts: RuleVerdict[];
  constraintAgg: ConstraintAggregationData;
  allEvidence: EvidenceRef[];
  allProvenance: ProvenanceRef[];
  allRecommendations: Recommendation[];
}

/**
 * B01.12 phase: Assemble all 11 prior phase outputs into B01CandidateState.
 *
 * Input: real outputs of B01.01 through B01.11 (via B0112AssemblyInput)
 * Output: B01CandidateState (pre-decision, pre-version candidate state)
 *
 * CRITICAL BOUNDARIES:
 * 1. Assemble outputs from all prior phases (no new domain logic introduced here)
 * 2. Calculate completeness score (what % of decision space is defined)
 * 3. Identify blocking decisions (what must user decide next)
 * 4. Return PRE-DECISION candidate state (NOT yet versioned or canonical)
 * 5. Versioning/persistence is B12 responsibility (future phase) — this
 *    function does not version, audit, persist, or require user approval.
 */
export async function runPhaseB0112(
  input: B0112AssemblyInput,
  _deps?: B01Deps,
): Promise<B01CandidateState> {
  const timestamp = new Date().toISOString();

  const candidateState: B01CandidateState = {
    candidate_id: input.candidateId,
    created_at: timestamp,
    updated_at: timestamp,

    ecosystem: input.ecosystem,
    brand_arch: input.brand_arch,
    role_map: input.role_map,
    relationship_graph: input.relationship_graph,
    platform_registry: input.platform_registry,
    channel_fit: input.channel_fit,
    territories: input.territories,
    distribution: input.distribution,
    editorial: input.editorial,
    rule_verdicts: input.rule_verdicts,
    constraints: {
      strategic_constraints: input.constraintAgg.constraints,
      conflicts: input.constraintAgg.conflicts,
      gaps: input.constraintAgg.gaps,
      evidence_refs: input.constraintAgg.evidence_refs,
      provenance_refs: input.constraintAgg.provenance_refs,
      recommendation: input.constraintAgg.recommendation,
    },

    prior_canonical_state: undefined,
    prior_audit_trail: [],

    // Placeholder; overwritten immediately below by calculateCompleteness,
    // which needs the fully-assembled candidate to compute real scores.
    completeness: { score: 0, missing_inputs: [], blocking_decisions: [] },

    evidence_refs: input.allEvidence,
    all_recommendations: input.allRecommendations,
    provenance_refs: input.allProvenance,
  };

  const completenessResult = calculateCompleteness(candidateState);
  candidateState.completeness = {
    score: completenessResult.score,
    missing_inputs: completenessResult.missing_inputs,
    blocking_decisions: completenessResult.blocking_decisions,
  };

  return candidateState;
}
