// B02.02 — Analytical Opportunity Evaluation Layer
// Identifies strategic opportunities at intersection of positioning, platforms, capabilities

import type { B01CanonicalState, EvidenceRef } from "../../b00/contracts.js";
import type { ProvenanceRef } from "../../b00/provenanceRef.js";
import type { B02StrategicOpportunity, OpportunityType, B02Deps, EvaluationContext } from "../types.js";
import { buildRegistryContext } from "./B02_01_registry.js";
import { canonicalHasher } from "../../b00/hashing.js";
import { normalizeEvidenceRef } from "../../b00/evidence.js";

function inheritedChannelEvidence(channel: B01CanonicalState["channels"][number]): EvidenceRef[] {
  return (channel.evidence_refs || []).map((ref) => normalizeEvidenceRef(ref));
}

function inferredEvidence(id: string, source: string, excerpt: string): EvidenceRef {
  return { id, source, status: "INFERRED", origin: "SYSTEM_DERIVATION", basis: "INFERRED", source_mode: "REAL", production_eligible: true, excerpt };
}

function unknownConstraint(c: B01CanonicalState["strategic_constraints"][number]) {
  return {
    constraint_id: c.constraint_id,
    description: c.description,
    status: "UNKNOWN" as const,
    evidence_refs: [],
    reason: "No B02 evaluator established whether this opportunity satisfies the constraint",
  };
}

/** Evaluate positioning + platform alignment → strategic opportunities */
export function evaluatePositioningAlignment(
  b01State: B01CanonicalState,
  deps?: B02Deps,
): B02StrategicOpportunity[] {
  const opportunities: B02StrategicOpportunity[] = [];
  const deps_ = deps || createDefaultB02Deps();
  const now = deps_.now?.() || new Date().toISOString();

  const registry = buildRegistryContext(b01State, deps);

  // Analyze each channel × platform combination
  for (const channel of b01State.channels) {
    const platform = channel.platform?.toString() || "UNKNOWN";

    // Skip if no positioning defined
    if (!b01State.brand_profile?.positioning) {
      continue;
    }

    // Opportunity 1: Platform audience alignment
    const hasAudience =
      channel.audience_category &&
      ["professional", "lifestyle", "creators", "broad", "niche"].includes(channel.audience_category);

    if (hasAudience) {
      const opportunity: B02StrategicOpportunity = {
        opportunity_id: deps_.hash?.stableOpportunityId(
          b01State.version,
          channel.channel_id,
          "positioning_alignment",
        ) || `op_${channel.channel_id}_positioning`,

        title: `${platform} positioning alignment opportunity`,
        description: `Platform audience (${channel.audience_category}) aligns with brand positioning`,

        channel_id: channel.channel_id,
        platform_name: platform,

        opportunity_type: "positioning_alignment" as OpportunityType,
        strategic_relevance: 0.75,
        strategic_relevance_basis: "HEURISTIC",
        strategic_relevance_reason: "Rule-based platform/audience alignment weight; not a measured outcome",

        blocking_constraints: (b01State.strategic_constraints || []).map(unknownConstraint),

        supporting_evidence: [
          ...inheritedChannelEvidence(channel),
          inferredEvidence(`ev_${channel.channel_id}_audience_alignment`, "B02.positioning_alignment", `Heuristic alignment between ${channel.audience_category} and the current B01 positioning`),
        ],

        provenance: {
          id: `prov_${channel.channel_id}_positioning`,
          type: "INFERRED",
          decision_authority: "B02_strategist_agent",
          timestamp: now,
          rationale:
            "Algorithm inferred: platform audience category matches positioning theme",
        } as ProvenanceRef,

        gaps: [],
      };

      opportunities.push(opportunity);
    }

    // Opportunity 2: Capability match
    const platformCaps = registry.platformCapabilities.get(platform) || new Set();
    if (platformCaps.size > 0) {
      const opportunity: B02StrategicOpportunity = {
        opportunity_id: deps_.hash?.stableOpportunityId(
          b01State.version,
          channel.channel_id,
          "capability_match",
        ) || `op_${channel.channel_id}_capability`,

        title: `${platform} capability match opportunity`,
        description: `Platform capabilities (${Array.from(platformCaps).slice(0, 2).join(", ")}) enable content strategy`,

        channel_id: channel.channel_id,
        platform_name: platform,

        opportunity_type: "capability_match" as OpportunityType,
        strategic_relevance: 0.7,
        strategic_relevance_basis: "HEURISTIC",
        strategic_relevance_reason: "Rule-based capability-match weight; not a measured outcome",

        blocking_constraints: [],

        supporting_evidence: [
          ...inheritedChannelEvidence(channel),
          inferredEvidence(`ev_capabilities_${channel.channel_id}`, "B00.terminology.PLATFORMS_REGISTRY", `Registry-defined platform capabilities: ${Array.from(platformCaps).join(", ")}`),
        ],

        provenance: {
          id: `prov_${channel.channel_id}_capability`,
          type: "INFERRED",
          decision_authority: "B02_capability_matcher",
          timestamp: now,
          rationale:
            "Algorithm inferred: platform capabilities enable content distribution strategy",
        } as ProvenanceRef,

        gaps: [],
      };

      opportunities.push(opportunity);
    }

    // Opportunity 3: Role-based prioritization
    const role = channel.role || "UNKNOWN";
    if (role === "primary" || role === "secondary") {
      const opportunity: B02StrategicOpportunity = {
        opportunity_id: deps_.hash?.stableOpportunityId(
          b01State.version,
          channel.channel_id,
          `territory_opportunity:${role}`,
        ) || `op_${channel.channel_id}_role`,

        title: `${platform} primary distribution opportunity`,
        description: `${role.toUpperCase()} channel priority for content distribution`,

        channel_id: channel.channel_id,
        platform_name: platform,

        opportunity_type: "territory_opportunity" as OpportunityType,
        strategic_relevance: role === "primary" ? 0.9 : 0.7,
        strategic_relevance_basis: "HEURISTIC",
        strategic_relevance_reason: "Rule-based channel-role weight; role is upstream data but score is not empirical",

        blocking_constraints: [],

        supporting_evidence: [
          ...inheritedChannelEvidence(channel),
          inferredEvidence(`ev_role_${channel.channel_id}`, "B02.channel_role_rule", `Opportunity derived from canonical channel role: ${role}`),
        ],

        provenance: {
          id: `prov_${channel.channel_id}_role`,
          type: "OBSERVED",
          decision_authority: "B01_orchestration",
          timestamp: now,
          rationale: "B01 explicitly identified channel role; opportunity follows directly",
        } as ProvenanceRef,

        gaps: [],
      };

      opportunities.push(opportunity);
    }
  }

  return opportunities;
}

/** Evaluate editorial constitution → content type opportunities */
export function evaluateEditorialFit(
  b01State: B01CanonicalState,
  opportunities: B02StrategicOpportunity[],
  deps?: B02Deps,
): B02StrategicOpportunity[] {
  if (!b01State.editorial_constitution || !Array.isArray(b01State.editorial_constitution.rules)) {
    return opportunities;
  }

  const deps_ = deps || createDefaultB02Deps();
  const now = deps_.now?.() || new Date().toISOString();
  const newOpportunities: B02StrategicOpportunity[] = [];

  for (const rule of b01State.editorial_constitution.rules) {
    if (!rule.applies_to || rule.applies_to.length === 0) {
      continue;
    }

    // For each channel, if content type is permitted, add constraint satisfaction opportunity
    for (const channel of b01State.channels) {
      const platform = channel.platform?.toString() || "UNKNOWN";

      const opportunity: B02StrategicOpportunity = {
        opportunity_id: deps_.hash?.stableOpportunityId(
          b01State.version,
          channel.channel_id,
          `constraint_satisfaction:${rule.rule_id}`,
        ) || `op_${channel.channel_id}_${rule.rule_id}_editorial`,

        title: `${platform} editorial constraint satisfaction`,
        description: `Channel permits ${rule.applies_to.join(", ")} content angles under rule: ${rule.description}`,

        channel_id: channel.channel_id,
        platform_name: platform,

        opportunity_type: "constraint_satisfaction" as OpportunityType,
        strategic_relevance: 0.65,
        strategic_relevance_basis: "HEURISTIC",
        strategic_relevance_reason: "Rule-based editorial-fit weight; not a measured outcome",

        blocking_constraints: [],

        supporting_evidence: [
          ...inheritedChannelEvidence(channel),
          ...(b01State.editorial_constitution?.evidence_refs || []).map((ref) => normalizeEvidenceRef(ref)),
          inferredEvidence(`ev_editorial_${channel.channel_id}_${rule.rule_id}`, "B02.editorial_fit_rule", `Rule ${rule.rule_id} applies to ${rule.applies_to.join(", ")}; B02 infers a possible fit`),
        ],

        provenance: {
          id: `prov_${channel.channel_id}_editorial`,
          type: "INFERRED",
          decision_authority: "B02_editorial_analyzer",
          timestamp: now,
          rationale:
            "Algorithm inferred: editorial constitution rule permits these content angles on this channel",
        } as ProvenanceRef,

        gaps: [],
      };

      newOpportunities.push(opportunity);
    }
  }

  return [...opportunities, ...newOpportunities];
}

/** Create default B02Deps for standalone testing */
export function createDefaultB02Deps(): B02Deps {
  return {
    hash: {
      stableOpportunityId: (inputId: string, channelId: string, opportunityType: string) =>
        `opp_${canonicalHasher.hash(`${inputId}:${channelId}:${opportunityType}`)}`,
      stableClassId: (inputId: string, className: string) =>
        `class_${canonicalHasher.hash(`${inputId}:${className}`)}`,
    },
    secretGuard: {
      redactSecrets: (text: string) => text,
    },
    now: () => new Date().toISOString(),
  };
}
