// Structured errors per docs/architecture/02_PIPELINE_2_ARCHITECTURE.md.
// Same shape as pipeline1_research/src/errors.ts (duplicated, not imported —
// P2 has no dependency edge on P1, see plan "Package layout").

export class ValidationError extends Error {
  readonly field: string;
  readonly stage: string;

  constructor(stage: string, field: string, message: string) {
    super(`[${stage}] ${field}: ${message}`);
    this.name = "ValidationError";
    this.stage = stage;
    this.field = field;
  }
}

// Raised by ingest.ts when an incoming object does not satisfy the P1
// Research Package handoff contract — P2 never infers missing context from
// a malformed/incomplete package (Architectural Principle 8).
export class HandoffValidationError extends Error {
  readonly field: string;

  constructor(field: string, message: string) {
    super(`[P1->P2 handoff] ${field}: ${message}`);
    this.name = "HandoffValidationError";
    this.field = field;
  }
}

// Raised when a gate transition is attempted out of order.
export class GateStateError extends Error {
  constructor(gateId: string, expected: string, actual: string) {
    super(`[${gateId}] expected state "${expected}" but found "${actual}"`);
    this.name = "GateStateError";
  }
}

// Raised by traceability.ts when an FK in the Asset Traceability chain
// (RESEARCH FACT -> CREATIVE DECISION -> SCENE -> SHOT -> ASSET REQUIREMENT)
// does not resolve. Never inferred/patched — always a hard stop.
export class TraceabilityError extends Error {
  constructor(chainLink: string, id: string, reason: string) {
    super(`Broken traceability chain at ${chainLink} ("${id}"): ${reason}`);
    this.name = "TraceabilityError";
  }
}

// Raised by P2.11 Reverse QA when it detects a mismatch anywhere in the
// creative chain. The draft function refuses to produce a handoff — no
// automatic repair, substitution, or silent decision.
export class ReverseQAError extends Error {
  readonly mismatches: string[];

  constructor(mismatches: string[]) {
    super(`Reverse QA found ${mismatches.length} unresolved mismatch(es): ${mismatches.join("; ")}`);
    this.name = "ReverseQAError";
    this.mismatches = mismatches;
  }
}
