// B10 Persistence

import type { B10CanonicalState, B10StatePersistence } from "./types.js";

export class InMemoryB10Persistence implements B10StatePersistence {
  private versions: Map<string, B10CanonicalState> = new Map();

  async save(state: B10CanonicalState): Promise<void> {
    if (this.versions.has(state.version)) {
      throw new Error(`Version ${state.version} already exists (immutable)`);
    }
    this.versions.set(state.version, JSON.parse(JSON.stringify(state)));
  }

  async load(version: string): Promise<B10CanonicalState | null> {
    const state = this.versions.get(version);
    if (!state) return null;
    return JSON.parse(JSON.stringify(state));
  }

  async listVersions(): Promise<string[]> {
    const versions = Array.from(this.versions.keys());
    return versions.sort((a: string, b: string) => {
      const aNum = parseInt(a.substring(1).split(".").join(""));
      const bNum = parseInt(b.substring(1).split(".").join(""));
      return bNum - aNum;
    });
  }

  async latest(): Promise<B10CanonicalState | null> {
    const versions = Array.from(this.versions.keys());
    if (versions.length === 0) return null;
    versions.sort((a: string, b: string) => {
      const aNum = parseInt(a.substring(1).split(".").join(""));
      const bNum = parseInt(b.substring(1).split(".").join(""));
      return bNum - aNum;
    });
    const latestVersion = versions[0];
    if (!latestVersion) return null;
    return this.load(latestVersion);
  }
}

/** Backward-compatible testing factory used by the preserved B integration tests. */
export function createMockPersistence(): B10StatePersistence {
  return new InMemoryB10Persistence();
}
