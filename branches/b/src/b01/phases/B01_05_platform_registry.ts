// B01.05 — Platform Registry
// Normalize platform metadata from provider registry, user input, and channel presence.
// CRITICAL: Channel presence is EVIDENCE, not capability proof. Never derive capabilities from channel presence alone.

import type { B01Deps, EcosystemData, PlatformRegistry } from "../types.js";
import type { EvidenceRef } from "../../types/entities.js";
import type { ProvenanceRef } from "../../b00/provenanceRef.js";
import type { PlatformCapability } from "../../b00/terminology.js";
import type { B01Input } from "../../b00/contracts.js";
import { stableEvidenceId } from "../../b00/stableIds.js";

/**
 * Create evidence ref for platform capability
 */
function createEvidenceRef(source: string, seed: string): EvidenceRef {
  return {
    id: stableEvidenceId(source, seed),
    source,
    status: "INFERRED", // Platform registry entries are inferred until verified via provider
    excerpt: `Platform capability from ${source}`,
  };
}

/**
 * B01.05 phase: Build platform registry with normalized metadata
 *
 * Sources currently implemented:
 * 1. User-Provided (B01Input.known_platforms) → INFERRED/ASSERTED (authoritative as user intent, not external fact verification)
 * 2. Channel Presence (inferred from ecosystem channels) → INFERRED (data point, not capability)
 *
 * Provider-registry verification is not executed by this phase today; therefore
 * this phase must not claim provider-verified platform facts.
 *
 * CRITICAL RULE: Channel presence is evidence that a platform is used, NOT proof that it has capabilities.
 * Example: YouTube channel presence = evidence platform is in use, NOT automatic proof of "video" capability.
 *
 * Algorithm:
 * 1. Start with empty registry
 * 2. For each platform in ecosystem.channels, add entry if missing
 * 3. For each user-provided platform, merge capabilities as INFERRED user assertions
 * 4. For each channel, mark platform as "in_use" (evidence only, not capability)
 * 5. Return registry with explicit source/evidence_status/provenance tracking
 */
export async function runPhaseB0105(
  ecosystem: EcosystemData,
  input: B01Input | undefined,
  _deps?: B01Deps,
): Promise<PlatformRegistry> {
  const registry: PlatformRegistry = {};

  // Step 1: Collect all unique platforms from ecosystem channels
  const platformsInUse = new Set<string>();
  for (const channel of ecosystem.channels) {
    platformsInUse.add(channel.platform);
  }

  // Step 2: Initialize registry entries for each platform
  for (const platform of platformsInUse) {
    if (!registry[platform]) {
      registry[platform] = {
        name: platform,
        capabilities: [],
        evidence_refs: [],
      };
    }
  }

  // Step 3: Add user-provided platform assertions without upgrading them to externally VERIFIED facts
  if (input?.known_platforms) {
    for (const userPlatform of input.known_platforms) {
      const platformId = userPlatform.name;
      if (!registry[platformId]) {
        registry[platformId] = {
          name: userPlatform.name,
          capabilities: [],
          evidence_refs: [],
        };
      }

      // Add user-provided capabilities as asserted user evidence (not verified research)
      if (userPlatform.capabilities && Array.isArray(userPlatform.capabilities)) {
        for (const cap of userPlatform.capabilities) {
          // Check if already exists (avoid duplicates)
          const exists = registry[platformId].capabilities.some((c) => c.capability === cap);
          if (!exists) {
            const capEvRef = createEvidenceRef("user_input", `${platformId}:${cap}`);
            registry[platformId].capabilities.push({
              capability: cap, // already typed PlatformCapability by B01Input; no cast needed
              source: "user_provided",
              evidence_status: "INFERRED", // User assertion; not externally verified
              evidence_refs: [{ ...capEvRef, status: "INFERRED", origin: "USER_ASSERTION", basis: "ASSERTED", source_mode: "REAL", production_eligible: true }],
              provenance_refs: [
                {
                  id: `prov_${platformId}_${cap}`,
                  type: "OBSERVED",
                  decision_authority: "B01_platform_registry",
                  timestamp: new Date().toISOString(),
                  rationale: `Capability "${cap}" directly confirmed via user-provided platform input`,
                },
              ],
            });
          }
        }
      }

      // Add platform-level evidence for user input
      registry[platformId].evidence_refs.push(
        createEvidenceRef("user_input", `platform_${platformId}`),
      );
      registry[platformId].provenance_refs = [
        ...(registry[platformId].provenance_refs ?? []),
        {
          id: `prov_${platformId}_platform`,
          type: "OBSERVED",
          decision_authority: "B01_platform_registry",
          timestamp: new Date().toISOString(),
          rationale: `Platform "${platformId}" directly confirmed via user-provided input`,
        },
      ];
    }
  }

  // Step 4: Mark all platforms in ecosystem as "in_use" (evidence, not capability)
  // This tracks that we've seen channels on these platforms, but doesn't auto-generate capabilities
  for (const platform of platformsInUse) {
    if (registry[platform] && !registry[platform].evidence_refs.some((ev) => ev.source.includes("channel_presence"))) {
      registry[platform].evidence_refs.push(
        createEvidenceRef("channel_presence", `platform_${platform}`),
      );
      registry[platform].provenance_refs = [
        ...(registry[platform].provenance_refs ?? []),
        {
          id: `prov_${platform}_channel_presence`,
          type: "INFERRED",
          decision_authority: "B01_platform_registry",
          timestamp: new Date().toISOString(),
          rationale: `Platform "${platform}" inferred to be in use from channel presence (not proof of capability)`,
        },
      ];
    }
  }

  // Step 5: Set recommendation as adopted=false (user decision required for canonical)
  // Note: Registry itself doesn't have recommendation, but phases that use it should gate on user approval

  return registry;
}
