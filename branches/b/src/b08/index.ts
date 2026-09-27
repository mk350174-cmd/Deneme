// B08 — Analytics Strategy

export type {
  DataSourceDefinition,
  MetricDefinition,
  AnalyticsWorkflow,
  CompletenessScore,
  B08CandidateState,
  B08CanonicalState,
  B08Deps,
  B08StatePersistence,
} from "./types.js";

export { KNOWN_CANONICALIZATION_DROPS } from "./types.js";
export { runB08, approveCandidate, commitVersion, loadVersion, listVersions, getLatestVersion } from "./orchestration.js";
export { InMemoryB08Persistence } from "./persistence.js";
export * from "./phases/B08_01_registry.js";
export * from "./phases/B08_02_sources.js";
export * from "./phases/B08_03_metrics.js";
export * from "./phases/B08_04_workflows.js";
export * from "./phases/B08_05_validation.js";

export * from "./execution.js";
export * from "./external/types.js";
export * from "./external/adapter.js";
export * from "./external/runtime.js";
export * from "./external/context.js";
