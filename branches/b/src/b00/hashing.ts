// B00 — Canonical Hash Authority
//
// This is the single cryptographic identity authority for B-Branch.
// Canonical identities, artifact/content hashes, approval bindings, manifest
// identities and governance event identities MUST use SHA-256 through this
// module. Weak/non-cryptographic hashes are intentionally not exposed here.

import { createHash } from "node:crypto";

export function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** Stable JSON-like canonicalization. Object key order is normalized; array
 * order is preserved because arrays may carry semantic ordering. `undefined`
 * object properties are omitted, matching JSON semantics. Non-finite numbers
 * are rejected instead of being silently coerced. */
export function canonicalStringify(value: unknown): string {
  const seen = new WeakSet<object>();

  function normalize(input: unknown): unknown {
    if (input === null || typeof input === "string" || typeof input === "boolean") return input;
    if (typeof input === "number") {
      if (!Number.isFinite(input)) throw new TypeError("Canonical hashing rejects non-finite numbers");
      return input;
    }
    if (typeof input === "bigint") return { $bigint: input.toString() };
    if (typeof input === "undefined") return undefined;
    if (typeof input === "function" || typeof input === "symbol") {
      throw new TypeError(`Canonical hashing cannot encode ${typeof input}`);
    }
    if (input instanceof Date) return input.toISOString();
    if (Array.isArray(input)) return input.map((entry) => normalize(entry));
    if (typeof input === "object") {
      if (seen.has(input)) throw new TypeError("Canonical hashing rejects circular structures");
      seen.add(input);
      const output: Record<string, unknown> = {};
      for (const key of Object.keys(input as Record<string, unknown>).sort()) {
        const normalized = normalize((input as Record<string, unknown>)[key]);
        if (normalized !== undefined) output[key] = normalized;
      }
      seen.delete(input);
      return output;
    }
    return input;
  }

  return JSON.stringify(normalize(value));
}

export function hashCanonicalValue(value: unknown): string {
  return sha256(canonicalStringify(value));
}

export interface CanonicalHasher {
  stableCandidateId(module: string, inputSignature: string): string;
  stableConflictId(module: string, affectedItems: string): string;
  stableStateId(moduleVersionSignature: string): string;
  hash(input: string): string;
  hashValue(value: unknown): string;
}

export function createCanonicalHasher(): CanonicalHasher {
  return {
    stableCandidateId: (module: string, inputSignature: string) =>
      `cand_${module}_${sha256(`${module}:${inputSignature}`).slice(0, 24)}`,
    stableConflictId: (module: string, affectedItems: string) =>
      `conf_${module}_${sha256(`${module}:${affectedItems}`).slice(0, 24)}`,
    stableStateId: (moduleVersionSignature: string) =>
      `state_${sha256(moduleVersionSignature).slice(0, 32)}`,
    hash: sha256,
    hashValue: hashCanonicalValue,
  };
}

export const canonicalHasher = createCanonicalHasher();
