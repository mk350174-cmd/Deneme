import { describe, expect, it } from "vitest";
import { analyze, recommend, recordHumanDecision, supersedeDecision } from "../src/aiDirector.js";
import { formatDecisionFromApprovedDecision } from "../src/pipeline.js";

describe("AI Director (advisory-only contract test)", () => {
  it("analyze() only reflects caller-supplied gaps/risks, never invents them", () => {
    expect(analyze({})).toEqual({ gaps: [], risks: [] });
    expect(analyze({ statedGaps: ["missing continuity reference"], statedRisks: [] })).toEqual({
      gaps: ["missing continuity reference"],
      risks: [],
    });
  });

  it("recommend() can only ever produce status 'recommended', never 'approved'", () => {
    const decision = recommend({
      question: "camera_choice",
      targetId: "shot_1",
      optionsConsidered: [{ choice: "static" }, { choice: "slow push-in" }],
      recommendation: "slow push-in",
      rationale: "Matches the establishing-shot pacing used elsewhere in the plan.",
    });
    expect(decision.status).toBe("recommended");
    expect(decision.approving_actor).toBeUndefined();
  });

  it("recommend() refuses a recommendation that isn't one of the considered options", () => {
    expect(() =>
      recommend({
        question: "camera_choice",
        targetId: "shot_1",
        optionsConsidered: [{ choice: "static" }],
        recommendation: "drone shot",
        rationale: "n/a",
      }),
    ).toThrow();
  });

  it("recordHumanDecision requires a non-empty actor — no automatic approval transition", () => {
    const recommended = recommend({
      question: "camera_choice",
      targetId: "shot_1",
      optionsConsidered: [{ choice: "static" }, { choice: "slow push-in" }],
      recommendation: "slow push-in",
      rationale: "r",
    });
    expect(() => recordHumanDecision(recommended, "", "approved")).toThrow();
  });

  it("recordHumanDecision is the only path from recommended to approved", () => {
    const recommended = recommend({
      question: "camera_choice",
      targetId: "shot_1",
      optionsConsidered: [{ choice: "static" }, { choice: "slow push-in" }],
      recommendation: "slow push-in",
      rationale: "r",
    });
    const approved = recordHumanDecision(recommended, "user:mk350174", "approved");
    expect(approved.status).toBe("approved");
    expect(approved.approving_actor).toBe("user:mk350174");
    // recommended and approved must remain distinct states/objects in time:
    expect(recommended.status).toBe("recommended");
  });

  it("recordHumanDecision can reject or modify, and refuses to re-record an already-decided decision", () => {
    const recommended = recommend({
      question: "camera_choice",
      targetId: "shot_2",
      optionsConsidered: [{ choice: "static" }, { choice: "slow push-in" }],
      recommendation: "static",
      rationale: "r",
    });
    const rejected = recordHumanDecision(recommended, "user:mk350174", "rejected");
    expect(rejected.status).toBe("rejected");
    expect(() => recordHumanDecision(rejected, "user:mk350174", "approved")).toThrow();
  });

  it("supersedeDecision requires an actor and links to the superseding decision", () => {
    const recommended = recommend({
      question: "camera_choice",
      targetId: "shot_3",
      optionsConsidered: [{ choice: "static" }],
      recommendation: "static",
      rationale: "r",
    });
    expect(() => supersedeDecision(recommended, "dec_new", "")).toThrow();
    const superseded = supersedeDecision(recommended, "dec_new", "user:mk350174");
    expect(superseded.status).toBe("superseded");
    expect(superseded.precedent_refs).toContain("dec_new");
  });
});

describe("C4 — interactive format reasoning: formatDecisionFromApprovedDecision (small improvements)", () => {
  it("refuses to build a FormatDecision from a Decision that isn't approved yet", () => {
    const recommended = recommend({
      question: "format",
      targetId: "video_1",
      optionsConsidered: [{ choice: "documentary" }, { choice: "cinematic" }],
      recommendation: "documentary",
      rationale: "Matches the evidence-heavy source material better than a dramatized approach.",
    });
    expect(() => formatDecisionFromApprovedDecision(recommended, [])).toThrow();
  });

  it("builds a FormatDecision from an approved format Decision, reusing the existing advisory flow end to end", () => {
    const recommended = recommend({
      question: "format",
      targetId: "video_1",
      optionsConsidered: [{ choice: "documentary" }, { choice: "cinematic" }],
      recommendation: "documentary",
      rationale: "Matches the evidence-heavy source material better than a dramatized approach.",
    });
    const approved = recordHumanDecision(recommended, "user:mk350174", "approved");
    const format = formatDecisionFromApprovedDecision(approved, ["max_9_minutes"]);
    expect(format).toEqual({ format: "documentary", constraints: ["max_9_minutes"] });
  });
});
