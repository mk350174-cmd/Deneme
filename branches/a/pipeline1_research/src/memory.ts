// ADAPT of SOP src/memory/projectMemory.ts — see capability table:
// "Incremental memory merge | ADAPT | Origin: SOP project-memory merge
// pattern". Same discipline: update incrementally, never silently drop
// prior evidence/claims, append-only changelog.

import { promises as fs } from "node:fs";
import path from "node:path";
import type { Claim, Evidence, ResearchScope, Source } from "./types.js";

const DEFAULT_MEMORY_DIR = path.resolve(process.cwd(), "project_memory");

export interface ProjectMemoryChangelogEntry {
  timestamp: string;
  stage: string;
  summary: string;
}

export interface ProjectMemory {
  project_id: string;
  research_scope: ResearchScope | null;
  sources: Source[];
  evidence: Evidence[];
  claims: Claim[];
  changelog: ProjectMemoryChangelogEntry[];
  updated_at: string;
}

function emptyMemory(projectId: string): ProjectMemory {
  return {
    project_id: projectId,
    research_scope: null,
    sources: [],
    evidence: [],
    claims: [],
    changelog: [],
    updated_at: new Date().toISOString(),
  };
}

function memoryPath(projectId: string, dir: string): string {
  return path.join(dir, `${projectId}.json`);
}

export async function loadProjectMemory(
  projectId: string,
  dir: string = DEFAULT_MEMORY_DIR,
): Promise<ProjectMemory> {
  try {
    const raw = await fs.readFile(memoryPath(projectId, dir), "utf-8");
    return JSON.parse(raw) as ProjectMemory;
  } catch {
    return emptyMemory(projectId);
  }
}

function mergeUnique<T>(existing: T[], incoming: T[], keyFn: (v: T) => string): T[] {
  const map = new Map<string, T>();
  for (const item of existing) map.set(keyFn(item), item);
  for (const item of incoming) map.set(keyFn(item), item); // incoming wins on conflict
  return Array.from(map.values());
}

// Merges a fresh P1 run's sources/evidence/claims into existing project
// memory. Never silently drops prior entries; same-id entries are updated
// in place, everything else is additive. Scope is only overwritten once
// approved (SCOPE_APPROVED), matching the frozen-scope rule.
export function applyRunToMemory(
  memory: ProjectMemory,
  run: {
    scope: ResearchScope;
    sources: Source[];
    evidence: Evidence[];
    claims: Claim[];
    stage: string;
    summary: string;
  },
): ProjectMemory {
  const now = new Date().toISOString();
  return {
    ...memory,
    research_scope:
      run.scope.state === "SCOPE_APPROVED" ? run.scope : memory.research_scope,
    sources: mergeUnique(memory.sources, run.sources, (s) => s.source_id),
    evidence: mergeUnique(memory.evidence, run.evidence, (e) => e.evidence_id),
    claims: mergeUnique(memory.claims, run.claims, (c) => c.claim_id),
    changelog: [
      ...memory.changelog,
      { timestamp: now, stage: run.stage, summary: run.summary },
    ],
    updated_at: now,
  };
}

export async function saveProjectMemory(
  memory: ProjectMemory,
  dir: string = DEFAULT_MEMORY_DIR,
): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  const filePath = memoryPath(memory.project_id, dir);
  await fs.writeFile(filePath, JSON.stringify(memory, null, 2) + "\n", "utf-8");
  return filePath;
}

export { DEFAULT_MEMORY_DIR };
