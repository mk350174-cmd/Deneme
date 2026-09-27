// B01.03 — Channel Role Classification
// Classify channels into structural roles (primary, secondary, experimental, archive)

import type { B01Input } from "../../b00/contracts.js";
import type { RoleMap } from "../types.js";
import type { B01Deps } from "../types.js";
import type { ChannelRole } from "../../b00/terminology.js";
import type { EvidenceRef } from "../../types/entities.js";
import type { ProvenanceRef } from "../../b00/provenanceRef.js";
import { stableEvidenceId } from "../../b00/stableIds.js";

/**
 * Classify channel role from user input keywords
 *
 * Algorithm:
 * 1. Search user_input + user_notes for channel name + role keywords
 * 2. Role keywords: "primary", "main", "priority" → PRIMARY_CHANNEL
 *                   "secondary", "backup", "secondary" → SECONDARY_CHANNEL
 *                   "experiment", "test", "experimental" → EXPERIMENTAL_CHANNEL
 *                   "archive", "legacy", "old" → ARCHIVE_CHANNEL (or emitted as UNKNOWN + Gap if not in enum)
 * 3. First match wins (no duplication)
 * 4. If no match found, return UNKNOWN + Gap
 */
function classifyChannelRole(channelName: string, input: B01Input): {
  role: ChannelRole;
  evidence_refs: EvidenceRef[];
  isGuess: boolean;
} {
  const searchText = [input.user_input ?? "", input.user_notes ?? ""]
    .join(" ")
    .toLowerCase();

  const channelNameLower = channelName.toLowerCase();

  // Look for channel name + role keyword pattern
  const rolePatterns: Array<{ keywords: string[]; role: ChannelRole }> = [
    { keywords: ["primary", "main", "priority", "major"], role: "primary" },
    { keywords: ["secondary", "backup", "supporting"], role: "secondary" },
    { keywords: ["experiment", "test", "experimental", "pilot"], role: "experimental" },
  ];

  // Search for pattern: "channel_name ... role_keyword"
  for (const { keywords, role } of rolePatterns) {
    for (const keyword of keywords) {
      // Look for channel name + keyword within reasonable proximity
      const pattern = new RegExp(`${channelNameLower}.*?\\b${keyword}\\b`, "i");
      if (pattern.test(searchText)) {
        return {
          role,
          evidence_refs: [
            {
              id: stableEvidenceId("role_classification", channelName),
              source: "user_input:role_classification",
              status: "INFERRED",
              excerpt: `Channel "${channelName}" classified as ${role} based on keyword "${keyword}"`,
            },
          ],
          isGuess: false,
        };
      }
    }
  }

  // Check for archive keyword (which isn't in enum, so return UNKNOWN)
  const archivePattern = new RegExp(`${channelNameLower}.*?(archive|legacy|deprecated|old)\\b`, "i");
  if (archivePattern.test(searchText)) {
    // Archive detected but not supported by enum; return UNKNOWN instead of guessing
    return {
      role: "UNKNOWN",
      evidence_refs: [
        {
          id: stableEvidenceId("role_classification_archive", channelName),
          source: "user_input:role_classification",
          status: "INFERRED",
          excerpt: `Channel "${channelName}" appears to be archive/legacy but enum lacks archive type; emitting UNKNOWN`,
        },
      ],
      isGuess: false,
    };
  }

  // No match found
  return {
    role: "UNKNOWN",
    evidence_refs: [
      {
        id: stableEvidenceId("role_classification_unknown", channelName),
        source: "user_input:role_classification",
        status: "UNKNOWN",
        excerpt: `Channel "${channelName}" role could not be determined from user input`,
      },
    ],
    isGuess: true,
  };
}

/**
 * B01.03 phase: Classify channel roles from user input
 *
 * Input: B01Input + channel list
 * Output: RoleMap mapping channel_id → {role, evidence_refs}
 *
 * Algorithm:
 * 1. For each channel in ecosystem data, classify role
 * 2. Return map of channel_id → role + evidence
 * 3. No auto-assignment; UNKNOWN channels emit gap in later phase
 */
export async function runPhaseB0103(
  input: B01Input,
  channelNames: string[],
  _deps?: B01Deps,
): Promise<RoleMap> {
  const roleMap: RoleMap = {};

  for (const channelName of channelNames) {
    const { role, evidence_refs, isGuess } = classifyChannelRole(channelName, input);
    const provenance_refs: ProvenanceRef[] = [
      {
        id: stableEvidenceId("B01.03:provenance", channelName),
        type: "INFERRED",
        decision_authority: "B01_channel_role_classifier",
        timestamp: new Date().toISOString(),
        rationale: isGuess
          ? `No role keyword found for channel "${channelName}"; classified UNKNOWN rather than guessed`
          : `Algorithm inferred role "${role}" for channel "${channelName}" from keyword proximity match`,
      },
    ];
    roleMap[channelName] = { role, evidence_refs, provenance_refs };
  }

  return roleMap;
}
