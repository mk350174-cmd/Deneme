// B01 Completeness Scoring
// Calculate 0-100 completeness score using 8 weighted structural categories,
// plus three independently-inspectable components (Decision G / canonical
// plan Phase H): completeness is NOT purely "are fields populated" — it also
// separately reports how STRONG the underlying evidence is, how much of the
// candidate carries real decision-lineage (provenance), and how many
// detected conflicts remain unresolved. These three are exposed as their
// own fields rather than blended into `score` with an invented weight —
// Decision G explicitly forbids inventing arbitrary numeric weights; any
// future decision to combine them into the headline score is a separate
// product/architecture call, not made here.

import type { B01CandidateState } from "./types.js";
import type { EvidenceStatus } from "../types/entities.js";
import type { ProvenanceRef } from "../b00/provenanceRef.js";

export interface CompletenessResult {
  score: number; // 0-100 — structural presence score (unchanged formula from before this pass)
  missing_inputs: string[];
  blocking_decisions: string[];
  category_scores: Record<string, number>;

  /** Same value as `score`, exposed under its real name: "how much of the
   *  decision space has fields populated at all", independent of whether
   *  that data is well-evidenced or already governed. */
  structuralPresence: number; // 0-100
  /** 0-1: evidence-strength-weighted average across all evidence_refs found
   *  on the candidate (VERIFIED=1.0, INFERRED=0.5, UNKNOWN=0.0). Answers "how
   *  solid is the underlying data", independent of how much is populated. */
  evidenceQuality: number;
  /** 0-1: fraction of major phase outputs that carry non-empty
   *  provenance_refs. Answers "how much of this candidate has a real
   *  decision-lineage marker attached", independent of evidence strength. */
  provenanceCoverage: number;
  /** 0-1: fraction of detected conflicts that have been resolved (1.0 if no
   *  conflicts exist). Answers "how much outstanding disagreement remains",
   *  independent of the above three. */
  conflictCoverage: number;
}

/**
 * Calculate completeness score using 8 weighted categories:
 * - brand_profile (15%): name+positioning+mission vs partial vs missing
 * - channels_roles (20%): % channels with non-UNKNOWN role
 * - platforms_caps (10%): % platforms with defined capabilities
 * - territories (10%): binary (≥1 = 1.0, none = 0.0)
 * - distribution (15%): % channels with role assignments
 * - editorial (15%): binary (≥1 rule = 1.0, empty = 0.0)
 * - constraints (10%): 1.0 - (unresolved_high_conflicts / total_conflicts)
 * - no_high_conflicts (5%): 1.0 if no high conflicts, 0.0 otherwise
 */
export function calculateCompleteness(candidate: B01CandidateState): CompletenessResult {
  const categoryScores: Record<string, number> = {};

  // Category 1: brand_profile (15%)
  // 1.0 = has name + positioning + mission
  // 0.5 = has name only
  // 0.0 = missing critical data
  let profileScore = 0;
  if (candidate.brand_arch?.positioning_summary && candidate.brand_arch.positioning_summary !== "UNKNOWN") {
    profileScore += 0.33; // positioning
  }
  if (candidate.ecosystem?.channels && candidate.ecosystem.channels.length > 0) {
    profileScore += 0.33; // name (implicit)
  }
  if (candidate.brand_arch?.value_themes && candidate.brand_arch.value_themes.length > 0) {
    profileScore += 0.34; // values
  }
  categoryScores["brand_profile"] = Math.min(1.0, profileScore);

  // Category 2: channels_roles (20%)
  // % of channels with non-UNKNOWN role
  let roleScore = 0;
  if (candidate.role_map && candidate.ecosystem?.channels) {
    const knownRoles = Object.values(candidate.role_map).filter((rm) => rm.role !== "UNKNOWN").length;
    roleScore = candidate.ecosystem.channels.length > 0 ? knownRoles / candidate.ecosystem.channels.length : 0;
  }
  categoryScores["channels_roles"] = roleScore;

  // Category 3: platforms_caps (10%)
  // % of platforms with defined capabilities
  let capScore = 0;
  if (candidate.platform_registry && Object.keys(candidate.platform_registry).length > 0) {
    const withCaps = Object.values(candidate.platform_registry).filter(
      (p) => p.capabilities && p.capabilities.length > 0,
    ).length;
    capScore = withCaps / Object.keys(candidate.platform_registry).length;
  }
  categoryScores["platforms_caps"] = capScore;

  // Category 4: territories (10%)
  // Binary: has ≥1 territory = 1.0, none = 0.0
  let terrScore = 0;
  if (candidate.territories?.territories && candidate.territories.territories.length > 0) {
    terrScore = 1.0;
  }
  categoryScores["territories"] = terrScore;

  // Category 5: distribution (15%)
  // % of channels with distribution role assignments
  let distScore = 0;
  if (candidate.distribution?.channel_assignments && candidate.ecosystem?.channels) {
    const assigned = candidate.distribution.channel_assignments.filter((a) => a.distribution_role !== "UNKNOWN").length;
    distScore =
      candidate.ecosystem.channels.length > 0 ? assigned / candidate.ecosystem.channels.length : 0;
  }
  categoryScores["distribution"] = distScore;

  // Note: Uses 'distribution_role' from b01/types.ts DistributionData (internal B01 model).
  // Mapping to canonical 'role' field happens in orchestration.ts when building B01CanonicalState.

  // Category 6: editorial (15%)
  // Binary: has ≥1 non-UNKNOWN rule = 1.0, empty = 0.0
  // Fixed vacuous check: previously filtered on `r.type !== "UNKNOWN"`, a
  // field that does not exist on the real EditorialRule shape (rules carry
  // `category`/`rule_text`, never `type`) — the filter always evaluated
  // `undefined !== "UNKNOWN"` (always true), so any non-empty rules array
  // scored 1.0 regardless of content. Now checks the fields that actually
  // exist: a rule only counts if it has non-empty rule_text and a
  // recognized category.
  let editScore = 0;
  const validCategories = new Set(["tone", "content_type", "audience_fit", "brand_safety", "compliance"]);
  if (candidate.editorial?.rules && candidate.editorial.rules.length > 0) {
    const meaningful = candidate.editorial.rules.filter(
      (r) => r.rule_text && r.rule_text.trim().length > 0 && validCategories.has(r.category),
    ).length;
    if (meaningful > 0) {
      editScore = 1.0;
    }
  }
  categoryScores["editorial"] = editScore;

  // Category 7: constraints (10%)
  // 1.0 - (unresolved_high_conflicts / total_conflicts)
  let constraintScore = 1.0;
  const highConflicts = candidate.constraints?.conflicts.filter((c) => c.severity === "high") ?? [];
  const unresolvedHigh = highConflicts.filter((c) => !c.resolution).length;
  if (candidate.constraints?.conflicts && candidate.constraints.conflicts.length > 0) {
    constraintScore = 1.0 - unresolvedHigh / candidate.constraints.conflicts.length;
  }
  categoryScores["constraints"] = constraintScore;

  // Category 8: no_high_conflicts (5%)
  // 1.0 if zero unresolved high-severity, 0.0 otherwise
  let noHighScore = unresolvedHigh === 0 ? 1.0 : 0.0;
  categoryScores["no_high_conflicts"] = noHighScore;

  // Weighted sum
  const weights: Record<string, number> = {
    brand_profile: 0.15,
    channels_roles: 0.2,
    platforms_caps: 0.1,
    territories: 0.1,
    distribution: 0.15,
    editorial: 0.15,
    constraints: 0.1,
    no_high_conflicts: 0.05,
  };

  let score = 0;
  for (const [category, weight] of Object.entries(weights)) {
    score += (categoryScores[category] ?? 0) * weight;
  }

  // Identify missing inputs and blocking decisions
  const missing_inputs: string[] = [];
  const blocking_decisions: string[] = [];

  if (!candidate.brand_arch || candidate.brand_arch.positioning_summary === "UNKNOWN") {
    missing_inputs.push("Brand positioning not provided");
  }

  // Blocking: channels with UNKNOWN roles
  const unknownRoles = Object.entries(candidate.role_map ?? {})
    .filter(([, rm]) => rm.role === "UNKNOWN")
    .map(([chId]) => chId);
  if (unknownRoles.length > 0) {
    blocking_decisions.push(`${unknownRoles.length} channel(s) with undefined roles`);
  }

  // Blocking: no distribution strategy
  if (!candidate.distribution || candidate.distribution.channel_assignments.length === 0) {
    blocking_decisions.push("Distribution strategy not defined");
  }

  // Blocking: unresolved high conflicts
  if (unresolvedHigh > 0) {
    blocking_decisions.push(`${unresolvedHigh} unresolved high-severity conflict(s)`);
  }

  // Blocking: no editorial rules
  if (!candidate.editorial || candidate.editorial.rules.length === 0) {
    blocking_decisions.push("Editorial constitution not defined");
  }

  // --- evidenceQuality: strength-weighted average across all evidence_refs
  // found anywhere on the candidate (top-level + per-channel + per-platform +
  // per-role + per-territory + per-assignment + per-rule). ---
  const evidenceWeight: Record<EvidenceStatus, number> = { VERIFIED: 1.0, INFERRED: 0.5, UNKNOWN: 0 };
  const allEvidenceRefs = [
    ...(candidate.evidence_refs ?? []),
    ...(candidate.ecosystem?.channels.flatMap((c) => c.evidence_refs ?? []) ?? []),
    ...(candidate.ecosystem?.platforms.flatMap((p) => p.evidence_refs ?? []) ?? []),
    ...(candidate.brand_arch?.evidence_refs ?? []),
    ...Object.values(candidate.role_map ?? {}).flatMap((r) => r.evidence_refs ?? []),
    ...(candidate.territories?.territories.flatMap((t) => t.evidence_refs ?? []) ?? []),
    ...(candidate.distribution?.channel_assignments.flatMap((a) => a.evidence_refs ?? []) ?? []),
    ...(candidate.editorial?.evidence_refs ?? []),
  ];
  const evidenceQuality =
    allEvidenceRefs.length > 0
      ? allEvidenceRefs.reduce((sum, ref) => sum + evidenceWeight[ref.status], 0) / allEvidenceRefs.length
      : 0;

  // --- provenanceCoverage: fraction of major phase outputs (that declare a
  // provenance_refs field) which actually have it populated. ---
  const provenanceBearingPhases: Array<ProvenanceRef[] | undefined> = [
    candidate.ecosystem?.provenance_refs,
    candidate.brand_arch?.provenance_refs,
    candidate.relationship_graph?.provenance_refs,
    candidate.territories?.provenance_refs,
    candidate.distribution?.provenance_refs,
    candidate.editorial?.provenance_refs,
    candidate.constraints?.provenance_refs,
  ];
  const populatedProvenancePhases = provenanceBearingPhases.filter((refs) => refs && refs.length > 0).length;
  const provenanceCoverage = provenanceBearingPhases.length > 0
    ? populatedProvenancePhases / provenanceBearingPhases.length
    : 0;

  // --- conflictCoverage: fraction of detected conflicts that are resolved
  // (1.0 if none exist — nothing outstanding to resolve). ---
  const allConflicts = candidate.constraints?.conflicts ?? [];
  const conflictCoverage =
    allConflicts.length === 0 ? 1.0 : allConflicts.filter((c) => !!c.resolution).length / allConflicts.length;

  return {
    score: Math.round(score * 100),
    missing_inputs,
    blocking_decisions,
    category_scores: categoryScores,
    structuralPresence: Math.round(score * 100),
    evidenceQuality,
    provenanceCoverage,
    conflictCoverage,
  };
}
