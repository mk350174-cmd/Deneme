// B02.01 — Deterministic Registry Layer
// Maps B01 platforms to capability registry; extracts editorial/constraint rules

import type { B01CanonicalState } from "../../b00/contracts.js";
import type { B02Deps, EvaluationContext } from "../types.js";
import { PLATFORMS_REGISTRY, CAPABILITIES_REGISTRY } from "../../b00/terminology.js";

/** Deterministic mapping: B01 state → capability/rule registry (no inference) */
export function buildRegistryContext(
  b01State: B01CanonicalState,
  deps?: B02Deps,
): {
  platformCapabilities: Map<string, Set<string>>;
  channelRoles: Map<string, string>;
  editorialRules: Array<{ rule: string; content_types: string[] }>;
  constraints: Array<{ id: string; description: string }>;
} {
  const deps_ = deps || {};

  // Map: platform_name -> Set of capabilities
  const platformCapabilities = new Map<string, Set<string>>();

  // Extract capabilities from B01 platforms (verified data only)
  for (const platform of b01State.platforms) {
    const caps = new Set<string>();
    const regEntry = PLATFORMS_REGISTRY[platform.name as keyof typeof PLATFORMS_REGISTRY];
    if (regEntry && regEntry.capabilities) {
      for (const cap of regEntry.capabilities) {
        caps.add(cap);
      }
    }
    platformCapabilities.set(platform.name, caps);
  }

  // Map: channel_name -> role
  const channelRoles = new Map<string, string>();
  for (const channel of b01State.channels) {
    channelRoles.set(channel.name, channel.role || "UNKNOWN");
  }

  // Extract editorial rules (if present in editorial_constitution)
  const editorialRules: Array<{ rule: string; content_types: string[] }> = [];
  if (b01State.editorial_constitution) {
    if (Array.isArray(b01State.editorial_constitution.rules)) {
      for (const rule of b01State.editorial_constitution.rules) {
        editorialRules.push({
          rule: rule.description || "rule",
          content_types: rule.applies_to || [],
        });
      }
    }
  }

  // Extract strategic constraints (deterministic: just collect, no inference)
  const constraints = [];
  if (b01State.strategic_constraints) {
    for (const constraint of b01State.strategic_constraints) {
      constraints.push({
        id: constraint.constraint_id,
        description: constraint.description,
      });
    }
  }

  return {
    platformCapabilities,
    channelRoles,
    editorialRules,
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

  if (!b01State.editorial_constitution) {
    gaps.push("editorial_constitution missing");
  }

  if (!b01State.strategic_constraints || b01State.strategic_constraints.length === 0) {
    gaps.push("strategic_constraints empty or missing");
  }

  return {
    valid: gaps.length === 0,
    gaps,
  };
}
