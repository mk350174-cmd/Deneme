// B05 State Persistence
// In-memory storage for versioned canonical states

import type { B05CanonicalState, B05StatePersistence } from "./types.js";

class InMemoryB05Persistence implements B05StatePersistence {
  private states = new Map<string, B05CanonicalState>();

  async save(state: B05CanonicalState): Promise<void> {
    if (this.states.has(state.version)) {
      throw new Error(`Version ${state.version} already exists`);
    }
    this.states.set(state.version, JSON.parse(JSON.stringify(state)));
  }

  async load(version: string): Promise<B05CanonicalState | null> {
    const state = this.states.get(version);
    return state ? JSON.parse(JSON.stringify(state)) : null;
  }

  async listVersions(): Promise<string[]> {
    const versions = Array.from(this.states.keys());
    return versions.sort((a: string, b: string) => {
      const aNum = parseInt(a.substring(1).split(".").join(""));
      const bNum = parseInt(b.substring(1).split(".").join(""));
      return aNum - bNum;
    });
  }

  async latest(): Promise<B05CanonicalState | null> {
    const versions = Array.from(this.states.keys());
    if (versions.length === 0) return null;
    versions.sort((a: string, b: string) => {
      const aNum = parseInt(a.substring(1).split(".").join(""));
      const bNum = parseInt(b.substring(1).split(".").join(""));
      return bNum - aNum;
    });
    const latest = versions[0]!;
    return this.load(latest);
  }
}

export function createMockPersistence(): B05StatePersistence {
  return new InMemoryB05Persistence();
}
