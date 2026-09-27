// B02 — Storage Abstraction
// Persistence interface allowing injectable backends (JSON files, Supabase, etc.)

import type { B02StatePersistence, B02Deps } from "./types.js";
import type { B02CanonicalState } from "./types.js";
import { canonicalHasher } from "../b00/hashing.js";

/**
 * Create a mock in-memory persistence (testing only)
 */
export function createMockPersistence(): B02StatePersistence {
  const states = new Map<string, B02CanonicalState>();

  return {
    async save(state: B02CanonicalState): Promise<void> {
      if (states.has(state.version)) {
        throw new Error(`Version ${state.version} already committed (immutable)`);
      }
      states.set(state.version, JSON.parse(JSON.stringify(state)));
    },

    async load(version: string): Promise<B02CanonicalState | null> {
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

    async latest(): Promise<B02CanonicalState | null> {
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
 * Provide default deps for B02 functions (with fallback/mock implementations)
 */
export function createDefaultDeps(): B02Deps {
  return {
    hash: {
      stableOpportunityId: (inputId: string, channelId: string, opportunityType: string) =>
        `opp_${canonicalHasher.hash(`${inputId}:${channelId}:${opportunityType}`)}`,
      stableClassId: (inputId: string, className: string) =>
        `class_${canonicalHasher.hash(`${inputId}:${className}`)}`,
    },
    secretGuard: {
      redactSecrets: (text: string) => {
        // Simple pattern matching for common secret patterns
        return text
          .replace(/sk_(live|test)_[a-zA-Z0-9]{20,}/g, "[REDACTED_SECRET]")
          .replace(/api[_-]?key[:\s]+"?[a-zA-Z0-9]{20,}"?/gi, "[REDACTED_API_KEY]")
          .replace(/password[:\s]+"?[^\s"]+?"?/gi, "[REDACTED_PASSWORD]");
      },
    },
    now: () => new Date().toISOString(),
  };
}
