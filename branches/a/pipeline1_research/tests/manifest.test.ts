import { describe, expect, it } from "vitest";
import { buildManifestAndIntegrity, verifyIntegrity } from "../src/manifest.js";

const baseSections = {
  research_scope: { topic: "Roman aqueducts", state: "SCOPE_APPROVED" },
  sources: [{ source_id: "src_1" }],
  evidence: [{ evidence_id: "ev_1" }],
  claims: [{ claim_id: "claim_1" }],
  verifications: [{ verification_id: "verif_1" }],
  knowledge_package: { facts: [] },
  unresolved_questions: [],
  handoff_notes: "",
};

describe("manifest / integrity (contract test)", () => {
  it("produces a manifest entry per package section", () => {
    const { manifest } = buildManifestAndIntegrity(baseSections);
    expect(manifest.length).toBe(8);
    expect(manifest.map((m) => m.path)).toContain("handoff/knowledge_package.json");
  });

  it("is deterministic for identical content", () => {
    const a = buildManifestAndIntegrity(baseSections);
    const b = buildManifestAndIntegrity(baseSections);
    expect(a.integrity_hashes.package_sha256).toBe(b.integrity_hashes.package_sha256);
  });

  it("is order-independent for object key ordering", () => {
    const reordered = {
      ...baseSections,
      research_scope: { state: "SCOPE_APPROVED", topic: "Roman aqueducts" },
    };
    const a = buildManifestAndIntegrity(baseSections);
    const b = buildManifestAndIntegrity(reordered);
    expect(a.integrity_hashes.package_sha256).toBe(b.integrity_hashes.package_sha256);
  });

  it("changes when content changes", () => {
    const changed = { ...baseSections, claims: [{ claim_id: "claim_2" }] };
    const a = buildManifestAndIntegrity(baseSections);
    const b = buildManifestAndIntegrity(changed);
    expect(a.integrity_hashes.package_sha256).not.toBe(b.integrity_hashes.package_sha256);
  });

  it("verifyIntegrity confirms an unmodified package and rejects a tampered one", () => {
    const { integrity_hashes } = buildManifestAndIntegrity(baseSections);
    expect(verifyIntegrity(baseSections, integrity_hashes)).toBe(true);

    const tampered = { ...baseSections, claims: [{ claim_id: "claim_TAMPERED" }] };
    expect(verifyIntegrity(tampered, integrity_hashes)).toBe(false);
  });

  it("manifest never contains an entry for its own integrity block (no self-reference)", () => {
    const { manifest } = buildManifestAndIntegrity(baseSections);
    expect(manifest.some((m) => m.path.includes("integrity"))).toBe(false);
  });
});
