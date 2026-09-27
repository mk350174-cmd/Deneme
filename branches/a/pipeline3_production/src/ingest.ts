// P3.01 Ingest — three explicit, separately-callable validation layers
// (correction 2), never collapsed into one vague "validation" operation:
//   A. Structural  — required fields exist, types/shapes correct.
//   B. Integrity   — manifest + integrity_hashes exist and are well-formed.
//   C. Referential — every FK (scene/shot/prompt/decision/asset requirement)
//                    resolves to a real object in the same package.
// Applied to BOTH P3 inputs: the P2 Production Package and the user's
// Production Delivery (asset_delivery_map is REQUIRED on the latter).

import { HandoffValidationError } from "./errors.js";
import { isWellFormedSha256, sha256 } from "./ids.js";
import type { ProductionDeliveryInput, ProductionPackageHandoffInput } from "./types.js";

function requireField(obj: Record<string, unknown>, field: string, kind: "string" | "object" | "array"): void {
  const value = obj[field];
  if (value === undefined || value === null) {
    throw new HandoffValidationError("structural", field, "required field is missing");
  }
  if (kind === "array" && !Array.isArray(value)) {
    throw new HandoffValidationError("structural", field, "expected an array");
  }
  if (kind === "object" && (typeof value !== "object" || Array.isArray(value))) {
    throw new HandoffValidationError("structural", field, "expected an object");
  }
  if (kind === "string" && typeof value !== "string") {
    throw new HandoffValidationError("structural", field, "expected a string");
  }
}

// --- Layer A: structural ---

export function validateStructural(raw: unknown): ProductionPackageHandoffInput {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new HandoffValidationError("structural", "<root>", "expected a JSON object");
  }
  const obj = raw as Record<string, unknown>;

  requireField(obj, "package_id", "string");
  requireField(obj, "production_package_version", "string");
  requireField(obj, "project_id", "string");
  requireField(obj, "research_package_ref", "string");
  requireField(obj, "scenes", "array");
  requireField(obj, "shots", "array");
  requireField(obj, "asset_requirements", "array");
  requireField(obj, "prompts", "array");
  requireField(obj, "decision_log", "array");
  requireField(obj, "voice_script", "string");
  requireField(obj, "pronunciation_flags", "array");
  requireField(obj, "user_approval_state", "array");
  requireField(obj, "manifest", "array");
  requireField(obj, "integrity_hashes", "object");

  for (const [i, req] of (obj.asset_requirements as unknown[]).entries()) {
    if (typeof req !== "object" || req === null || typeof (req as Record<string, unknown>).shot_id !== "string") {
      throw new HandoffValidationError(
        "structural",
        `asset_requirements[${i}].shot_id`,
        "AssetRequirement is missing its shot_id traceability FK",
      );
    }
  }

  return obj as unknown as ProductionPackageHandoffInput;
}

export function validateStructuralDelivery(raw: unknown): ProductionDeliveryInput {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new HandoffValidationError("structural", "<root>", "expected a JSON object (Production Delivery)");
  }
  const obj = raw as Record<string, unknown>;

  // asset_delivery_map is REQUIRED — an empty array is valid, a missing or
  // malformed field is not. There is no fallback matching mechanism.
  requireField(obj, "asset_delivery_map", "array");
  requireField(obj, "generated_assets", "array");

  for (const [i, entry] of (obj.asset_delivery_map as unknown[]).entries()) {
    const e = entry as Record<string, unknown>;
    if (typeof e?.asset_requirement_id !== "string" || typeof e?.asset_file_id !== "string") {
      throw new HandoffValidationError(
        "structural",
        `asset_delivery_map[${i}]`,
        "entry must have string asset_requirement_id and asset_file_id",
      );
    }
  }
  for (const [i, file] of (obj.generated_assets as unknown[]).entries()) {
    const f = file as Record<string, unknown>;
    if (typeof f?.asset_file_id !== "string" || typeof f?.hash !== "string" || typeof f?.media_properties !== "object") {
      throw new HandoffValidationError(
        "structural",
        `generated_assets[${i}]`,
        "GeneratedAssetFile requires asset_file_id, hash, and media_properties",
      );
    }
  }

  return obj as unknown as ProductionDeliveryInput;
}

// --- Layer B: integrity ---

// TIER-1 REPAIR T1.2 — mirrors the identical repair at the P1->P2 boundary
// (pipeline2_creative/src/ingest.ts::verifyResearchPackageIntegrity). Must
// stay byte-for-byte aligned with P2's manifest.ts::buildManifestAndIntegrity
// canonicalization, since that is the representation P2 hashed.
const P2_SECTION_ORDER = [
  "scenes",
  "shots",
  "asset_requirements",
  "prompts",
  "decision_log",
  "voice_script",
  "pronunciation_flags",
  "voice_lines",
] as const;

function canonicalize(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      return Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b)));
    }
    return val;
  });
}

export interface ProductionPackageIntegrityResult {
  package_sha256: string;
}

/**
 * Recomputes the Production Package's canonical hashes from the received
 * content and hard-fails on any mismatch against package_sha256, every
 * per_file entry, and every declared manifest entry.
 */
export function verifyProductionPackageIntegrity(
  pkg: ProductionPackageHandoffInput,
): ProductionPackageIntegrityResult {
  const obj = pkg as unknown as Record<string, unknown>;
  const per_section: Record<string, string> = {};
  const entries: Array<{ path: string; sha256: string }> = [];
  for (const key of P2_SECTION_ORDER) {
    const virtualPath = `production_package/${key}.json`;
    // `voice_lines` is an additive T2.4 section: packages sealed before its
    // introduction legitimately omit it. Treat a genuinely absent key as an
    // empty array so old-but-honest packages still verify, while a present
    // key is still hashed exactly as declared.
    const value = key === "voice_lines" && !(key in obj) ? [] : obj[key];
    const hash = sha256(canonicalize(value));
    per_section[virtualPath] = hash;
    entries.push({ path: virtualPath, sha256: hash });
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));
  const recomputed = sha256(entries.map((m) => `${m.path}:${m.sha256}`).join("|"));

  const integrity = pkg.integrity_hashes;
  if (recomputed !== integrity.package_sha256) {
    throw new HandoffValidationError(
      "integrity",
      "integrity_hashes.package_sha256",
      `Production Package integrity verification FAILED: declared "${integrity.package_sha256}", ` +
        `recomputed "${recomputed}". The package was modified after P2 sealed it.`,
    );
  }

  const declaredPerFile = integrity.per_file ?? {};
  for (const [path, actual] of Object.entries(per_section)) {
    const declared = declaredPerFile[path];
    if (declared !== undefined && declared !== actual) {
      throw new HandoffValidationError(
        "integrity",
        `integrity_hashes.per_file[${path}]`,
        `declared "${declared}" does not match recomputed "${actual}"`,
      );
    }
  }

  for (const entry of pkg.manifest ?? []) {
    const actual = per_section[entry.path];
    if (actual === undefined) continue; // unrecognized section name; not this layer's concern
    if (entry.sha256 !== actual) {
      throw new HandoffValidationError(
        "integrity",
        `manifest[${entry.path}]`,
        `declared sha256 "${entry.sha256}" does not match recomputed "${actual}"`,
      );
    }
  }

  return { package_sha256: recomputed };
}

export function validateIntegrity(pkg: ProductionPackageHandoffInput): void {
  if (!pkg.manifest || pkg.manifest.length === 0) {
    throw new HandoffValidationError("integrity", "manifest", "manifest is empty or missing");
  }
  if (!pkg.integrity_hashes?.package_sha256) {
    throw new HandoffValidationError("integrity", "integrity_hashes.package_sha256", "missing");
  }
  if (!isWellFormedSha256(pkg.integrity_hashes.package_sha256)) {
    throw new HandoffValidationError("integrity", "integrity_hashes.package_sha256", "not a well-formed sha256 hash");
  }
  for (const [path, hash] of Object.entries(pkg.integrity_hashes.per_file ?? {})) {
    if (!isWellFormedSha256(hash)) {
      throw new HandoffValidationError("integrity", `integrity_hashes.per_file[${path}]`, "not a well-formed sha256 hash");
    }
  }

  // TIER-1 REPAIR T1.2 — real recomputation, not just shape-checking.
  // Previously this function was the ENTIRE integrity layer: it verified
  // every declared hash "looked like" sha256 and never compared any of them
  // to anything. That is the exact "looks like a SHA-256" gap the brief
  // names.
  verifyProductionPackageIntegrity(pkg);
}

// --- Gate A3 approval verification (AUDIT FIX, §13 item 3) ---
// Previously user_approval_state's presence/shape was checked (layer A)
// but its CONTENT was never inspected — a Production Package whose Gate A3
// approval (PRODUCTION_PACKAGE_DRAFTED -> PRODUCTION_PACKAGE_APPROVED) was
// never recorded would still be accepted by P3. Grouped with layer B since
// it's the same "is this package trustworthy to consume" concern.

export function validateGateApproval(pkg: ProductionPackageHandoffInput): void {
  const approved = pkg.user_approval_state.some(
    (g) => g.gate_id === "A3" && g.state_after === "PRODUCTION_PACKAGE_APPROVED",
  );
  if (!approved) {
    throw new HandoffValidationError(
      "integrity",
      "user_approval_state",
      "Production Package has no Gate A3 PRODUCTION_PACKAGE_APPROVED record — P3 cannot consume an unapproved package",
    );
  }
}

// --- Layer C: referential / semantic consistency ---

export function validateReferentialConsistency(pkg: ProductionPackageHandoffInput): void {
  const sceneIds = new Set(pkg.scenes.map((s) => s.scene_id));
  const shotIds = new Set(pkg.shots.map((s) => s.shot_id));
  const decisionIds = new Set(pkg.decision_log.map((d) => d.decision_id));

  for (const shot of pkg.shots) {
    if (!sceneIds.has(shot.scene_id)) {
      throw new HandoffValidationError("referential", `shots[${shot.shot_id}].scene_id`, `scene "${shot.scene_id}" not found`);
    }
  }
  for (const scene of pkg.scenes) {
    for (const shotId of scene.shots) {
      if (!shotIds.has(shotId)) {
        throw new HandoffValidationError("referential", `scenes[${scene.scene_id}].shots`, `shot "${shotId}" not found`);
      }
    }
  }
  for (const req of pkg.asset_requirements) {
    if (!shotIds.has(req.shot_id)) {
      throw new HandoffValidationError(
        "referential",
        `asset_requirements[${req.asset_requirement_id}].shot_id`,
        `shot "${req.shot_id}" not found`,
      );
    }
  }
  for (const prompt of pkg.prompts) {
    const t = prompt.spec.traceable_to;
    if (!shotIds.has(t.shot_id)) {
      throw new HandoffValidationError("referential", `prompts[${prompt.spec.prompt_spec_id}].traceable_to.shot_id`, `shot "${t.shot_id}" not found`);
    }
    if (!decisionIds.has(t.decision_id)) {
      throw new HandoffValidationError("referential", `prompts[${prompt.spec.prompt_spec_id}].traceable_to.decision_id`, `decision "${t.decision_id}" not found`);
    }
  }
}

// Runs all three layers in order for the Production Package, failing on the
// first layer that breaks (the error's `layer` field names which one).
export function parseProductionPackage(raw: unknown): ProductionPackageHandoffInput {
  const pkg = validateStructural(raw);
  validateIntegrity(pkg);
  validateGateApproval(pkg);
  validateReferentialConsistency(pkg);
  return pkg;
}

export function parseProductionDelivery(raw: unknown): ProductionDeliveryInput {
  return validateStructuralDelivery(raw);
}
