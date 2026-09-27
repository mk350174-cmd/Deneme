// B01 Conflict Detection & Resolution
//
// SOLE conflict-detection authority for B01 (per canonical plan Decision E/F).
// No other B01 file runs its own competing conflict-detection algorithm —
// B01.11 (constraint aggregation) is a pure aggregator that always returns
// `conflicts: []` and defers entirely to this module.

import type { B01CandidateState } from "./types.js";
import type { ConflictRecord, Gap } from "../b00/contracts.js";

/**
 * Detect conflicts in candidate state.
 *
 * Rule 1: Duplicate channel_id (detection only — see note below).
 * Rule 2: Stale channel_id reference in distribution (emits Gap).
 * Rule 3: Editorial tone-rule collision (migrated from the former,
 *         now-removed B01.11 conflict engine).
 * Rule 4: Missing critical ecosystem/brand/role data (emits Gap).
 * Rule 5: Channel has audience_category but platform has no capabilities
 *         (emits Gap).
 */
export function detectConflicts(
  candidate: B01CandidateState,
): { conflicts: ConflictRecord[]; gaps: Gap[] } {
  const conflicts: ConflictRecord[] = [];
  const gaps: Gap[] = [];
  const seenConflictIds = new Set<string>();

  // Rule 1: Duplicate channel_id.
  // NOTE: detection only. This function does not mutate `candidate.ecosystem`
  // — it has no way to "drop" the duplicate from the caller's data. The
  // resolution text below previously claimed the duplicate was dropped; that
  // claim was false (nothing was ever removed). It now honestly describes
  // this as flagged for manual review.
  const seenChannelIds = new Map<string, string>(); // channel_id → role
  if (candidate.ecosystem) {
    for (const ch of candidate.ecosystem.channels) {
      if (seenChannelIds.has(ch.channel_id)) {
        const priorRole = seenChannelIds.get(ch.channel_id);
        const conflictId = `conflict_dup_${ch.channel_id}`;
        if (!seenConflictIds.has(conflictId)) {
          seenConflictIds.add(conflictId);
          conflicts.push({
            conflict_id: conflictId,
            description: `Duplicate channel_id "${ch.channel_id}" with different roles`,
            affected_items: [ch.channel_id],
            severity: "high",
            resolution: `Flagged for manual review (prior occurrence role: ${priorRole}); not auto-resolved`,
          });
        }
      } else {
        seenChannelIds.set(ch.channel_id, "role_placeholder");
      }
    }
  }

  // Rule 2: Stale channel_id reference in distribution → emit Gap.
  if (candidate.distribution && candidate.ecosystem) {
    const validChannelIds = new Set(candidate.ecosystem.channels.map((ch) => ch.channel_id));
    for (const assignment of candidate.distribution.channel_assignments) {
      if (!validChannelIds.has(assignment.channel_id)) {
        const conflictId = `conflict_stale_${assignment.channel_id}`;
        if (!seenConflictIds.has(conflictId)) {
          seenConflictIds.add(conflictId);
          gaps.push({
            gap_id: `gap_stale_ref_${assignment.channel_id}`,
            description: `Channel assignment references unknown channel "${assignment.channel_id}"`,
            required_for: "valid distribution strategy",
            priority: "high",
          });
        }
      }
    }
  }

  // Rule 3: Editorial tone-rule collision. Migrated from the former B01.11
  // conflict engine (which was removed because its output was always
  // discarded by orchestration.ts in favor of this module). Faithfully
  // preserves the original's outer precondition — the check only runs when
  // at least one brand_safety rule exists — rather than the looser version
  // from an earlier draft of this migration that dropped that gate; the
  // original's exact behavior is what "migrate" means here.
  const brandSafetyRules = candidate.editorial?.rules?.filter((r) => r.category === "brand_safety") ?? [];
  if (brandSafetyRules.length > 0) {
    const toneRules = candidate.editorial?.rules?.filter((r) => r.category === "tone") ?? [];
    for (let i = 0; i < toneRules.length - 1; i++) {
      for (let j = i + 1; j < toneRules.length; j++) {
        const rule1 = toneRules[i];
        const rule2 = toneRules[j];
        if (
          rule1 &&
          rule2 &&
          rule1.rule_text.toLowerCase().includes("avoid") &&
          rule2.rule_text.toLowerCase().includes("professional")
        ) {
          const conflictId = `conflict_tone_${rule1.rule_id}_${rule2.rule_id}`;
          if (!seenConflictIds.has(conflictId)) {
            seenConflictIds.add(conflictId);
            conflicts.push({
              conflict_id: conflictId,
              description: `Tone rules may conflict: '${rule1.rule_text}' vs '${rule2.rule_text}'`,
              affected_items: [rule1.rule_id, rule2.rule_id],
              severity: "medium",
              resolution: "Flagged for manual review; not auto-resolved",
            });
          }
        }
      }
    }
  }

  // Rules formerly numbered 3 and 5 in the prior version of this file
  // ("prior canonical role contradicts new candidate role" and "territory vs
  // distribution timing incompatibility") were removed rather than kept as
  // placeholders: they had no defined detection logic anywhere in the
  // codebase, and leaving `// Placeholder for now` comments presented as
  // active conflict rules was itself misleading (a defect this pass fixes,
  // not one it repeats). They are deferred, undocumented-elsewhere work —
  // see the implementation report's "Deferred Items" section.

  // Rule 4: Missing critical ecosystem/brand/role data → emit Gap.
  if (!candidate.ecosystem || candidate.ecosystem.channels.length === 0) {
    gaps.push({
      gap_id: "gap_missing_ecosystem",
      description: "No channels defined in ecosystem",
      required_for: "ecosystem structure",
      priority: "high",
    });
  }

  if (!candidate.brand_arch) {
    gaps.push({
      gap_id: "gap_missing_brand_arch",
      description: "Brand architecture not defined",
      required_for: "brand positioning",
      priority: "high",
    });
  }

  if (!candidate.role_map || Object.keys(candidate.role_map).length === 0) {
    gaps.push({
      gap_id: "gap_missing_role_map",
      description: "No channel roles defined",
      required_for: "channel role classification",
      priority: "medium",
    });
  }

  // Rule 5: Channel with audience_category but empty platform capabilities → emit Gap.
  if (candidate.ecosystem && candidate.platform_registry) {
    const platformReg = candidate.platform_registry;
    const emptyCapabilityChannels = candidate.ecosystem.channels.filter((ch) => {
      const hasAudience = !!ch.audience_category;
      const platformEntry = platformReg[
        Object.keys(platformReg).find((k) =>
          platformReg[k]?.name?.toLowerCase() === ch.platform?.toLowerCase(),
        ) ?? ""
      ];
      const hasCapabilities = platformEntry?.capabilities && platformEntry.capabilities.length > 0;
      return hasAudience && !hasCapabilities;
    });

    for (const ch of emptyCapabilityChannels) {
      gaps.push({
        gap_id: `gap_empty_caps_${ch.channel_id}`,
        description: `Channel "${ch.name}" has audience_category but platform has no defined capabilities`,
        required_for: "channel-audience fit assessment",
        priority: "medium",
      });
    }
  }

  return { conflicts, gaps };
}

/**
 * Merge conflict records from multiple phases
 */
export function mergeConflicts(allConflicts: ConflictRecord[][]): ConflictRecord[] {
  const seen = new Set<string>();
  const merged: ConflictRecord[] = [];

  for (const conflictList of allConflicts) {
    for (const conflict of conflictList) {
      if (!seen.has(conflict.conflict_id)) {
        seen.add(conflict.conflict_id);
        merged.push(conflict);
      }
    }
  }

  return merged;
}
