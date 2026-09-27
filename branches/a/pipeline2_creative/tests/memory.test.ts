import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendToBucket, createMemoryRecord, loadAllBuckets, loadBucket } from "../src/memory.js";
import { MEMORY_BUCKETS } from "../src/types.js";

describe("memory buckets (7 GRAFİK buckets, ADAPT + populate)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "p2-memory-"));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("exposes exactly the 7 canonical buckets", () => {
    expect(MEMORY_BUCKETS).toEqual([
      "BRAND_MEMORY",
      "CAMPAIGN_MEMORY",
      "CREATIVE_HISTORY",
      "SUCCESS_MEMORY",
      "REJECTION_MEMORY",
      "AVOID_MEMORY",
      "REFERENCE_MEMORY",
    ]);
  });

  it("persists and reloads a record incrementally, never dropping prior entries", async () => {
    const r1 = createMemoryRecord({ bucket: "BRAND_MEMORY", record_type: "RULE", content: "Never use red on the logo." });
    await appendToBucket("BRAND_MEMORY", [r1], dir);

    const r2 = createMemoryRecord({ bucket: "BRAND_MEMORY", record_type: "RULE", content: "Always use serif for titles." });
    await appendToBucket("BRAND_MEMORY", [r2], dir);

    const loaded = await loadBucket("BRAND_MEMORY", dir);
    expect(loaded).toHaveLength(2);
    expect(loaded.map((r) => r.content)).toContain("Never use red on the logo.");
    expect(loaded.map((r) => r.content)).toContain("Always use serif for titles.");
  });

  it("deduplicates re-appended identical records instead of duplicating", async () => {
    const r1 = createMemoryRecord({ bucket: "AVOID_MEMORY", record_type: "REJECTION", content: "Overused stock-photo hands." });
    await appendToBucket("AVOID_MEMORY", [r1], dir);
    await appendToBucket("AVOID_MEMORY", [r1], dir);

    const loaded = await loadBucket("AVOID_MEMORY", dir);
    expect(loaded).toHaveLength(1);
  });

  it("loadAllBuckets aggregates across buckets", async () => {
    await appendToBucket("SUCCESS_MEMORY", [createMemoryRecord({ bucket: "SUCCESS_MEMORY", record_type: "EXAMPLE", content: "High-retention hook pattern." })], dir);
    await appendToBucket("REJECTION_MEMORY", [createMemoryRecord({ bucket: "REJECTION_MEMORY", record_type: "REJECTION", content: "Overly long intro." })], dir);

    const all = await loadAllBuckets(MEMORY_BUCKETS, dir);
    expect(all.length).toBe(2);
  });
});
