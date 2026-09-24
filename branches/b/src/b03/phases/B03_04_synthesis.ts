// B03.04 — Profile Synthesis Layer
// Creates reusable profiles from segments, synthesizes needs/pain points/questions

import type {
  AudienceSegment,
  SegmentProfile,
  AudienceNeed,
  AudiencePainPoint,
  AudienceQuestion,
  B03Deps,
} from "../types.js";
import type { ProvenanceRef } from "../../b00/provenanceRef.js";
import type { EvidenceRef } from "../../types/entities.js";
import { canonicalHasher } from "../../b00/hashing.js";

/** Synthesize reusable segment profiles from segments */
export function synthesizeSegmentProfiles(
  segments: AudienceSegment[],
  deps?: B03Deps,
): SegmentProfile[] {
  const profiles: SegmentProfile[] = [];
  const deps_ = deps || { hash: createDefaultHashFunctions() };

  // Merge only when an explicit shared profile id exists. String-prefix matching
  // is not evidence that two audiences are the same population.
  const groupedSegments = new Map<string, AudienceSegment[]>();
  for (const segment of segments) {
    const groupKey = segment.segment_profile_id ?? segment.segment_id;
    if (!groupedSegments.has(groupKey)) groupedSegments.set(groupKey, []);
    groupedSegments.get(groupKey)!.push(segment);
  }

  // Create one profile per group
  for (const [groupKey, groupSegs] of groupedSegments) {
    const profileName = groupSegs[0]?.segment_name ?? groupKey;
    const profile: SegmentProfile = {
      profile_id: deps_.hash!.stableProfileId(
        groupSegs[0]?.evidence_refs?.[0]?.source || "unknown",
        `${groupKey}:${profileName}`,
      ),

      segment_name: profileName,
      description: `Shared profile for ${profileName} audiences across platforms`,

      characteristics: mergeCharacteristics(groupSegs).characteristics,
      characteristic_conflicts: mergeCharacteristics(groupSegs).conflicts,
      segment_ids: groupSegs.map((s) => s.segment_id),

      platform_affinity: groupSegs
        .filter((s) => s.platform_names.length > 0)
        .map((s) => ({
          platform_name: s.platform_names[0]!,
          engagement_level: s.confidence,
          evidence_refs: s.evidence_refs,
        })),

      evidence_refs: mergeEvidenceRefs(groupSegs),
      provenance: {
        type: "INFERRED",
        decision_authority: "B03_profile_synthesizer",
        timestamp: new Date().toISOString(),
        rationale: `Synthesized profile from ${groupSegs.length} related segments`,
      } as ProvenanceRef,

      confidence: calculateProfileConfidence(groupSegs),
    };

    profiles.push(profile);
  }

  return profiles;
}

/** Synthesize audience needs from segment evidence */
export function synthesizeAudienceNeeds(
  segments: AudienceSegment[],
  deps?: B03Deps,
): AudienceNeed[] {
  const needs: AudienceNeed[] = [];
  const deps_ = deps || { hash: createDefaultHashFunctions() };
  const now = deps_?.now?.() || new Date().toISOString();

  for (const segment of segments) {
    // Extract needs from evidence text (simple keyword matching)
    const needKeywords = [
      { word: "knowledge", type: "knowledge" as const },
      { word: "learn", type: "knowledge" as const },
      { word: "best practice", type: "knowledge" as const },
      { word: "capability", type: "capability" as const },
      { word: "skill", type: "capability" as const },
      { word: "tool", type: "tool" as const },
      { word: "community", type: "community" as const },
      { word: "validation", type: "validation" as const },
      { word: "mentorship", type: "mentorship" as const },
    ];

    for (const evidence of segment.evidence_refs) {
      if (!evidence.excerpt) continue;
      for (const keyword of needKeywords) {
        if (evidence.excerpt.toLowerCase().includes(keyword.word)) {
          const need: AudienceNeed = {
            need_id: `need_${segment.segment_id}_${keyword.type}`,
            segment_id: segment.segment_id,
            need_type: keyword.type,
            description: `${keyword.type} need for ${segment.segment_name}`,
            urgency: "medium",
            evidence_refs: [evidence],
            provenance: {
              type: "INFERRED",
              decision_authority: "B03_need_analyzer",
              timestamp: now,
              rationale: `Identified from audience evidence: "${evidence.excerpt.substring(0, 100)}..."`,
            } as ProvenanceRef,
          };

          needs.push(need);
          break; // One need per keyword per segment
        }
      }
    }
  }

  return needs;
}

/** Synthesize audience pain points from segment evidence */
export function synthesizeAudiencePainPoints(
  segments: AudienceSegment[],
  deps?: B03Deps,
): AudiencePainPoint[] {
  const painPoints: AudiencePainPoint[] = [];
  const deps_ = deps || { hash: createDefaultHashFunctions() };
  const now = deps_?.now?.() || new Date().toISOString();

  for (const segment of segments) {
    const painKeywords = [
      { word: "efficiency", type: "efficiency" as const },
      { word: "performance", type: "efficiency" as const },
      { word: "quality", type: "quality" as const },
      { word: "bug", type: "quality" as const },
      { word: "cost", type: "cost" as const },
      { word: "expensive", type: "cost" as const },
      { word: "skill gap", type: "skill_gap" as const },
      { word: "technical debt", type: "process" as const },
      { word: "compliance", type: "compliance" as const },
    ];

    for (const evidence of segment.evidence_refs) {
      if (!evidence.excerpt) continue;
      for (const keyword of painKeywords) {
        if (evidence.excerpt.toLowerCase().includes(keyword.word)) {
          const painPoint: AudiencePainPoint = {
            pain_point_id: `pain_${segment.segment_id}_${keyword.type}`,
            segment_id: segment.segment_id,
            pain_point_type: keyword.type,
            description: `${keyword.type} pain point for ${segment.segment_name}`,
            severity: "medium",
            evidence_refs: [evidence],
            provenance: {
              type: "INFERRED",
              decision_authority: "B03_pain_point_analyzer",
              timestamp: now,
              rationale: `Identified from audience evidence: "${evidence.excerpt.substring(0, 100)}..."`,
            } as ProvenanceRef,
          };

          painPoints.push(painPoint);
          break;
        }
      }
    }
  }

  return painPoints;
}

/** Synthesize audience questions from segment evidence */
export function synthesizeAudienceQuestions(
  segments: AudienceSegment[],
  deps?: B03Deps,
): AudienceQuestion[] {
  const questions: AudienceQuestion[] = [];
  const deps_ = deps || { hash: createDefaultHashFunctions() };
  const now = deps_?.now?.() || new Date().toISOString();

  for (const segment of segments) {
    const questionKeywords = [
      { word: "how", category: "technical" as const },
      { word: "what", category: "technical" as const },
      { word: "why", category: "strategic" as const },
      { word: "best practice", category: "best_practice" as const },
      { word: "which tool", category: "tool_selection" as const },
      { word: "career", category: "career" as const },
    ];

    for (const evidence of segment.evidence_refs) {
      if (!evidence.excerpt) continue;
      for (const keyword of questionKeywords) {
        if (evidence.excerpt.toLowerCase().includes(keyword.word)) {
          const question: AudienceQuestion = {
            question_id: `q_${segment.segment_id}_${keyword.category}`,
            segment_id: segment.segment_id,
            category: keyword.category,
            description: `${keyword.category} question from ${segment.segment_name}`,
            frequency: "occasional",
            evidence_refs: [evidence],
            provenance: {
              type: "INFERRED",
              decision_authority: "B03_question_analyzer",
              timestamp: now,
              rationale: `Identified from audience evidence: "${evidence.excerpt.substring(0, 100)}..."`,
            } as ProvenanceRef,
          };

          questions.push(question);
          break;
        }
      }
    }
  }

  return questions;
}

/** Merge characteristics deliberately: arrays are unioned; conflicting scalar
 * values are omitted from the resolved profile and retained in conflicts. */
function mergeCharacteristics(segments: AudienceSegment[]): { characteristics: AudienceSegment["characteristics"]; conflicts: Record<string, unknown[]> } {
  const conflicts: Record<string, unknown[]> = {};
  const out: Record<string, unknown> = {};
  const keys = new Set(segments.flatMap((s) => Object.keys(s.characteristics)));
  for (const key of keys) {
    const values = segments.map((s) => (s.characteristics as Record<string, unknown>)[key]).filter((v) => v !== undefined);
    if (values.length === 0) continue;
    if (values.every(Array.isArray)) {
      out[key] = Array.from(new Set(values.flatMap((v) => v as unknown[]).map((v) => JSON.stringify(v)))).map((v) => JSON.parse(v));
      continue;
    }
    const unique = Array.from(new Map(values.map((v) => [JSON.stringify(v), v])).values());
    if (unique.length === 1) out[key] = unique[0];
    else conflicts[key] = unique;
  }
  return { characteristics: out as AudienceSegment["characteristics"], conflicts };
}

/** Merge evidence refs from multiple segments, removing duplicates */
function mergeEvidenceRefs(segments: AudienceSegment[]): EvidenceRef[] {
  const merged = new Map<string, EvidenceRef>();

  for (const segment of segments) {
    for (const evidence of segment.evidence_refs) {
      if (!merged.has(evidence.id)) {
        merged.set(evidence.id, evidence);
      }
    }
  }

  return Array.from(merged.values());
}

/** Calculate profile confidence from segment confidences */
function calculateProfileConfidence(segments: AudienceSegment[]): number {
  if (segments.length === 0) return 0;

  const avgConfidence = segments.reduce((sum, s) => sum + s.confidence, 0) / segments.length;
  return Math.min(avgConfidence, 0.85);
}

function createDefaultHashFunctions() {
  return {
    stableProfileId: (b01Version: string, profileName: string) =>
      `prof_${canonicalHasher.hash(`${b01Version}:${profileName}`)}`,
    stableInsightId: (b01Version: string, insightType: string, description: string) =>
      `ins_${canonicalHasher.hash(`${b01Version}:${insightType}:${description}`)}`,
    stableSegmentId: (b01Version: string, channelId: string, segmentName: string) =>
      `seg_${canonicalHasher.hash(`${b01Version}:${channelId}:${segmentName}`)}`,
  };
}
