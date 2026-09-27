// B09 Persistence

import type { B09CanonicalState, B09StatePersistence } from "./types.js";

export class InMemoryB09Persistence implements B09StatePersistence {
  private versions: Map<string, B09CanonicalState> = new Map();

  async save(state: B09CanonicalState): Promise<void> {
    if (this.versions.has(state.version)) {
      throw new Error(`Version ${state.version} already exists (immutable)`);
    }
    this.versions.set(state.version, JSON.parse(JSON.stringify(state)));
  }

  async load(version: string): Promise<B09CanonicalState | null> {
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

  async latest(): Promise<B09CanonicalState | null> {
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
