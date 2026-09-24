import { describe, expect, it } from "vitest";
import { containsSecret, redactSecrets } from "../src/secretGuard.js";
import { stableCandidateId, stableDecisionId, stableShotId } from "../src/ids.js";

describe("secretGuard smoke (duplicated from P1, same behavior)", () => {
  it("detects and redacts a GitHub token", () => {
    const text = "token: ghp_1234567890abcdef1234";
    expect(containsSecret(text)).toBe(true);
    expect(redactSecrets(text)).toContain("[REDACTED]");
  });

  it("leaves ordinary text untouched", () => {
    const text = "A vertical short video about Roman aqueducts.";
    expect(containsSecret(text)).toBe(false);
  });
});

describe("deterministic ids smoke", () => {
  it("is stable and reproducible", () => {
    expect(stableCandidateId("Channel A")).toBe(stableCandidateId("Channel A"));
    expect(stableShotId("scene_1", 0)).toBe(stableShotId("scene_1", 0));
    expect(stableDecisionId("camera_choice", "shot_1")).not.toBe(stableDecisionId("camera_choice", "shot_2"));
  });
});
