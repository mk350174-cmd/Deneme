// Local signing key for unified envelopes (HMAC-SHA256).
//
// A plain SHA-256 seal catches accidental edits and wrong files, but anyone who
// edits a JSON can recompute it. With a key that lives only on this machine
// (.unified/seal.key, created by `npm run kur` / `npm run setup`, never
// committed), an edited-and-resealed file no longer verifies.
//
// Key lookup, at call time:
//   UNIFIED_SEAL_KEY=<64 hex>   explicit key (CI, tests)
//   UNIFIED_SEAL_KEY=none       signing disabled (tests of the unsigned mode only)
//   <repo>/.unified/seal.key    default
// The CommonJS mirror in apps/youtube-agent/integration/envelope.js uses the
// same lookup and the same signature input.

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const SEAL_ALG = "HMAC-SHA256";

export function sealKeyPath(): string {
  return process.env.UNIFIED_SEAL_KEY_FILE || join(repoRoot(), ".unified", "seal.key");
}

function repoRoot(): string {
  return fileURLToPath(new URL("../../../", import.meta.url));
}

export interface SealKey {
  key: Buffer;
  key_id: string;
}

export function loadSealKey(): SealKey | null {
  const env = process.env.UNIFIED_SEAL_KEY?.trim();
  let hex: string | undefined;
  if (env) {
    if (env.toLowerCase() === "none") return null;
    hex = env;
  } else {
    const p = sealKeyPath();
    if (!existsSync(p)) {
      // An installed pipeline always has a key; a missing key must not silently switch the checks off.
      if (existsSync(join(repoRoot(), ".unified", "installed.json"))) {
        throw new Error(`SEAL_KEY_MISSING: ${p} yok. Kurulum bu anahtarla yapıldı; yedekten geri koyun. (Yeni anahtar üretirseniz önceki döngülerin dosyaları doğrulanmaz.)`);
      }
      return null;
    }
    hex = readFileSync(p, "utf8").trim();
  }
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error(`unified seal key must be 64 hex characters (${env ? "UNIFIED_SEAL_KEY" : sealKeyPath()})`);
  const key = Buffer.from(hex, "hex");
  return { key, key_id: createHash("sha256").update(key).digest("hex").slice(0, 16) };
}

/** Creates the key once; never overwrites an existing one. Returns its path. */
export function ensureSealKey(path = sealKeyPath()): string {
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, randomBytes(32).toString("hex") + "\n", { encoding: "utf8", mode: 0o600 });
    try {
      chmodSync(path, 0o600);
    } catch {
      /* Windows */
    }
  }
  return path;
}

/** HMAC over the SHA-256 of the canonical identity (signature field excluded). */
export function signDigest(key: SealKey, digestHex: string): { alg: string; key_id: string; value: string } {
  return { alg: SEAL_ALG, key_id: key.key_id, value: createHmac("sha256", key.key).update(digestHex, "utf8").digest("hex") };
}

export function signatureMatches(key: SealKey, digestHex: string, value: string): boolean {
  const expected = Buffer.from(signDigest(key, digestHex).value, "hex");
  const got = Buffer.from(typeof value === "string" && /^[0-9a-f]{64}$/i.test(value) ? value : "", "hex");
  return got.length === expected.length && timingSafeEqual(got, expected);
}
