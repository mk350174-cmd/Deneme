// Structured errors per docs/architecture/03_PIPELINE_3_ARCHITECTURE.md
// "Error Taxonomy" and the user's explicit correction: P3Error carries
// exactly code/field/object_id/reason/required_action, where
// required_action is a CLOSED, machine-readable vocabulary — never
// arbitrary prose. Human-readable explanation belongs in `reason`.

export type P3ErrorCode =
  | "MISSING_ASSET"
  | "WRONG_ASSET"
  | "PLAN_ERROR"
  | "ASSET_ERROR"
  | "USER_ACTION_REQUIRED"
  | "RENDER_COORDINATION_ERROR"
  | "SHARD_MERGE_ERROR"
  | "SHARD_PREVIEW_ERROR";

export type RequiredAction =
  | "UPLOAD_MISSING_ASSET"
  | "REPLACE_WRONG_ASSET"
  | "FIX_PLAN"
  | "FIX_ASSET"
  | "HUMAN_APPROVAL_REQUIRED"
  | "RESOLVE_AMBIGUITY"
  | "RETRY_SHARD"
  | "SPLIT_SHARD"
  | "ESCALATE_TO_HUMAN";

// Default code -> required_action mapping. Call sites may pick a more
// specific action within the same closed vocabulary where appropriate
// (e.g. USER_ACTION_REQUIRED routing to Gate A6 uses RESOLVE_AMBIGUITY
// rather than the generic HUMAN_APPROVAL_REQUIRED).
const DEFAULT_REQUIRED_ACTION: Record<P3ErrorCode, RequiredAction> = {
  MISSING_ASSET: "UPLOAD_MISSING_ASSET",
  WRONG_ASSET: "REPLACE_WRONG_ASSET",
  PLAN_ERROR: "FIX_PLAN",
  ASSET_ERROR: "FIX_ASSET",
  USER_ACTION_REQUIRED: "HUMAN_APPROVAL_REQUIRED",
  RENDER_COORDINATION_ERROR: "ESCALATE_TO_HUMAN",
  SHARD_MERGE_ERROR: "ESCALATE_TO_HUMAN",
  SHARD_PREVIEW_ERROR: "ESCALATE_TO_HUMAN",
};

export class P3Error extends Error {
  readonly code: P3ErrorCode;
  readonly field: string;
  readonly object_id: string;
  readonly reason: string;
  readonly required_action: RequiredAction;

  constructor(params: {
    code: P3ErrorCode;
    field: string;
    object_id: string;
    reason: string;
    required_action?: RequiredAction;
  }) {
    super(`[${params.code}] ${params.field} (${params.object_id}): ${params.reason}`);
    this.name = "P3Error";
    this.code = params.code;
    this.field = params.field;
    this.object_id = params.object_id;
    this.reason = params.reason;
    this.required_action = params.required_action ?? DEFAULT_REQUIRED_ACTION[params.code];
  }
}

// Raised by ingest.ts when a raw input fails structural, integrity, or
// referential-consistency validation — names exactly which layer failed.
export class HandoffValidationError extends Error {
  readonly layer: "structural" | "integrity" | "referential";
  readonly field: string;

  constructor(layer: "structural" | "integrity" | "referential", field: string, message: string) {
    super(`[P2->P3 handoff, ${layer} layer] ${field}: ${message}`);
    this.name = "HandoffValidationError";
    this.layer = layer;
    this.field = field;
  }
}

export class GateStateError extends Error {
  constructor(gateId: string, expected: string, actual: string) {
    super(`[${gateId}] expected state "${expected}" but found "${actual}"`);
    this.name = "GateStateError";
  }
}
