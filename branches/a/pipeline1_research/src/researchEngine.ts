// Research Engine Contract — docs/architecture/01_PIPELINE_1_ARCHITECTURE.md
// "Research Engine Contract (provider selection remains deferred)".
//
// ADAPT of SOP's ResearchProvider / ManualResearchProvider pattern (src/m03/
// providers/researchProvider.ts) — see capability table: "Research Engine
// implementation | NEW / deferred | Behind the defined contract". SOP's own
// comment on that file states the intent precisely: a real provider "slots
// in later behind this same interface without the caller's business logic
// changing." That is exactly what P1.03 needs, so the interface shape is
// carried forward; the concrete provider (real web/domain research) is not
// selected here.
//
// ManualResearchEngine below is the one reference implementation shipped in
// this pass — deterministic, local, and never fabricates: it only returns
// pre-supplied findings, each carrying its own Source/evidence, exactly like
// SOP's ManualResearchProvider. This is what makes P1 fully testable
// end-to-end without prematurely committing to a real research engine.

import type { Claim, ClaimDimension, EvidenceStatusV1, ResearchScope, Source } from "./types.js";

export interface DiscoverResult {
  direction: string;
  rationale: string;
}

export interface InvestigateQuery {
  query: string;
  dimension: ClaimDimension;
}

export interface RawFinding {
  statement: string;
  dimension: ClaimDimension;
  derived_from: string;
  source: Source;
  excerpt_or_pointer: string;
  extraction_method: string;
  // Findings with no reliable evidence must say so up front instead of
  // being silently dropped or silently marked VERIFIED.
  unresolved_reason?: string;
}

export interface InvestigateResult {
  findings: RawFinding[];
}

export interface VerifyResult {
  status: EvidenceStatusV1;
  rationale: string;
  unresolved_reason?: string;
}

export interface ResearchEngine {
  discover(topic: string, constraints: string[]): Promise<DiscoverResult[]>;
  // approvedScope MUST be SCOPE_APPROVED — enforced by the pipeline before
  // this is ever called (see pipeline.ts runP103DomainResearch), and
  // independently re-checked here (defense in depth, per "MUST NOT: silently
  // broaden scope").
  investigate(approvedScope: ResearchScope, query: InvestigateQuery): Promise<InvestigateResult>;
  verify(claim: Claim, evidenceRefs: string[]): Promise<VerifyResult>;
}

/**
 * ManualResearchEngine: deterministic, local reference implementation.
 * Looks up pre-supplied findings keyed by "topic::dimension::query" and
 * pre-supplied verification verdicts keyed by claim statement. Nothing is
 * fetched over the network and nothing is invented — whatever the caller
 * did not supply comes back as an explicit UNKNOWN, never a guess.
 */
export class ManualResearchEngine implements ResearchEngine {
  private readonly findingsByKey: Map<string, RawFinding[]>;
  private readonly verificationsByStatement: Map<string, VerifyResult>;
  private readonly boundTopic: string;

  constructor(params: {
    topic: string;
    findings?: Record<string, RawFinding[]>;
    verifications?: Record<string, VerifyResult>;
  }) {
    this.boundTopic = params.topic.trim().toLowerCase();
    this.findingsByKey = new Map(Object.entries(params.findings ?? {}));
    this.verificationsByStatement = new Map(Object.entries(params.verifications ?? {}));
  }

  async discover(topic: string, constraints: string[]): Promise<DiscoverResult[]> {
    // Deterministic, non-fabricating "discovery": echoes the requested
    // topic/constraints back as a single candidate direction rather than
    // inventing research angles the engine has no basis for.
    return [
      {
        direction: topic,
        rationale:
          constraints.length > 0
            ? `Direct investigation of "${topic}" under supplied constraints: ${constraints.join("; ")}`
            : `Direct investigation of "${topic}".`,
      },
    ];
  }

  async investigate(approvedScope: ResearchScope, query: InvestigateQuery): Promise<InvestigateResult> {
    if (approvedScope.state !== "SCOPE_APPROVED") {
      // Pipeline-level enforcement is the primary guard (pipeline.ts);
      // this is the engine-level half of the same MUST NOT rule.
      throw new Error(
        `ManualResearchEngine.investigate called with scope in state "${approvedScope.state}", ` +
          `expected SCOPE_APPROVED`,
      );
    }
    if (approvedScope.topic.trim().toLowerCase() !== this.boundTopic) {
      // Out-of-scope direction: flagged via a typed error the caller must
      // handle explicitly (ScopeViolationError), never silently pursued.
      const { ScopeViolationError } = await import("./errors.js");
      throw new ScopeViolationError(approvedScope.topic, this.boundTopic);
    }
    const key = `${approvedScope.topic.trim().toLowerCase()}::${query.dimension}::${query.query.trim().toLowerCase()}`;
    return { findings: this.findingsByKey.get(key) ?? [] };
  }

  async verify(claim: Claim, evidenceRefs: string[]): Promise<VerifyResult> {
    const supplied = this.verificationsByStatement.get(claim.statement.trim().toLowerCase());
    if (supplied) return supplied;
    if (evidenceRefs.length === 0) {
      return {
        status: "UNKNOWN",
        rationale: "No evidence attached to this claim.",
        unresolved_reason: "No supporting evidence was found or supplied for this claim.",
      };
    }
    // Evidence exists but no explicit verification verdict was supplied:
    // default to INFERRED (derived from evidence, not independently
    // cross-checked) rather than guessing VERIFIED.
    return {
      status: "INFERRED",
      rationale: `Derived from ${evidenceRefs.length} evidence reference(s); not independently cross-checked.`,
    };
  }
}
