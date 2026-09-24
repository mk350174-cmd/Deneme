// B12 Persistence

import type { BranchCanonicalState, B12StatePersistence } from "./types.js";

export class InMemoryB12Persistence implements B12StatePersistence {
  private states: Map<string, BranchCanonicalState> = new Map();

  async save(state: BranchCanonicalState): Promise<void> {
    if (this.states.has(state.state_id)) {
      throw new Error(`State ${state.state_id} already committed (immutable)`);
    }
    this.states.set(state.state_id, JSON.parse(JSON.stringify(state)));
  }

  async load(stateId: string): Promise<BranchCanonicalState | null> {
    const state = this.states.get(stateId);
    if (!state) return null;
    return JSON.parse(JSON.stringify(state));
  }

  async listStates(): Promise<string[]> {
    return Array.from(this.states.keys());
  }

  async latest(): Promise<BranchCanonicalState | null> {
    const stateIds = Array.from(this.states.keys());
    if (stateIds.length === 0) return null;

    const firstStateId = stateIds[0];
    if (!firstStateId) return null;

    const firstState = this.states.get(firstStateId);
    if (!firstState) return null;

    let latestState = firstState;
    let latestTime = new Date(latestState.updated_at).getTime();

    for (let i = 1; i < stateIds.length; i++) {
      const stateId = stateIds[i];
      if (!stateId) continue;

      const state = this.states.get(stateId);
      if (state) {
        const stateTime = new Date(state.updated_at).getTime();
        if (stateTime > latestTime) {
          latestState = state;
          latestTime = stateTime;
        }
      }
    }

    return JSON.parse(JSON.stringify(latestState));
  }
}
