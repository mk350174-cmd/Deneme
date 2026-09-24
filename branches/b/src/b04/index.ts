// src/b04/index.ts
export type {
  CampaignStrategy,
  StrategicPriority,
  AlignmentScore,
  TerritorialStrategy,
  CompletenessScore,
  B04CandidateState,
  B04CanonicalState,
  B04Input,
  B04Deps,
  B04StatePersistence,
} from "./types.js";

export { KNOWN_CANONICALIZATION_DROPS } from "./types.js";

export {
  runB04,
  approveCandidate,
  commitVersion,
  loadVersion,
  listVersions,
  getLatestVersion,
} from "./orchestration.js";

export { createMockPersistence } from "./persistence.js";

export {
  buildStrategyContext,
  validateStrategyContext,
} from "./phases/B04_01_registry.js";

export {
  analyzeOpportunitySegmentAlignment,
} from "./phases/B04_02_opportunities.js";

export {
  synthesizeCampaigns,
  synthesizePriorities,
} from "./phases/B04_03_synthesis.js";

export {
  detectStrategyConflicts,
  identifyStrategicGaps,
  calculateStrategyCompleteness,
} from "./phases/B04_04_validation.js";
