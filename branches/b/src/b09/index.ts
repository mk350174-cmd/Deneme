// B09 — Learning Loops

export type {
  LearningObservation,
  LearningSignal,
  FeedbackRule,
  LearningProposal,
  CompletenessScore,
  B09CandidateState,
  B09CanonicalState,
  B09Deps,
  B09StatePersistence,
} from "./types.js";

export { KNOWN_CANONICALIZATION_DROPS } from "./types.js";
export { runB09, approveCandidate, commitVersion, loadVersion, listVersions, getLatestVersion } from "./orchestration.js";
export { InMemoryB09Persistence } from "./persistence.js";
export * from "./phases/B09_01_observations.js";
export * from "./phases/B09_02_signals.js";
export * from "./phases/B09_03_proposals.js";
export * from "./phases/B09_04_validation.js";
