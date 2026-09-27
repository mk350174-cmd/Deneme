import type { EvidenceRef } from "../../types/entities.js";
import type { EvidenceSourceMode } from "../../b00/evidence.js";
import type { CanonicalIdentity } from "../../b00/identity.js";
import type { ProvenanceRef } from "../../b00/provenanceRef.js";
import type { GovernanceEvent } from "../../b00/governance.js";

export type ObservationKind = "PerformanceObservation" | "AudienceObservation" | "CommunityObservation" | "TrendObservation" | "CompetitiveObservation";
export type AccessFailure = "FAILED" | "UNAVAILABLE" | "AUTH_REQUIRED" | "UNSUPPORTED_CAPABILITY" | "RATE_LIMITED" | "MALFORMED_RESULT";
export type AccessStatus = AccessFailure | "EXECUTED_REAL" | "EXECUTED_MOCK" | "EXECUTED_SYNTHETIC" | "EXECUTED_UNKNOWN";
export interface ExternalAccessRequest {
  request_id: string;
  project_id: string;
  purpose: string;
  query: string;
  source_types: string[];
  platform?: string;
  geography?: string;
  time_range?: { start: string; end: string };
  max_results: number;
  observation_kind: ObservationKind;
  /** Explicit B channel identity; a platform name alone does not bind a channel. */
  channel_id: string;
}
export interface AgentReachCapability {
  capability: string; platform: string; backend: string;
  requires_auth: boolean; requires_cookie: boolean; requires_browser_session: boolean;
  requires_mcp: boolean; proxy_required: boolean;
  status: "UNKNOWN" | "AVAILABLE" | AccessFailure; last_checked: string | null;
}
export interface AgentReachHealth {
  installed: boolean; reachable: boolean; authenticated: boolean | "UNKNOWN";
  provider_version: string | null; checked_at: string;
  capabilities: AgentReachCapability[];
  /** Operational telemetry only; never converted to EvidenceRef. */
  status: "AVAILABLE" | AccessFailure;
}
/** B-owned transport envelope, NOT an asserted upstream Agent Reach JSON API. */
export interface ProviderResponse {
  status: "OK" | AccessFailure; provider_version: string | null; backend: string;
  retrieved_at: string;
  sources: Array<{ canonical_url: string; platform: string; retrieval_method: string; content: string }>;
}
export interface AgentReachTransport {
  readonly source_mode: EvidenceSourceMode;
  retrieve(request: ExternalAccessRequest, signal: AbortSignal): Promise<unknown>;
  health(): Promise<AgentReachHealth>;
}
export interface ExternalSource {
  source_id: string; project_id: string; platform: string; canonical_url: string;
  retrieval_method: string; retrieved_at: string; content_hash: string;
  source_mode: EvidenceSourceMode; backend: string; provider_version: string | null;
  /** Exact retrieved text; data only, never instructions or executable code. */
  content: string;
}
export interface ExternalMeasurement {
  metric_id: string; channel_id: string; value: number; unit: string;
  period_start: string; period_end: string;
}
export interface ExternalObservation {
  observation_id: string; kind: ObservationKind; project_id: string; channel_id: string;
  source_id: string; source_mode: EvidenceSourceMode; observed_at: string;
  /** Source report, not established truth. */
  statement: string; measurement?: ExternalMeasurement;
  evidence_refs: EvidenceRef[]; provenance: ProvenanceRef;
}
export interface ExternalAccessResult {
  identity: CanonicalIdentity; request: ExternalAccessRequest;
  provider: "agent-reach"; provider_version: string | null; backend: string;
  status: AccessStatus; source_mode: EvidenceSourceMode; retrieved_at: string;
  sources: ExternalSource[]; evidence: EvidenceRef[]; provenance: ProvenanceRef[];
  observations: ExternalObservation[];
}
/** Separate confirmation by a caller-owned reviewer, bound through B00 governance.
 * Retrieval evidence remains UNKNOWN even after this review. */
export interface ExternalObservationReview {
  observation_id: string; observation_content_hash: string;
  authority: string; reviewed_at: string; evidence_refs: EvidenceRef[];
  governance_events: GovernanceEvent[];
}
export interface ExternalIntelligenceContext {
  project_id: string; results: ExternalAccessResult[]; reviews?: ExternalObservationReview[];
}
