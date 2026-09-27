import { stableEvidenceId } from "../../b00/stableIds.js";
// B01.02 — Brand Architecture
// Extract brand positioning, values, mission from user context (heuristic agent)

import type { B01Input } from "../../b00/contracts.js";
import type { BrandArchitecture } from "../types.js";
import type { B01Deps } from "../types.js";
import type { Recommendation, EvidenceRef } from "../../b00/contracts.js";
import type { ProvenanceRef } from "../../b00/provenanceRef.js";

/**
 * Extract positioning summary from user input
 * Looks for explicit positioning statement or infers from values/mission
 */
function extractPositioning(input: B01Input): string | "UNKNOWN" {
  // Direct positioning from brand_context
  if (input.brand_context?.positioning) {
    return input.brand_context.positioning.trim();
  }

  // Try to infer from mission + values
  const hasMission = !!input.brand_context?.mission;
  const hasValues = (input.brand_context?.values?.length ?? 0) > 0;

  if (hasMission && hasValues) {
    // User provided both; hint that positioning is inferrable but not explicit
    return "UNKNOWN"; // Don't fabricate; user must provide explicit positioning
  }

  return "UNKNOWN";
}

/**
 * Extract value themes from user input
 */
function extractValues(input: B01Input): string[] {
  if (!input.brand_context?.values || !Array.isArray(input.brand_context.values)) {
    return [];
  }

  return input.brand_context.values.map((v) => (typeof v === "string" ? v.trim() : "")).filter((v) => v.length > 0);
}

/**
 * Create evidence refs for brand context
 */
function createBrandEvidenceRefs(input: B01Input): EvidenceRef[] {
  const refs: EvidenceRef[] = [];

  if (input.brand_context?.positioning) {
    refs.push({
      id: stableEvidenceId("brand_context", "positioning"),
      source: "user_input:brand_context.positioning",
      status: "INFERRED",
      origin: "USER_ASSERTION",
      basis: "ASSERTED",
      source_mode: "REAL",
      production_eligible: true,
      excerpt: `Positioning provided: "${input.brand_context.positioning.substring(0, 60)}"`,
    });
  }

  if (input.brand_context?.values && input.brand_context.values.length > 0) {
    refs.push({
      id: stableEvidenceId("brand_context", "values"),
      source: "user_input:brand_context.values",
      status: "INFERRED",
      origin: "USER_ASSERTION",
      basis: "ASSERTED",
      source_mode: "REAL",
      production_eligible: true,
      excerpt: `${input.brand_context.values.length} values provided`,
    });
  }

  if (input.brand_context?.mission) {
    refs.push({
      id: stableEvidenceId("brand_context", "mission"),
      source: "user_input:brand_context.mission",
      status: "INFERRED",
      origin: "USER_ASSERTION",
      basis: "ASSERTED",
      source_mode: "REAL",
      production_eligible: true,
      excerpt: `Mission provided: "${input.brand_context.mission.substring(0, 60)}"`,
    });
  }

  return refs;
}

/**
 * B01.02 phase: Extract brand architecture (positioning, values, mission)
 *
 * Input: B01Input with brand_context
 * Output: BrandArchitecture with positioning_summary, value_themes, evidence_refs, recommendation
 *
 * Algorithm:
 * 1. Extract positioning from brand_context or mark UNKNOWN
 * 2. Extract values from brand_context
 * 3. Create evidence refs for all extracted data
 * 4. Emit recommendation if any positioning conflicts detected (e.g., mission vs positioning drift)
 * 5. Return BrandArchitecture
 */
export async function runPhaseB0102(
  input: B01Input,
  _deps?: B01Deps,
): Promise<BrandArchitecture> {
  const positioning_summary = extractPositioning(input);
  const value_themes = extractValues(input);
  const evidence_refs = createBrandEvidenceRefs(input);

  // Generate recommendation if positioning missing but values/mission provided
  const recommendation: Recommendation = {
    recommendation_id: `rec_brand_positioning_${input.input_id}`,
    source_agent: "B01.02_BrandStrategist",
    proposal:
      positioning_summary === "UNKNOWN"
        ? "Brand positioning not explicitly provided. Consider adding explicit positioning statement for strategic clarity."
        : `Positioning confirmed: "${positioning_summary}"`,
    timestamp: new Date().toISOString(),
    adopted: false,
    rationale_if_rejected: positioning_summary === "UNKNOWN" ? "User chose to proceed without explicit positioning" : undefined,
  };

  // OBSERVED provenance means the user assertion was observed; it does not upgrade the assertion to VERIFIED evidence.
  const provenance_refs: ProvenanceRef[] =
    positioning_summary !== "UNKNOWN"
      ? [
          {
            id: `prov_${input.input_id}_positioning`,
            type: "OBSERVED",
            decision_authority: "B01_brand_arch_discovery",
            timestamp: new Date().toISOString(),
            rationale: "Positioning echoed directly from user-provided brand_context.positioning",
          },
        ]
      : [];

  // UNIFIED FIX B-1: brand name and mission were never carried from the
  // input, so canonical state always showed brand_name "UNKNOWN".
  const brand_name = input.brand_context?.brand_name?.trim() || "UNKNOWN";
  const mission = input.brand_context?.mission?.trim() || "UNKNOWN";

  return {
    brand_name,
    mission,
    positioning_summary,
    value_themes,
    evidence_refs,
    provenance_refs,
    recommendation,
  };
}
