// B05.02 — Creative Angle Synthesis
// Generate creative angles for each campaign-segment combination

import type { CreativeAngle } from "../types.js";
import type { EvidenceRef } from "../../types/entities.js";
import type { ProvenanceRef } from "../../b00/provenanceRef.js";
import type { CreativeContext } from "./B05_01_registry.js";

const ANGLE_TEMPLATES = [
  { title: "Problem-Solution", description: "Frame as solving a core pain point" },
  { title: "Success Story", description: "Demonstrate through real-world results" },
  { title: "Expert Authority", description: "Position as industry thought leader" },
  { title: "Trend Insight", description: "Connect to emerging trends in space" },
];

export function synthesizeCreativeAngles(
  context: CreativeContext,
  deps?: { hash?: { stableAngleId: (campaignId: string, angleTitle: string) => string }; now?: () => string },
): CreativeAngle[] {
  const angles: CreativeAngle[] = [];
  const stableAngleId = deps?.hash?.stableAngleId || ((cid: string, title: string) => `angle_${cid}_${title.replace(/\s+/g, "_").toLowerCase()}`);
  const now = deps?.now?.() || new Date().toISOString();

  for (const campaign of context.campaigns) {
    for (const segmentId of campaign.target_segments) {
      const segment = context.segments.find((s) => s.segment_id === segmentId);
      if (!segment) continue;

      // Generate angles for each campaign-segment pair
      for (let templateIdx = 0; templateIdx < ANGLE_TEMPLATES.length; templateIdx++) {
        const template = ANGLE_TEMPLATES[templateIdx]!;
        const angleTitle = `${template.title} - ${segment.segment_name}`;

        const angle: CreativeAngle = {
          angle_id: stableAngleId(campaign.campaign_id, angleTitle),
          campaign_id: campaign.campaign_id,
          title: angleTitle,
          description: `${template.description} for ${segment.segment_name} audience`,
          target_audience_segment: segmentId,

          core_message: `${context.brand_name} ${campaign.primary_objective.toLowerCase()}`,
          emotional_appeal: inferEmotionalAppeal(template.title, segment),
          credibility_angle: inferCredibilityAngle(context.brand_positioning, template.title),

          content_types: inferContentTypes(template.title),
          tone: inferTone(segment.segment_name),

          evidence_refs: [
            {
              id: `ev_angle_${stableAngleId(campaign.campaign_id, angleTitle)}`,
              source: `campaign:${campaign.campaign_id},segment:${segmentId}`,
              status: "INFERRED" as const,
              excerpt: `Angle template: ${template.title}`,
            },
          ],
          provenance: {
            type: "INFERRED" as const,
            decision_authority: `B05_02:synthesizeCreativeAngles`,
            timestamp: now,
            rationale: `Generated from template and campaign-segment mapping`,
          },
          confidence: 0.65,
          confidence_basis: "HEURISTIC_DEFAULT",
          derivation_basis: "TEMPLATE",
        };

        angles.push(angle);
      }
    }
  }

  return angles;
}

function inferEmotionalAppeal(templateTitle: string, segment: { segment_name: string }): string {
  const appeals: { [key: string]: string } = {
    "Problem-Solution": "Relief and progress",
    "Success Story": "Aspiration and confidence",
    "Expert Authority": "Trust and credibility",
    "Trend Insight": "Relevance and belonging",
  };
  return appeals[templateTitle] || "Connection and value";
}

function inferCredibilityAngle(positioning: string, templateTitle: string): string {
  if (templateTitle === "Expert Authority") {
    return `${positioning} establishes thought leadership`;
  }
  return positioning || "Industry relevance";
}

function inferContentTypes(templateTitle: string): string[] {
  const types: { [key: string]: string[] } = {
    "Problem-Solution": ["explainer", "tutorial"],
    "Success Story": ["case_study", "testimonial"],
    "Expert Authority": ["advice", "research"],
    "Trend Insight": ["analysis", "prediction"],
  };
  return types[templateTitle] || ["explainer"];
}

function inferTone(segmentName: string): "formal" | "casual" | "technical" | "narrative" | "humorous" {
  if (segmentName.toLowerCase().includes("cto") || segmentName.toLowerCase().includes("engineer")) {
    return "technical";
  }
  if (segmentName.toLowerCase().includes("executive")) {
    return "formal";
  }
  return "narrative";
}
