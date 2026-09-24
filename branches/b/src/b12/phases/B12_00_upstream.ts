// B12.00 — Resolve canonical upstream artifacts and aggregate control-plane records.
// B12 is a control plane: it does not re-run domain logic, but it DOES validate
// canonical identity/lineage and the epistemic/governance envelopes it aggregates.
import type { EvidenceRef } from "../../types/entities.js";
import { validateEvidenceSemantics } from "../../b00/evidence.js";
import { validateLineageGraph, type CanonicalModule } from "../../b00/lineage.js";
import type { CanonicalIdentity } from "../../b00/identity.js";
import { validateCanonicalIdentity } from "../../b00/identity.js";
import type { ProvenanceRef } from "../../b00/provenanceRef.js";
import { validateSubjectBoundProvenance } from "../../b00/provenanceRef.js";
import type { GovernanceEvent } from "../../b00/governance.js";
import { validateGovernanceHistory } from "../../b00/governance.js";
import type { Decision, Recommendation } from "../../b00/contracts.js";
import type { BranchVersion, B12Deps, BModule } from "../types.js";

export interface UpstreamAggregation {
  evidence_refs: EvidenceRef[];
  provenance_refs: ProvenanceRef[];
  governance_events: Record<string, GovernanceEvent[]>;
  decisions_made: Decision[];
  recommendations_considered: Recommendation[];
  upstream_audit_trail: Array<{
    module: BModule;
    version: string;
    audit_entries: Array<{ timestamp: string; changed_at: string; changed_by: string; summary: string }>;
  }>;
  missing_modules: string[];
  failed_modules: string[];
  resolved_versions: BranchVersion[];
  semantic_findings: string[];
  operational_findings: string[];
  semantic_validity: "VALID" | "INVALID" | "UNKNOWN";
  operational_readiness: "READY" | "NOT_READY" | "NOT_VERIFIED";
}

async function load(reader: any, module: BModule, version: string): Promise<any> {
  return reader?.[module]?.load ? reader[module].load(version) : null;
}

export async function loadAndAggregateUpstream(
  moduleVersions: BranchVersion[],
  deps?: B12Deps,
): Promise<UpstreamAggregation> {
  const reader = deps?.upstreamReader;
  const evidence: EvidenceRef[] = [];
  const provenance: ProvenanceRef[] = [];
  const governance: Record<string, GovernanceEvent[]> = {};
  const decisions: Decision[] = [];
  const recommendations: Recommendation[] = [];
  const audit: UpstreamAggregation["upstream_audit_trail"] = [];
  const missing: string[] = [];
  const failed: string[] = [];
  const resolved: BranchVersion[] = [];
  const semantic: string[] = [];
  const operational: string[] = [];

  if (!reader) {
    for (const version of moduleVersions) {
      missing.push(`${version.module.toUpperCase()}:${version.version}`);
      resolved.push({ ...version, identity_status: "DECLARED" });
    }
    return {
      evidence_refs: [],
      provenance_refs: [],
      governance_events: {},
      decisions_made: [],
      recommendations_considered: [],
      upstream_audit_trail: [],
      missing_modules: missing,
      failed_modules: [],
      resolved_versions: resolved,
      semantic_findings: ["Upstream canonical states were not loaded; semantic validity cannot be verified"],
      operational_findings: ["No upstream reader was provided; operational readiness is not verified"],
      semantic_validity: "UNKNOWN",
      operational_readiness: "NOT_VERIFIED",
    };
  }

  let invalid = false;
  let unknown = false;
  let operationalReady = true;
  const identities: Partial<Record<CanonicalModule, CanonicalIdentity>> = {};

  for (const declaredVersion of moduleVersions) {
    try {
      const state = await load(reader, declaredVersion.module, declaredVersion.version);
      if (!state) {
        missing.push(`${declaredVersion.module.toUpperCase()}:${declaredVersion.version}`);
        resolved.push({ ...declaredVersion, identity_status: "MISSING" });
        semantic.push(`${declaredVersion.module.toUpperCase()} ${declaredVersion.version}: canonical state missing`);
        unknown = true;
        operationalReady = false;
        continue;
      }

      let resolvedVersion: BranchVersion;
      if (state.identity) {
        const identityValidation = validateCanonicalIdentity(state, state.identity);
        identities[declaredVersion.module.toUpperCase() as CanonicalModule] = state.identity as CanonicalIdentity;
        resolvedVersion = {
          ...declaredVersion,
          canonical_state_id: state.identity.object_id,
          object_type: state.identity.object_type,
          content_hash: state.identity.content_hash,
          identity_status: identityValidation.valid ? "VERIFIED" : "INVALID",
        };
        if (!identityValidation.valid) {
          semantic.push(`${declaredVersion.module.toUpperCase()} ${declaredVersion.version}: canonical identity invalid (${identityValidation.errors.join(",")})`);
          invalid = true;
        }
      } else {
        resolvedVersion = {
          ...declaredVersion,
          canonical_state_id: `${declaredVersion.module}:${declaredVersion.version}`,
          object_type: `${declaredVersion.module.toUpperCase()}_CANONICAL_STATE`,
          content_hash: "UNKNOWN",
          identity_status: "DECLARED",
        };
        semantic.push(`${declaredVersion.module.toUpperCase()} ${declaredVersion.version}: legacy/no canonical identity envelope`);
        unknown = true;
      }
      resolved.push(resolvedVersion);

      for (const ref of state.evidence_refs ?? []) {
        const validation = validateEvidenceSemantics(ref);
        if (!validation.valid) {
          semantic.push(`${declaredVersion.module.toUpperCase()} evidence ${ref?.id ?? "UNKNOWN"}: ${validation.issues.map((x) => x.code).join(",")}`);
          invalid = true;
        }
        if (!evidence.some((existing) => existing.id === ref.id)) evidence.push(ref);
      }

      for (const ref of state.provenance_refs ?? []) {
        const validation = validateSubjectBoundProvenance(ref);
        if (!validation.valid) {
          semantic.push(`${declaredVersion.module.toUpperCase()} provenance ${ref?.id ?? "UNKNOWN"}: ${validation.errors.join(",")}`);
          invalid = true;
        }
        if (!provenance.some((existing) => existing.id === ref.id)) provenance.push(ref);
      }

      for (const [subjectId, events] of Object.entries(state.governance_events ?? {})) {
        const history = events as GovernanceEvent[];
        const validation = validateGovernanceHistory(subjectId, history);
        if (!validation.valid) {
          semantic.push(`${declaredVersion.module.toUpperCase()} governance ${subjectId}: ${validation.errors.join(",")}`);
          invalid = true;
        }
        governance[subjectId] = governance[subjectId] ?? [];
        for (const event of history) {
          if (!governance[subjectId]!.some((existing) => existing.id === event.id)) governance[subjectId]!.push(event);
        }
      }

      for (const decision of state.decisions_made ?? []) {
        if (!decisions.some((existing) => existing.decision_id === decision.decision_id)) decisions.push(decision);
      }
      for (const recommendation of state.recommendations_considered ?? []) {
        if (!recommendations.some((existing) => existing.recommendation_id === recommendation.recommendation_id)) recommendations.push(recommendation);
      }

      if (Array.isArray(state.audit_trail)) {
        audit.push({
          module: declaredVersion.module,
          version: declaredVersion.version,
          audit_entries: state.audit_trail.map((entry: any) => ({
            timestamp: entry.timestamp ?? entry.changed_at ?? "",
            changed_at: entry.changed_at ?? entry.timestamp ?? "",
            changed_by: entry.changed_by ?? entry.actor ?? "unknown",
            summary: entry.summary ?? entry.action ?? "",
          })),
        });
      }

      if (declaredVersion.module === "b11") {
        const statuses = (state.compliance_checks ?? []).map((check: any) => check.status);
        if (statuses.includes("NON_COMPLIANT")) {
          semantic.push("B11 contains evidence-backed NON_COMPLIANT result(s)");
          invalid = true;
        }
        if (statuses.some((status: string) => status === "UNKNOWN" || status === "PENDING") || statuses.length === 0) {
          semantic.push("B11 compliance validity is unresolved (UNKNOWN/PENDING/no checks)");
          unknown = true;
          operationalReady = false;
        }
      }

      if (declaredVersion.module === "b08") {
        const usableRealResult = (state.analytics_results ?? []).some(
          (result: any) => result.source_mode === "REAL" && (result.state === "USABLE" || result.state === "VALIDATED"),
        );
        if (!usableRealResult) {
          operational.push("B08 has no validated/usable REAL analytics result");
          operationalReady = false;
        }
      }
    } catch (error) {
      failed.push(`${declaredVersion.module.toUpperCase()}:${declaredVersion.version}`);
      resolved.push({ ...declaredVersion, identity_status: "MISSING" });
      semantic.push(`${declaredVersion.module.toUpperCase()} ${declaredVersion.version}: load/validation failed: ${error instanceof Error ? error.message : String(error)}`);
      unknown = true;
      operationalReady = false;
    }
  }

  const lineage = validateLineageGraph(identities);
  for (const issue of lineage.issues) {
    semantic.push(`LINEAGE ${issue.code}: ${issue.message}`);
    if (issue.severity === "ERROR") invalid = true;
    else unknown = true;
  }

  const semanticValidity = invalid ? "INVALID" : unknown ? "UNKNOWN" : "VALID";
  return {
    evidence_refs: evidence,
    provenance_refs: provenance,
    governance_events: governance,
    decisions_made: decisions,
    recommendations_considered: recommendations,
    upstream_audit_trail: audit,
    missing_modules: missing,
    failed_modules: failed,
    resolved_versions: resolved,
    semantic_findings: semantic,
    operational_findings: operational,
    semantic_validity: semanticValidity,
    operational_readiness: operationalReady && semanticValidity === "VALID" ? "READY" : "NOT_READY",
  };
}
