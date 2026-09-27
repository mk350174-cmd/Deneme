// B05.04 — Creative Constraints
// Identify and codify creative constraints for brand safety

import type { CreativeConstraint } from "../types.js";
import type { ProvenanceRef } from "../../b00/provenanceRef.js";
import type { B01CanonicalState } from "../../b00/contracts.js";
import type { B04CandidateState, B04CanonicalState } from "../../b04/types.js";

export function identifyCreativeConstraints(
  b01State: B01CanonicalState,
  b04State: B04CandidateState | B04CanonicalState,
  deps?: { hash?: { stableConstraintId: (campaignId: string, type: string) => string }; now?: () => string },
): CreativeConstraint[] {
  const constraints: CreativeConstraint[] = [];
  const stableConstraintId =
    deps?.hash?.stableConstraintId || ((cid: string, type: string) => `const_${cid}_${type}`);
  const now = deps?.now?.() || new Date().toISOString();

  // Brand value constraints
  const brandValues = b01State?.brand_profile?.values || [];
  for (const campaign of b04State?.campaigns || []) {
    if (brandValues.length > 0) {
      constraints.push({
        constraint_id: stableConstraintId(campaign.campaign_id, "brand_values"),
        campaign_id: campaign.campaign_id,
        constraint_type: "brand_protection" as const,
        description: "Must align with brand values",
        details: brandValues.map((v: string) => `Maintain alignment with: ${v}`),

        rationale: "Brand authenticity and consistency",
        editorial_authority: "Brand guidelines",

        evidence_refs: [
          {
            id: `ev_const_${stableConstraintId(campaign.campaign_id, "brand_values")}`,
            source: `brand_profile:${b01State?.brand_profile?.brand_name}`,
            status: "INFERRED" as const,
            origin: "SYSTEM_DERIVATION" as const, basis: "INFERRED" as const, source_mode: "REAL" as const,
            excerpt: `Brand values: ${brandValues.join(", ")}`,
          },
        ],
        provenance: {
          type: "OBSERVED" as const,
          decision_authority: `B01:brand_profile`,
          timestamp: now,
          rationale: `Brand values from B01 canonical state`,
        },
        derivation_basis: "EVIDENCE_BACKED",
      });
    }

    // Territory-based constraints
    const territories = campaign.territories || [];
    if (territories.length > 0) {
      constraints.push({
        constraint_id: stableConstraintId(campaign.campaign_id, "territory_compliance"),
        campaign_id: campaign.campaign_id,
        constraint_type: "required_elements" as const,
        description: "Territory-specific compliance requirements",
        details: territories.map((t: string) => `Must comply with ${t} regulations`),

        rationale: "Legal and regulatory compliance",
        editorial_authority: "Territory management",

        evidence_refs: [
          {
            id: `ev_const_${stableConstraintId(campaign.campaign_id, "territory_compliance")}`,
            source: `campaign:${campaign.campaign_id}`,
            status: "INFERRED" as const,
            excerpt: `Territories: ${territories.join(", ")}`,
          },
        ],
        provenance: {
          type: "INFERRED" as const,
          decision_authority: `B04:campaign.territories`,
          timestamp: now,
          rationale: `Territory routing from B04 canonical state`,
        },
        derivation_basis: "HEURISTIC",
      });
    }

    // Audience-specific constraints
    const targetSegments = campaign.target_segments || [];
    if (targetSegments.length > 0) {
      constraints.push({
        constraint_id: stableConstraintId(campaign.campaign_id, "audience_appropriateness"),
        campaign_id: campaign.campaign_id,
        constraint_type: "tone_requirements" as const,
        description: "Content must be appropriate for target audience",
        details: targetSegments.map((s: string) => `Audience-appropriate for: ${s}`),

        rationale: "Audience respect and engagement",
        editorial_authority: "Audience guidelines",

        evidence_refs: [
          {
            id: `ev_const_${stableConstraintId(campaign.campaign_id, "audience_appropriateness")}`,
            source: `campaign:${campaign.campaign_id}`,
            status: "INFERRED" as const,
            excerpt: `Target segments: ${targetSegments.join(", ")}`,
          },
        ],
        provenance: {
          type: "INFERRED" as const,
          decision_authority: `B04:campaign.target_segments`,
          timestamp: now,
          rationale: `Target segments from B04 campaign strategy`,
        },
        derivation_basis: "HEURISTIC",
      });
    }
  }

  return constraints;
}
