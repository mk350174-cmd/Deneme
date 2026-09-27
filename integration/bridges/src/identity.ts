// Seal / verify helpers. The unified pipeline uses B00 as its single hash
// authority for cross-branch envelopes (SHA-256 over canonical JSON with the
// top-level `identity` field excluded).

import { B00 } from "b-branch-strategic-control-plane";
import type { CanonicalIdentity } from "./contracts.js";
import { loadSealKey, signDigest, signatureMatches, SEAL_ALG } from "./sealKey.js";

export interface EnvelopeSignature {
  alg: string;
  key_id: string;
  value: string;
}

/** Digest the signature covers: the whole identity (content hash, type, id, version, parents) minus the signature. */
function identityDigest(identity: CanonicalIdentity & { signature?: EnvelopeSignature }): string {
  const { signature: _sig, ...rest } = identity;
  return B00.hashCanonicalValue(rest);
}

export class BridgeError extends Error {
  constructor(
    readonly bridge: string,
    readonly code: string,
    message: string,
  ) {
    super(`[${bridge}] ${code}: ${message}`);
    this.name = "BridgeError";
  }
}

export function sealEnvelope<T extends { identity?: CanonicalIdentity }>(
  body: Omit<T, "identity">,
  meta: {
    object_id: string;
    object_type: string;
    version: string;
    created_at: string;
    parents?: B00.CanonicalParentReference[];
  },
): T {
  const identity = B00.createCanonicalIdentity({
    object_id: meta.object_id,
    object_type: meta.object_type,
    version: meta.version,
    artifact: body,
    parent_references: meta.parents ?? [],
    created_at: meta.created_at,
  });
  const key = loadSealKey();
  const signed = key ? { ...identity, signature: signDigest(key, identityDigest(identity)) } : identity;
  return { ...(body as object), identity: signed } as T;
}

export function verifyEnvelope(bridge: string, envelope: { identity?: CanonicalIdentity } & object, expectedType: string): void {
  if (!envelope || typeof envelope !== "object" || !envelope.identity) {
    throw new BridgeError(bridge, "MISSING_IDENTITY", "envelope has no canonical identity");
  }
  if (envelope.identity.object_type !== expectedType) {
    throw new BridgeError(bridge, "WRONG_ENVELOPE_TYPE", `expected ${expectedType}, got ${envelope.identity.object_type}`);
  }
  const check = B00.validateCanonicalIdentity(envelope, envelope.identity);
  if (!check.valid) {
    throw new BridgeError(bridge, "ENVELOPE_TAMPERED", `identity validation failed: ${check.errors.join(", ")}`);
  }
  verifySignature(bridge, envelope.identity as CanonicalIdentity & { signature?: EnvelopeSignature });
}

/**
 * With a local key, every unified envelope must carry a valid signature from
 * THIS key: an edited-and-resealed file, or one sealed on another machine, is refused.
 * Without a key (signing not set up) only the content hash is checked.
 */
function verifySignature(bridge: string, identity: CanonicalIdentity & { signature?: EnvelopeSignature }): void {
  const key = loadSealKey();
  if (!key) return;
  const sig = identity.signature;
  if (!sig) throw new BridgeError(bridge, "ENVELOPE_UNSIGNED", "envelope is not signed with this installation's seal key (hand-made or produced before signing was set up) — regenerate it from its source");
  if (sig.alg !== SEAL_ALG) throw new BridgeError(bridge, "SIGNATURE_INVALID", `unsupported signature algorithm ${sig.alg}`);
  if (sig.key_id !== key.key_id) throw new BridgeError(bridge, "SIGNED_WITH_OTHER_KEY", `envelope was signed by another installation (key ${sig.key_id}, this one ${key.key_id})`);
  if (!signatureMatches(key, identityDigest(identity), sig.value)) {
    throw new BridgeError(bridge, "SIGNATURE_INVALID", "signature does not match — the file was changed and resealed without the seal key");
  }
}

/** Signs an arbitrary digest (used for strategy.json, which is not an envelope). */
export function signValue(value: unknown): EnvelopeSignature | undefined {
  const key = loadSealKey();
  return key ? signDigest(key, B00.hashCanonicalValue(value)) : undefined;
}

export function verifyValueSignature(bridge: string, what: string, value: unknown, sig: EnvelopeSignature | undefined): void {
  const key = loadSealKey();
  if (!key) return;
  if (!sig) throw new BridgeError(bridge, "UNSIGNED", `${what} is not signed with this installation's seal key — regenerate it`);
  if (sig.key_id !== key.key_id) throw new BridgeError(bridge, "SIGNED_WITH_OTHER_KEY", `${what} was signed by another installation`);
  if (!signatureMatches(key, B00.hashCanonicalValue(value), sig.value)) throw new BridgeError(bridge, "SIGNATURE_INVALID", `${what} was changed after it was signed`);
}

export function hashValue(value: unknown): string {
  return B00.hashCanonicalValue(value);
}

export function shortHash(hash: string, n = 12): string {
  return hash.slice(0, n);
}

/**
 * A human gate is satisfied only by a named person. Placeholders ("<your name>"),
 * preview/system markers (any case) and blank values are rejected everywhere
 * (B12 commit, directive, Gate F1, B08 observation review).
 */
export function assertHumanAuthority(bridge: string, value: unknown, what = "authority"): string {
  const v = typeof value === "string" ? value.trim() : "";
  const letters = (v.match(/\p{L}/gu) ?? []).length;
  if (!v || v.startsWith("<") || letters < 2 || /^(preview|system|unknown|n\/a|none|todo)(?!\p{L})/iu.test(v)) {
    throw new BridgeError(bridge, "AUTHORITY_REQUIRED", `${what} must name the approving person (got ${JSON.stringify(value ?? "")})`);
  }
  return v;
}
