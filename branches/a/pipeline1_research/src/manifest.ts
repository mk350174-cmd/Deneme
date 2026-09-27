// ADAPT of SOP's manifest/snapshot-integrity pattern (src/utils/manifest.ts,
// scripts/generate-manifest.ts) — see capability table: "Manifest/integrity
// verification | REUSE | Origin: SOP". SOP's version hashes a git working
// tree; P1's handoff is an in-memory package object, not a checked-out repo,
// so the walk-the-filesystem mechanics are adapted into hashing the
// package's own named sections. The self-reference rule is preserved
// identically: the manifest/integrity block is computed from every *other*
// section and is never included in its own hash input.

import { sha256 } from "./ids.js";
import type { IntegrityHashes, ManifestEntry } from "./types.js";

// The named sections a Research Package handoff is built from, each
// individually hashed and listed in the manifest — mirrors SOP's per-file
// manifest entries, one level up (per logical section instead of per file).
export interface PackageSections {
  research_scope: unknown;
  sources: unknown;
  evidence: unknown;
  claims: unknown;
  verifications: unknown;
  knowledge_package: unknown;
  unresolved_questions: unknown;
  handoff_notes: unknown;
}

const SECTION_PURPOSE: Record<keyof PackageSections, string> = {
  research_scope: "P1.02 frozen, human-approved research scope",
  sources: "P1.03 acquired sources",
  evidence: "P1.03 extracted evidence",
  claims: "P1.03/P1.04 claims with dimension assignment",
  verifications: "P1.04 verification verdicts",
  knowledge_package: "P1.05/P1.06 synthesized knowledge structure",
  unresolved_questions: "P1.06 explicit open/unresolved questions",
  handoff_notes: "P1.07 machine-readable notes for P2",
};

function canonicalize(value: unknown): string {
  // Stable stringify: sorted object keys so hash is order-independent for
  // object fields (arrays keep their meaningful order).
  return JSON.stringify(value, (_key, val) => {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      return Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b)));
    }
    return val;
  });
}

export function buildManifestAndIntegrity(sections: PackageSections): {
  manifest: ManifestEntry[];
  integrity_hashes: IntegrityHashes;
} {
  const manifest: ManifestEntry[] = [];
  const perFile: Record<string, string> = {};

  for (const key of Object.keys(sections) as Array<keyof PackageSections>) {
    const hash = sha256(canonicalize(sections[key]));
    const virtualPath = `handoff/${key}.json`;
    manifest.push({ path: virtualPath, sha256: hash, purpose: SECTION_PURPOSE[key] });
    perFile[virtualPath] = hash;
  }
  manifest.sort((a, b) => a.path.localeCompare(b.path));

  // Whole-package hash is derived from every per-section hash, in
  // manifest order — never from itself (self-reference is structurally
  // impossible since this value doesn't exist yet while it's computed).
  const packageHash = sha256(manifest.map((m) => `${m.path}:${m.sha256}`).join("|"));

  return {
    manifest,
    integrity_hashes: { package_sha256: packageHash, per_file: perFile },
  };
}

// TIER-1 REPAIR T1.2 + TIER-2 T2.7 — real package integrity verification.
//
// The previous verifyIntegrity() recomputed the package hash and compared
// only `package_sha256`. That left two holes the brief names explicitly:
//   * the DECLARED per-file map was never compared, so tampering with
//     integrity_hashes.per_file alone passed;
//   * the DECLARED manifest entries were never compared, so a manifest
//     claiming different paths/hashes/purposes than the content passed.
// Both are now reconstructed and compared exactly.
export interface IntegrityVerificationResult {
  valid: boolean;
  package_hash_match: boolean;
  per_file_mismatches: Array<{ path: string; declared: string; actual: string }>;
  manifest_mismatches: Array<{ path: string; reason: string }>;
  declared_package_sha256: string;
  recomputed_package_sha256: string;
}

export function verifyIntegrityDetailed(
  sections: PackageSections,
  integrity: IntegrityHashes,
  declaredManifest?: ManifestEntry[],
): IntegrityVerificationResult {
  const recomputed = buildManifestAndIntegrity(sections);

  const package_hash_match =
    recomputed.integrity_hashes.package_sha256 === integrity.package_sha256;

  // --- per-file exactness: every declared entry must match, and no
  // declared entry may be missing or extra. ---
  const per_file_mismatches: Array<{ path: string; declared: string; actual: string }> = [];
  const actualPerFile = recomputed.integrity_hashes.per_file;
  const declaredPerFile = integrity.per_file ?? {};
  for (const [path, actual] of Object.entries(actualPerFile)) {
    const declared = declaredPerFile[path];
    if (declared !== actual) {
      per_file_mismatches.push({ path, declared: declared ?? "<missing>", actual });
    }
  }
  for (const path of Object.keys(declaredPerFile)) {
    if (!(path in actualPerFile)) {
      per_file_mismatches.push({ path, declared: declaredPerFile[path]!, actual: "<no such section>" });
    }
  }

  // --- manifest exactness (T2.7): reconstruct canonical manifest content
  // and compare against the declared manifest data. ---
  const manifest_mismatches: Array<{ path: string; reason: string }> = [];
  if (declaredManifest) {
    const actualByPath = new Map(recomputed.manifest.map((m) => [m.path, m]));
    const declaredByPath = new Map(declaredManifest.map((m) => [m.path, m]));
    for (const [path, actual] of actualByPath) {
      const declared = declaredByPath.get(path);
      if (!declared) {
        manifest_mismatches.push({ path, reason: "section missing from declared manifest" });
        continue;
      }
      if (declared.sha256 !== actual.sha256) {
        manifest_mismatches.push({
          path,
          reason: `declared sha256 "${declared.sha256}" != recomputed "${actual.sha256}"`,
        });
      }
      if (declared.purpose !== actual.purpose) {
        manifest_mismatches.push({ path, reason: "declared purpose does not match canonical purpose" });
      }
    }
    for (const path of declaredByPath.keys()) {
      if (!actualByPath.has(path)) {
        manifest_mismatches.push({ path, reason: "declared manifest entry has no corresponding section" });
      }
    }
  }

  return {
    valid:
      package_hash_match && per_file_mismatches.length === 0 && manifest_mismatches.length === 0,
    package_hash_match,
    per_file_mismatches,
    manifest_mismatches,
    declared_package_sha256: integrity.package_sha256,
    recomputed_package_sha256: recomputed.integrity_hashes.package_sha256,
  };
}

export function verifyIntegrity(
  sections: PackageSections,
  integrity: IntegrityHashes,
  declaredManifest?: ManifestEntry[],
): boolean {
  return verifyIntegrityDetailed(sections, integrity, declaredManifest).valid;
}
