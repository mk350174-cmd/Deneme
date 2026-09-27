/**
 * B-Branch canonical epistemic primitives.
 *
 * VERIFIED = directly confirmed by eligible non-mock evidence under the
 * B-Branch evidence policy.
 * INFERRED = derived/assumed/asserted rather than directly observed.
 * UNKNOWN  = insufficient evidence; never fabricated into certainty.
 */
export type EvidenceStatus = "VERIFIED" | "INFERRED" | "UNKNOWN";

export interface EvidenceRef {
  /** Stable evidence reference id. */
  id: string;
  /** Source locator or source-class identifier. */
  source: string;
  /** Epistemic status; distinct from origin, basis and governance state. */
  status: EvidenceStatus;
  /** Where the evidence originated. */
  origin?:
    | "REAL_WORLD_OBSERVATION"
    | "PROVIDER_DATA"
    | "RESEARCH"
    | "DOCUMENTATION"
    | "USER_ASSERTION"
    | "SYSTEM_DERIVATION"
    | "DEFAULT"
    | "MOCK"
    | "UNKNOWN";
  /** How the represented claim relates to the source. */
  basis?: "OBSERVED" | "ASSERTED" | "INFERRED" | "DEFAULT" | "MOCK" | "UNKNOWN";
  /** Explicit real/mock firewall. */
  source_mode?: "REAL" | "MOCK" | "SYNTHETIC" | "UNKNOWN";
  /** MOCK/SYNTHETIC references must never be production eligible. */
  production_eligible?: boolean;
  /** Optional short source-backed excerpt. */
  excerpt?: string;
}
