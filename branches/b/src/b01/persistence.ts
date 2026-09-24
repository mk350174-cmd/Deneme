// B01 — Storage Abstraction
// Persistence interface allowing injectable backends (JSON files, Supabase, etc.)

import type { B01StatePersistence, B01Deps } from "./types.js";
import type { B01CanonicalState } from "../b00/contracts.js";
import {
  stableChannelId,
  stablePlatformId,
  stableTerritoryId,
  stableConstraintId,
  stableConflictId,
  stableGapId,
  stableRecommendationId,
} from "../b00/stableIds.js";

/**
 * Create a mock in-memory persistence (testing only)
 */
export function createMockPersistence(): B01StatePersistence {
  const states = new Map<string, B01CanonicalState>();

  return {
    async save(state: B01CanonicalState): Promise<void> {
      if (states.has(state.version)) {
        throw new Error(`Version ${state.version} already committed (immutable)`);
      }
      states.set(state.version, JSON.parse(JSON.stringify(state)));
    },

    async load(version: string): Promise<B01CanonicalState | null> {
      const state = states.get(version);
      if (!state) return null;
      return JSON.parse(JSON.stringify(state));
    },

    async listVersions(): Promise<string[]> {
      const versions = Array.from(states.keys());
      return versions.sort((a: string, b: string) => {
        const aNum = parseInt(a.substring(1).split(".").join(""));
        const bNum = parseInt(b.substring(1).split(".").join(""));
        return aNum - bNum;
      });
    },

    async latest(): Promise<B01CanonicalState | null> {
      const versions = Array.from(states.keys());
      if (versions.length === 0) return null;
      versions.sort((a: string, b: string) => {
        const aNum = parseInt(a.substring(1).split(".").join(""));
        const bNum = parseInt(b.substring(1).split(".").join(""));
        return bNum - aNum;
      });
      const lastVersion = versions[0];
      if (!lastVersion) return null;
      const state = states.get(lastVersion);
      if (!state) return null;
      return JSON.parse(JSON.stringify(state));
    },
  };
}

/**
 * Provide default deps for B01 phase functions. All stable IDs delegate to
 * B00's canonical SHA-256 authority via stableIds.ts.
 */
export function createDefaultDeps(): B01Deps {
  return {
    hash: {
      stableChannelId,
      stablePlatformId,
      stableTerritoryId,
      stableConstraintId,
      stableConflictId,
      stableGapId,
      stableRecommendationId,
    },
    secretGuard: {
      redactSecrets: (text: string) => {
        // Simple pattern matching for common secret patterns
        return text
          .replace(/sk_(live|test)_[a-zA-Z0-9]{20,}/g, "[REDACTED_SECRET]")
          .replace(/api[_-]?key[:\s]+"?[a-zA-Z0-9]{20,}"?/gi, '[REDACTED_API_KEY]')
          .replace(/password[:\s]+"?[^"\s]+"?/gi, "[REDACTED_PASSWORD]");
      },
    },
    now: () => new Date().toISOString(),
  };
}
