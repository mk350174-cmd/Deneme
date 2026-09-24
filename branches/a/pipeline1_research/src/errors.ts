// Structured errors per docs/architecture/01_PIPELINE_1_ARCHITECTURE.md
// "P1 Must Not" / error-handling rule: missing required input, out-of-scope
// research directions, and provenance-schema violations must all fail loud
// with a named field, never continue silently.

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

// Raised when a P1.03 research direction falls outside the scope object
// approved at Gate A1 (transition 1). Per the Research Engine contract,
// this must be flagged and returned upstream, never silently pursued.
export class ScopeViolationError extends Error {
  readonly requestedTopic: string;
  readonly approvedTopic: string;

  constructor(requestedTopic: string, approvedTopic: string) {
    super(
      `Research direction "${requestedTopic}" falls outside approved scope ` +
        `"${approvedTopic}". Flagged upstream — not executed.`,
    );
    this.name = "ScopeViolationError";
    this.requestedTopic = requestedTopic;
    this.approvedTopic = approvedTopic;
  }
}

// Raised when a gate transition is attempted out of order (e.g. approving a
// package that was never drafted, or investigating before scope approval).
export class GateStateError extends Error {
  constructor(gateId: string, expected: string, actual: string) {
    super(`[${gateId}] expected state "${expected}" but found "${actual}"`);
    this.name = "GateStateError";
  }
}
