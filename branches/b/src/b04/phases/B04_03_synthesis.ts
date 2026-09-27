// B04.03 — Campaign Strategy Synthesis
// Create campaigns from opportunities + segments + territories

import type { CampaignStrategy, StrategicPriority, B04Deps } from "../types.js";
import type { AlignmentScore } from "../types.js";
import type { ProvenanceRef } from "../../b00/provenanceRef.js";
import type { StrategyContext } from "./B04_01_registry.js";
import { canonicalHasher } from "../../b00/hashing.js";

export function synthesizeCampaigns(
  context: StrategyContext,
  alignments: AlignmentScore[],
  deps?: B04Deps,
): CampaignStrategy[] {
  const campaigns: CampaignStrategy[] = [];
  const hashes = createDefaultHashFunctions();
  const deps_ = deps || { hash: hashes };
  const now = deps_?.now?.() || new Date().toISOString();

  const campaignsByOpp = new Map<string, AlignmentScore[]>();
  for (const align of alignments) {
    if (!campaignsByOpp.has(align.opportunity_id)) {
      campaignsByOpp.set(align.opportunity_id, []);
    }
    campaignsByOpp.get(align.opportunity_id)!.push(align);
  }

  for (const [oppId, oppAlignments] of campaignsByOpp) {
    const opportunity = context.opportunities.find((o) => o.opportunity_id === oppId);
    if (!opportunity) continue;

    const segmentIds = oppAlignments.map((a) => a.segment_id);
    const avgAlignment =
      oppAlignments.reduce((sum, a) => sum + a.alignment_score, 0) /
      oppAlignments.length;

    const campaign: CampaignStrategy = {
      campaign_id: deps_.hash!.stableCampaignId(
        `${opportunity.opportunity_id}:${segmentIds.slice().sort().join(",")}:${(opportunity.territories || context.territories).slice().sort().join(",")}:${opportunity.description}`,
        context.brand_profile.name,
      ),
      campaign_name: opportunity.description.substring(0, 50),
      description: `Strategic campaign for ${opportunity.description}`,
      target_segments: segmentIds,
      aligned_opportunities: [oppId],
      territories: opportunity.territories || context.territories,
      timeline_months: 3,
      timeline_basis: "DEFAULT",
      timeline_source: "B04 framework default; requires user/evidence override before operational scheduling",
      primary_objective: `Engage ${segmentIds.length} audience segment(s) around opportunity`,
      secondary_objectives: [
        `Achieve 0.7+ engagement on aligned channels`,
        `Build thought leadership in target territories`,
      ],
      evidence_refs: opportunity.evidence_refs,
      provenance: {
        type: "INFERRED",
        decision_authority: "B04_synthesizer",
        timestamp: now,
        rationale: `Synthesized from ${oppAlignments.length} opportunity-segment alignments`,
      } as ProvenanceRef,
      confidence: Math.min(avgAlignment, 0.85),
      confidence_basis: "HEURISTIC",
    };

    campaigns.push(campaign);
  }

  return campaigns;
}

export function synthesizePriorities(
  campaigns: CampaignStrategy[],
  deps?: B04Deps,
): StrategicPriority[] {
  const priorities: StrategicPriority[] = [];
  const deps_ = deps || { hash: createDefaultHashFunctions() };
  const now = deps_?.now?.() || new Date().toISOString();

  const ranked = [...campaigns].sort((a, b) => b.confidence - a.confidence);

  for (let i = 0; i < ranked.length; i++) {
    const campaign = ranked[i]!;
    const priority: StrategicPriority = {
      priority_id: deps_.hash!.stablePriorityId(campaign.campaign_id, i + 1),
      rank: i + 1,
      campaign_id: campaign.campaign_id,
      description: campaign.campaign_name,
      rationale: `Confidence: ${campaign.confidence.toFixed(2)}; ${campaign.target_segments.length} segments; ${campaign.territories.length} territories`,
      blocks: i === 0 ? [] : [ranked[i - 1]!.campaign_id],
      depends_on: [],
      evidence_refs: campaign.evidence_refs,
      provenance: {
        type: "INFERRED",
        decision_authority: "B04_prioritizer",
        timestamp: now,
        rationale: `Ranked #${i + 1} by confidence score`,
      } as ProvenanceRef,
    };

    priorities.push(priority);
  }

  return priorities;
}

function createDefaultHashFunctions() {
  return {
    stableCampaignId: (name: string, b01Version: string) =>
      `camp_${canonicalHasher.hash(`${b01Version}:${name}`)}`,
    stablePriorityId: (campaignId: string, rank: number) =>
      `prio_${canonicalHasher.hash(`${campaignId}:${rank}`)}`,
    stableAlignmentId: (opportunityId: string, segmentId: string, score: string) =>
      `align_${canonicalHasher.hash(`${opportunityId}:${segmentId}:${score}`)}`,
  };
}
