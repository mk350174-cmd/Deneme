// TIER-1 REPAIR T1.3 test helper — Gate A5's NARRATION_APPROVED_FOR_PRODUCTION
// now requires Gate A4's PRODUCTION_DELIVERY_RECEIVED to already be on
// record. Every test that approves A5 needs a legal A4 record in its
// history; this is that record, factored out once rather than repeated.
import { recordGateApproval } from "../../src/gates.js";
import type { GateApprovalRecord } from "../../src/types.js";

export function approvedA4Fixture(): GateApprovalRecord {
  return recordGateApproval({
    gateId: "A4",
    stateBefore: "AWAITING_PRODUCTION_DELIVERY",
    actor: "user:mk350174",
    objectVersionBeingApproved: "delivery_v1",
    stateAfter: "PRODUCTION_DELIVERY_RECEIVED",
    downstreamOperationUnlocked: "P3.02",
  });
}
