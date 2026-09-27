// B01 — Brand & Ecosystem Intelligence
// Composite capability: ecosystem discovery, brand analysis, role classification, platform normalization,
// territory rules, distribution strategy, editorial governance, constraint aggregation, canonical state versioning

export type { B01Input, B01CanonicalState, ConflictRecord, Gap, Decision, Recommendation } from "../b00/contracts.js";

export type {
  EcosystemData,
  BrandArchitecture,
  RoleMap,
  RelationshipGraph,
  PlatformRegistry,
  ChannelFitMap,
  TerritoryData,
  DistributionData,
  EditorialData,
  RuleVerdict,
  ConstraintAggregation,
  B01CandidateState,
  B01StatePersistence,
  B01Deps,
} from "./types.js";

// Phases (MVP: only core phases exported; others will be implemented in Phase E continuation)
export { runPhaseB0101 } from "./phases/B01_01_ecosystem.js";
export { runPhaseB0102 } from "./phases/B01_02_brand_arch.js";
export { runPhaseB0103 } from "./phases/B01_03_channel_roles.js";
export { runPhaseB0104 } from "./phases/B01_04_relationships.js";
export { runPhaseB0105 } from "./phases/B01_05_platform_registry.js";
export { runPhaseB0106 } from "./phases/B01_06_channel_fit.js";
export { runPhaseB0107 } from "./phases/B01_07_territory.js";
export { runPhaseB0108 } from "./phases/B01_08_distribution.js";
export { runPhaseB0109 } from "./phases/B01_09_editorial.js";
export { runPhaseB0110 } from "./phases/B01_10_decision_logic.js";
export { runPhaseB0111 } from "./phases/B01_11_constraint_aggregation.js";
export { runPhaseB0112 } from "./phases/B01_12_assembly.js";

// Utilities
export { detectConflicts, mergeConflicts } from "./conflicts.js";
export { calculateCompleteness } from "./completeness.js";

// Orchestration
export {
  runB01,
  commitVersion,
  loadVersion,
  listVersions,
  getLatestVersion,
  approveCandidate,
  rejectCandidate,
  revokeCandidate,
  KNOWN_CANONICALIZATION_DROPS,
  platformRegistryProvenance,
} from "./orchestration.js";

// Persistence
export { createMockPersistence, createDefaultDeps } from "./persistence.js";
