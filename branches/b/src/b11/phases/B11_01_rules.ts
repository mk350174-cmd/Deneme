// B11.01 — Define Compliance Rules

import type { ComplianceRule, B11Deps } from "../types.js";
import type { ProvenanceRef } from "../../b00/provenanceRef.js";
import { canonicalHasher } from "../../b00/hashing.js";

export function defineComplianceRules(deps?: B11Deps): ComplianceRule[] {
  const deps_ = deps || createDefaultB11Deps();
  const hash = deps_.hash || createDefaultB11Deps().hash!;
  const now = deps_.now || (() => new Date().toISOString());

  const rules: ComplianceRule[] = [
    {
      rule_id: hash.stableRuleId("platform", "YouTube_monetization_requirements"),
      rule_category: "platform",
      description: "YouTube channel must meet monetization eligibility requirements",
      scope: ["b06", "b08"],
      required: true,
      rule_basis: "FRAMEWORK_DEFAULT",
      external_verified: false,
      evidence_refs: [],
      provenance: {
        type: "INFERRED",
        decision_authority: "B11_01:defineComplianceRules",
        timestamp: now(),
        rationale: "Built-in compliance framework rule; external applicability/version not verified at runtime",
      },
    },
    {
      rule_id: hash.stableRuleId("brand", "brand_guidelines_compliance"),
      rule_category: "brand",
      description: "All content must comply with brand guidelines and positioning",
      scope: ["b01", "b05"],
      required: true,
      rule_basis: "FRAMEWORK_DEFAULT",
      external_verified: false,
      evidence_refs: [],
      provenance: {
        type: "INFERRED",
        decision_authority: "B11_01:defineComplianceRules",
        timestamp: now(),
        rationale: "Built-in governance framework rule; not evidence of subject compliance",
      },
    },
    {
      rule_id: hash.stableRuleId("legal", "data_privacy_compliance"),
      rule_category: "legal",
      description: "All data collection and usage must comply with GDPR, CCPA, and local regulations",
      scope: ["b08"],
      required: true,
      rule_basis: "FRAMEWORK_DEFAULT",
      external_verified: false,
      evidence_refs: [],
      provenance: {
        type: "INFERRED",
        decision_authority: "B11_01:defineComplianceRules",
        timestamp: now(),
        rationale: "Built-in legal-risk framework rule; jurisdiction/applicability requires evidence and review",
      },
    },
    {
      rule_id: hash.stableRuleId("operational", "quality_standards"),
      rule_category: "operational",
      description: "Content quality must meet operational standards (resolution, audio, etc)",
      scope: ["b06"],
      required: true,
      rule_basis: "FRAMEWORK_DEFAULT",
      external_verified: false,
      evidence_refs: [],
      provenance: {
        type: "INFERRED",
        decision_authority: "B11_01:defineComplianceRules",
        timestamp: now(),
        rationale: "Built-in operational framework rule; not a measured result",
      },
    },
    {
      rule_id: hash.stableRuleId("ethical", "disclosure_transparency"),
      rule_category: "ethical",
      description: "All sponsored or promotional content must clearly disclose relationships",
      scope: ["b01", "b05"],
      required: false,
      rule_basis: "FRAMEWORK_DEFAULT",
      external_verified: false,
      evidence_refs: [],
      provenance: {
        type: "INFERRED",
        decision_authority: "B11_01:defineComplianceRules",
        timestamp: now(),
        rationale: "Built-in ethical framework rule; not a verified external requirement",
      },
    },
  ];

  return rules;
}

function createDefaultB11Deps(): B11Deps {
  return {
    hash: {
      stableRuleId: (category: string, description: string) =>
        `rule_${canonicalHasher.hash(`${category}:${description}`)}`,
      stableCheckId: (ruleId: string) =>
        `check_${canonicalHasher.hash(`${ruleId}`)}`,
    },
    now: () => new Date().toISOString(),
  };
}
