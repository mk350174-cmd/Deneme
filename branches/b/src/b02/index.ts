// B02 — Content Intelligence Module
// Strategic opportunity evaluation and opportunity classification

export type {
  B02StrategicOpportunity,
  OpportunityType,
  B02CandidateState,
  B02CanonicalState,
  B02Deps,
  B02StatePersistence,
} from "./types.js";

export { KNOWN_CANONICALIZATION_DROPS } from "./types.js";

export { runB02, approveCandidate, commitVersion, loadVersion, listVersions, getLatestVersion } from "./orchestration.js";

export { createMockPersistence, createDefaultDeps } from "./persistence.js";

// Re-export phase functions for testing
export * from "./phases/B02_01_registry.js";
export * from "./phases/B02_02_opportunities.js";
export * from "./phases/B02_03_validation.js";
export * from "./phases/B02_04_prioritization.js";
