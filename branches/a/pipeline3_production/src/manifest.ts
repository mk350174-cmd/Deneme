// ADAPT of P1/P2's section-hash manifest/integrity pattern, applied to the
// Final Delivery Package. Self-reference rule preserved: the integrity
// block is computed from every other section and never includes itself.

import { sha256 } from "./ids.js";
import type { IntegrityHashes, ManifestEntry } from "./types.js";

export interface FinalDeliverySections {
  resolved_assets: unknown;
  narration: unknown;
  timing: unknown;
  timeline: unknown;
  render: unknown;
  qa: unknown;
  kaggle: unknown;
}

const SECTION_PURPOSE: Record<keyof FinalDeliverySections, string> = {
  resolved_assets: "P3.03 resolved asset records",
  narration: "P3.04/P3.05 narration record (Piper preview + production voice)",
  timing: "P3.06 timing record",
  timeline: "P3.07 timeline",
  render: "P3.08 render manifest",
  qa: "P3.09 automated QA report",
  kaggle: "P3.10 Kaggle delivery record",
};

function canonicalize(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      return Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b)));
    }
    return val;
  });
}

export function buildManifestAndIntegrity(sections: FinalDeliverySections): {
  manifest: ManifestEntry[];
  integrity_hashes: IntegrityHashes;
} {
  const manifest: ManifestEntry[] = [];
  const perFile: Record<string, string> = {};

  for (const key of Object.keys(sections) as Array<keyof FinalDeliverySections>) {
    const hash = sha256(canonicalize(sections[key]));
    const virtualPath = `final_delivery/${key}.json`;
    manifest.push({ path: virtualPath, sha256: hash, purpose: SECTION_PURPOSE[key] });
    perFile[virtualPath] = hash;
  }
  manifest.sort((a, b) => a.path.localeCompare(b.path));

  const packageHash = sha256(manifest.map((m) => `${m.path}:${m.sha256}`).join("|"));
  return { manifest, integrity_hashes: { package_sha256: packageHash, per_file: perFile } };
}

export function verifyIntegrity(sections: FinalDeliverySections, integrity: IntegrityHashes): boolean {
  return buildManifestAndIntegrity(sections).integrity_hashes.package_sha256 === integrity.package_sha256;
}
