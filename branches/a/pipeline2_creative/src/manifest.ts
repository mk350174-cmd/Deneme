// ADAPT of pipeline1_research/src/manifest.ts's section-hash pattern
// (itself adapted from SOP's manifest/snapshot-integrity discipline),
// applied to Production Package sections. Self-reference rule preserved:
// the integrity block is computed from every other section and never
// includes itself.

import { sha256 } from "./ids.js";
import type { IntegrityHashes, ManifestEntry } from "./types.js";

export interface ProductionPackageSections {
  scenes: unknown;
  shots: unknown;
  asset_requirements: unknown;
  prompts: unknown;
  decision_log: unknown;
  voice_script: unknown;
  pronunciation_flags: unknown;
  // T2.4 — voice lineage is now a manifested, integrity-covered section,
  // not an afterthought outside the sealed content.
  voice_lines: unknown;
}

const SECTION_PURPOSE: Record<keyof ProductionPackageSections, string> = {
  scenes: "P2.08 canonical Scene plan",
  shots: "P2.08 canonical Shot plan",
  asset_requirements: "P2.07 asset requirements",
  prompts: "P2.09 Structured Prompt Specifications + rendered Flow text",
  decision_log: "P2.06 AI Director decision log",
  voice_script: "P2.10 narration script",
  pronunciation_flags: "P2.10 pronunciation/number risk flags",
  voice_lines: "P2.10 claim/line voice lineage (T2.4)",
};

function canonicalize(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      return Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b)));
    }
    return val;
  });
}

export function buildManifestAndIntegrity(sections: ProductionPackageSections): {
  manifest: ManifestEntry[];
  integrity_hashes: IntegrityHashes;
} {
  const manifest: ManifestEntry[] = [];
  const perFile: Record<string, string> = {};

  for (const key of Object.keys(sections) as Array<keyof ProductionPackageSections>) {
    const hash = sha256(canonicalize(sections[key]));
    const virtualPath = `production_package/${key}.json`;
    manifest.push({ path: virtualPath, sha256: hash, purpose: SECTION_PURPOSE[key] });
    perFile[virtualPath] = hash;
  }
  manifest.sort((a, b) => a.path.localeCompare(b.path));

  const packageHash = sha256(manifest.map((m) => `${m.path}:${m.sha256}`).join("|"));

  return {
    manifest,
    integrity_hashes: { package_sha256: packageHash, per_file: perFile },
  };
}

// TIER-1 REPAIR T1.2 + TIER-2 T2.7 — see the same repair in
// pipeline1_research/src/manifest.ts. package_sha256 alone was compared, so
// tampering confined to integrity_hashes.per_file or to the declared
// manifest passed verification.
export interface IntegrityVerificationResult {
  valid: boolean;
  package_hash_match: boolean;
  per_file_mismatches: Array<{ path: string; declared: string; actual: string }>;
  manifest_mismatches: Array<{ path: string; reason: string }>;
  declared_package_sha256: string;
  recomputed_package_sha256: string;
}

export function verifyIntegrityDetailed(
  sections: ProductionPackageSections,
  integrity: IntegrityHashes,
  declaredManifest?: ManifestEntry[],
): IntegrityVerificationResult {
  const recomputed = buildManifestAndIntegrity(sections);
  const package_hash_match = recomputed.integrity_hashes.package_sha256 === integrity.package_sha256;

  const per_file_mismatches: Array<{ path: string; declared: string; actual: string }> = [];
  const actualPerFile = recomputed.integrity_hashes.per_file;
  const declaredPerFile = integrity.per_file ?? {};
  for (const [path, actual] of Object.entries(actualPerFile)) {
    const declared = declaredPerFile[path];
    if (declared !== actual) per_file_mismatches.push({ path, declared: declared ?? "<missing>", actual });
  }
  for (const path of Object.keys(declaredPerFile)) {
    if (!(path in actualPerFile)) {
      per_file_mismatches.push({ path, declared: declaredPerFile[path]!, actual: "<no such section>" });
    }
  }

  const manifest_mismatches: Array<{ path: string; reason: string }> = [];
  if (declaredManifest) {
    const actualByPath = new Map(recomputed.manifest.map((m) => [m.path, m]));
    const declaredByPath = new Map(declaredManifest.map((m) => [m.path, m]));
    for (const [path, actual] of actualByPath) {
      const declared = declaredByPath.get(path);
      if (!declared) { manifest_mismatches.push({ path, reason: "section missing from declared manifest" }); continue; }
      if (declared.sha256 !== actual.sha256) {
        manifest_mismatches.push({ path, reason: `declared sha256 "${declared.sha256}" != recomputed "${actual.sha256}"` });
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
    valid: package_hash_match && per_file_mismatches.length === 0 && manifest_mismatches.length === 0,
    package_hash_match,
    per_file_mismatches,
    manifest_mismatches,
    declared_package_sha256: integrity.package_sha256,
    recomputed_package_sha256: recomputed.integrity_hashes.package_sha256,
  };
}

export function verifyIntegrity(
  sections: ProductionPackageSections,
  integrity: IntegrityHashes,
  declaredManifest?: ManifestEntry[],
): boolean {
  return verifyIntegrityDetailed(sections, integrity, declaredManifest).valid;
}
