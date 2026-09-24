// Memory buckets — ADAPT + populate of GRAFİK's memory/*.jsonl pattern
// (7 buckets: BRAND_MEMORY, CAMPAIGN_MEMORY, CREATIVE_HISTORY,
// SUCCESS_MEMORY, REJECTION_MEMORY, AVOID_MEMORY, REFERENCE_MEMORY),
// JSONL-backed per-bucket file, incremental-append persistence (same
// discipline as pipeline1_research/src/memory.ts's incremental-merge
// pattern, adapted to GRAFİK's flat append-only JSONL storage shape since
// that's how the source bucket files are actually structured).

import { promises as fs } from "node:fs";
import path from "node:path";
import { stableMemoryRecordId } from "./ids.js";
import type { MemoryBucket, MemoryRecord, MemoryRecordType } from "./types.js";

const DEFAULT_MEMORY_DIR = path.resolve(process.cwd(), "memory_store");

function bucketFilePath(bucket: MemoryBucket, dir: string): string {
  return path.join(dir, `${bucket.toLowerCase()}.jsonl`);
}

export function createMemoryRecord(params: {
  bucket: MemoryBucket;
  record_type: MemoryRecordType;
  content: string;
  reason?: string;
  locked?: boolean;
}): MemoryRecord {
  return {
    record_id: stableMemoryRecordId(params.bucket, params.content),
    bucket: params.bucket,
    record_type: params.record_type,
    content: params.content,
    reason: params.reason,
    created_at: new Date().toISOString(),
    locked: params.locked,
  };
}

export async function loadBucket(bucket: MemoryBucket, dir: string = DEFAULT_MEMORY_DIR): Promise<MemoryRecord[]> {
  try {
    const raw = await fs.readFile(bucketFilePath(bucket, dir), "utf-8");
    return raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as MemoryRecord);
  } catch {
    return [];
  }
}

// Appends new records to a bucket, deduplicated by record_id (same content
// re-recorded is a no-op, not a duplicate). Never drops existing records.
export async function appendToBucket(
  bucket: MemoryBucket,
  records: MemoryRecord[],
  dir: string = DEFAULT_MEMORY_DIR,
): Promise<string> {
  const existing = await loadBucket(bucket, dir);
  const existingIds = new Set(existing.map((r) => r.record_id));
  const toAppend = records.filter((r) => !existingIds.has(r.record_id));

  await fs.mkdir(dir, { recursive: true });
  const filePath = bucketFilePath(bucket, dir);
  if (toAppend.length > 0) {
    const lines = toAppend.map((r) => JSON.stringify(r)).join("\n") + "\n";
    await fs.appendFile(filePath, lines, "utf-8");
  } else {
    // Ensure the file exists even with nothing new to append.
    await fs.writeFile(filePath, "", { flag: "a" });
  }
  return filePath;
}

export async function loadAllBuckets(
  buckets: readonly MemoryBucket[],
  dir: string = DEFAULT_MEMORY_DIR,
): Promise<MemoryRecord[]> {
  const all = await Promise.all(buckets.map((b) => loadBucket(b, dir)));
  return all.flat();
}

export { DEFAULT_MEMORY_DIR };
