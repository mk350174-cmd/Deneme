import { describe, expect, it } from "vitest";
import { containsSecret, redactSecrets, redactSecretsDeep } from "../src/secretGuard.js";
import { isWellFormedSha256, sha256, stableKaggleDatasetId, stableRenderRunId } from "../src/ids.js";

describe("secret redaction (item 27)", () => {
  it("detects and redacts ElevenLabs-style credentials", () => {
    const text = "xi-api-key: sk_live_1234567890abcdef1234";
    expect(containsSecret(text)).toBe(true);
    expect(redactSecrets(text)).toContain("[REDACTED]");
  });

  it("deep-redacts secrets out of nested objects before logging", () => {
    const obj = { headers: { "xi-api-key": "abcdef1234567890abcd" }, body: { text: "hello" } };
    const redacted = redactSecretsDeep(obj);
    expect(JSON.stringify(redacted)).not.toContain("abcdef1234567890abcd");
  });

  it("AUDIT FIX §13.6: deep-redacts a Kaggle credential value logged under the key name 'kaggle_key'", () => {
    const obj = { kaggle_key: "KGAT_fixturetoken0000000000000000", other: "fine" };
    const redacted = redactSecretsDeep(obj);
    expect(JSON.stringify(redacted)).not.toContain("fixturetoken0000000000000000");
    expect((redacted as typeof obj).other).toBe("fine");
  });
});

describe("deterministic ids (item 28)", () => {
  it("sha256/well-formed check is stable and correct", () => {
    const h = sha256("test");
    expect(isWellFormedSha256(h)).toBe(true);
    expect(isWellFormedSha256("not-a-hash")).toBe(false);
  });

  it("kaggle dataset id and render run id are deterministic", () => {
    expect(stableKaggleDatasetId("video_1")).toBe(stableKaggleDatasetId("video_1"));
    expect(stableKaggleDatasetId("video_1")).not.toBe(stableKaggleDatasetId("video_2"));
    expect(stableRenderRunId("proj_1", "master", "target_1")).toBe(stableRenderRunId("proj_1", "master", "target_1"));
  });
});
