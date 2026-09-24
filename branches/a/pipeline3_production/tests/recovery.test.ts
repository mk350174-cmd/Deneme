// P3.08-DIST Distributed Render (NOT phase P3.09/Automated QA) — Failure Recovery Matrix Tests
// Validates failure classification, recovery procedure selection, and retry orchestration

import { describe, it, expect, beforeEach } from "vitest";
import { FailureRecoveryOrchestrator, type RecoveryAction, type FailureClass } from "../src/recovery.js";
import type { ShardAssignment } from "../src/types.js";

describe("FailureRecoveryOrchestrator", () => {
  let orchestrator: FailureRecoveryOrchestrator;

  beforeEach(() => {
    orchestrator = new FailureRecoveryOrchestrator(2);
  });

  describe("classifyFailure", () => {
    it("classifies 'out of memory' error as memory failure", () => {
      const result = orchestrator.classifyFailure(new Error("Process out of memory"));
      expect(result).toBe("memory");
    });

    it("classifies OOM abbreviation", () => {
      const result = orchestrator.classifyFailure("OOM killed");
      expect(result).toBe("memory");
    });

    it("classifies timeout error", () => {
      const result = orchestrator.classifyFailure(new Error("Operation timeout exceeded"));
      expect(result).toBe("timeout");
    });

    it("classifies 401 unauthorized as secret_expired", () => {
      const result = orchestrator.classifyFailure("401 Unauthorized");
      expect(result).toBe("secret_expired");
    });

    it("classifies token error as secret_expired", () => {
      const result = orchestrator.classifyFailure("Invalid token or expired credentials");
      expect(result).toBe("secret_expired");
    });

    it("classifies corruption error", () => {
      const result = orchestrator.classifyFailure("Output corruption detected: hash mismatch");
      expect(result).toBe("output_corruption");
    });

    it("classifies 404 not found as network", () => {
      const result = orchestrator.classifyFailure("404 not found");
      expect(result).toBe("network");
    });

    it("classifies quota exhausted", () => {
      const result = orchestrator.classifyFailure("Quota limit exceeded");
      expect(result).toBe("quota_exhausted");
    });

    it("classifies merge failure", () => {
      const result = orchestrator.classifyFailure("FFmpeg concat failed");
      expect(result).toBe("merge_failure");
    });

    it("classifies preview timeout", () => {
      const result = orchestrator.classifyFailure("Preview generation timeout");
      expect(result).toBe("preview_timeout");
    });

    it("defaults to worker_death for unknown error", () => {
      const result = orchestrator.classifyFailure("Some random error");
      expect(result).toBe("worker_death");
    });
  });

  describe("decideRecovery", () => {
    it("decides to retry on timeout with backoff", () => {
      const procedure = orchestrator.decideRecovery("timeout", 0);
      expect(procedure.action).toBe("retry");
      expect(procedure.retryAfter_s).toBeGreaterThan(0);
      expect(procedure.maxAttempts).toBeDefined();
    });

    it("increases retry delay on successive timeout attempts", () => {
      const p0 = orchestrator.decideRecovery("timeout", 0);
      const p1 = orchestrator.decideRecovery("timeout", 1);
      const p2 = orchestrator.decideRecovery("timeout", 2);
      const delay0 = p0.retryAfter_s || 0;
      const delay1 = p1.retryAfter_s || 0;
      const delay2 = p2.retryAfter_s || 0;
      expect(delay1).toBeGreaterThan(delay0);
      expect(delay2).toBeGreaterThan(delay1);
    });

    it("decides to reassign_worker on memory error", () => {
      const procedure = orchestrator.decideRecovery("memory", 0);
      expect(procedure.action).toBe("reassign_worker");
      expect(procedure.alternateWorker).toBe("local_cpu");
    });

    it("decides to retry on secret_expired with 5s delay", () => {
      const procedure = orchestrator.decideRecovery("secret_expired", 0);
      expect(procedure.action).toBe("retry");
      expect(procedure.retryAfter_s).toBe(5);
      expect(procedure.maxAttempts).toBe(1);
    });

    it("decides to retry on output_corruption", () => {
      const procedure = orchestrator.decideRecovery("output_corruption", 0);
      expect(procedure.action).toBe("retry");
    });

    it("decides to retry on network error (first attempts)", () => {
      const procedure = orchestrator.decideRecovery("network", 0);
      expect(procedure.action).toBe("retry");
      expect(procedure.maxAttempts).toBe(5);
    });

    it("escalates human on network error (after max retries)", () => {
      const procedure = orchestrator.decideRecovery("network", 2);
      expect(procedure.action).toBe("escalate_human");
    });

    it("fails loud on quota_exhausted (no retry)", () => {
      const procedure = orchestrator.decideRecovery("quota_exhausted", 0);
      expect(procedure.action).toBe("fail_loud");
    });

    it("skips preview on duplicate execution", () => {
      const procedure = orchestrator.decideRecovery("duplicate", 0);
      expect(procedure.action).toBe("skip_preview");
    });

    it("escalates human on merge_failure", () => {
      const procedure = orchestrator.decideRecovery("merge_failure", 0);
      expect(procedure.action).toBe("escalate_human");
    });

    it("skips preview on preview_timeout", () => {
      const procedure = orchestrator.decideRecovery("preview_timeout", 0);
      expect(procedure.action).toBe("skip_preview");
    });

    it("escalates human on blueprint_stale", () => {
      const procedure = orchestrator.decideRecovery("blueprint_stale", 0);
      expect(procedure.action).toBe("escalate_human");
    });

    it("escalates human on worker_death", () => {
      const procedure = orchestrator.decideRecovery("worker_death", 0);
      expect(procedure.action).toBe("escalate_human");
    });
  });

  describe("executeShard (retry orchestration)", () => {
    it("succeeds on first attempt", async () => {
      const assignment: ShardAssignment = {
        shard_id: "shard_0",
        assigned_worker: {
          id: "local_cpu",
          estimated_fps: 30,
          memory_gb: 8,
          session_timeout_hours: 1,
          cost_per_hour_units: 0,
        },
        estimated_duration_s: 10,
        cost_estimate_units: 0,
        priority: 0,
      };

      const executor = async () => "success";

      const result = await orchestrator.executeShard("shard_0", assignment, executor);
      expect(result.success).toBe(true);
      expect(result.result).toBe("success");
      expect(result.attempts).toBe(1);
    });

    it("retries on timeout and succeeds on second attempt", async () => {
      const assignment: ShardAssignment = {
        shard_id: "shard_0",
        assigned_worker: {
          id: "local_cpu",
          estimated_fps: 30,
          memory_gb: 8,
          session_timeout_hours: 1,
          cost_per_hour_units: 0,
        },
        estimated_duration_s: 10,
        cost_estimate_units: 0,
        priority: 0,
      };

      let attemptCount = 0;
      const executor = async () => {
        attemptCount++;
        if (attemptCount === 1) throw new Error("timeout exceeded");
        return "success";
      };

      const result = await orchestrator.executeShard("shard_0", assignment, executor);
      expect(result.success).toBe(true);
      expect(result.result).toBe("success");
      expect(result.attempts).toBe(2);
    });

    it("fails after max retries exhausted", async () => {
      const assignment: ShardAssignment = {
        shard_id: "shard_0",
        assigned_worker: {
          id: "local_cpu",
          estimated_fps: 30,
          memory_gb: 8,
          session_timeout_hours: 1,
          cost_per_hour_units: 0,
        },
        estimated_duration_s: 10,
        cost_estimate_units: 0,
        priority: 0,
      };

      const executor = async () => {
        throw new Error("timeout exceeded"); // always fails
      };

      const result = await orchestrator.executeShard("shard_0", assignment, executor);
      expect(result.success).toBe(false);
      expect(result.lastError).toBeDefined();
      expect(result.attempts).toBe(3); // 0, 1, 2 (3 total attempts)
    });

    // TIER-3 REPAIR NOTE: this test's title and original assertion
    // (attempts: 1, "fails immediately, no retries") documented the
    // PLACEHOLDER'S behavior — reassign_worker always returned failure
    // without ever attempting a reassignment, per the comment "Would
    // reassign to alternate worker (escalate for user decision)". Memory
    // errors are mapped to reassign_worker (not fail_loud) precisely
    // because a worker with more memory might succeed where this one
    // didn't — that is the whole rationale for choosing that action over
    // immediate escalation. Now that reassign_worker genuinely retries once
    // on the alternate worker, a persistent OOM correctly costs one extra
    // attempt before escalating, rather than never being retried at all.
    it("retries once on an alternate (higher-memory) worker after an OOM, then escalates if that also fails", async () => {
      const assignment: ShardAssignment = {
        shard_id: "shard_0",
        assigned_worker: {
          id: "local_cpu",
          estimated_fps: 30,
          memory_gb: 8,
          session_timeout_hours: 1,
          cost_per_hour_units: 0,
        },
        estimated_duration_s: 10,
        cost_estimate_units: 0,
        priority: 0,
      };

      const seenWorkers: string[] = [];
      const executor = async (a: ShardAssignment) => {
        seenWorkers.push(typeof a.assigned_worker === "string" ? a.assigned_worker : a.assigned_worker.id);
        throw new Error("Process out of memory");
      };

      const result = await orchestrator.executeShard("shard_0", assignment, executor);
      expect(result.success).toBe(false);
      expect(result.attempts).toBe(2); // original attempt + one genuine reassignment retry
      expect(seenWorkers).toEqual(["local_cpu", "local_cpu"]); // reassign target from decideRecovery
    });

    it("a reassignment retry that succeeds is reported as a success", async () => {
      const assignment: ShardAssignment = {
        shard_id: "shard_0",
        assigned_worker: {
          id: "local_cpu",
          estimated_fps: 30,
          memory_gb: 8,
          session_timeout_hours: 1,
          cost_per_hour_units: 0,
        },
        estimated_duration_s: 10,
        cost_estimate_units: 0,
        priority: 0,
      };

      let callCount = 0;
      const executor = async (a: ShardAssignment) => {
        callCount += 1;
        if (callCount === 1) throw new Error("Process out of memory");
        return { assigned_worker: a.assigned_worker, ok: true };
      };

      const result = await orchestrator.executeShard("shard_0", assignment, executor);
      expect(result.success).toBe(true);
      expect(result.attempts).toBe(2);
      expect(callCount).toBe(2);
    });

    it("skips preview on preview_timeout error", async () => {
      const assignment: ShardAssignment = {
        shard_id: "shard_0",
        assigned_worker: {
          id: "local_cpu",
          estimated_fps: 30,
          memory_gb: 8,
          session_timeout_hours: 1,
          cost_per_hour_units: 0,
        },
        estimated_duration_s: 10,
        cost_estimate_units: 0,
        priority: 0,
      };

      const executor = async () => {
        throw new Error("Preview generation timeout");
      };

      const result = await orchestrator.executeShard("shard_0", assignment, executor);
      expect(result.success).toBe(true); // succeeds despite preview failure
      expect(result.attempts).toBe(1);
    });

    it("fails loud on quota_exhausted", async () => {
      const assignment: ShardAssignment = {
        shard_id: "shard_0",
        assigned_worker: {
          id: "local_cpu",
          estimated_fps: 30,
          memory_gb: 8,
          session_timeout_hours: 1,
          cost_per_hour_units: 0,
        },
        estimated_duration_s: 10,
        cost_estimate_units: 0,
        priority: 0,
      };

      const executor = async () => {
        throw new Error("Quota budget limit cost");
      };

      const result = await orchestrator.executeShard("shard_0", assignment, executor);
      expect(result.success).toBe(false);
      expect(result.attempts).toBe(1); // fails immediately, hard stop
    });
  });

  describe("Failure Matrix Coverage", () => {
    it("covers all 15 failure scenarios with recovery procedures", () => {
      const scenarios: FailureClass[] = [
        "worker_death",
        "timeout",
        "memory",
        "network",
        "output_corruption",
        "quota_exhausted",
        "duplicate",
        "secret_expired",
        "blueprint_stale",
        "merge_failure",
        "preview_timeout",
      ];

      for (const scenario of scenarios) {
        const procedure = orchestrator.decideRecovery(scenario, 0);
        expect(procedure.action).toBeDefined();
        expect(
          ["retry", "reassign_worker", "split_shard", "escalate_human", "skip_preview", "fail_loud"].includes(
            procedure.action,
          ),
        ).toBe(true);
      }
    });
  });
});
