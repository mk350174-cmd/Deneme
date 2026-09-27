// REUSE (near-verbatim) from SOP src/utils/secretGuard.ts, duplicated from
// pipeline1_research/src/secretGuard.ts (no cross-package dependency — see
// capability table: "Secret redaction | REUSE | Origin: SOP").

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
