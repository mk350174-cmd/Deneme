// B10 — Continuous Optimization

export type {
  OptimizationProposal,
  ImpactAssessment,
  CompletenessScore,
  B10CandidateState,
  B10CanonicalState,
  B10Deps,
  B10StatePersistence,
} from "./types.js";

export { KNOWN_CANONICALIZATION_DROPS } from "./types.js";
export { runB10, approveCandidate, commitVersion, loadVersion, listVersions, getLatestVersion } from "./orchestration.js";
export { InMemoryB10Persistence, createMockPersistence } from "./persistence.js";
export * from "./phases/B10_01_proposals.js";
export * from "./phases/B10_02_impact.js";
export * from "./phases/B10_03_validation.js";
