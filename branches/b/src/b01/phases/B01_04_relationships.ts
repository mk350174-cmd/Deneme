// B01.04 — Relationship Graph
// Analyze strategic relationships between channels/platforms; detect hierarchies, dependencies, complementarity.
// CRITICAL: Inferred relationships marked INFERRED; only user-approved decisions become DECIDED.

import type { B01Deps, EcosystemData, RoleMap, RelationshipGraph } from "../types.js";
import type { EvidenceRef } from "../../types/entities.js";
import type { ProvenanceRef } from "../../b00/provenanceRef.js";
import { stableEvidenceId } from "../../b00/stableIds.js";

/**
 * Create evidence ref for relationship inference
 */
function createEvidenceRef(source: string, seed: string): EvidenceRef {
  return {
    id: stableEvidenceId(source, seed),
    source,
    status: "INFERRED", // Relationships inferred from roles + platforms are INFERRED, not VERIFIED
    excerpt: `Relationship inferred from ${source}`,
  };
}

/**
 * Create provenance ref marking inferred relationships as such
 */
function createProvenanceRef(type: "INFERRED" | "OBSERVED" | "DECIDED" = "INFERRED"): ProvenanceRef {
  return {
    type,
    decision_authority: type === "INFERRED" ? "B01.04_algorithm" : "user",
    timestamp: new Date().toISOString(),
  };
}

/**
 * Infer relationship type from role + platform data
 *
 * Algorithm:
 * 1. If both channels primary → "mirrors" (parallel, same priority)
 * 2. If A primary, B secondary → "primary_to_secondary" (B is overflow/secondary to A)
 * 3. If A experimental → "feeds_into" (experimental feeds knowledge to primary)
 * 4. If different platforms, complementary audiences → "complements"
 * 5. If role contradiction + territory conflict → "conflicts"
 * 6. Else → "UNKNOWN" (insufficient data)
 */
function inferRelationshipType(
  channelA: string,
  channelB: string,
  roleA: string,
  roleB: string,
  platformA: string,
  platformB: string,
): {
  relationship_type: "primary_to_secondary" | "feeds_into" | "mirrors" | "complements" | "conflicts" | "UNKNOWN";
  strength: number;
  reason: string;
} {
  // Verify roles exist
  if (roleA === "UNKNOWN" || roleB === "UNKNOWN") {
    return { relationship_type: "UNKNOWN", strength: 0, reason: "insufficient_role_data" };
  }

  // Mirror: both primary
  if (roleA === "primary" && roleB === "primary") {
    return {
      relationship_type: "mirrors",
      strength: 0.9,
      reason: "both_primary_channels",
    };
  }

  // Primary-to-secondary: A primary, B secondary
  if (roleA === "primary" && roleB === "secondary") {
    return {
      relationship_type: "primary_to_secondary",
      strength: 0.8,
      reason: "primary_to_secondary_hierarchy",
    };
  }

  // Reverse primary-to-secondary
  if (roleA === "secondary" && roleB === "primary") {
    return {
      relationship_type: "primary_to_secondary",
      strength: 0.8,
      reason: "secondary_to_primary_hierarchy",
    };
  }

  // Feeds into: experimental channel
  if (roleA === "experimental" || roleB === "experimental") {
    const expChannel = roleA === "experimental" ? channelA : channelB;
    const targetChannel = roleA === "experimental" ? channelB : channelA;
    return {
      relationship_type: "feeds_into",
      strength: 0.7,
      reason: `experimental_${expChannel}_feeds_to_${targetChannel}`,
    };
  }

  // Complements: different platforms (audience diversification)
  if (platformA !== platformB) {
    return {
      relationship_type: "complements",
      strength: 0.6,
      reason: "different_platforms_complement_audiences",
    };
  }

  // Same platform, no clear hierarchy
  return {
    relationship_type: "UNKNOWN",
    strength: 0,
    reason: "insufficient_differentiation",
  };
}

/**
 * B01.04 phase: Analyze channel relationships
 *
 * Input: EcosystemData (channels), RoleMap (roles)
 * Output: RelationshipGraph with inferred edges
 *
 * Each inferred relationship is marked INFERRED provenance.
 * User approval required to make relationship DECIDED (canonical).
 */
export async function runPhaseB0104(
  ecosystem: EcosystemData,
  roleMap: RoleMap,
  _deps?: B01Deps,
): Promise<RelationshipGraph> {
  const edges: RelationshipGraph["edges"] = [];
  const evidenceRefs: EvidenceRef[] = [];

  // Prevent self-loops and deduplication
  const seenEdges = new Set<string>();

  // For each channel pair
  if (!ecosystem.channels || ecosystem.channels.length === 0) {
    return {
      edges: [],
      evidence_refs: [],
      recommendation: {
        recommendation_id: `rec_rel_empty_${ecosystem.platforms.length}`,
        source_agent: "B01.04",
        proposal: "No channels to analyze for relationships",
        timestamp: new Date().toISOString(),
        adopted: false,
      },
    };
  }

  for (let i = 0; i < ecosystem.channels.length; i++) {
    for (let j = i + 1; j < ecosystem.channels.length; j++) {
      const chA = ecosystem.channels[i];
      const chB = ecosystem.channels[j];

      // Guard against undefined (shouldn't happen with valid array bounds)
      if (!chA || !chB) continue;

      // Skip self-loops
      if (chA.channel_id === chB.channel_id) continue;

      // Get roles (default UNKNOWN if not found)
      const roleA = roleMap[chA.channel_id]?.role ?? "UNKNOWN";
      const roleB = roleMap[chB.channel_id]?.role ?? "UNKNOWN";

      // Infer relationship
      const { relationship_type, strength, reason } = inferRelationshipType(
        chA.channel_id,
        chB.channel_id,
        roleA,
        roleB,
        chA.platform,
        chB.platform,
      );

      // Skip if insufficient data
      if (relationship_type === "UNKNOWN" && strength === 0) {
        continue;
      }

      // Deduplication key: normalized edge (undirected)
      const edgeKey = [chA.channel_id, chB.channel_id].sort().join("|");
      if (seenEdges.has(edgeKey)) continue;
      seenEdges.add(edgeKey);

      // Create evidence for this relationship
      const evRef = createEvidenceRef(`B01.04:${reason}`, `${chA.channel_id}→${chB.channel_id}`);
      evidenceRefs.push(evRef);

      // Mark as INFERRED (not DECIDED) — user approval required for canonical
      const provRef = createProvenanceRef("INFERRED");

      edges.push({
        from_channel_id: chA.channel_id,
        to_channel_id: chB.channel_id,
        relationship_type,
        strength,
        provenance_refs: [provRef],
        evidence_refs: [evRef],
      });
    }
  }

  return {
    edges,
    evidence_refs: evidenceRefs,
    recommendation: {
      recommendation_id: `rec_rel_${ecosystem.channels.length}_channels`,
      source_agent: "B01.04",
      proposal: `Identified ${edges.length} potential channel relationships. Review and approve before canonical commitment.`,
      timestamp: new Date().toISOString(),
      adopted: false, // User must approve to make canonical
    },
  };
}
