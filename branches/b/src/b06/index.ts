// B06 — Distribution Strategy Module

export type {
  ChannelSelection,
  ContentSchedule,
  FormatRule,
  DistributionStrategy,
  CompletenessScore,
  B06CandidateState,
  B06CanonicalState,
  B06Input,
  B06Deps,
  B06StatePersistence,
} from "./types.js";

export { KNOWN_CANONICALIZATION_DROPS } from "./types.js";
export { runB06, approveCandidate, commitVersion, loadVersion, listVersions, getLatestVersion } from "./orchestration.js";
export { createMockPersistence } from "./persistence.js";
export { buildDistributionContext, validateDistributionContext } from "./phases/B06_01_registry.js";
export { selectChannelsForCampaigns } from "./phases/B06_02_channels.js";
export { createContentSchedules } from "./phases/B06_03_scheduling.js";
export { defineFormatRules } from "./phases/B06_04_formats.js";
export {
  detectDistributionConflicts,
  identifyDistributionGaps,
  calculateDistributionCompleteness,
} from "./phases/B06_05_validation.js";
