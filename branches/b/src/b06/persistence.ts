// B06 State Persistence

import type { B06CanonicalState, B06StatePersistence } from "./types.js";

class InMemoryB06Persistence implements B06StatePersistence {
  private states = new Map<string, B06CanonicalState>();

  async save(state: B06CanonicalState): Promise<void> {
    if (this.states.has(state.version)) {
      throw new Error(`Version ${state.version} already exists`);
    }
    this.states.set(state.version, JSON.parse(JSON.stringify(state)));
  }

  async load(version: string): Promise<B06CanonicalState | null> {
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

  async latest(): Promise<B06CanonicalState | null> {
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

export function createMockPersistence(): B06StatePersistence {
  return new InMemoryB06Persistence();
}
