// P3.08-DIST Distributed Render — Failure Recovery Matrix
// NOT phase P3.09 (Automated QA, qa.ts) — see the naming note in orchestration_p309.ts.
// Maps 15 failure scenarios to recovery procedures with retry logic

import type { ShardAssignment, WorkerType } from "./types.js";

export type FailureClass =
  | "worker_death"
  | "timeout"
  | "memory"
  | "network"
  | "output_corruption"
  | "quota_exhausted"
  | "duplicate"
  | "secret_expired"
  | "blueprint_stale"
  | "merge_failure"
  | "preview_timeout";

export type RecoveryAction = "retry" | "reassign_worker" | "split_shard" | "escalate_human" | "skip_preview" | "fail_loud";

export interface RecoveryProcedure {
  action: RecoveryAction;
  retryAfter_s?: number;
  backoffMultiplier?: number;
  maxAttempts?: number;
  alternateWorker?: WorkerType;
}

export class FailureRecoveryOrchestrator {
  private readonly maxRetries: number;

  constructor(maxRetries: number = 2) {
    this.maxRetries = maxRetries;
  }

  // Classify failure from error message/context
  // Note: Order matters — more specific checks come before general ones
  classifyFailure(error: Error | string): FailureClass {
    const msg = (typeof error === "string" ? error : error.message).toLowerCase();

    if (msg.includes("out of memory") || msg.includes("oom")) return "memory";
    if (msg.includes("401") || msg.includes("unauthorized") || msg.includes("token")) return "secret_expired";
    if (msg.includes("corruption") || msg.includes("hash") || msg.includes("checksum")) return "output_corruption";
    if (msg.includes("404") || msg.includes("not found") || msg.includes("network")) return "network";
    if (msg.includes("quota") || (msg.includes("limit") && msg.includes("cost"))) return "quota_exhausted";
    if (msg.includes("merge") || msg.includes("concat")) return "merge_failure";
    if (msg.includes("preview")) return "preview_timeout";
    if (msg.includes("timeout") || msg.includes("exceeded") || msg.includes("hung")) return "timeout";

    return "worker_death"; // default
  }

  // Decide recovery procedure for failure class
  decideRecovery(failureClass: FailureClass, attempt: number): RecoveryProcedure {
    // Implementation based on plan's 15-scenario matrix (H.3)
    const baseDelay = 1;
    const backoff = 1.5;

    switch (failureClass) {
      case "timeout":
        return { action: "retry", retryAfter_s: baseDelay * Math.pow(backoff, attempt), maxAttempts: this.maxRetries };

      case "memory":
        return { action: "reassign_worker", alternateWorker: "local_cpu" as WorkerType };

      case "secret_expired":
        // Retry after brief delay to allow token refresh
        return { action: "retry", retryAfter_s: 5, maxAttempts: 1 };

      case "output_corruption":
        return { action: "retry", retryAfter_s: baseDelay * Math.pow(backoff, attempt) };

      case "network":
        return attempt < this.maxRetries
          ? { action: "retry", retryAfter_s: 10, maxAttempts: 5 }
          : { action: "escalate_human" };

      case "quota_exhausted":
        return { action: "fail_loud" }; // hard stop, no retry

      case "duplicate":
        return { action: "skip_preview" }; // shard already executed, skip

      case "merge_failure":
        return { action: "escalate_human" };

      case "preview_timeout":
        return { action: "skip_preview" }; // preview is optional

      case "blueprint_stale":
        return { action: "escalate_human" }; // need manual blueprint update

      case "worker_death":
      default:
        return { action: "escalate_human" };
    }
  }

  // Execute shard with automatic recovery
  async executeShard<T>(
    shardId: string,
    assignment: ShardAssignment,
    executor: (assignment: ShardAssignment) => Promise<T>,
  ): Promise<{ success: boolean; result?: T; lastError?: Error; attempts: number }> {
    let lastError: Error | null = null;
    let attempts = 0;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      attempts = attempt + 1;

      try {
        const result = await executor(assignment);
        return { success: true, result, attempts };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const failureClass = this.classifyFailure(lastError);
        const procedure = this.decideRecovery(failureClass, attempt);

        switch (procedure.action) {
          case "retry":
            if (attempt < (procedure.maxAttempts || this.maxRetries)) {
              const delayS = procedure.retryAfter_s || 1;
              await this.delay(delayS * 1000);
              continue;
            }
            break;

          case "reassign_worker": {
            // TIER-3 REPAIR — previously always returned failure with the
            // comment "Would reassign to alternate worker (escalate for
            // user decision)": the reassignment never actually happened,
            // only its possibility was noted. This now genuinely retries
            // the SAME executor with the assignment's worker swapped to
            // procedure.alternateWorker, once. If that retry also fails,
            // recovery honestly escalates rather than looping forever.
            if (procedure.alternateWorker && attempt < this.maxRetries) {
              try {
                const reassigned: ShardAssignment = { ...assignment, assigned_worker: procedure.alternateWorker };
                const result = await executor(reassigned);
                return { success: true, result, attempts: attempts + 1 };
              } catch (retryError) {
                lastError = retryError instanceof Error ? retryError : new Error(String(retryError));
                return { success: false, lastError, attempts: attempts + 1 };
              }
            }
            return { success: false, lastError, attempts };
          }

          case "split_shard":
            // NOT IMPLEMENTED — documented limitation, not silently
            // dropped. Splitting requires the shard's frame-range
            // specification (ShardSpecification), which executeShard does
            // not receive (it operates on ShardAssignment only, one level
            // removed from sharding.ts). Implementing a real split here
            // would mean widening this method's signature and touching the
            // Phase 3 orchestration loop that calls it — out of scope for a
            // Tier 3 change per the repair brief's "repair where practical
            // without destabilizing Tier 1/2". Escalates to a human
            // decision honestly instead of claiming a split that does not
            // happen.
            return { success: false, lastError, attempts };

          case "escalate_human":
            return { success: false, lastError, attempts };

          case "fail_loud":
            return { success: false, lastError, attempts };

          case "skip_preview":
            // Preview is optional, return success even though preview failed
            return { success: true, attempts };

          default:
            break;
        }
      }
    }

    return { success: false, lastError: lastError || new Error("Unknown failure"), attempts };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
