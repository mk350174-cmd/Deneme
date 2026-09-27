// Bridge 1 — A-Branch P1 (Research) -> B-Branch (Strategy)
//
// Position in the unified flow:  P1.07 --[Gate A1]--> THIS --> B01 / B03
//
// What it does
//   * Re-validates the P1 Research Package with the SAME verifier P2 uses
//     (structure + Gate A1 PACKAGE_APPROVED + full SHA-256 recomputation).
//   * Produces a hash-sealed StrategyInputBundle containing a ready B01Input
//     and B03 audience_sources, plus the research lineage that every later
//     envelope carries.
//
// What it deliberately does NOT do
//   * It does not turn topic research into audience or market "evidence".
//     The digest enters B03 as documentation, which B03 already classifies
//     as HEURISTIC/INFERRED — never as measured audience data.
//   * It does not invent a brand or channels. Those come from the caller
//     (the channel owner). P1's target_context.channel is used only as a
//     named hint when the caller supplies nothing else.

import { parseResearchPackage } from "pipeline2-creative/dist/ingest.js";
import type { B01 } from "b-branch-strategic-control-plane";
import type { ResearchLineage, StrategyInputBundle } from "./contracts.js";
import { UNIFIED_SCHEMA_VERSION } from "./contracts.js";
import { BridgeError, sealEnvelope, shortHash } from "./identity.js";

const BRIDGE = "P1->B";

interface RawVerification {
  claim_id: string;
  status: string;
}
interface RawClaim {
  claim_id: string;
  statement: string;
  dimension: string;
  evidence_refs: string[];
}
interface RawGate {
  gate_id: string;
  state_after: string;
  approval_record_id: string;
}
interface RawSource {
  source_id: string;
  origin: string;
}
interface RawEvidence {
  evidence_id: string;
  source_id: string;
}

export interface StrategyContextOptions {
  /** Channel owner's brand context. Never derived from research. */
  brand?: B01.B01Input["brand_context"];
  /** Channel owner's known channels. */
  channels?: B01.B01Input["known_channels"];
  platforms?: B01.B01Input["known_platforms"];
  documentation?: B01.B01Input["documentation"];
  /** Platform used when only P1's target_context.channel name is available. */
  default_platform?: string;
  /** Max claims placed into the B03 documentation digest. */
  digest_claim_limit?: number;
  now?: () => string;
}

/** Extracts the research lineage from an already-verified package. */
export function researchLineage(raw: unknown): ResearchLineage {
  let pkg;
  try {
    pkg = parseResearchPackage(raw);
  } catch (err) {
    throw new BridgeError(BRIDGE, "RESEARCH_PACKAGE_REJECTED", (err as Error).message);
  }
  const obj = raw as Record<string, unknown>;
  const gates = (obj.gates ?? []) as RawGate[];
  const a1 = gates.find((g) => g.gate_id === "A1" && g.state_after === "PACKAGE_APPROVED");
  if (!a1) throw new BridgeError(BRIDGE, "GATE_A1_MISSING", "no PACKAGE_APPROVED record");
  const identity = obj.identity as { content_hash?: string } | undefined;
  if (!identity?.content_hash) {
    throw new BridgeError(BRIDGE, "P1_IDENTITY_MISSING", "research package carries no canonical identity (P1 T1.1)");
  }
  const verifications = (pkg.verifications ?? []) as RawVerification[];
  const byStatus = (status: string) =>
    verifications.filter((v) => v.status === status).map((v) => v.claim_id).sort();
  return {
    research_package_id: pkg.package_id,
    research_package_sha256: pkg.integrity_hashes.package_sha256,
    research_identity_hash: identity.content_hash,
    project_id: pkg.project_id,
    topic: pkg.research_scope.topic,
    gate_a1_record_id: a1.approval_record_id,
    verified_claim_ids: byStatus("VERIFIED"),
    inferred_claim_ids: byStatus("INFERRED"),
    unknown_claim_ids: byStatus("UNKNOWN"),
  };
}

function researchDigest(raw: Record<string, unknown>, lineage: ResearchLineage, limit: number): string {
  const claims = raw.claims as RawClaim[];
  const sources = new Map((raw.sources as RawSource[]).map((s) => [s.source_id, s.origin]));
  const evidence = new Map((raw.evidence as RawEvidence[]).map((e) => [e.evidence_id, e.source_id]));
  const verified = new Set(lineage.verified_claim_ids);
  const inferred = new Set(lineage.inferred_claim_ids);
  const origins = (c: RawClaim) =>
    [...new Set(c.evidence_refs.map((id) => sources.get(evidence.get(id) ?? "") ?? "").filter(Boolean))].join(", ");

  const lines: string[] = [
    `TOPIC RESEARCH DIGEST — A-Branch P1 package ${lineage.research_package_id} (sha256 ${shortHash(lineage.research_package_sha256)})`,
    "Nature of this document: subject-matter research about the video topic. It is NOT audience measurement,",
    "NOT market data and NOT platform analytics. Do not treat any line below as an observed audience attribute.",
    "",
  ];
  let n = 0;
  for (const c of claims) {
    if (n >= limit) break;
    if (verified.has(c.claim_id)) {
      lines.push(`[VERIFIED] (${c.dimension}) ${c.statement} — claim ${c.claim_id}; sources: ${origins(c) || "n/a"}`);
      n++;
    }
  }
  for (const c of claims) {
    if (n >= limit) break;
    if (inferred.has(c.claim_id)) {
      lines.push(`[INFERRED — not independently cross-checked] (${c.dimension}) ${c.statement} — claim ${c.claim_id}`);
      n++;
    }
  }
  const open = (raw.unresolved_questions as string[]) ?? [];
  if (open.length) {
    lines.push("", "Open research questions (UNKNOWN):", ...open.slice(0, 20).map((q) => `- ${q}`));
  }
  return lines.join("\n");
}

export function buildStrategyInputBundle(raw: unknown, options: StrategyContextOptions = {}): StrategyInputBundle {
  const lineage = researchLineage(raw);
  const obj = raw as Record<string, unknown>;
  const scope = obj.research_scope as {
    topic: string;
    question?: string;
    objective?: string;
    constraints: string[];
    target_context?: { channel?: string; project?: string; editorial_destination?: string };
    output_language?: string;
  };
  const now = options.now ?? (() => new Date().toISOString());
  const created_at = now();

  let known_channels = options.channels;
  if ((!known_channels || known_channels.length === 0) && scope.target_context?.channel) {
    known_channels = [
      {
        name: scope.target_context.channel,
        platform: options.default_platform ?? "YouTube",
        source: "p1:research_scope.target_context.channel",
      },
    ];
  }

  const userInput = [
    `Research topic: ${scope.topic}`,
    scope.question ? `Research question: ${scope.question}` : "",
    scope.objective ? `Objective: ${scope.objective}` : "",
    scope.target_context?.editorial_destination ? `Editorial destination: ${scope.target_context.editorial_destination}` : "",
    scope.output_language ? `Output language: ${scope.output_language}` : "",
    scope.constraints.length ? `Research constraints: ${scope.constraints.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const b01_input: B01.B01Input = {
    input_id: `p1_${lineage.research_package_id}_${shortHash(lineage.research_package_sha256)}`,
    created_at,
    ...(options.brand ? { brand_context: options.brand } : {}),
    ...(known_channels ? { known_channels } : {}),
    ...(options.platforms ? { known_platforms: options.platforms } : {}),
    ...(options.documentation ? { documentation: options.documentation } : {}),
    user_input: userInput,
    user_notes:
      `Derived from A-Branch P1 package ${lineage.research_package_id} (sha256 ${lineage.research_package_sha256}). ` +
      `Claims: ${lineage.verified_claim_ids.length} VERIFIED, ${lineage.inferred_claim_ids.length} INFERRED, ` +
      `${lineage.unknown_claim_ids.length} UNKNOWN. Brand and channels come from the channel owner, not from research.`,
  };

  const body: Omit<StrategyInputBundle, "identity"> = {
    bundle_type: "P1_TO_B_STRATEGY_INPUT",
    schema_version: UNIFIED_SCHEMA_VERSION,
    lineage,
    b01_input,
    b03_audience_sources: {
      documentation: {
        market_research: researchDigest(obj, lineage, options.digest_claim_limit ?? 60),
      },
      user_input: userInput,
    },
    created_at,
  };
  return sealEnvelope<StrategyInputBundle>(body, {
    object_id: `sib_${lineage.research_package_id}_${shortHash(lineage.research_package_sha256)}`,
    object_type: "UNIFIED_STRATEGY_INPUT_BUNDLE",
    version: "v1",
    created_at,
  });
}
