// B03.05 — Validation & Conflict Detection Layer
// Detects constraint violations, identifies gaps, calculates completeness

import type { B01CanonicalState, ConflictRecord, Gap } from "../../b00/contracts.js";
import type { AudienceSegment } from "../types.js";
import type { CompletenessScore } from "../types.js";

/** Detect conflicts between segments and B01 state */
export function detectSegmentConflicts(
  b01State: B01CanonicalState,
  segments: AudienceSegment[],
): ConflictRecord[] {
  const conflicts: ConflictRecord[] = [];

  // Get valid channel IDs from B01
  const validChannelIds = new Set(b01State.channels.map((c) => c.channel_id));

  // Check each segment's channel references
  for (const segment of segments) {
    for (const channelId of segment.channel_ids) {
      if (!validChannelIds.has(channelId)) {
        conflicts.push({
          conflict_id: `conf_segment_${segment.segment_id}_channel`,
          description: `Segment references unknown channel ${channelId}`,
          affected_items: [segment.segment_id, channelId],
          severity: "high",
          resolution: "Verify channel_id exists in B01.channels",
        });
      }
    }

    // Check geography against territories
    if (segment.geography && b01State.content_territories) {
      const validGeos = new Set<string>();
      for (const territory of b01State.content_territories) {
        for (const boundary of territory.boundaries) {
          validGeos.add(boundary);
        }
      }

      for (const geo of segment.geography) {
        if (!validGeos.has(geo)) {
          conflicts.push({
            conflict_id: `conf_segment_${segment.segment_id}_geo_${geo}`,
            description: `Segment geography ${geo} not in B01 territories`,
            affected_items: [segment.segment_id, geo],
            severity: "medium",
            resolution: "Verify geography aligns with B01 content_territories",
          });
        }
      }
    }
  }

  return conflicts;
}

/** Identify data gaps affecting audience analysis */
export function identifyGaps(
  b01State: B01CanonicalState,
  segmentCount: number,
): Gap[] {
  const gaps: Gap[] = [];

  if (!b01State.brand_profile?.positioning) {
    gaps.push({
      gap_id: "gap_brand_positioning",
      description: "Brand positioning not fully defined",
      required_for: "contextualize audience segments with brand positioning",
      priority: "high",
    });
  }

  if (!b01State.channels || b01State.channels.length === 0) {
    gaps.push({
      gap_id: "gap_channels",
      description: "No channels defined in B01",
      required_for: "map audiences to distribution channels",
      priority: "high",
    });
  }

  if (!b01State.content_territories || b01State.content_territories.length === 0) {
    gaps.push({
      gap_id: "gap_territories",
      description: "No content territories defined in B01",
      required_for: "validate segment geography and timezone scope",
      priority: "medium",
    });
  }

  if (segmentCount === 0) {
    gaps.push({
      gap_id: "gap_no_segments",
      description: "No audience segments identified",
      required_for: "feed B04 strategic planning with audience insights",
      priority: "high",
    });
  }

  return gaps;
}

/** Calculate completeness of B03 analysis (0-100 scale) */
export function calculateCompleteness(
  b01State: B01CanonicalState,
  segmentCount: number,
  profileCount: number,
  gaps: Gap[],
): CompletenessScore {
  const criteria = {
    brand_positioning: b01State.brand_profile?.positioning ? 20 : 0,
    channels: b01State.channels?.length ? 20 : 0,
    territories: b01State.content_territories?.length ? 20 : 0,
    segments_identified: segmentCount > 0 ? 20 : 0,
    profiles_created: profileCount > 0 ? 20 : 0,
  };

  const score = Object.values(criteria).reduce((a, b) => a + b, 0);

  const missing_inputs: string[] = [];
  if (criteria.brand_positioning === 0) missing_inputs.push("brand_profile.positioning");
  if (criteria.channels === 0) missing_inputs.push("channels");
  if (criteria.territories === 0) missing_inputs.push("content_territories");

  const blocking_decisions: string[] = [];
  if (gaps.some((g) => g.priority === "high")) {
    blocking_decisions.push("Resolve high-priority data gaps before finalizing audience segments");
  }
  if (segmentCount === 0) {
    blocking_decisions.push("Identify at least one audience segment");
  }

  return {
    score,
    missing_inputs,
    blocking_decisions,
  };
}

/** Validate no fabricated audience data */
export function validateNoFabrication(segments: AudienceSegment[]): boolean {
  for (const segment of segments) {
    // Check: must have evidence
    if (!segment.evidence_refs || segment.evidence_refs.length === 0) {
      console.warn(`Segment ${segment.segment_id} has no evidence (fabricated?)`);
      return false;
    }

    // Check: confidence must be in valid range
    if (typeof segment.confidence !== "number" || segment.confidence < 0 || segment.confidence > 1) {
      console.warn(`Segment ${segment.segment_id} has invalid confidence`);
      return false;
    }

    // Check: segment name must not be empty
    if (!segment.segment_name || segment.segment_name.length === 0) {
      console.warn(`Segment ${segment.segment_id} has no name`);
      return false;
    }

    // Check: must reference at least one channel
    if (!segment.channel_ids || segment.channel_ids.length === 0) {
      console.warn(`Segment ${segment.segment_id} references no channels`);
      return false;
    }

    // Check: characteristics should have evidence or be explicitly UNKNOWN
    for (const [key, value] of Object.entries(segment.characteristics)) {
      if (value !== "UNKNOWN" && value !== null && value !== undefined) {
        // Only validate string characteristics; enums/numbers are pre-validated by type system
        if (typeof value === "string") {
          const hasEvidence = segment.evidence_refs.some(
            (e) => e.excerpt && e.excerpt.toLowerCase().includes(value.toLowerCase()),
          );
          if (!hasEvidence) {
            console.warn(
              `Segment ${segment.segment_id}: characteristic '${key}' = '${value}' but no supporting evidence`,
            );
            return false;
          }
        }
      }
    }
  }

  return true;
}
