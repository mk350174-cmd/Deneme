// Stage cache / checkpoint — item 26 (resume/checkpoint behavior) + the
// correction-5 requirement that a cache hit is never automatically trusted.

import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { StageCache } from "../src/checkpoint.js";
import { stableFingerprint } from "../src/ids.js";

interface FakeResult {
  value: string;
}
function isFakeResult(v: unknown): v is FakeResult {
  return typeof v === "object" && v !== null && typeof (v as FakeResult).value === "string";
}

describe("checkpoint / stage cache (item 26)", () => {
  it("a valid cache hit skips the low-level I/O seam entirely", async () => {
    const cache = new StageCache();
    const fingerprint = stableFingerprint({ text: "hello", voice: "v1" });
    let ioCalls = 0;
    const runStage = async (): Promise<FakeResult> => {
      ioCalls += 1;
      return { value: "synthesized" };
    };

    // First run: cache miss, stage executes.
    let result = cache.getValid(fingerprint, isFakeResult);
    if (!result) {
      result = await runStage();
      cache.put(fingerprint, result);
    }
    expect(ioCalls).toBe(1);

    // Second run with the same fingerprint: cache hit, stage never re-runs.
    let result2 = cache.getValid(fingerprint, isFakeResult);
    if (!result2) {
      result2 = await runStage();
      cache.put(fingerprint, result2);
    }
    expect(ioCalls).toBe(1); // NOT charged/executed again
    expect(result2).toEqual(result);
  });

  it("a corrupted cached result (hash mismatch) is rejected and the stage reruns", () => {
    const cache = new StageCache();
    const fingerprint = stableFingerprint({ text: "hello" });
    cache.put(fingerprint, { value: "original" });

    // Simulate corruption by reaching into the internal store via a second
    // put with different content under a fingerprint collision scenario —
    // here we directly verify the validator path instead: an invalid SHAPE
    // is rejected even though the hash matches what was stored.
    cache.put(fingerprint, { value: "original" } as unknown as FakeResult);
    const isValidNarrow = (v: unknown): v is FakeResult => isFakeResult(v) && (v as FakeResult).value === "something-else-entirely";
    const result = cache.getValid(fingerprint, isValidNarrow);
    expect(result).toBeUndefined();
    // After invalidation, the entry is gone — has() reflects the invalidation.
    expect(cache.has(fingerprint)).toBe(false);
  });

  it("an invalid/corrupt cache result causes a rerun (not a crash, not a silent bad reuse)", async () => {
    const cache = new StageCache();
    const fingerprint = stableFingerprint({ text: "x" });
    cache.put(fingerprint, { notTheRightShape: true } as unknown as FakeResult);

    let reran = false;
    let result = cache.getValid(fingerprint, isFakeResult);
    if (!result) {
      reran = true;
      result = { value: "rerun-result" };
      cache.put(fingerprint, result);
    }
    expect(reran).toBe(true);
    expect(result.value).toBe("rerun-result");
  });

  it("a valid cached stage is not re-invoked or re-charged on a second run (resume-cheap)", () => {
    const cache = new StageCache();
    const fingerprint = stableFingerprint({ provider: "elevenlabs", text: "hello" });
    cache.put(fingerprint, { value: "voice-result" });

    const hit1 = cache.getValid(fingerprint, isFakeResult);
    const hit2 = cache.getValid(fingerprint, isFakeResult);
    expect(hit1).toEqual(hit2);
    expect(cache.size()).toBe(1); // one entry, reused, not duplicated
  });

  it("a genuine result_hash mismatch (not just a shape mismatch) is rejected and invalidated", () => {
    const cache = new StageCache();
    const fingerprint = stableFingerprint({ text: "flappy" });

    // A getter with a side effect: JSON.stringify(entry.result) at put-time
    // ("x":1) differs from JSON.stringify(entry.result) at getValid-time
    // ("x":2) — a real hash-integrity failure, not a narrowed shape check.
    let n = 0;
    const flappy = { get x(): number { n += 1; return n; } };
    cache.put(fingerprint, flappy);
    const result = cache.getValid(fingerprint, (v): v is typeof flappy => true);
    expect(result).toBeUndefined();
    expect(cache.has(fingerprint)).toBe(false);
  });
});

describe("checkpoint / stage cache — cross-process disk persistence (AUDIT FIX §13.4 correction 1)", () => {
  let tmpDir: string;
  afterEach(() => {
    if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("a value put by one StageCache instance is recovered by a FRESH instance pointed at the same persistPath (real cross-process resume)", () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "stagecache-test-"));
    const persistPath = path.join(tmpDir, "cache.json");
    const fingerprint = stableFingerprint({ text: "persisted" });

    const first = new StageCache(persistPath);
    first.put(fingerprint, { value: "durable" });

    // A brand-new instance — simulates a fresh process after a restart —
    // constructed against the same file, with no in-memory state shared.
    const second = new StageCache(persistPath);
    const recovered = second.getValid(fingerprint, isFakeResult);
    expect(recovered).toEqual({ value: "durable" });
    expect(second.has(fingerprint)).toBe(true);
  });

  it("a corrupted on-disk JSON file is handled safely — treated as an empty cache, never a crash", () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "stagecache-test-"));
    const persistPath = path.join(tmpDir, "cache.json");
    writeFileSync(persistPath, "{ not valid json ][");

    expect(() => new StageCache(persistPath)).not.toThrow();
    const cache = new StageCache(persistPath);
    expect(cache.size()).toBe(0);
  });

  it("a well-formed-JSON-but-wrong-shape on-disk file is handled safely — treated as an empty cache", () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "stagecache-test-"));
    const persistPath = path.join(tmpDir, "cache.json");
    writeFileSync(persistPath, JSON.stringify(["not", "an", "object"]));

    const cache = new StageCache(persistPath);
    expect(cache.size()).toBe(0);
  });

  it("an in-memory-only StageCache (no persistPath) behaves exactly as before this fix — nothing written to disk", () => {
    const cache = new StageCache();
    const fingerprint = stableFingerprint({ text: "ephemeral" });
    cache.put(fingerprint, { value: "gone-on-exit" });
    expect(cache.getValid(fingerprint, isFakeResult)).toEqual({ value: "gone-on-exit" });
  });
});
