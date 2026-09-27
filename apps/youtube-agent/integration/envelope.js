// CommonJS mirror of B-Branch B00's canonical hash authority, so the YouTube
// agent can verify unified-pipeline envelopes without importing TypeScript.
// Must stay byte-compatible with branches/b/src/b00/hashing.ts
// (canonicalStringify + sha256) and b00/identity.ts (identity excluded).
const crypto = require('crypto');

function canonicalStringify(value) {
  const seen = new WeakSet();
  function normalize(input) {
    if (input === null || typeof input === 'string' || typeof input === 'boolean') return input;
    if (typeof input === 'number') {
      if (!Number.isFinite(input)) throw new TypeError('Canonical hashing rejects non-finite numbers');
      return input;
    }
    if (typeof input === 'bigint') return { $bigint: input.toString() };
    if (typeof input === 'undefined') return undefined;
    if (typeof input === 'function' || typeof input === 'symbol') throw new TypeError(`Canonical hashing cannot encode ${typeof input}`);
    if (input instanceof Date) return input.toISOString();
    if (Array.isArray(input)) return input.map(entry => normalize(entry));
    if (typeof input === 'object') {
      if (seen.has(input)) throw new TypeError('Canonical hashing rejects circular structures');
      seen.add(input);
      const output = {};
      for (const key of Object.keys(input).sort()) {
        const normalized = normalize(input[key]);
        if (normalized !== undefined) output[key] = normalized;
      }
      seen.delete(input);
      return output;
    }
    return input;
  }
  return JSON.stringify(normalize(value));
}

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function contentHash(envelope) {
  const { identity: _identity, ...content } = envelope;
  return sha256(canonicalStringify(content));
}

// ---- seal key (mirror of integration/bridges/src/sealKey.ts) -------------
// UNIFIED_SEAL_KEY=<64 hex> | none, else <repo>/.unified/seal.key
const path = require('path');
const SEAL_ALG = 'HMAC-SHA256';
function sealKeyPath() {
  return process.env.UNIFIED_SEAL_KEY_FILE || path.resolve(__dirname, '..', '..', '..', '.unified', 'seal.key');
}
function loadSealKey() {
  const fs = require('fs');
  const env = (process.env.UNIFIED_SEAL_KEY || '').trim();
  let hex;
  if (env) {
    if (env.toLowerCase() === 'none') return null;
    hex = env;
  } else {
    if (!fs.existsSync(sealKeyPath())) {
      if (fs.existsSync(path.resolve(__dirname, '..', '..', '..', '.unified', 'installed.json'))) throw new Error(`SEAL_KEY_MISSING: ${sealKeyPath()}`);
      return null;
    }
    hex = fs.readFileSync(sealKeyPath(), 'utf8').trim();
  }
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error('SEAL_KEY_INVALID: must be 64 hex characters');
  const key = Buffer.from(hex, 'hex');
  return { key, key_id: crypto.createHash('sha256').update(key).digest('hex').slice(0, 16) };
}
function identityDigest(identity) {
  const { signature: _sig, ...rest } = identity;
  return sha256(canonicalStringify(rest));
}
function hmac(key, digest) {
  return crypto.createHmac('sha256', key.key).update(digest, 'utf8').digest('hex');
}

function verifyEnvelope(envelope, expectedType) {
  if (!envelope || typeof envelope !== 'object' || !envelope.identity) throw new Error('ENVELOPE_MISSING_IDENTITY');
  if (envelope.identity.object_type !== expectedType) throw new Error(`WRONG_ENVELOPE_TYPE: ${envelope.identity.object_type}`);
  const actual = contentHash(envelope);
  if (actual !== envelope.identity.content_hash) throw new Error('ENVELOPE_TAMPERED');
  const key = loadSealKey();
  if (key) {
    const sig = envelope.identity.signature;
    if (!sig) throw new Error('ENVELOPE_UNSIGNED: not signed with this installation\'s seal key');
    if (sig.alg !== SEAL_ALG) throw new Error(`SIGNATURE_INVALID: algorithm ${sig.alg}`);
    if (sig.key_id !== key.key_id) throw new Error(`SIGNED_WITH_OTHER_KEY: ${sig.key_id}`);
    const expected = Buffer.from(hmac(key, identityDigest(envelope.identity)), 'hex');
    const got = Buffer.from(/^[0-9a-f]{64}$/i.test(String(sig.value)) ? sig.value : '', 'hex');
    if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) throw new Error('SIGNATURE_INVALID: changed and resealed without the seal key');
  }
  return actual;
}

function sealEnvelope(body, meta) {
  const identity = {
    object_id: meta.object_id,
    object_type: meta.object_type,
    version: meta.version || 'v1',
    content_hash: sha256(canonicalStringify(body)),
    parent_references: [],
    created_at: meta.created_at
  };
  const key = loadSealKey();
  if (key) identity.signature = { alg: SEAL_ALG, key_id: key.key_id, value: hmac(key, identityDigest(identity)) };
  return { ...body, identity };
}

async function fileSha256(filePath) {
  const fs = require('fs');
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(filePath).on('error', reject).on('data', chunk => hash.update(chunk)).on('end', () => resolve(hash.digest('hex')));
  });
}

module.exports = { canonicalStringify, sha256, contentHash, verifyEnvelope, sealEnvelope, fileSha256, loadSealKey };
