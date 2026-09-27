// B03.03 — Analytical Segmentation Layer
// Infers audience segments from evidence (agent analysis)

import type { B01CanonicalState } from "../../b00/contracts.js";
import type { AudienceSegment, B03Deps } from "../types.js";
import type { ProvenanceRef } from "../../b00/provenanceRef.js";
import type { EvidenceRef } from "../../types/entities.js";
import { canonicalHasher } from "../../b00/hashing.js";
import { normalizeEvidenceRef } from "../../b00/evidence.js";

/** Infer audience segments from registry + evidence */
export function inferAudienceSegments(
  b01State: B01CanonicalState,
  allEvidence: EvidenceRef[],
  deps?: B03Deps,
  channelBoundEvidence: EvidenceRef[] = [],
): AudienceSegment[] {
  const segments: AudienceSegment[] = [];
  const deps_ = deps || createDefaultB03Deps();

  if (allEvidence.length === 0 && channelBoundEvidence.length === 0) {
    return segments;
  }

  // Strategy: For each channel, infer a primary segment based on platform + evidence
  for (const channel of b01State.channels) {
    const platform = channel.platform;
    const channelId = channel.channel_id;

    // Filter evidence relevant to this channel
    const channelEvidence = [...channelBoundEvidence, ...allEvidence.filter(
      (e) =>
        (e.excerpt && e.excerpt.toLowerCase().includes(channel.name.toLowerCase())) ||
        (e.excerpt && e.excerpt.toLowerCase().includes(platform.toLowerCase())),
    )];

    // If channel has some evidence, create a segment
    if (channelEvidence.length > 0) {
      // Infer segment name from platform + role
      let segmentName = `${platform} Audience`;
      if (channel.role === "primary") {
        segmentName = `${platform} Primary Audience`;
      } else if (channel.role === "secondary") {
        segmentName = `${platform} Secondary Audience`;
      }

      const segment: AudienceSegment = {
        segment_id: deps_.hash!.stableSegmentId(b01State.version, channelId, segmentName),

        segment_name: segmentName,
        segment_basis: "HEURISTIC",

        channel_ids: [channelId],
        platform_names: [platform],
        geography: inferGeographyFromEvidence(channelEvidence),
        timezone: inferTimezoneFromEvidence(channelEvidence),
        geography_basis: inferGeographyFromEvidence(channelEvidence) ? "INFERRED" : "UNKNOWN",
        timezone_basis: inferTimezoneFromEvidence(channelEvidence) ? "INFERRED" : "UNKNOWN",

        characteristics: {
          role_title: inferRoleFromEvidence(channelEvidence),
          seniority_level: "UNKNOWN",
          company_size: "UNKNOWN",
          industry: inferIndustryFromEvidence(channelEvidence),
          education_level: "UNKNOWN",
          experience_years: "UNKNOWN",
          technical_background: undefined,
        },

        evidence_refs: channelEvidence,
        provenance: {
          type: "INFERRED",
          decision_authority: "B03_segmentation_agent",
          timestamp: deps_.now!(),
          rationale: `Inferred segment from ${platform} channel evidence and B01 ecosystem data`,
        } as ProvenanceRef,

        confidence: calculateSegmentConfidence(channelEvidence),
        confidence_basis: "EVIDENCE_POLICY",
        data_sources: Array.from(new Set(channelEvidence.map((e) => e.source))),
      };

      segments.push(segment);
    }
  }

  return segments;
}

/** Infer geography from evidence text */
function inferGeographyFromEvidence(evidence: EvidenceRef[]): string[] | undefined {
  const geographies = new Set<string>();

  for (const ev of evidence) {
    if (!ev.excerpt) continue;
    const text = ev.excerpt.toUpperCase();

    if (/\bUS\b|\bU\.?S\.?A?\b|\bUNITED STATES\b/.test(text)) geographies.add("US");
    if (/\bUK\b|\bU\.?K\.?\b|\bUNITED KINGDOM\b/.test(text)) geographies.add("UK");
    if (/\bEU\b|\bEUROPE(?:AN)?\b/.test(text)) geographies.add("EU");
    if (/\bASIA(?:N)?\b/.test(text)) geographies.add("ASIA");
    if (/\bCANADA\b/.test(text)) geographies.add("CANADA");
    if (/\bAUSTRALIA\b/.test(text)) geographies.add("AUSTRALIA");
  }

  return geographies.size > 0 ? Array.from(geographies) : undefined;
}

/** Infer timezone from evidence text */
function inferTimezoneFromEvidence(evidence: EvidenceRef[]): string[] | undefined {
  const timezones = new Set<string>();

  for (const ev of evidence) {
    if (!ev.excerpt) continue;
    const text = ev.excerpt;

    if (/\bEST\b|\bEDT\b|\bET\b/.test(text)) timezones.add("America/New_York");
    if (/\bPST\b|\bPDT\b|\bPT\b/.test(text)) timezones.add("America/Los_Angeles");
    if (/\bGMT\b|\bUTC\b/.test(text)) timezones.add("UTC");
  }

  return timezones.size > 0 ? Array.from(timezones) : undefined;
}

/** Infer role from evidence text */
function inferRoleFromEvidence(evidence: EvidenceRef[]): string | undefined {
  const roles = new Set<string>();

  for (const ev of evidence) {
    if (!ev.excerpt) continue;
    const text = ev.excerpt.toLowerCase();

    if (text.includes("engineer") || text.includes("developer")) roles.add("Engineer");
    if (text.includes("manager")) roles.add("Manager");
    if (text.includes("cto") || text.includes("vp eng")) roles.add("CTO/VP");
    if (text.includes("founder") || text.includes("entrepreneur")) roles.add("Founder");
    if (text.includes("executive")) roles.add("Executive");
  }

  return roles.size > 0 ? Array.from(roles).join(" / ") : undefined;
}

/** Infer industry from evidence text */
function inferIndustryFromEvidence(evidence: EvidenceRef[]): string[] | undefined {
  const industries = new Set<string>();

  for (const ev of evidence) {
    if (!ev.excerpt) continue;
    const text = ev.excerpt.toLowerCase();

    if (text.includes("saas")) industries.add("SaaS");
    if (text.includes("fintech")) industries.add("FinTech");
    if (text.includes("hardware")) industries.add("Hardware");
    if (text.includes("startup")) industries.add("Startup");
    if (text.includes("enterprise")) industries.add("Enterprise");
  }

  return industries.size > 0 ? Array.from(industries) : undefined;
}

/** Calculate segment confidence based on evidence strength */
function calculateSegmentConfidence(evidence: EvidenceRef[]): number {
  if (evidence.length === 0) return 0;

  const normalized = evidence.map(normalizeEvidenceRef);
  const verifiedCount = normalized.filter((e) => e.status === "VERIFIED").length;
  const inferredCount = normalized.filter((e) => e.status === "INFERRED").length;

  // More evidence = higher confidence, but mostly INFERRED evidence caps at 0.7
  const verificationRatio = verifiedCount / evidence.length;
  const basedOnCount = Math.min(evidence.length / 5, 1.0); // Cap at 1.0

  return Math.min(verificationRatio * basedOnCount, 0.85);
}

/** Create default B03Deps for standalone testing */
export function createDefaultB03Deps(): B03Deps {
  return {
    hash: {
      stableSegmentId: (b01Version: string, channelId: string, segmentName: string) =>
        `seg_${canonicalHasher.hash(`${b01Version}:${channelId}:${segmentName}`)}`,
      stableProfileId: (b01Version: string, profileName: string) =>
        `prof_${canonicalHasher.hash(`${b01Version}:${profileName}`)}`,
      stableInsightId: (b01Version: string, insightType: string, description: string) =>
        `ins_${canonicalHasher.hash(`${b01Version}:${insightType}:${description}`)}`,
    },
    secretGuard: {
      redactSecrets: (text: string) => text,
    },
    now: () => new Date().toISOString(),
  };
}
