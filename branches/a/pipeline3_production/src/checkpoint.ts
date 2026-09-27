// Lightweight ADAPT of Studio's ArtifactCache.fingerprint/get/put pattern —
// a content-addressed cache keyed by stage-input hash, applied to the
// costed Piper/ElevenLabs stages so a re-run doesn't repeat completed work.
// Deliberately NOT Studio's full task/worker/DAG kernel.
//
// A cache hit is NEVER automatically trusted (correction 5): the stored
// result's hash is recomputed and a schema/shape validator runs before the
// entry is reused. An invalid/corrupt entry is discarded and the stage
// reruns (and is re-cached with the fresh, valid result). This holds
// whether the entry came from this process's own memory or was loaded from
// disk (see persistence below) — corruption is corruption either way.
//
// AUDIT FIX (P3 final closure pass, correction 1): cross-process resume.
// The cache was previously pure in-memory (a bare Map, lost on process
// exit) — "resume cheaply" did not actually hold across a real crash or
// restart. Persistence mirrors pipeline1_research/src/memory.ts's existing,
// already-established convention exactly: a plain JSON file via node:fs,
// whole-file rewrite on every write, loaded once on construction — not a
// database, not JSONL, no new convention invented.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { sha256 } from "./ids.js";
import type { CacheEntry } from "./types.js";

function isPersistedEntryShape(v: unknown): v is CacheEntry<unknown> {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Record<string, unknown>;
  return typeof e.fingerprint === "string" && typeof e.result_hash === "string" && "result" in e;
}

export class StageCache {
  private readonly store = new Map<string, CacheEntry<unknown>>();

  // persistPath is optional — an in-memory-only StageCache (persistPath
  // omitted) behaves exactly as before this fix. When provided, the cache
  // survives process restarts by round-tripping through this JSON file.
  constructor(private readonly persistPath?: string) {
    if (!this.persistPath) return;
    if (!existsSync(this.persistPath)) return;
    try {
      const raw = readFileSync(this.persistPath, "utf-8");
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return; // malformed -> empty cache, never a crash
      for (const [fingerprint, entry] of Object.entries(parsed as Record<string, unknown>)) {
        // Only structurally-shaped entries are even admitted into memory;
        // getValid()'s hash + caller-supplied shape validation still runs
        // on every read regardless — this is just cheap defense against a
        // hand-edited file crashing JSON.parse consumers downstream.
        if (isPersistedEntryShape(entry)) this.store.set(fingerprint, entry);
      }
    } catch {
      // Invalid JSON on disk -> treated as an empty cache, never a crash.
    }
  }

  private persist(): void {
    if (!this.persistPath) return;
    mkdirSync(path.dirname(this.persistPath), { recursive: true });
    const obj: Record<string, CacheEntry<unknown>> = {};
    for (const [fingerprint, entry] of this.store) obj[fingerprint] = entry;
    writeFileSync(this.persistPath, JSON.stringify(obj, null, 2));
  }

  put<T>(fingerprint: string, result: T): void {
    this.store.set(fingerprint, { fingerprint, result, result_hash: sha256(JSON.stringify(result)) });
    this.persist();
  }

  // Returns the cached result only if it passes integrity + shape
  // validation; otherwise invalidates the entry (in memory AND on disk)
  // and returns undefined (forcing the caller to rerun the stage).
  getValid<T>(fingerprint: string, isValidShape: (value: unknown) => value is T): T | undefined {
    const entry = this.store.get(fingerprint);
    if (!entry) return undefined;

    const recomputedHash = sha256(JSON.stringify(entry.result));
    if (recomputedHash !== entry.result_hash) {
      this.store.delete(fingerprint); // corrupt entry — invalidate
      this.persist();
      return undefined;
    }
    if (!isValidShape(entry.result)) {
      this.store.delete(fingerprint); // schema-invalid entry — invalidate
      this.persist();
      return undefined;
    }
    return entry.result;
  }

  has(fingerprint: string): boolean {
    return this.store.has(fingerprint);
  }

  size(): number {
    return this.store.size;
  }
}
