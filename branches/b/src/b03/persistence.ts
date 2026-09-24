// B03 — Persistence Layer
// In-memory storage for B03 canonical state versions

import type { B03StatePersistence, B03CanonicalState, B03Deps } from "./types.js";
import { canonicalHasher } from "../b00/hashing.js";

/** Create in-memory persistence for B03 (for testing and development) */
export function createMockPersistence(): B03StatePersistence {
  const store = new Map<string, B03CanonicalState>();

  return {
    save: async (state: B03CanonicalState) => {
      if (store.has(state.version)) {
        throw new Error(`Version ${state.version} already committed (immutable)`);
      }
      store.set(state.version, JSON.parse(JSON.stringify(state)));
    },

    load: async (version: string) => {
      const state = store.get(version);
      return state ? JSON.parse(JSON.stringify(state)) : null;
    },

    listVersions: async () => {
      const versions = Array.from(store.keys());
      return versions.sort((a: string, b: string) => {
        const aNum = parseInt(a.substring(1).split(".").join(""));
        const bNum = parseInt(b.substring(1).split(".").join(""));
        return aNum - bNum;
      });
    },

    latest: async () => {
      const versions = Array.from(store.keys());
      if (versions.length === 0) return null;
      versions.sort((a: string, b: string) => {
        const aNum = parseInt(a.substring(1).split(".").join(""));
        const bNum = parseInt(b.substring(1).split(".").join(""));
        return bNum - aNum;
      });
      const latestVersion = versions[0]!;
      const state = store.get(latestVersion);
      return state ? JSON.parse(JSON.stringify(state)) : null;
    },
  };
}

/** Create default B03Deps for standalone testing */
export function createDefaultDeps(): B03Deps {
  return {
    hash: {
      stableSegmentId: (b01Version: string, channelId: string, segmentName: string) =>
        `seg_${canonicalHasher.hash(`${b01Version}:${channelId}:${segmentName}`)}`,
      stableProfileId: (b01Version: string, profileName: string) =>
        `prof_${canonicalHasher.hash(`${b01Version}:${profileName}`)}`,
      stableInsightId: (b01Version: string, insightType: string, description: string) =>
        `ins_${canonicalHasher.hash(`${b01Version}:${insightType}:${description}`)}`,
    },
    secretGuard: {
      redactSecrets: (text: string) => text,
    },
    now: () => new Date().toISOString(),
  };
}
