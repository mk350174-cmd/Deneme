// B01.07 — Territory Rules & Content Boundaries
// Extract territory constraints from documentation; NO inference from platform names or audience assumptions.
// CRITICAL: Territories are geographic/regulatory/timezone constraints only. Audience segmentation is B03's job.

import type { B01Deps, EcosystemData, TerritoryData } from "../types.js";
import type { B01Input } from "../../b00/contracts.js";
import type { EvidenceRef } from "../../types/entities.js";
import type { ProvenanceRef } from "../../b00/provenanceRef.js";
import { stableEvidenceId } from "../../b00/stableIds.js";

/**
 * UNIFIED FIX B-2: whole-word / whole-phrase match. Plain substring search
 * turned "focus" into "us" (North America), "best"/"interest" into "est"
 * (Eastern time), "neutral" into "eu", etc.
 */
function mentions(doc: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "iu").test(doc);
}


/**
 * Create evidence ref for territory rule extraction.
 *
 * Status is INFERRED, not VERIFIED, despite this phase's rule of only
 * reading "EXPLICIT documentation" (see below): the extraction itself is a
 * keyword-proximity heuristic (e.g. matching "europe" or "gdpr" substrings),
 * not a verbatim read of an explicit territory declaration — per the
 * VERIFIED/INFERRED semantic rule (src/types/entities.ts), VERIFIED means
 * the underlying data is directly confirmed, which a heuristic keyword match
 * is not. "Explicit documentation only" describes the *source* (never
 * inferring from platform name/audience), not the *extraction confidence*.
 */
function createEvidenceRef(source: string, seed: string): EvidenceRef {
  return {
    id: stableEvidenceId(source, seed),
    source,
    status: "INFERRED",
    excerpt: `Territory rule from ${source}`,
  };
}

/**
 * Extract geographic territories from documentation
 *
 * Looks for patterns like:
 * - "available in [countries]"
 * - "restricted in [countries]"
 * - "geo-block [regions]"
 * - Does NOT infer from platform name (e.g., "LinkedIn = US" is wrong)
 */
function extractGeographicTerritories(documentation: string[]): Array<{
  territory_id: string;
  type: "geographic";
  boundaries: string[];
  compliance_notes: string[];
}> {
  const territories: Array<{
    territory_id: string;
    type: "geographic";
    boundaries: string[];
    compliance_notes: string[];
  }> = [];

  for (const doc of documentation) {
    if (!doc) continue;

    const docLower = doc.toLowerCase();

    // Look for explicit geographic mentions
    if (mentions(docLower, "north america") || mentions(docLower, "us") || mentions(docLower, "usa")) {
      territories.push({
        territory_id: "geo_north_america",
        type: "geographic",
        boundaries: ["US", "Canada", "Mexico"],
        compliance_notes: ["Mentioned in documentation"],
      });
    }

    if (mentions(docLower, "europe") || mentions(docLower, "eu")) {
      territories.push({
        territory_id: "geo_europe",
        type: "geographic",
        boundaries: ["EU", "UK", "Switzerland"],
        compliance_notes: ["GDPR compliance required"],
      });
    }

    if (mentions(docLower, "asia") || mentions(docLower, "apac")) {
      territories.push({
        territory_id: "geo_asia_pacific",
        type: "geographic",
        boundaries: ["JP", "SG", "AU", "India"],
        compliance_notes: ["Regional platform rules apply"],
      });
    }

    if (mentions(docLower, "china") /* UNIFIED FIX B-2: the generic word "restricted" no longer implies China */) {
      territories.push({
        territory_id: "geo_china_restricted",
        type: "geographic",
        boundaries: [],
        compliance_notes: ["China: restricted access", "Great Firewall considerations"],
      });
    }
  }

  return territories;
}

/**
 * Extract timezone-based territories from documentation
 */
function extractTimezoneTerritories(documentation: string[]): Array<{
  territory_id: string;
  type: "timezone";
  boundaries: string[];
  compliance_notes: string[];
}> {
  const territories: Array<{
    territory_id: string;
    type: "timezone";
    boundaries: string[];
    compliance_notes: string[];
  }> = [];

  for (const doc of documentation) {
    if (!doc) continue;

    const docLower = doc.toLowerCase();

    if (mentions(docLower, "pst") || mentions(docLower, "pacific")) {
      territories.push({
        territory_id: "tz_pst",
        type: "timezone",
        boundaries: ["PST", "PDT"],
        compliance_notes: ["US Pacific timezone operations"],
      });
    }

    if (mentions(docLower, "est") || mentions(docLower, "eastern")) {
      territories.push({
        territory_id: "tz_est",
        type: "timezone",
        boundaries: ["EST", "EDT"],
        compliance_notes: ["US Eastern timezone operations"],
      });
    }

    if (mentions(docLower, "gmt") || mentions(docLower, "utc")) {
      territories.push({
        territory_id: "tz_utc",
        type: "timezone",
        boundaries: ["UTC", "GMT"],
        compliance_notes: ["Universal timezone reference"],
      });
    }
  }

  return territories;
}

/**
 * Extract regulatory territories from documentation
 */
function extractRegulatoryTerritories(documentation: string[]): Array<{
  territory_id: string;
  type: "regulatory";
  boundaries: string[];
  compliance_notes: string[];
}> {
  const territories: Array<{
    territory_id: string;
    type: "regulatory";
    boundaries: string[];
    compliance_notes: string[];
  }> = [];

  for (const doc of documentation) {
    if (!doc) continue;

    const docLower = doc.toLowerCase();

    if (mentions(docLower, "gdpr") || mentions(docLower, "european")) {
      territories.push({
        territory_id: "reg_gdpr",
        type: "regulatory",
        boundaries: ["EU", "EEA"],
        compliance_notes: ["GDPR compliance mandatory", "Data processing agreements required"],
      });
    }

    if (mentions(docLower, "ccpa") || mentions(docLower, "california")) {
      territories.push({
        territory_id: "reg_ccpa",
        type: "regulatory",
        boundaries: ["California"],
        compliance_notes: ["CCPA opt-out required", "Consumer privacy rights"],
      });
    }

    if (mentions(docLower, "copyright") || mentions(docLower, "dmca")) {
      territories.push({
        territory_id: "reg_copyright",
        type: "regulatory",
        boundaries: ["US", "International"],
        compliance_notes: ["Copyright protection enforcement", "DMCA considerations"],
      });
    }
  }

  return territories;
}

/**
 * B01.07 phase: Extract territory constraints from documentation
 *
 * Input: EcosystemData, B01Input (documentation fields), and ecosystem channels
 * Output: TerritoryData with geographic/timezone/regulatory boundaries
 *
 * CRITICAL RULES:
 * 1. Only extract from EXPLICIT documentation (user-provided, brand guidelines, policies)
 * 2. NEVER infer territories from platform name ("LinkedIn = professional = US" is WRONG)
 * 3. NEVER segment audiences (that's B03's job; territories are constraints only)
 * 4. If territory not documented, don't create it; mark as gap instead
 *
 * Territory structure:
 * - type: "geographic" (countries/regions) | "timezone" | "regulatory"
 * - boundaries: explicit list of regions/zones
 * - compliance_notes: rules or considerations
 * - channels_allowed: which channels can be used in this territory
 * - channels_restricted: channels with limitations
 */
export async function runPhaseB0107(
  ecosystem: EcosystemData,
  input: B01Input | undefined,
  _deps?: B01Deps,
): Promise<TerritoryData> {
  const territories: TerritoryData["territories"] = [];
  const evidenceRefs: EvidenceRef[] = [];

  // Collect documentation sources
  const docSources: string[] = [];
  if (input?.documentation?.brand_guidelines) {
    docSources.push(input.documentation.brand_guidelines);
  }
  if (input?.documentation?.channel_policies) {
    docSources.push(input.documentation.channel_policies);
  }
  if (input?.documentation?.editorial_standards) {
    docSources.push(input.documentation.editorial_standards);
  }

  // Extract territories from documentation (explicit only, no inference)
  const geoTerritories = extractGeographicTerritories(docSources);
  const tzTerritories = extractTimezoneTerritories(docSources);
  const regTerritories = extractRegulatoryTerritories(docSources);

  // Combine and deduplicate by territory_id
  const allTerritories = [...geoTerritories, ...tzTerritories, ...regTerritories];
  const seen = new Set<string>();

  for (const terr of allTerritories) {
    if (!seen.has(terr.territory_id)) {
      seen.add(terr.territory_id);

      // Create evidence for this territory
      const evRef = createEvidenceRef("documentation_extraction", terr.territory_id);
      evidenceRefs.push(evRef);

      // Add territory with channel constraints (empty by default; user can populate)
      territories.push({
        territory_id: terr.territory_id,
        type: terr.type, // "geographic"|"timezone"|"regulatory" are all valid TerritoryType members; no cast needed
        description: `${terr.type} territory: ${terr.boundaries.join(", ")}`,
        boundaries: terr.boundaries,
        channels_allowed: ecosystem.channels?.map((ch) => ch.channel_id) ?? [], // Default: all channels allowed
        channels_restricted: [], // User can add restrictions
        compliance_notes: terr.compliance_notes,
        evidence_refs: [evRef],
      });
    }
  }

  // If no territories extracted, default to global (no restrictions)
  if (territories.length === 0) {
    territories.push({
      territory_id: "global_default",
      type: "geographic",
      description: "Global: no explicit territory restrictions found",
      boundaries: ["Global"],
      channels_allowed: ecosystem.channels?.map((ch) => ch.channel_id) ?? [],
      channels_restricted: [],
      compliance_notes: ["No explicit documentation found; using default global scope"],
      evidence_refs: [createEvidenceRef("default_fallback", "global_default")],
    });
  }

  const provenance_refs: ProvenanceRef[] = territories.map((t) => ({
    id: stableEvidenceId("B01.07:provenance", t.territory_id),
    type: "INFERRED",
    decision_authority: "B01_territory_extractor",
    timestamp: new Date().toISOString(),
    rationale: `Algorithm extracted territory "${t.territory_id}" via keyword match against documentation`,
  }));

  return {
    territories,
    provenance_refs,
  };
}
