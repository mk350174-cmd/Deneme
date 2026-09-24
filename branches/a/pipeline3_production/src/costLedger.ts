// ADAPT: unifies Studio's two cost-ledger implementations into one —
// runtime/cost_governor.py's soft/hard-limit exceptions
// (soft_limit_threshold=0.80, budget_limit, validate_before_execution) and
// scripts/lib/production_ledger.py's per-provider unit quota
// (would_exceed_quota). One ledger, one set of fields.

import type { CostLedgerEntry } from "./types.js";

export class SoftLimitWarning extends Error {
  constructor(readonly totalCost: number, readonly budgetLimit: number) {
    super(`Soft budget limit reached: ${totalCost} of ${budgetLimit}`);
    this.name = "SoftLimitWarning";
  }
}

export class HardLimitHalt extends Error {
  constructor(readonly totalCost: number, readonly budgetLimit: number) {
    super(`Hard budget limit exceeded: ${totalCost} of ${budgetLimit}`);
    this.name = "HardLimitHalt";
  }
}

export class CostLedger {
  private readonly entries: CostLedgerEntry[] = [];
  private readonly quotaByProvider: Record<string, number>;
  readonly softLimitThreshold = 0.8;

  constructor(private readonly budgetLimit: number, quotaByProvider: Record<string, number> = {}) {
    this.quotaByProvider = quotaByProvider;
  }

  unitsUsed(provider: string): number {
    return this.entries.filter((e) => e.provider === provider && e.accepted).reduce((sum, e) => sum + e.units, 0);
  }

  totalCost(): number {
    return this.entries.filter((e) => e.accepted).reduce((sum, e) => sum + e.cost, 0);
  }

  wouldExceedQuota(provider: string, additionalUnits: number): boolean {
    const cap = this.quotaByProvider[provider];
    if (cap === undefined) return false;
    return this.unitsUsed(provider) + additionalUnits > cap;
  }

  wouldExceedHardLimit(provider: string, additionalUnits: number, unitCost = 1): boolean {
    return this.totalCost() + additionalUnits * unitCost > this.budgetLimit;
  }

  // Combined capacity/quota check used by scheduling.ts (P3.08-DIST) before
  // assigning a costed shard to a worker: true if EITHER the provider's own
  // unit quota or the ledger's overall budget would be exceeded. Distinct
  // from wouldExceedHardLimit (budget only) because a provider quota can be
  // tighter than the remaining budget (e.g. a Kaggle-notebook-count cap).
  wouldExceedLimit(provider: string, costUnits: number): boolean {
    return this.wouldExceedQuota(provider, costUnits) || this.wouldExceedHardLimit(provider, costUnits);
  }

  validateBeforeExecution(estimatedCost: number): void {
    const projected = this.totalCost() + estimatedCost;
    if (projected > this.budgetLimit) {
      throw new HardLimitHalt(projected, this.budgetLimit);
    }
    if (projected > this.budgetLimit * this.softLimitThreshold) {
      throw new SoftLimitWarning(projected, this.budgetLimit);
    }
  }

  log(entry: Omit<CostLedgerEntry, "ts">): void {
    this.entries.push({ ...entry, ts: new Date().toISOString() });
  }

  allEntries(): readonly CostLedgerEntry[] {
    return this.entries;
  }
}
