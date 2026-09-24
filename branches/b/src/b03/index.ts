// B03 — Audience Intelligence Module
// Exports all types and functions for use by other B modules

export type {
  SeniorityLevel,
  CompanySize,
  AudienceNeedType,
  AudiencePainPointType,
  AudienceQuestionCategory,
  AudienceCharacteristics,
  AudienceSegment,
  SegmentProfile,
  AudienceNeed,
  AudiencePainPoint,
  AudienceQuestion,
  AudienceInsight,
  B03Input,
  CompletenessScore,
  B03CandidateState,
  B03CanonicalState,
  B03Deps,
  B03StatePersistence,
} from "./types.js";

export { KNOWN_CANONICALIZATION_DROPS } from "./types.js";

export {
  buildAudienceRegistry,
  validateRegistry,
} from "./phases/B03_01_registry.js";

export {
  aggregateAudienceEvidence,
} from "./phases/B03_02_evidence.js";

export {
  inferAudienceSegments,
  createDefaultB03Deps,
} from "./phases/B03_03_segmentation.js";

export {
  synthesizeSegmentProfiles,
  synthesizeAudienceNeeds,
  synthesizeAudiencePainPoints,
  synthesizeAudienceQuestions,
} from "./phases/B03_04_synthesis.js";

export {
  detectSegmentConflicts,
  identifyGaps,
  calculateCompleteness,
  validateNoFabrication,
} from "./phases/B03_05_validation.js";

export {
  runB03,
  approveCandidate,
  commitVersion,
  loadVersion,
  listVersions,
  getLatestVersion,
} from "./orchestration.js";

export {
  createMockPersistence,
  createDefaultDeps,
} from "./persistence.js";
