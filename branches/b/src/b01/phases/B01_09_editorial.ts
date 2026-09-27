// B01.09 — Editorial Constitution
// Define editorial governance rules: brand tone, content types, audience fit, content standards.
// CRITICAL: Governance rules only. NOT content violation claims (can't assess without actual content).
// NOT A-Branch production decisions (templates, exact formats, creative direction).

import type { B01Deps, EcosystemData, EditorialData } from "../types.js";
import type { B01Input } from "../../b00/contracts.js";
import type { EvidenceRef } from "../../types/entities.js";
import type { ProvenanceRef } from "../../b00/provenanceRef.js";
import { stableEvidenceId } from "../../b00/stableIds.js";

export type { EditorialData };

/**
 * Create evidence ref for editorial rule
 */
function createEvidenceRef(source: string, seed: string): EvidenceRef {
  return {
    id: stableEvidenceId(source, seed),
    source,
    status: "INFERRED", // Editorial rules extracted from guidelines/standards; user approval required
    excerpt: `Editorial rule from ${source}`,
  };
}

/**
 * Extract tone rules from editorial standards documentation
 *
 * Examples (no fabrication):
 * - "Professional and authoritative tone"
 * - "Conversational and friendly"
 * - "Educational and thought-leadership focused"
 */
function extractToneRules(documentation: string[]): Array<{
  rule_id: string;
  category: "tone";
  rule_text: string;
  evidence_refs: EvidenceRef[];
}> {
  const rules: Array<{
    rule_id: string;
    category: "tone";
    rule_text: string;
    evidence_refs: EvidenceRef[];
  }> = [];

  for (const doc of documentation) {
    if (!doc) continue;

    const docLower = doc.toLowerCase();

    if (
      docLower.includes("professional") ||
      docLower.includes("authoritative") ||
      docLower.includes("formal")
    ) {
      const ruleId = stableEvidenceId("editorial_standards", "tone_professional");
      rules.push({
        rule_id: ruleId,
        category: "tone" as const,
        rule_text: "Maintain professional and authoritative tone across all content",
        evidence_refs: [createEvidenceRef("editorial_standards", ruleId)],
      });
    }

    if (docLower.includes("conversational") || docLower.includes("friendly") || docLower.includes("casual")) {
      const ruleId = stableEvidenceId("editorial_standards", "tone_conversational");
      rules.push({
        rule_id: ruleId,
        category: "tone" as const,
        rule_text: "Use conversational and approachable language",
        evidence_refs: [createEvidenceRef("editorial_standards", ruleId)],
      });
    }

    if (docLower.includes("thought leadership") || docLower.includes("expert") || docLower.includes("educational")) {
      const ruleId = stableEvidenceId("editorial_standards", "tone_thought_leader");
      rules.push({
        rule_id: ruleId,
        category: "tone" as const,
        rule_text: "Position brand as thought leader through educational content",
        evidence_refs: [createEvidenceRef("editorial_standards", ruleId)],
      });
    }
  }

  return rules;
}

/**
 * Extract content type rules
 *
 * Examples:
 * - "Video-first content strategy"
 * - "Written content with supporting visuals"
 * - "Mix of long-form and short-form content"
 */
function extractContentTypeRules(documentation: string[]): Array<{
  rule_id: string;
  category: "content_type";
  rule_text: string;
  evidence_refs: EvidenceRef[];
}> {
  const rules: Array<{
    rule_id: string;
    category: "content_type";
    rule_text: string;
    evidence_refs: EvidenceRef[];
  }> = [];

  for (const doc of documentation) {
    if (!doc) continue;

    const docLower = doc.toLowerCase();

    if (docLower.includes("video") && docLower.includes("first")) {
      const ruleId = stableEvidenceId("editorial_standards", "content_video_first");
      rules.push({
        rule_id: ruleId,
        category: "content_type" as const,
        rule_text: "Prioritize video content across channels",
        evidence_refs: [createEvidenceRef("editorial_standards", ruleId)],
      });
    }

    if (docLower.includes("written") || docLower.includes("blog") || docLower.includes("articles")) {
      const ruleId = stableEvidenceId("editorial_standards", "content_written");
      rules.push({
        rule_id: ruleId,
        category: "content_type" as const,
        rule_text: "Include long-form written content (articles, blog posts, whitepapers)",
        evidence_refs: [createEvidenceRef("editorial_standards", ruleId)],
      });
    }

    if (docLower.includes("case studies") || docLower.includes("stories") || docLower.includes("examples")) {
      const ruleId = stableEvidenceId("editorial_standards", "content_storytelling");
      rules.push({
        rule_id: ruleId,
        category: "content_type" as const,
        rule_text: "Feature customer stories and real-world case studies",
        evidence_refs: [createEvidenceRef("editorial_standards", ruleId)],
      });
    }
  }

  return rules;
}

/**
 * Extract brand safety rules
 *
 * Examples:
 * - "Avoid controversial political topics"
 * - "No profanity or offensive language"
 * - "Respect competitor confidentiality"
 */
function extractBrandSafetyRules(documentation: string[]): Array<{
  rule_id: string;
  category: "brand_safety";
  rule_text: string;
  evidence_refs: EvidenceRef[];
}> {
  const rules: Array<{
    rule_id: string;
    category: "brand_safety";
    rule_text: string;
    evidence_refs: EvidenceRef[];
  }> = [];

  for (const doc of documentation) {
    if (!doc) continue;

    const docLower = doc.toLowerCase();

    if (docLower.includes("avoid") && docLower.includes("politics")) {
      const ruleId = stableEvidenceId("brand_guidelines", "safety_politics");
      rules.push({
        rule_id: ruleId,
        category: "brand_safety" as const,
        rule_text: "Avoid divisive political commentary and controversial topics",
        evidence_refs: [createEvidenceRef("brand_guidelines", ruleId)],
      });
    }

    if (docLower.includes("profanity") || docLower.includes("language") || docLower.includes("respectful")) {
      const ruleId = stableEvidenceId("brand_guidelines", "safety_language");
      rules.push({
        rule_id: ruleId,
        category: "brand_safety" as const,
        rule_text: "Maintain professional language; no offensive or derogatory content",
        evidence_refs: [createEvidenceRef("brand_guidelines", ruleId)],
      });
    }

    if (docLower.includes("competitor") || docLower.includes("confidential") || docLower.includes("proprietary")) {
      const ruleId = stableEvidenceId("brand_guidelines", "safety_confidential");
      rules.push({
        rule_id: ruleId,
        category: "brand_safety" as const,
        rule_text: "Protect proprietary information and competitor confidentiality",
        evidence_refs: [createEvidenceRef("brand_guidelines", ruleId)],
      });
    }
  }

  return rules;
}

/**
 * B01.09 phase: Define editorial constitution (governance rules)
 *
 * Input: EcosystemData, B01Input (documentation with brand guidelines, editorial standards, channel policies)
 * Output: EditorialData with governance rules for content (tone, types, brand safety, compliance)
 *
 * CRITICAL BOUNDARIES:
 * 1. Governance rules only (tone, types, safety, compliance)
 * 2. NOT content violation claims (can't assess without viewing actual content)
 * 3. NOT production decisions (templates, formats, creative direction → A-Branch)
 * 4. Agent can RECOMMEND rules; only user-approved rules become canonical
 *
 * EditorialData structure:
 * - constitution_id: unique identifier for this editorial framework
 * - rules: array of governance rules with categories (tone, content_type, brand_safety, compliance)
 * - evidence_refs: extracted from documentation
 * - recommendation: user approval required (adopted=false)
 */
export async function runPhaseB0109(
  ecosystem: EcosystemData,
  input: B01Input | undefined,
  _deps?: B01Deps,
): Promise<EditorialData> {
  const stableId = stableEvidenceId("editorial_constitution", "constitution_v1");
  const constitution_id = `constitution_${stableId}`;
  const rules: EditorialData["rules"] = [];
  const evidenceRefs: EvidenceRef[] = [];

  // Collect documentation sources
  const docSources: string[] = [];
  if (input?.documentation?.brand_guidelines) {
    docSources.push(input.documentation.brand_guidelines);
  }
  if (input?.documentation?.editorial_standards) {
    docSources.push(input.documentation.editorial_standards);
  }
  if (input?.documentation?.channel_policies) {
    docSources.push(input.documentation.channel_policies);
  }

  // Extract rules from documentation (no fabrication)
  const toneRules = extractToneRules(docSources);
  const contentTypeRules = extractContentTypeRules(docSources);
  const brandSafetyRules = extractBrandSafetyRules(docSources);

  // Combine rules
  const allRules = [...toneRules, ...contentTypeRules, ...brandSafetyRules];

  // Add to output
  for (const rule of allRules) {
    rules.push({
      rule_id: rule.rule_id,
      category: rule.category,
      rule_text: rule.rule_text,
      applies_to_channels: undefined, // User can specify; B01 doesn't restrict by channel
      evidence_refs: rule.evidence_refs,
    });

    // Track evidence
    evidenceRefs.push(...rule.evidence_refs);
  }

  // If no rules extracted, provide default fallback
  if (rules.length === 0) {
    const defaultRuleId = stableEvidenceId("brand_guidelines", "default_brand_integrity");
    rules.push({
      rule_id: defaultRuleId,
      category: "brand_safety",
      rule_text: "Maintain brand integrity and professional standards",
      applies_to_channels: undefined,
      evidence_refs: [createEvidenceRef("default_fallback", defaultRuleId)],
    });
  }

  // INFERRED provenance per rule: each rule was extracted via keyword
  // matching against documentation, not directly confirmed (see B01.07's
  // identical rationale for why this is INFERRED, not VERIFIED, despite
  // reading "explicit" documentation).
  const provenance_refs: ProvenanceRef[] = rules.map((rule) => ({
    id: stableEvidenceId("B01.09:provenance", rule.rule_id),
    type: "INFERRED",
    decision_authority: "B01_editorial_extractor",
    timestamp: new Date().toISOString(),
    rationale: `Algorithm extracted ${rule.category} rule "${rule.rule_id}" via keyword match against documentation`,
  }));

  return {
    constitution_id,
    rules,
    evidence_refs: evidenceRefs,
    provenance_refs,
    recommendation: {
      recommendation_id: `rec_editorial_${constitution_id}`,
      source_agent: "B01.09",
      proposal: `Defined editorial constitution with ${rules.length} governance rules. User approval required for canonical commitment.`,
      timestamp: new Date().toISOString(),
      adopted: false, // User must approve before canonical
    },
  };
}
