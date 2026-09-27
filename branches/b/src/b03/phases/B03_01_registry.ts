// B03.01 — Deterministic Registry Layer
// Maps B01 ecosystem to audience registry (no inference)

import type { B01CanonicalState } from "../../b00/contracts.js";
import type { B03Deps } from "../types.js";

/** Deterministic mapping: B01 state → audience registry */
export function buildAudienceRegistry(
  b01State: B01CanonicalState,
  deps?: B03Deps,
): {
  channels: Map<string, { platform: string; role: string }>;
  platforms: Map<string, { capabilities: string[] }>;
  territories: Map<string, { type: string; boundaries: string[] }>;
  constraints: Array<{ id: string; description: string }>;
} {
  // Map: channel_id → platform + role (deterministic from B01)
  const channels = new Map<string, { platform: string; role: string }>();
  for (const channel of b01State.channels) {
    channels.set(channel.channel_id, {
      platform: channel.platform,
      role: channel.role,
    });
  }

  // Map: platform_name → capabilities (deterministic from B01)
  const platforms = new Map<string, { capabilities: string[] }>();
  for (const platform of b01State.platforms) {
    platforms.set(platform.name, {
      capabilities: platform.capabilities,
    });
  }

  // Map: territory_id → type + boundaries (deterministic from B01)
  const territories = new Map<string, { type: string; boundaries: string[] }>();
  if (b01State.content_territories) {
    for (const territory of b01State.content_territories) {
      territories.set(territory.territory_id, {
        type: territory.type,
        boundaries: territory.boundaries,
      });
    }
  }

  // Collect strategic constraints (deterministic from B01)
  const constraints: Array<{ id: string; description: string }> = [];
  for (const constraint of b01State.strategic_constraints || []) {
    constraints.push({
      id: constraint.constraint_id,
      description: constraint.description,
    });
  }

  return {
    channels,
    platforms,
    territories,
    constraints,
  };
}

/** Validate that required registry data is present (no inference, just checking) */
export function validateRegistry(
  b01State: B01CanonicalState,
): { valid: boolean; gaps: string[] } {
  const gaps: string[] = [];

  if (!b01State.brand_profile) {
    gaps.push("brand_profile missing");
  }

  if (!b01State.channels || b01State.channels.length === 0) {
    gaps.push("channels empty or missing");
  }

  if (!b01State.platforms || b01State.platforms.length === 0) {
    gaps.push("platforms empty or missing");
  }

  if (!b01State.content_territories || b01State.content_territories.length === 0) {
    gaps.push("content_territories empty or missing");
  }

  return {
    valid: gaps.length === 0,
    gaps,
  };
}
