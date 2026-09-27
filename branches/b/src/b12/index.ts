// B12 — State Management

export * from "./types.js";
export {
  createBranchState,
  commitBranchState,
  loadBranchState,
  listBranchStates,
  getLatestBranchState,
} from "./orchestration.js";
export { InMemoryB12Persistence } from "./persistence.js";
export { createRealUpstreamReader } from "./upstreamPersistenceAdapter.js";
export * from "./phases/B12_00_upstream.js";
export * from "./phases/B12_01_aggregate.js";
export * from "./phases/B12_02_transitions.js";
export * from "./phases/B12_03_completeness.js";
export * from "./phases/B12_04_audit.js";
