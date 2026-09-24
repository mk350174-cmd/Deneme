// REUSE (near-verbatim) from SOP src/utils/secretGuard.ts, duplicated from
// pipeline1_research/src/secretGuard.ts and pipeline2_creative/src/secretGuard.ts
// (no cross-package dependency). Also used to scrub API keys out of
// logs/manifests/error messages before anything touching ElevenLabs/Kaggle
// credentials is persisted or reported.

const SECRET_PATTERN_DEFS: Array<{ source: string; flags: string }> = [
  { source: "-----BEGIN [A-Z ]*PRIVATE KEY-----[\\s\\S]*?-----END [A-Z ]*PRIVATE KEY-----", flags: "g" },
  { source: "\\b(sk|pk|rk)-[A-Za-z0-9]{16,}\\b", flags: "g" },
  { source: "\\bghp_[A-Za-z0-9]{20,}\\b", flags: "g" },
  { source: "\\bAKIA[0-9A-Z]{12,}\\b", flags: "g" },
  { source: "(?:api[_-]?key|secret|token|password|passwd)\\s*[:=]\\s*[\"']?[^\\s\"']{6,}", flags: "gi" },
  { source: "\\b(xoxb|xoxp|xoxs)-[A-Za-z0-9]{8,}\\b", flags: "g" },
  { source: "\\b(sk_live|sk_test|pk_live|pk_test)_[A-Za-z0-9]{16,}\\b", flags: "g" },
  { source: "\\beyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\b", flags: "g" },
  { source: "\\bAIzaSy[A-Za-z0-9_-]{20,}\\b", flags: "g" },
  // ElevenLabs / Kaggle credential shapes seen in this pipeline specifically.
  { source: "\\bxi-api-key\\s*[:=]\\s*[\"']?[^\\s\"']{6,}", flags: "gi" },
];

function freshPatterns(): RegExp[] {
  return SECRET_PATTERN_DEFS.map((p) => new RegExp(p.source, p.flags));
}

export function containsSecret(text: string): boolean {
  return freshPatterns().some((re) => re.test(text));
}

export function redactSecrets(text: string): string {
  let out = text;
  for (const re of freshPatterns()) {
    out = out.replace(re, "[REDACTED]");
  }
  return out;
}

// Object keys whose values are always credential-shaped, redacted
// unconditionally by key name. Necessary because the regex patterns above
// need key+value in the SAME string (e.g. "api_key: abc123") — once a JSON
// object splits a key from its value, the value string alone ("abc123")
// carries no "api_key"/"xi-api-key" text for the regex to match against.
const SENSITIVE_KEY_NAMES = new Set([
  "xi-api-key",
  "api_key",
  "apikey",
  "authorization",
  "password",
  "secret",
  "token",
  "kaggle_key", // AUDIT FIX (§13.6): defensive — real Kaggle credential value, if ever logged under this key name
]);

// Deep-redacts secrets out of any JSON-serializable value before it is
// logged, written to a manifest, or embedded in an error/report object.
export function redactSecretsDeep<T>(value: T): T {
  if (typeof value === "string") {
    return redactSecrets(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactSecretsDeep(v)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_NAMES.has(k.toLowerCase()) && typeof v === "string") {
        out[k] = "[REDACTED]";
      } else {
        out[k] = redactSecretsDeep(v);
      }
    }
    return out as unknown as T;
  }
  return value;
}
