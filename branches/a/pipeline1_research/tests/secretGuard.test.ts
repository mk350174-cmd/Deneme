import { describe, expect, it } from "vitest";
import { containsSecret, isForbiddenFile, redactSecrets } from "../src/secretGuard.js";

describe("secretGuard", () => {
  it("detects a GitHub personal access token", () => {
    expect(containsSecret("token: ghp_1234567890abcdef1234")).toBe(true);
  });

  it("redacts an AWS access key id", () => {
    const out = redactSecrets("key=AKIAABCDEFGHIJKLMNOP rest of text");
    expect(out).toContain("[REDACTED]");
    expect(out).not.toContain("AKIAABCDEFGHIJKLMNOP");
  });

  it("leaves ordinary text untouched", () => {
    const text = "The research topic is the history of the printing press.";
    expect(containsSecret(text)).toBe(false);
    expect(redactSecrets(text)).toBe(text);
  });

  it("is deterministic across repeated calls (no shared-regex-state bug)", () => {
    const text = "sk-abcdefghijklmnopqrstuvwx";
    expect(containsSecret(text)).toBe(true);
    expect(containsSecret(text)).toBe(true);
    expect(containsSecret(text)).toBe(true);
  });

  it("flags forbidden filenames", () => {
    expect(isForbiddenFile(".env")).toBe(true);
    expect(isForbiddenFile("some/dir/credentials.json")).toBe(true);
    expect(isForbiddenFile("README.md")).toBe(false);
  });
});
