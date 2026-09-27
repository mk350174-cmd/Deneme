// P3.08-DIST Distributed Render (NOT phase P3.09/Automated QA) — Feedback Routing Tests
// Validates feedback classification, memory routing, and decision points

import { describe, it, expect, beforeEach } from "vitest";
import { FeedbackRouter, shouldReRender, shouldEscalate } from "../src/feedback.js";
import type { HumanQAFeedback, RoutedFeedback } from "../src/types.js";

describe("FeedbackRouter", () => {
  let router: FeedbackRouter;

  beforeEach(() => {
    router = new FeedbackRouter();
  });

  describe("routeFeedback", () => {
    it("routes technical issues to REJECTION_MEMORY", () => {
      const feedback: HumanQAFeedback = {
        feedback_id: "fb_001",
        preview_id: "preview_001",
        narrative_quality: "unreviewed",
        technical_issues: ["codec mismatch", "fps inconsistency"],
        continuity_issues: [],
        aesthetic_issues: [],
        specific_shot_ids: ["shot_1", "shot_2"],
        recommendation: "request_reshard",
      };

      const routed = router.routeFeedback(feedback);
      const technical = routed.find((r) => r.category === "technical");

      expect(technical).toBeDefined();
      expect(technical?.memory_bucket).toBe("REJECTION_MEMORY");
      expect(technical?.observation).toContain("codec mismatch");
      expect(technical?.observation).toContain("fps inconsistency");
    });

    it("routes continuity issues to REJECTION_MEMORY", () => {
      const feedback: HumanQAFeedback = {
        feedback_id: "fb_002",
        preview_id: "preview_002",
        narrative_quality: "unreviewed",
        technical_issues: [],
        continuity_issues: ["frame gap at 1000-2000", "stuttering on transition"],
        aesthetic_issues: [],
        specific_shot_ids: ["shot_3"],
        recommendation: "request_reshard",
      };

      const routed = router.routeFeedback(feedback);
      const continuity = routed.find((r) => r.category === "continuity");

      expect(continuity).toBeDefined();
      expect(continuity?.memory_bucket).toBe("REJECTION_MEMORY");
      expect(continuity?.observation).toContain("frame gap");
    });

    it("routes aesthetic issues to REFERENCE_MEMORY when quality is excellent", () => {
      const feedback: HumanQAFeedback = {
        feedback_id: "fb_003",
        preview_id: "preview_003",
        narrative_quality: "excellent",
        technical_issues: [],
        continuity_issues: [],
        aesthetic_issues: ["color grading is exceptional", "transitions are smooth"],
        specific_shot_ids: ["shot_5"],
        recommendation: "approve",
      };

      const routed = router.routeFeedback(feedback);
      const aesthetic = routed.find((r) => r.category === "aesthetic");

      expect(aesthetic).toBeDefined();
      expect(aesthetic?.memory_bucket).toBe("REFERENCE_MEMORY");
      expect(aesthetic?.observation).toContain("excellent");
    });

    it("routes aesthetic issues to REJECTION_MEMORY when quality is poor", () => {
      const feedback: HumanQAFeedback = {
        feedback_id: "fb_004",
        preview_id: "preview_004",
        narrative_quality: "poor",
        technical_issues: [],
        continuity_issues: [],
        aesthetic_issues: ["colors are washed out", "pacing is too slow"],
        specific_shot_ids: ["shot_6"],
        recommendation: "request_remix",
      };

      const routed = router.routeFeedback(feedback);
      const aesthetic = routed.find((r) => r.category === "aesthetic");

      expect(aesthetic).toBeDefined();
      expect(aesthetic?.memory_bucket).toBe("REJECTION_MEMORY");
    });

    it("routes narrative quality to REFERENCE_MEMORY when excellent", () => {
      const feedback: HumanQAFeedback = {
        feedback_id: "fb_005",
        preview_id: "preview_005",
        narrative_quality: "excellent",
        technical_issues: [],
        continuity_issues: [],
        aesthetic_issues: [],
        specific_shot_ids: [],
        recommendation: "approve",
      };

      const routed = router.routeFeedback(feedback);
      const narrative = routed.find((r) => r.category === "narrative");

      expect(narrative).toBeDefined();
      expect(narrative?.memory_bucket).toBe("REFERENCE_MEMORY");
      expect(narrative?.observation).toContain("excellent");
    });

    it("routes narrative quality to REJECTION_MEMORY when poor", () => {
      const feedback: HumanQAFeedback = {
        feedback_id: "fb_006",
        preview_id: "preview_006",
        narrative_quality: "poor",
        technical_issues: [],
        continuity_issues: [],
        aesthetic_issues: [],
        specific_shot_ids: [],
        recommendation: "request_remix",
      };

      const routed = router.routeFeedback(feedback);
      const narrative = routed.find((r) => r.category === "narrative");

      expect(narrative).toBeDefined();
      expect(narrative?.memory_bucket).toBe("REJECTION_MEMORY");
    });

    it("does not route unreviewed narrative quality", () => {
      const feedback: HumanQAFeedback = {
        feedback_id: "fb_007",
        preview_id: "preview_007",
        narrative_quality: "unreviewed",
        technical_issues: [],
        continuity_issues: [],
        aesthetic_issues: [],
        specific_shot_ids: [],
        recommendation: "approve",
      };

      const routed = router.routeFeedback(feedback);
      const narrative = routed.find((r) => r.category === "narrative");

      expect(narrative).toBeUndefined();
    });

    it("includes feedback_id in metadata", () => {
      const feedback: HumanQAFeedback = {
        feedback_id: "fb_008",
        preview_id: "preview_008",
        narrative_quality: "unreviewed",
        technical_issues: ["issue 1"],
        continuity_issues: [],
        aesthetic_issues: [],
        specific_shot_ids: [],
        recommendation: "request_reshard",
      };

      const routed = router.routeFeedback(feedback);
      const technical = routed.find((r) => r.category === "technical");

      expect(technical?.metadata?.feedback_id).toBe("fb_008");
    });

    it("includes shot_ids in metadata", () => {
      const feedback: HumanQAFeedback = {
        feedback_id: "fb_009",
        preview_id: "preview_009",
        narrative_quality: "unreviewed",
        technical_issues: ["issue"],
        continuity_issues: [],
        aesthetic_issues: [],
        specific_shot_ids: ["shot_a", "shot_b"],
        recommendation: "request_reshard",
      };

      const routed = router.routeFeedback(feedback);
      const technical = routed.find((r) => r.category === "technical");

      expect(technical?.metadata?.shot_ids).toEqual(["shot_a", "shot_b"]);
    });

    it("handles feedback with multiple issue types", () => {
      const feedback: HumanQAFeedback = {
        feedback_id: "fb_010",
        preview_id: "preview_010",
        narrative_quality: "good",
        technical_issues: ["fps mismatch"],
        continuity_issues: ["frame gap"],
        aesthetic_issues: ["color grade needs work"],
        specific_shot_ids: ["shot_7"],
        recommendation: "request_reshard",
      };

      const routed = router.routeFeedback(feedback);

      expect(routed.length).toBeGreaterThan(1);
      expect(routed.some((r) => r.category === "technical")).toBe(true);
      expect(routed.some((r) => r.category === "continuity")).toBe(true);
      expect(routed.some((r) => r.category === "aesthetic")).toBe(true);
      expect(routed.some((r) => r.category === "narrative")).toBe(true);
    });

    it("returns empty array for feedback with no issues", () => {
      const feedback: HumanQAFeedback = {
        feedback_id: "fb_011",
        preview_id: "preview_011",
        narrative_quality: "unreviewed",
        technical_issues: [],
        continuity_issues: [],
        aesthetic_issues: [],
        specific_shot_ids: [],
        recommendation: "approve",
      };

      const routed = router.routeFeedback(feedback);

      expect(routed.length).toBe(0);
    });
  });

  describe("shouldReRender", () => {
    it("returns true when recommendation is request_reshard", () => {
      const feedback: HumanQAFeedback = {
        feedback_id: "fb_012",
        preview_id: "preview_012",
        narrative_quality: "unreviewed",
        technical_issues: [],
        continuity_issues: [],
        aesthetic_issues: [],
        specific_shot_ids: [],
        recommendation: "request_reshard",
      };

      expect(shouldReRender(feedback)).toBe(true);
    });

    it("returns true when technical issues present", () => {
      const feedback: HumanQAFeedback = {
        feedback_id: "fb_013",
        preview_id: "preview_013",
        narrative_quality: "unreviewed",
        technical_issues: ["codec issue"],
        continuity_issues: [],
        aesthetic_issues: [],
        specific_shot_ids: [],
        recommendation: "approve",
      };

      expect(shouldReRender(feedback)).toBe(true);
    });

    it("returns true when continuity issues present", () => {
      const feedback: HumanQAFeedback = {
        feedback_id: "fb_014",
        preview_id: "preview_014",
        narrative_quality: "unreviewed",
        technical_issues: [],
        continuity_issues: ["frame gap"],
        aesthetic_issues: [],
        specific_shot_ids: [],
        recommendation: "approve",
      };

      expect(shouldReRender(feedback)).toBe(true);
    });

    it("returns false when no re-render indicators present", () => {
      const feedback: HumanQAFeedback = {
        feedback_id: "fb_015",
        preview_id: "preview_015",
        narrative_quality: "excellent",
        technical_issues: [],
        continuity_issues: [],
        aesthetic_issues: ["minor color grade change"],
        specific_shot_ids: [],
        recommendation: "approve",
      };

      expect(shouldReRender(feedback)).toBe(false);
    });

    it("returns false for request_remix recommendation", () => {
      const feedback: HumanQAFeedback = {
        feedback_id: "fb_016",
        preview_id: "preview_016",
        narrative_quality: "unreviewed",
        technical_issues: [],
        continuity_issues: [],
        aesthetic_issues: [],
        specific_shot_ids: [],
        recommendation: "request_remix",
      };

      expect(shouldReRender(feedback)).toBe(false);
    });
  });

  describe("shouldEscalate", () => {
    it("returns true when recommendation is escalate", () => {
      const feedback: HumanQAFeedback = {
        feedback_id: "fb_017",
        preview_id: "preview_017",
        narrative_quality: "unreviewed",
        technical_issues: [],
        continuity_issues: [],
        aesthetic_issues: [],
        specific_shot_ids: [],
        recommendation: "escalate",
      };

      expect(shouldEscalate(feedback)).toBe(true);
    });

    it("returns true when continuity issues present", () => {
      const feedback: HumanQAFeedback = {
        feedback_id: "fb_018",
        preview_id: "preview_018",
        narrative_quality: "unreviewed",
        technical_issues: [],
        continuity_issues: ["stuttering"],
        aesthetic_issues: [],
        specific_shot_ids: [],
        recommendation: "approve",
      };

      expect(shouldEscalate(feedback)).toBe(true);
    });

    it("returns false when no escalation indicators present", () => {
      const feedback: HumanQAFeedback = {
        feedback_id: "fb_019",
        preview_id: "preview_019",
        narrative_quality: "excellent",
        technical_issues: [],
        continuity_issues: [],
        aesthetic_issues: [],
        specific_shot_ids: [],
        recommendation: "approve",
      };

      expect(shouldEscalate(feedback)).toBe(false);
    });

    it("returns false for request_reshard (not escalation)", () => {
      const feedback: HumanQAFeedback = {
        feedback_id: "fb_020",
        preview_id: "preview_020",
        narrative_quality: "unreviewed",
        technical_issues: ["codec"],
        continuity_issues: [],
        aesthetic_issues: [],
        specific_shot_ids: [],
        recommendation: "request_reshard",
      };

      expect(shouldEscalate(feedback)).toBe(false);
    });
  });

  describe("getLearningsForShard", () => {
    it("returns placeholder learnings structure", () => {
      const learnings = router.getLearningsForShard("shard_0");

      expect(learnings).toBeDefined();
      expect(learnings.rejection_patterns).toBeDefined();
      expect(learnings.reference_patterns).toBeDefined();
      expect(Array.isArray(learnings.rejection_patterns)).toBe(true);
      expect(Array.isArray(learnings.reference_patterns)).toBe(true);
    });

    it("returns empty arrays as placeholder", () => {
      const learnings = router.getLearningsForShard("shard_0");

      expect(learnings.rejection_patterns.length).toBe(0);
      expect(learnings.reference_patterns.length).toBe(0);
    });
  });
});
