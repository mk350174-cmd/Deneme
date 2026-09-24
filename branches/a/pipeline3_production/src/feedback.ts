// P3.08-DIST Distributed Render — Human QA Feedback Routing & Memory Integration
// NOT phase P3.09 (Automated QA, qa.ts) — see the naming note in orchestration_p309.ts.
// Routes HumanQAFeedback to appropriate Memory buckets (REJECTION_MEMORY, REFERENCE_MEMORY)
// for learning and pattern storage

import type { HumanQAFeedback } from "./types.js";

export type FeedbackCategory = "narrative" | "continuity" | "aesthetic" | "technical" | "audio";

export interface RoutedFeedback {
  category: FeedbackCategory;
  memory_bucket: "REJECTION_MEMORY" | "REFERENCE_MEMORY";
  memory_record_type: string;
  object_id: string;
  observation: string;
  metadata: Record<string, unknown>;
}

export class FeedbackRouter {
  // Route human QA feedback to appropriate Memory buckets
  routeFeedback(feedback: HumanQAFeedback): RoutedFeedback[] {
    const routed: RoutedFeedback[] = [];

    // Technical issues → REJECTION_MEMORY (learn from failures)
    if (feedback.technical_issues && feedback.technical_issues.length > 0) {
      routed.push({
        category: "technical",
        memory_bucket: "REJECTION_MEMORY",
        memory_record_type: "qa_finding",
        object_id: feedback.preview_id,
        observation: `Technical issues: ${feedback.technical_issues.join("; ")}`,
        metadata: {
          feedback_id: feedback.feedback_id,
          severity: "technical",
          shot_ids: feedback.specific_shot_ids,
          issues: feedback.technical_issues,
        },
      });
    }

    // Continuity issues → REJECTION_MEMORY (learn from gaps/stutters)
    if (feedback.continuity_issues && feedback.continuity_issues.length > 0) {
      routed.push({
        category: "continuity",
        memory_bucket: "REJECTION_MEMORY",
        memory_record_type: "qa_finding",
        object_id: feedback.preview_id,
        observation: `Continuity issues: ${feedback.continuity_issues.join("; ")}`,
        metadata: {
          feedback_id: feedback.feedback_id,
          severity: "error",
          shot_ids: feedback.specific_shot_ids,
          issues: feedback.continuity_issues,
        },
      });
    }

    // Aesthetic issues → REFERENCE_MEMORY (learn good patterns)
    if (feedback.aesthetic_issues && feedback.aesthetic_issues.length > 0) {
      const bucket = feedback.narrative_quality === "excellent" ? "REFERENCE_MEMORY" : "REJECTION_MEMORY";
      routed.push({
        category: "aesthetic",
        memory_bucket: bucket,
        memory_record_type: "qa_finding",
        object_id: feedback.preview_id,
        observation: `Aesthetic feedback (${feedback.narrative_quality}): ${feedback.aesthetic_issues.join("; ")}`,
        metadata: {
          feedback_id: feedback.feedback_id,
          quality_rating: feedback.narrative_quality,
          shot_ids: feedback.specific_shot_ids,
          issues: feedback.aesthetic_issues,
        },
      });
    }

    // Narrative quality → REFERENCE_MEMORY (capture learned preferences)
    if (feedback.narrative_quality && feedback.narrative_quality !== "unreviewed") {
      routed.push({
        category: "narrative",
        memory_bucket: feedback.narrative_quality === "excellent" ? "REFERENCE_MEMORY" : "REJECTION_MEMORY",
        memory_record_type: "narrative_quality",
        object_id: feedback.preview_id,
        observation: `Narrative quality: ${feedback.narrative_quality}`,
        metadata: {
          feedback_id: feedback.feedback_id,
          quality: feedback.narrative_quality,
          recommendation: feedback.recommendation,
        },
      });
    }

    return routed;
  }

  // Retrieve learned patterns from Memory for decision-making
  // (In real implementation, this would call loadAllBuckets from pipeline1_research)
  getLearningsForShard(shardId: string): { rejection_patterns: string[]; reference_patterns: string[] } {
    // Placeholder — real implementation queries Memory buckets
    return {
      rejection_patterns: [],
      reference_patterns: [],
    };
  }
}

// Decision point: should shard be re-rendered based on feedback?
export function shouldReRender(feedback: HumanQAFeedback): boolean {
  return (
    feedback.recommendation === "request_reshard" ||
    (feedback.technical_issues && feedback.technical_issues.length > 0) ||
    (feedback.continuity_issues && feedback.continuity_issues.length > 0)
  );
}

// Decision point: should shard be escalated to human?
export function shouldEscalate(feedback: HumanQAFeedback): boolean {
  return feedback.recommendation === "escalate" || (feedback.continuity_issues && feedback.continuity_issues.length > 0);
}
