// B05 — Creative Synthesis Module
// Strategic creative direction and creative constraints

export type {
  CreativeAngle,
  CreativeConstraint,
  MessagingStrategy,
  CreativeBrief,
  CompletenessScore,
  B05CandidateState,
  B05CanonicalState,
  B05Input,
  B05Deps,
  B05StatePersistence,
} from "./types.js";

export { KNOWN_CANONICALIZATION_DROPS } from "./types.js";

export { runB05, approveCandidate, commitVersion, loadVersion, listVersions, getLatestVersion } from "./orchestration.js";
export { createMockPersistence } from "./persistence.js";
export { buildCreativeContext, validateCreativeContext } from "./phases/B05_01_registry.js";
export { synthesizeCreativeAngles } from "./phases/B05_02_angles.js";
export { synthesizeMessagingStrategies } from "./phases/B05_03_messaging.js";
export { identifyCreativeConstraints } from "./phases/B05_04_constraints.js";
export {
  detectCreativeConflicts,
  identifyCreativeGaps,
  calculateCreativeCompleteness,
} from "./phases/B05_05_validation.js";
