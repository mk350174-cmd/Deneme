// B08 Persistence

import type { B08CanonicalState, B08StatePersistence } from "./types.js";

export class InMemoryB08Persistence implements B08StatePersistence {
  private versions: Map<string, B08CanonicalState> = new Map();

  async save(state: B08CanonicalState): Promise<void> {
    if (this.versions.has(state.version)) {
      throw new Error(`Version ${state.version} already exists (immutable)`);
    }
    this.versions.set(state.version, JSON.parse(JSON.stringify(state)));
  }

  async load(version: string): Promise<B08CanonicalState | null> {
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

  async latest(): Promise<B08CanonicalState | null> {
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
