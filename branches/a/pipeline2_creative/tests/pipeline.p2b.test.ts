import { describe, expect, it } from "vitest";
import { buildFormatDecisionMatrix, approveFormatDecisionMatrix, formatDecisionFromApprovedDecision, decideFormat } from "../src/pipeline.js";
import { recommend, recordHumanDecision } from "../src/aiDirector.js";
import { ValidationError } from "../src/errors.js";

describe("P2.04 Improvement (P2-B): Format Decision Matrix", () => {
  it("buildFormatDecisionMatrix constructs a full chain: format → duration → narrative_density → production_complexity", () => {
    const formatDecisionId = "dec_format_vertical";
    const format = "vertical_short_video";
    const constraints = ["under 60s"];

    const matrix = buildFormatDecisionMatrix(formatDecisionId, format, constraints);

    expect(matrix.matrix_id).toMatch(/^fmat_/);
    expect(matrix.format_decision_id).toBe(formatDecisionId);
    expect(matrix.chain).toHaveLength(10); // All 10 decision points
    expect(matrix.is_user_reviewed).toBe(false);
    expect(matrix.review_timestamp).toBeUndefined();
    expect(matrix.review_actor).toBeUndefined();
  });

  it("matrix chain contains all canonical steps in order", () => {
    const formatDecisionId = "dec_format_horizontal";
    const format = "horizontal_long_form";
    const constraints = [];

    const matrix = buildFormatDecisionMatrix(formatDecisionId, format, constraints);

    const stepNames = matrix.chain.map((p) => p.step);
    expect(stepNames).toEqual([
      "format",
      "duration",
      "narrative_density",
      "shot_density",
      "visual_density",
      "motion_density",
      "asset_requirement",
      "voice_requirement",
      "manual_workload",
      "production_complexity",
    ]);
  });

  it("each matrix point contains step, input, output, and rationale", () => {
    const matrix = buildFormatDecisionMatrix("dec_test", "square_medium", ["under 180s"]);

    for (const point of matrix.chain) {
      expect(point.step).toBeTruthy();
      expect(point.input).toBeTruthy();
      expect(point.output).toBeTruthy();
      expect(point.rationale).toBeTruthy();
      // implications is optional
      if (point.implications) {
        expect(typeof point.implications).toBe("object");
      }
    }
  });

  it("matrix.chain[0] (format step) outputs the provided format", () => {
    const format = "custom_format_xyz";
    const matrix = buildFormatDecisionMatrix("dec_x", format, []);

    expect(matrix.chain[0]!.step).toBe("format");
    expect(matrix.chain[0]!.output).toBe(format);
  });

  it("matrix respects constraints in duration step", () => {
    const matrixShort = buildFormatDecisionMatrix("dec_short", "vertical_short_video", ["under 60s"]);
    const matrixMedium = buildFormatDecisionMatrix("dec_med", "vertical_medium_video", ["under 180s"]);

    expect(matrixShort.chain[1]!.step).toBe("duration");
    expect(matrixShort.chain[1]!.output).toContain("30-60");
    expect(matrixMedium.chain[1]!.output).toContain("60-180");
  });

  it("matrix_id is deterministic: same inputs produce same id", () => {
    const matrix1 = buildFormatDecisionMatrix("dec_1", "vertical_short_video", ["under 60s"]);
    const matrix2 = buildFormatDecisionMatrix("dec_1", "vertical_short_video", ["under 60s"]);

    expect(matrix1.matrix_id).toBe(matrix2.matrix_id);
  });

  it("matrix_id is unique per decision_id: different decision ids produce different matrix ids", () => {
    const matrix1 = buildFormatDecisionMatrix("dec_1", "vertical_short_video", ["under 60s"]);
    const matrix2 = buildFormatDecisionMatrix("dec_2", "vertical_short_video", ["under 60s"]);

    expect(matrix1.matrix_id).not.toBe(matrix2.matrix_id);
  });

  it("approveFormatDecisionMatrix sets review state and locks the matrix", () => {
    const matrix = buildFormatDecisionMatrix("dec_approve_test", "vertical_short_video", []);
    expect(matrix.is_user_reviewed).toBe(false);

    const approved = approveFormatDecisionMatrix(matrix, "user:test_actor", "Approved for production");

    expect(approved.is_user_reviewed).toBe(true);
    expect(approved.review_actor).toBe("user:test_actor");
    expect(approved.review_timestamp).toBeTruthy();
    expect(approved.notes).toBe("Approved for production");
    // Original not mutated
    expect(matrix.is_user_reviewed).toBe(false);
  });

  it("approveFormatDecisionMatrix prevents re-approval", () => {
    const matrix = buildFormatDecisionMatrix("dec_reapprove", "vertical_short_video", []);
    const approved = approveFormatDecisionMatrix(matrix, "user:actor1");

    expect(() => approveFormatDecisionMatrix(approved, "user:actor2")).toThrow(ValidationError);
  });

  it("review timestamp is valid ISO 8601", () => {
    const matrix = buildFormatDecisionMatrix("dec_iso", "vertical_short_video", []);
    const approved = approveFormatDecisionMatrix(matrix, "user:iso_test");

    const timestamp = new Date(approved.review_timestamp!);
    expect(timestamp.getTime()).toBeGreaterThan(0);
  });

  it("matrix chain implications link to downstream decision points", () => {
    const matrix = buildFormatDecisionMatrix("dec_implications", "vertical_short_video", ["under 60s"]);

    // Format step should mention duration, narrative_density, asset_count
    const formatImplications = matrix.chain[0]!.implications?.affects || "";
    expect(formatImplications).toContain("duration");

    // Duration should mention narrative_density, shot_density
    const durationImplications = matrix.chain[1]!.implications?.affects || "";
    expect(durationImplications).toContain("narrative_density");

    // Final step should indicate gate unlock
    const finalImplications = matrix.chain[9]!.implications?.final || "";
    expect(finalImplications).toContain("P2.05");
  });

  it("integrates with formatDecisionFromApprovedDecision workflow", () => {
    // User provides format choice via AI Director recommendation → approved Decision
    const recommended = recommend({
      question: "format_choice",
      targetId: "video_1",
      optionsConsidered: [{ choice: "vertical" }, { choice: "horizontal" }],
      recommendation: "vertical",
      rationale: "Vertical format matches target platform.",
    });
    const decision = recordHumanDecision(recommended, "user:test", "approved");

    // Convert to FormatDecision + matrix
    const formatDecision = formatDecisionFromApprovedDecision(decision, ["under 60s"]);
    const matrix = buildFormatDecisionMatrix(decision.decision_id, formatDecision.format, formatDecision.constraints);

    expect(matrix.format_decision_id).toBe(decision.decision_id);
    expect(matrix.chain[0]!.output).toBe("vertical");
    expect(matrix.is_user_reviewed).toBe(false);

    // User reviews and approves the matrix before progression
    const approved = approveFormatDecisionMatrix(matrix, "user:test");
    expect(approved.is_user_reviewed).toBe(true);
  });

  it("full workflow: format decision → matrix → user review → gate pass", () => {
    // Step 1: AI Director recommends format
    const recommended = recommend({
      question: "format_strategy",
      targetId: "content_1",
      optionsConsidered: [{ choice: "short_vertical" }, { choice: "long_horizontal" }],
      recommendation: "short_vertical",
      rationale: "Matches audience platform preference and pacing.",
    });
    const decision = recordHumanDecision(recommended, "user:mk350174", "approved");

    // Step 2: Build format decision
    const formatDecision = formatDecisionFromApprovedDecision(decision, ["under 90s"]);
    expect(formatDecision.format).toBe("short_vertical");

    // Step 3: Build decision matrix (no user review yet)
    const matrix = buildFormatDecisionMatrix(decision.decision_id, formatDecision.format, formatDecision.constraints);
    expect(matrix.is_user_reviewed).toBe(false);
    expect(matrix.chain).toHaveLength(10);

    // Step 4: User reviews matrix (checkpoint)
    const approved = approveFormatDecisionMatrix(matrix, "user:mk350174", "Ready for creative development");
    expect(approved.is_user_reviewed).toBe(true);

    // Step 5: Gate enforces review before downstream use (no silent progression)
    if (!approved.is_user_reviewed) {
      throw new Error("Cannot proceed to P2.05+ without user review gate");
    }

    // All assertions passed, matrix is locked and canonical
    expect(approved.review_actor).toBe("user:mk350174");
  });
});
