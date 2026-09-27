// B12.04 — Generate Audit Trail

import type { BranchVersion, B12Deps } from "../types.js";

export interface AuditEntry {
  timestamp: string;
  action: string;
  actor: string;
  affected_modules: string[];
}

export function generateAuditTrail(
  moduleVersions: BranchVersion[],
  authority: string,
  actionDescription: string,
  deps?: B12Deps,
): AuditEntry[] {
  const deps_ = deps || { now: () => new Date().toISOString() };
  const now = deps_.now?.() || new Date().toISOString();
  const affectedModules = moduleVersions.map((v) => v.module);

  const entries: AuditEntry[] = [
    {
      timestamp: now,
      action: actionDescription,
      actor: authority,
      affected_modules: affectedModules,
    },
  ];

  return entries;
}
