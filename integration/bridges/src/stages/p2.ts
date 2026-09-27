// Stage runner — A-Branch P2 (Creative / Production Planning)
//
// Position in the unified flow:
//   research.json (P1, Gate A1) + directive.json (B, G-B) + p2_input.json
//     --> p2Draft  --> p2_draft.json (sealed) + review.md (Turkish)
//     --> human reads review.md
//     --> p2Approve(actor) [Gate A3] --> production_package.json (P3 / to-youtube input)
//
// Same shape as the B orchestrator: propose -> human approves -> commit.
//
// What this runner does
//   * Re-validates the research package (structure, Gate A1, SHA-256) and the
//     directive (seal + same research), then feeds the directive's goals,
//     format and memory into the EXISTING P2 phase functions.
//   * Runs every content phase with ManualCreativeReasoningEngine: the creative
//     content is written by a person (or Claude on their behalf) in
//     p2_input.json. P2 validates, structures, traces and seals it; nothing is
//     generated here.
//   * Records every intermediate human gate (A2 references, P2-B format matrix,
//     AI Director decisions, A2 art direction) ONLY with names written in
//     input.approvals. No name is ever defaulted.
//
// What it deliberately does NOT do
//   * It does not invent research: every claim id must exist in the research
//     package (and P2's own P2.02 check runs as a second line).
//   * It does not relabel anything: directive goals keep their basis
//     (TEMPLATE / HEURISTIC / DEFAULT stay marked), claims keep their P1
//     verification status, and the P2-B format matrix is shown as P2's
//     generic template chain.
//   * It does not modify any P2 contract: the result is the frozen P2.11
//     ProductionPackageHandoff. Runner-only data (scene -> claim links, the
//     format matrix, reference notes) lives in the sealed draft envelope.

import {
  approveArtDirection,
  approveFormatDecisionMatrix,
  approveProductionPackage,
  approveReferences,
  buildFormatDecisionMatrix,
  draftProductionPackage,
  formatDecisionFromApprovedDecision,
  requireProductionPackageApproved,
  runP202Understand,
  runP203Strategize,
  runP206ArtDirection,
  runP207AssetPlanning,
  runP208SceneShotPlanning,
  runP209FlowPromptDirection,
  runP210VoiceSpec,
} from "pipeline2-creative/dist/pipeline.js";
import { ManualCreativeReasoningEngine, type ManualEngineFixtures } from "pipeline2-creative/dist/creativeReasoningEngine.js";
import { selectReferences } from "pipeline2-creative/dist/referenceDiscovery.js";
import { recommend, recordHumanDecision } from "pipeline2-creative/dist/aiDirector.js";
import { buildPromptSpecId, GoogleFlowRenderer, InMemoryPromptLibrary } from "pipeline2-creative/dist/promptArchitecture.js";
import { verifyIdentity } from "pipeline2-creative/dist/canonicalIdentity.js";
import { parseResearchPackage } from "pipeline2-creative/dist/ingest.js";
import type {
  ArtDirection,
  AssetRole,
  ContentStructure,
  CreativeApproach,
  CreativeStrategy,
  Decision,
  FormatDecisionMatrix,
  GateApprovalRecord,
  MemoryRecord,
  ProductionPackageHandoff,
  PromptSpecification,
  Reference,
  Scene,
  Shot,
  StrategyScopeLevel,
} from "pipeline2-creative/dist/types.js";
import { parseProductionPackage, verifyProductionPackageIntegrity } from "pipeline3-production/dist/ingest.js";
import type { CanonicalIdentity, DirectiveItem, ResearchLineage, StrategicCreativeDirective } from "../contracts.js";
import { UNIFIED_SCHEMA_VERSION } from "../contracts.js";
import { BridgeError, assertHumanAuthority, hashValue, sealEnvelope, shortHash, verifyEnvelope } from "../identity.js";
import { assertNoSecrets } from "../safety.js";
import { researchLineage } from "../p1ToB.js";
import { assertDirectiveMatchesResearch, toP2FormatInput, toP2Memory, toP2UserGoals } from "../bToP2.js";

const BRIDGE = "P2-stage";
export const P2_DRAFT_TYPE = "UNIFIED_P2_PRODUCTION_DRAFT";

// ---------------------------------------------------------------- input contract

/** Asset types a Google Flow shot can be planned as (P3-recognised media kinds). */
export const P2_SHOT_ASSET_TYPES = ["VISUAL_IMAGE", "VISUAL_VIDEO", "GRAPHIC"] as const;
export type P2ShotAssetType = (typeof P2_SHOT_ASSET_TYPES)[number];

const ASSET_ROLES: readonly AssetRole[] = [
  "primary_visual", "secondary_visual", "transition", "detail_insert", "texture", "diagram", "map", "chart", "animation", "loop", "background",
];
const CREATIVE_APPROACHES: readonly CreativeApproach[] = [
  "analytical", "documentary", "dramatic", "investigative", "provocative", "poetic", "intellectual", "cinematic", "minimal", "experimental",
];
const SCOPE_LEVELS: readonly StrategyScopeLevel[] = ["project", "series", "video_episode"];
/** Same pattern P3.06 timing uses to read Shot.duration_intention ("3-4s", "2.5s"). */
const DURATION_RE = /(\d+(?:\.\d+)?)\s*(?:-\s*(\d+(?:\.\d+)?))?\s*s/i;

/** One Google Flow prompt per shot (P2.09 Layer 2 PromptSpecification, without the ids P2 stamps). */
export interface P2PromptInput {
  prompt_family: string;
  /** Key of the AI Director decision (input.decisions[].key) this prompt traces to. */
  decision_key: string;
  subject: string;
  composition: string;
  style: string;
  action?: string;
  environment?: string;
  camera?: string;
  lighting?: string;
  motion?: string;
  materials?: string;
  atmosphere?: string;
  continuity?: string;
  negative_constraints: string[];
  axis_tags?: string[];
}

export interface P2ShotInput {
  shot_id: string;
  purpose: string;
  /** Parsed by P3.06 timing: "3-4s", "2.5s", "5s". */
  duration_intention: string;
  camera: { angle: string; movement: string; lens: string; framing: string };
  action: string;
  continuity_anchors?: string[];
  reference_requirements?: string[];
  asset_type: P2ShotAssetType;
  generation_method: string;
  media_properties?: Record<string, unknown>;
  /** Optional multi-asset plan (P2.07 C5); omitted = one requirement from asset_type. */
  assets?: Array<{ role: AssetRole; media_type: P2ShotAssetType; media_properties?: Record<string, unknown> }>;
  prompt: P2PromptInput;
}

export interface P2SceneInput {
  scene_id: string;
  purpose: string;
  narrative_function: string;
  continuity_requirements?: string[];
  /** Research claims this scene shows (claim ids from research.json). */
  claim_ids?: string[];
  shots: P2ShotInput[];
}

export interface P2DecisionInput {
  /** Local key referenced by art_direction.decision_keys and shot prompts. */
  key: string;
  question: string;
  /** What the decision is about (shot id, scene id, "art_direction", ...). */
  target: string;
  options: Array<{ choice: string; rationale?: string }>;
  recommendation: string;
  rationale: string;
}

export interface P2Approvals {
  /** Gate A2 (REFERENCES_PROPOSED -> REFERENCES_APPROVED). */
  references: string;
  /** P2-B Format Decision Matrix review (P2.04) and the format Decision. */
  format_matrix: string;
  /** Gate A2 (ART_DIRECTION_DRAFTED -> ART_DIRECTION_APPROVED). */
  art_direction: string;
  /** AI Director HUMAN DECISION, one name per input.decisions[].key. */
  decisions: Record<string, string>;
}

/** p2_input.json — the creative content a person (or Claude for them) writes for P2. */
export interface P2Input {
  input_type: "P2_CREATIVE_INPUT";
  /** Free-text instructions for whoever fills the file; ignored by the runner. */
  _readme?: string[];
  /** P2.01 reference set (approved as a whole at Gate A2). */
  references: Array<{ source: string; note?: string }>;
  /** P2.02 ContentStructure: key_claims_used must be claim ids from research.json. */
  understanding: ContentStructure;
  /** P2.03 CreativeStrategy. */
  strategy: {
    strategy_id?: string;
    communication_direction: string;
    narrative_direction: string;
    audience_intent?: string;
    creative_priorities: string[];
    creative_approach?: CreativeApproach;
    scope_level?: StrategyScopeLevel;
  };
  /** AI Director decisions (P2.06 decision log). */
  decisions: P2DecisionInput[];
  /** P2.06 ArtDirection. */
  art_direction: { art_direction_id?: string; visual_language: string; checklist: string[]; decision_keys: string[] };
  /** P2.08 scenes with their shots (P2.07 assets and P2.09 Flow prompts per shot). */
  scenes: P2SceneInput[];
  /** P2.10 narration, in reading order. claim_id / scene_id are optional per line. */
  narration: Array<{ text: string; claim_id?: string; scene_id?: string }>;
  /** Optional note stored with the format-matrix review. */
  format_notes?: string;
  approvals: P2Approvals;
}

// ---------------------------------------------------------------- draft envelope

export interface P2ClaimInfo {
  claim_id: string;
  statement: string;
  dimension: string;
  /** P1 verification status (VERIFIED / INFERRED / UNKNOWN / ...), or NO_VERIFICATION_RECORD. */
  status: string;
}

export interface P2Draft {
  draft_type: "P2_PRODUCTION_DRAFT";
  schema_version: typeof UNIFIED_SCHEMA_VERSION;
  project_id: string;
  research: Pick<ResearchLineage, "research_package_id" | "research_package_sha256" | "research_identity_hash" | "gate_a1_record_id" | "topic">;
  directive_hash: string;
  input_hash: string;
  /** Unapproved P2.11 package (Gate A2 records only). Gate A3 is added by p2Approve. */
  package: ProductionPackageHandoff;
  format: { format: string; constraints: string[]; matrix: FormatDecisionMatrix };
  /** Directive goals / memory exactly as fed to P2 (basis labels kept). */
  directive_goals: DirectiveItem[];
  directive_memory: MemoryRecord[];
  compliance_unresolved: string[];
  /** Runner-side lineage for review: scene -> research claims it uses. */
  scene_claims: Record<string, string[]>;
  claims: Record<string, P2ClaimInfo>;
  reference_notes: Record<string, string>;
  strategy: CreativeStrategy;
  content_structure: ContentStructure;
  art_direction: ArtDirection;
  /** hashValue(review markdown) — p2Approve can prove the approver read this exact review. */
  review_sha256: string;
  created_at: string;
  identity: CanonicalIdentity;
}

// ---------------------------------------------------------------- validation

class Problems {
  readonly list: string[] = [];
  add(path: string, msg: string): void {
    this.list.push(`${path}: ${msg}`);
  }
  str(path: string, v: unknown, optional = false): v is string {
    if (v === undefined && optional) return false;
    if (typeof v !== "string" || v.trim().length === 0) {
      this.add(path, "boş olmayan bir metin olmalı");
      return false;
    }
    return true;
  }
  strArr(path: string, v: unknown, optional = false): v is string[] {
    if (v === undefined && optional) return false;
    if (!Array.isArray(v)) {
      this.add(path, "metin dizisi olmalı");
      return false;
    }
    v.forEach((x, i) => this.str(`${path}[${i}]`, x));
    return true;
  }
  obj(path: string, v: unknown, optional = false): v is Record<string, unknown> {
    if (v === undefined && optional) return false;
    if (!v || typeof v !== "object" || Array.isArray(v)) {
      this.add(path, "nesne olmalı");
      return false;
    }
    return true;
  }
  arr(path: string, v: unknown): v is unknown[] {
    if (!Array.isArray(v)) {
      this.add(path, "dizi olmalı");
      return false;
    }
    return true;
  }
  oneOf<T extends string>(path: string, v: unknown, allowed: readonly T[], optional = false): void {
    if (v === undefined && optional) return;
    if (typeof v !== "string" || !allowed.includes(v as T)) this.add(path, `şunlardan biri olmalı: ${allowed.join(", ")}`);
  }
  noExtra(path: string, v: Record<string, unknown>, allowed: string[]): void {
    for (const k of Object.keys(v)) if (!allowed.includes(k)) this.add(`${path}.${k}`, "bilinmeyen alan (yazım hatası mı?)");
  }
}

const TOP_LEVEL_KEYS = ["input_type", "_readme", "references", "understanding", "strategy", "decisions", "art_direction", "scenes", "narration", "format_notes", "approvals"];

/** Structural validation of p2_input.json. Throws P2_INPUT_INVALID listing every problem. */
export function validateP2Input(raw: unknown): P2Input {
  const p = new Problems();
  if (!p.obj("$", raw)) throw new BridgeError(BRIDGE, "P2_INPUT_INVALID", p.list.join("; "));
  const x = raw as Record<string, any>;
  if (x.input_type !== "P2_CREATIVE_INPUT") p.add("$.input_type", 'değeri "P2_CREATIVE_INPUT" olmalı');
  p.noExtra("$", x, TOP_LEVEL_KEYS);
  p.strArr("$._readme", x._readme, true);

  if (p.arr("$.references", x.references)) {
    x.references.forEach((r: any, i: number) => {
      if (p.obj(`$.references[${i}]`, r)) {
        p.str(`$.references[${i}].source`, r.source);
        p.str(`$.references[${i}].note`, r.note, true);
      }
    });
  }
  if (p.obj("$.understanding", x.understanding)) {
    const u = x.understanding;
    p.str("$.understanding.central_idea", u.central_idea);
    p.str("$.understanding.objective", u.objective);
    if (p.strArr("$.understanding.key_claims_used", u.key_claims_used) && u.key_claims_used.length === 0) {
      p.add("$.understanding.key_claims_used", "en az bir araştırma iddiası (claim_id) gerekli");
    }
    p.strArr("$.understanding.narrative_material", u.narrative_material);
  }
  if (p.obj("$.strategy", x.strategy)) {
    const s = x.strategy;
    p.str("$.strategy.strategy_id", s.strategy_id, true);
    p.str("$.strategy.communication_direction", s.communication_direction);
    p.str("$.strategy.narrative_direction", s.narrative_direction);
    p.str("$.strategy.audience_intent", s.audience_intent, true);
    p.strArr("$.strategy.creative_priorities", s.creative_priorities);
    p.oneOf("$.strategy.creative_approach", s.creative_approach, CREATIVE_APPROACHES, true);
    p.oneOf("$.strategy.scope_level", s.scope_level, SCOPE_LEVELS, true);
  }
  const decisionKeys = new Set<string>();
  if (p.arr("$.decisions", x.decisions)) {
    if (x.decisions.length === 0) p.add("$.decisions", "sanat yönetimini temellendiren en az bir AI Director kararı gerekli");
    x.decisions.forEach((d: any, i: number) => {
      const at = `$.decisions[${i}]`;
      if (!p.obj(at, d)) return;
      if (p.str(`${at}.key`, d.key)) {
        if (decisionKeys.has(d.key)) p.add(`${at}.key`, `"${d.key}" iki kez kullanılmış`);
        decisionKeys.add(d.key);
      }
      p.str(`${at}.question`, d.question);
      p.str(`${at}.target`, d.target);
      p.str(`${at}.rationale`, d.rationale);
      p.str(`${at}.recommendation`, d.recommendation);
      if (p.arr(`${at}.options`, d.options)) {
        if (d.options.length === 0) p.add(`${at}.options`, "en az bir seçenek gerekli");
        d.options.forEach((o: any, j: number) => {
          if (p.obj(`${at}.options[${j}]`, o)) {
            p.str(`${at}.options[${j}].choice`, o.choice);
            p.str(`${at}.options[${j}].rationale`, o.rationale, true);
          }
        });
        if (typeof d.recommendation === "string" && !d.options.some((o: any) => o?.choice === d.recommendation)) {
          p.add(`${at}.recommendation`, "options[].choice değerlerinden biri olmalı");
        }
      }
    });
  }
  if (p.obj("$.art_direction", x.art_direction)) {
    const a = x.art_direction;
    p.str("$.art_direction.art_direction_id", a.art_direction_id, true);
    p.str("$.art_direction.visual_language", a.visual_language);
    p.strArr("$.art_direction.checklist", a.checklist);
    if (p.strArr("$.art_direction.decision_keys", a.decision_keys)) {
      if (a.decision_keys.length === 0) p.add("$.art_direction.decision_keys", "en az bir karar anahtarı gerekli");
      a.decision_keys.forEach((k: string, i: number) => {
        if (typeof k === "string" && !decisionKeys.has(k)) p.add(`$.art_direction.decision_keys[${i}]`, `"${k}" decisions[] içinde yok`);
      });
    }
  }
  const sceneIds = new Set<string>();
  const shotIds = new Set<string>();
  if (p.arr("$.scenes", x.scenes)) {
    if (x.scenes.length === 0) p.add("$.scenes", "en az bir sahne gerekli");
    x.scenes.forEach((sc: any, i: number) => {
      const at = `$.scenes[${i}]`;
      if (!p.obj(at, sc)) return;
      if (p.str(`${at}.scene_id`, sc.scene_id)) {
        if (sceneIds.has(sc.scene_id)) p.add(`${at}.scene_id`, `"${sc.scene_id}" iki kez kullanılmış`);
        sceneIds.add(sc.scene_id);
      }
      p.str(`${at}.purpose`, sc.purpose);
      p.str(`${at}.narrative_function`, sc.narrative_function);
      p.strArr(`${at}.continuity_requirements`, sc.continuity_requirements, true);
      p.strArr(`${at}.claim_ids`, sc.claim_ids, true);
      if (!p.arr(`${at}.shots`, sc.shots)) return;
      if (sc.shots.length === 0) p.add(`${at}.shots`, "en az bir çekim gerekli");
      sc.shots.forEach((sh: any, j: number) => {
        const st = `${at}.shots[${j}]`;
        if (!p.obj(st, sh)) return;
        if (p.str(`${st}.shot_id`, sh.shot_id)) {
          if (shotIds.has(sh.shot_id)) p.add(`${st}.shot_id`, `"${sh.shot_id}" iki kez kullanılmış`);
          shotIds.add(sh.shot_id);
        }
        p.str(`${st}.purpose`, sh.purpose);
        if (p.str(`${st}.duration_intention`, sh.duration_intention) && !DURATION_RE.test(sh.duration_intention)) {
          p.add(`${st}.duration_intention`, 'saniye cinsinden olmalı, ör. "3-4s" veya "2.5s" (P3 zamanlaması bunu okur)');
        }
        if (p.obj(`${st}.camera`, sh.camera)) for (const f of ["angle", "movement", "lens", "framing"]) p.str(`${st}.camera.${f}`, sh.camera[f]);
        p.str(`${st}.action`, sh.action);
        p.strArr(`${st}.continuity_anchors`, sh.continuity_anchors, true);
        p.strArr(`${st}.reference_requirements`, sh.reference_requirements, true);
        p.oneOf(`${st}.asset_type`, sh.asset_type, P2_SHOT_ASSET_TYPES);
        p.str(`${st}.generation_method`, sh.generation_method);
        p.obj(`${st}.media_properties`, sh.media_properties, true);
        if (sh.assets !== undefined && p.arr(`${st}.assets`, sh.assets)) {
          sh.assets.forEach((a: any, k: number) => {
            if (!p.obj(`${st}.assets[${k}]`, a)) return;
            p.oneOf(`${st}.assets[${k}].role`, a.role, ASSET_ROLES);
            p.oneOf(`${st}.assets[${k}].media_type`, a.media_type, P2_SHOT_ASSET_TYPES);
            p.obj(`${st}.assets[${k}].media_properties`, a.media_properties, true);
          });
        }
        if (p.obj(`${st}.prompt`, sh.prompt)) {
          const pr = sh.prompt;
          const pt = `${st}.prompt`;
          p.noExtra(pt, pr, ["prompt_family", "decision_key", "subject", "composition", "style", "action", "environment", "camera", "lighting", "motion", "materials", "atmosphere", "continuity", "negative_constraints", "axis_tags"]);
          for (const f of ["prompt_family", "subject", "composition", "style"]) p.str(`${pt}.${f}`, pr[f]);
          for (const f of ["action", "environment", "camera", "lighting", "motion", "materials", "atmosphere", "continuity"]) p.str(`${pt}.${f}`, pr[f], true);
          p.strArr(`${pt}.negative_constraints`, pr.negative_constraints);
          p.strArr(`${pt}.axis_tags`, pr.axis_tags, true);
          if (p.str(`${pt}.decision_key`, pr.decision_key) && !decisionKeys.has(pr.decision_key)) {
            p.add(`${pt}.decision_key`, `"${pr.decision_key}" decisions[] içinde yok`);
          }
        }
      });
    });
  }
  if (p.arr("$.narration", x.narration)) {
    if (x.narration.length === 0) p.add("$.narration", "en az bir anlatım satırı gerekli");
    x.narration.forEach((l: any, i: number) => {
      if (!p.obj(`$.narration[${i}]`, l)) return;
      p.str(`$.narration[${i}].text`, l.text);
      p.str(`$.narration[${i}].claim_id`, l.claim_id, true);
      if (p.str(`$.narration[${i}].scene_id`, l.scene_id, true) && !sceneIds.has(l.scene_id)) {
        p.add(`$.narration[${i}].scene_id`, `"${l.scene_id}" scenes[] içinde yok`);
      }
    });
  }
  p.str("$.format_notes", x.format_notes, true);
  if (p.obj("$.approvals", x.approvals)) {
    p.noExtra("$.approvals", x.approvals, ["references", "format_matrix", "art_direction", "decisions"]);
    if (x.approvals.decisions !== undefined && p.obj("$.approvals.decisions", x.approvals.decisions)) {
      for (const k of Object.keys(x.approvals.decisions)) if (!decisionKeys.has(k)) p.add(`$.approvals.decisions.${k}`, "decisions[] içinde böyle bir karar yok");
    }
  }
  if (p.list.length) throw new BridgeError(BRIDGE, "P2_INPUT_INVALID", `p2_input.json geçersiz — ${p.list.join("; ")}`);
  return x as P2Input;
}

/**
 * Every human gate before the final package. Names only from input.approvals,
 * validated like every other gate (no placeholder / PREVIEW / system).
 */
function requireApprovals(input: P2Input): { references: string; format_matrix: string; art_direction: string; decisions: Record<string, string> } {
  const missing: string[] = [];
  const name = (value: unknown, gate: string): string => {
    try {
      return assertHumanAuthority(BRIDGE, value, gate);
    } catch {
      missing.push(`${gate} (şu an: ${JSON.stringify(value ?? null)})`);
      return "";
    }
  };
  const a = input.approvals ?? ({} as P2Approvals);
  const out = {
    references: name(a.references, "Gate A2 referans onayı [approvals.references]"),
    format_matrix: name(a.format_matrix, "P2-B format karar matrisi onayı [approvals.format_matrix]"),
    art_direction: name(a.art_direction, "Gate A2 sanat yönetimi onayı [approvals.art_direction]"),
    decisions: {} as Record<string, string>,
  };
  for (const d of input.decisions) {
    out.decisions[d.key] = name(a.decisions?.[d.key], `AI Director kararı "${d.key}" [approvals.decisions.${d.key}]`);
  }
  if (missing.length) {
    throw new BridgeError(
      BRIDGE,
      "P2_APPROVAL_REQUIRED",
      `şu insan kapıları isimli bir onaylayan olmadan geçilemez: ${missing.join("; ")}. ` +
        "Onaylayan kişinin adını kendiniz yazın; yer tutucu (<adınız>), PREVIEW veya system kabul edilmez.",
    );
  }
  return out;
}

// ---------------------------------------------------------------- helpers

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function wrapP2<T>(stage: string, fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof BridgeError) throw err;
    const e = err as Error;
    throw new BridgeError(BRIDGE, "P2_REJECTED", `${stage}: ${e.name}: ${e.message}`);
  }
}

async function wrapP2Async<T>(stage: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof BridgeError) throw err;
    const e = err as Error;
    throw new BridgeError(BRIDGE, "P2_REJECTED", `${stage}: ${e.name}: ${e.message}`);
  }
}

function packageSections(pkg: ProductionPackageHandoff): Record<string, unknown> {
  return {
    scenes: pkg.scenes,
    shots: pkg.shots,
    asset_requirements: pkg.asset_requirements,
    prompts: pkg.prompts,
    decision_log: pkg.decision_log,
    voice_script: pkg.voice_script,
    pronunciation_flags: pkg.pronunciation_flags,
    voice_lines: pkg.voice_lines,
  };
}

function durationSeconds(intention: string): number {
  const m = DURATION_RE.exec(intention);
  if (!m) return 0;
  const lo = Number(m[1]);
  const hi = m[2] !== undefined ? Number(m[2]) : lo;
  return (lo + hi) / 2;
}

// ---------------------------------------------------------------- step 1: draft

export interface P2DraftResult {
  draft: P2Draft;
  review: string;
}

export async function p2Draft(params: { research: unknown; directive: unknown; input: P2Input; now?: () => string }): Promise<P2DraftResult> {
  const now = params.now ?? (() => new Date().toISOString());
  const research = clone(params.research);
  const directive = clone(params.directive) as StrategicCreativeDirective;
  const input = validateP2Input(clone(params.input));
  assertNoSecrets(input, "p2_input");

  // Gate A1 (structure + PACKAGE_APPROVED + SHA-256) and G-B (directive for this very research).
  const lineage = researchLineage(research);
  assertDirectiveMatchesResearch(directive, research);
  const pkg = wrapP2("P1->P2 ingest", () => parseResearchPackage(research));

  // Research claims: P2 never invents one.
  const verification = new Map((pkg.verifications ?? []).map((v) => [v.claim_id, v.status]));
  const claims: Record<string, P2ClaimInfo> = {};
  for (const c of pkg.claims) {
    claims[c.claim_id] = { claim_id: c.claim_id, statement: c.statement, dimension: c.dimension, status: verification.get(c.claim_id) ?? "NO_VERIFICATION_RECORD" };
  }
  const unknownClaims: string[] = [];
  const keyClaims = new Set(input.understanding.key_claims_used);
  const notInUnderstanding: string[] = [];
  const checkClaim = (id: string, where: string, mustBeKey: boolean) => {
    if (!claims[id]) unknownClaims.push(`${where} → "${id}"`);
    else if (mustBeKey && !keyClaims.has(id)) notInUnderstanding.push(`${where} → "${id}"`);
  };
  input.understanding.key_claims_used.forEach((id, i) => checkClaim(id, `understanding.key_claims_used[${i}]`, false));
  input.scenes.forEach((s, i) => (s.claim_ids ?? []).forEach((id, j) => checkClaim(id, `scenes[${i}].claim_ids[${j}]`, true)));
  input.narration.forEach((l, i) => l.claim_id !== undefined && checkClaim(l.claim_id, `narration[${i}].claim_id`, true));
  if (unknownClaims.length) {
    throw new BridgeError(
      BRIDGE,
      "P2_UNKNOWN_CLAIM",
      `araştırma paketinde (${lineage.research_package_id}) olmayan iddia kimlikleri: ${unknownClaims.join("; ")}. ` +
        "P2 araştırma uyduramaz — yalnızca research.json'daki claim_id'leri kullanın.",
    );
  }
  // Spoken narration states facts: a claim P1 could not source (UNKNOWN / no verification)
  // must not be narrated. Scenes may still reference it as context (flagged ⚠ in the review).
  const unverifiedSpoken = input.narration
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => l.claim_id !== undefined && claims[l.claim_id] && !["VERIFIED", "INFERRED"].includes(claims[l.claim_id]!.status))
    .map(({ l, i }) => `narration[${i}] → "${l.claim_id}" (${claims[l.claim_id!]!.status})`);
  if (unverifiedSpoken.length) {
    throw new BridgeError(
      BRIDGE,
      "P2_UNVERIFIED_NARRATION",
      `kaynağı doğrulanmamış iddialar anlatımda kesin bilgi olarak kullanılamaz: ${unverifiedSpoken.join("; ")}. ` +
        "Ya P1'de kaynak bulup iddiayı INFERRED/VERIFIED yapın, ya da bu satırı çıkarın/claim_id'siz yeniden yazın.",
    );
  }
  if (notInUnderstanding.length) {
    throw new BridgeError(
      BRIDGE,
      "P2_INPUT_INVALID",
      `sahne/anlatımda kullanılan ama understanding.key_claims_used listesinde olmayan iddialar: ${notInUnderstanding.join("; ")}`,
    );
  }

  // Every intermediate human gate needs a named approver BEFORE anything is recorded.
  const approvals = requireApprovals(input);

  // Directive -> P2 inputs (labels preserved by the bToP2 adapters).
  const userGoals = toP2UserGoals(directive);
  const formatInput = toP2FormatInput(directive);
  const memory = toP2Memory(directive) as MemoryRecord[];

  // ---- P2.01 references + Gate A2 (transition 1)
  const references: Reference[] = selectReferences({ candidates: [], approvedCandidateIds: [], manuallyAddedSources: input.references.map((r) => r.source) });
  const referenceNotes: Record<string, string> = {};
  input.references.forEach((r, i) => {
    if (r.note) referenceNotes[references[i]!.reference_id] = r.note;
  });
  const refIds = new Set<string>();
  for (const r of references) {
    if (refIds.has(r.reference_id)) throw new BridgeError(BRIDGE, "P2_INPUT_INVALID", `references: "${r.source}" iki kez verilmiş`);
    refIds.add(r.reference_id);
  }
  const { gate: referencesGate } = wrapP2("Gate A2 references", () => approveReferences(references, approvals.references));

  // ---- AI Director decisions (HUMAN DECISION recorded under the named approver)
  const decisionByKey = new Map<string, Decision>();
  for (const d of input.decisions) {
    const rec = wrapP2(`AI Director ${d.key}`, () =>
      recommend({ question: d.question, targetId: d.target, optionsConsidered: d.options, recommendation: d.recommendation, rationale: d.rationale }),
    );
    decisionByKey.set(d.key, wrapP2(`AI Director ${d.key}`, () => recordHumanDecision(rec, approvals.decisions[d.key]!, "approved")));
  }

  // ---- P2.04 format: the committed B06 format, confirmed by a human through the P2-B matrix.
  const formatRecommendation = wrapP2("P2.04 format", () =>
    recommend({
      question: "format_choice",
      targetId: pkg.project_id,
      optionsConsidered: [{ choice: formatInput.format, rationale: `B06 format rule in committed branch ${shortHash(directive.branch_state.content_hash)}` }],
      recommendation: formatInput.format,
      rationale: `Format carried from the owner-committed B strategy (directive ${shortHash(directive.identity.content_hash)}); aspect ratio ${directive.format.aspect_ratio}.`,
    }),
  );
  const formatDecision = wrapP2("P2.04 format", () => recordHumanDecision(formatRecommendation, approvals.format_matrix, "approved"));
  const decidedFormat = wrapP2("P2.04 format", () => formatDecisionFromApprovedDecision(formatDecision, formatInput.constraints));
  const matrix = wrapP2("P2-B format matrix", () =>
    approveFormatDecisionMatrix(buildFormatDecisionMatrix(formatDecision.decision_id, decidedFormat.format, decidedFormat.constraints), approvals.format_matrix, input.format_notes),
  );

  const decisionLog = [formatDecision, ...decisionByKey.values()];
  const seen = new Set<string>();
  for (const d of decisionLog) {
    if (seen.has(d.decision_id)) throw new BridgeError(BRIDGE, "P2_INPUT_INVALID", `iki karar aynı question+target çiftine sahip (${d.question} / ${d.decision_id})`);
    seen.add(d.decision_id);
  }

  // ---- Engine fixtures (content written in p2_input.json)
  const stableSuffix = shortHash(hashValue({ p: pkg.project_id, r: lineage.research_package_sha256 }), 12);
  const strategy: CreativeStrategy = { ...input.strategy, strategy_id: input.strategy.strategy_id ?? `strat_${stableSuffix}` };
  const artDirection: ArtDirection = {
    art_direction_id: input.art_direction.art_direction_id ?? `art_${stableSuffix}`,
    visual_language: input.art_direction.visual_language,
    checklist: input.art_direction.checklist,
    decision_ids: input.art_direction.decision_keys.map((k) => decisionByKey.get(k)!.decision_id),
  };
  const scenes: Scene[] = input.scenes.map((s) => ({
    scene_id: s.scene_id,
    purpose: s.purpose,
    shots: s.shots.map((sh) => sh.shot_id),
    continuity_requirements: s.continuity_requirements ?? [],
    narrative_function: s.narrative_function,
  }));
  const shots: Shot[] = input.scenes.flatMap((s) =>
    s.shots.map((sh) => ({
      shot_id: sh.shot_id,
      scene_id: s.scene_id,
      purpose: sh.purpose,
      duration_intention: sh.duration_intention,
      camera: sh.camera,
      action: sh.action,
      continuity_anchors: sh.continuity_anchors ?? [],
      reference_requirements: sh.reference_requirements ?? [],
      asset_type: sh.asset_type,
      generation_method: sh.generation_method,
    })),
  );
  const promptSpecsByShotId: Record<string, PromptSpecification> = {};
  for (const s of input.scenes) {
    for (const sh of s.shots) {
      const { decision_key, axis_tags, ...rest } = sh.prompt;
      promptSpecsByShotId[sh.shot_id] = {
        ...rest,
        prompt_spec_id: buildPromptSpecId(sh.shot_id, sh.prompt.prompt_family),
        version: 1,
        axis_tags: axis_tags ?? [],
        // asset_requirement_id is stamped by runP209FlowPromptDirection (T1.7).
        traceable_to: { shot_id: sh.shot_id, asset_requirement_id: "", decision_id: decisionByKey.get(decision_key)!.decision_id },
      };
    }
  }
  const fixtures: ManualEngineFixtures = {
    contentStructure: input.understanding,
    creativeStrategy: strategy,
    artDirection,
    decisionLog,
    scenes,
    shots,
    promptSpecsByShotId,
  };
  const engine = new ManualCreativeReasoningEngine(fixtures);

  // ---- P2.02 .. P2.10 through the real phase functions
  const contentStructure = await wrapP2Async("P2.02", () => runP202Understand(engine, pkg, references));
  const creativeStrategy = await wrapP2Async("P2.03", () => runP203Strategize(engine, contentStructure, userGoals, memory));
  const { artDirection: directed, decisionLog: engineDecisions } = await wrapP2Async("P2.06", () => runP206ArtDirection(engine, creativeStrategy, references, memory));
  const { gate: artDirectionGate } = wrapP2("Gate A2 art direction", () => approveArtDirection(directed, approvals.art_direction, [referencesGate]));
  const planned = await wrapP2Async("P2.08", () => runP208SceneShotPlanning(engine, creativeStrategy, directed));
  const mediaProps: Record<string, Record<string, unknown>> = {};
  const assetPlans: Record<string, Array<{ role: AssetRole; mediaType: string; mediaProperties: Record<string, unknown> }>> = {};
  for (const s of input.scenes) {
    for (const sh of s.shots) {
      if (sh.media_properties) mediaProps[sh.shot_id] = sh.media_properties;
      if (sh.assets?.length) assetPlans[sh.shot_id] = sh.assets.map((a) => ({ role: a.role, mediaType: a.media_type, mediaProperties: a.media_properties ?? {} }));
    }
  }
  const assetRequirements = wrapP2("P2.07", () => runP207AssetPlanning(planned.shots, references, mediaProps, assetPlans));
  const prompts = await wrapP2Async("P2.09", () =>
    runP209FlowPromptDirection(engine, planned.shots, directed, assetRequirements, new InMemoryPromptLibrary(), new GoogleFlowRenderer()),
  );
  const voice = wrapP2("P2.10", () => runP210VoiceSpec(input.narration.map((l) => (l.claim_id ? { text: l.text, claim_id: l.claim_id } : { text: l.text }))));

  // Timestamps of records made in this run follow `now` (deterministic reruns; not part of any id).
  const stampedAt = now();
  for (const d of engineDecisions) d.timestamp = stampedAt;
  for (const p of prompts) p.rendered.rendered_at = stampedAt;
  const gates: GateApprovalRecord[] = [
    { ...referencesGate, timestamp: stampedAt },
    { ...artDirectionGate, timestamp: stampedAt },
  ];
  const approvedMatrix: FormatDecisionMatrix = { ...matrix, review_timestamp: stampedAt };

  // ---- P2.11 Reverse QA + draft (unapproved)
  const draftPackage = clone(
    wrapP2("P2.11", () =>
      draftProductionPackage({
        pkg,
        contentStructure,
        decisionLog: engineDecisions,
        artDirection: directed,
        scenes: planned.scenes,
        shots: planned.shots,
        assetRequirements,
        prompts,
        voiceScript: voice.voice_script,
        pronunciationFlags: voice.pronunciation_flags,
        voiceLines: voice.voice_lines,
        gates,
      }),
    ),
  );
  if (draftPackage.research_package_content_hash !== lineage.research_package_sha256) {
    throw new BridgeError(BRIDGE, "LINEAGE_BROKEN", "P2 draft does not carry the research hash it was built from");
  }

  // Scene -> claims (runner-side lineage for the review; the frozen Scene contract has no claim field).
  const sceneClaims: Record<string, string[]> = {};
  for (const s of input.scenes) sceneClaims[s.scene_id] = [...(s.claim_ids ?? [])];
  for (const l of input.narration) {
    if (l.scene_id && l.claim_id && !sceneClaims[l.scene_id]!.includes(l.claim_id)) sceneClaims[l.scene_id]!.push(l.claim_id);
  }
  const usedClaims: Record<string, P2ClaimInfo> = {};
  for (const id of new Set([...input.understanding.key_claims_used, ...Object.values(sceneClaims).flat(), ...input.narration.flatMap((l) => (l.claim_id ? [l.claim_id] : []))])) {
    usedClaims[id] = claims[id]!;
  }

  const body = clone({
    draft_type: "P2_PRODUCTION_DRAFT" as const,
    schema_version: UNIFIED_SCHEMA_VERSION,
    project_id: pkg.project_id,
    research: {
      research_package_id: lineage.research_package_id,
      research_package_sha256: lineage.research_package_sha256,
      research_identity_hash: lineage.research_identity_hash,
      gate_a1_record_id: lineage.gate_a1_record_id,
      topic: lineage.topic,
    },
    directive_hash: directive.identity.content_hash,
    input_hash: hashValue(input),
    package: draftPackage,
    format: { format: decidedFormat.format, constraints: decidedFormat.constraints, matrix: approvedMatrix },
    directive_goals: directive.user_goals,
    directive_memory: memory,
    compliance_unresolved: directive.compliance?.unresolved ?? [],
    scene_claims: sceneClaims,
    claims: usedClaims,
    reference_notes: referenceNotes,
    strategy: creativeStrategy,
    content_structure: contentStructure,
    art_direction: directed,
    created_at: stampedAt,
  });
  const review = p2ReviewMarkdown(body);
  const withReview = { ...body, review_sha256: hashValue(review) };
  assertNoSecrets(withReview, "p2_draft");
  const draft = sealEnvelope<P2Draft>(withReview, {
    object_id: `p2d_${shortHash(draftPackage.identity.content_hash)}`,
    object_type: P2_DRAFT_TYPE,
    version: "v1",
    created_at: stampedAt,
  });
  return { draft, review };
}

// ---------------------------------------------------------------- step 2: approve (Gate A3)

export function p2Approve(params: { draft: unknown; actor: string; review?: string; now?: () => string }): ProductionPackageHandoff {
  const draft = clone(params.draft) as P2Draft;
  try {
    verifyEnvelope(BRIDGE, draft, P2_DRAFT_TYPE);
  } catch (err) {
    const code = err instanceof BridgeError ? err.code : "UNKNOWN";
    if (code === "WRONG_ENVELOPE_TYPE" || code === "MISSING_IDENTITY") throw err;
    throw new BridgeError(
      BRIDGE,
      "P2_DRAFT_CHANGED",
      `taslak incelemeden sonra değiştirilmiş ya da bu kurulumda üretilmemiş (${code}). Elle düzenlemeyin; p2_input.json'u değiştirip taslağı yeniden üretin. — ${(err as Error).message}`,
    );
  }
  if (draft.draft_type !== "P2_PRODUCTION_DRAFT") throw new BridgeError(BRIDGE, "WRONG_ENVELOPE_TYPE", "not a P2 production draft");
  if (params.review !== undefined && hashValue(params.review) !== draft.review_sha256) {
    throw new BridgeError(BRIDGE, "P2_REVIEW_MISMATCH", "onaylanan inceleme metni bu taslağın incelemesi değil — taslakla birlikte üretilen review.md'yi okuyun");
  }

  const pkg = draft.package;
  const identity = verifyIdentity(pkg.identity, packageSections(pkg));
  if (!identity.valid) throw new BridgeError(BRIDGE, "P2_DRAFT_CHANGED", `üretim paketi içeriği kimlik hash'iyle tutmuyor (${shortHash(identity.actual)} ≠ ${shortHash(identity.expected)})`);
  wrapP2("P2 package integrity", () => verifyProductionPackageIntegrity(pkg as never));
  if (pkg.research_package_content_hash !== draft.research.research_package_sha256) {
    throw new BridgeError(BRIDGE, "LINEAGE_BROKEN", "taslaktaki paket başka bir araştırmadan");
  }
  for (const [state, what] of [["REFERENCES_APPROVED", "referans"], ["ART_DIRECTION_APPROVED", "sanat yönetimi"]] as const) {
    if (!pkg.user_approval_state.some((g) => g.gate_id === "A2" && g.state_after === state)) {
      throw new BridgeError(BRIDGE, "P2_APPROVAL_REQUIRED", `Gate A2 ${what} onayı taslakta yok`);
    }
  }
  if (pkg.user_approval_state.some((g) => g.gate_id === "A3")) {
    throw new BridgeError(BRIDGE, "P2_ALREADY_APPROVED", "bu taslakta zaten bir Gate A3 kaydı var");
  }

  let actor: string;
  try {
    actor = assertHumanAuthority(BRIDGE, params.actor, "Gate A3");
  } catch {
    throw new BridgeError(
      BRIDGE,
      "P2_APPROVAL_REQUIRED",
      `Gate A3 (üretim paketi onayı) isimli bir onaylayan ister (verilen: ${JSON.stringify(params.actor ?? "")}). Yer tutucu, PREVIEW veya system kabul edilmez.`,
    );
  }

  const { handoff } = wrapP2("Gate A3", () => approveProductionPackage(pkg, actor));
  if (params.now) handoff.user_approval_state[handoff.user_approval_state.length - 1]!.timestamp = params.now();
  wrapP2("Gate A3", () => requireProductionPackageApproved(handoff));
  const out = clone(handoff);

  // Accept exactly what P3 / to-youtube will accept.
  let parsed;
  try {
    parsed = parseProductionPackage(out);
  } catch (err) {
    throw new BridgeError(BRIDGE, "PRODUCTION_PACKAGE_REJECTED", (err as Error).message);
  }
  if (parsed.research_package_content_hash !== draft.research.research_package_sha256) {
    throw new BridgeError(BRIDGE, "LINEAGE_BROKEN", "onaylı paket başka bir araştırmaya işaret ediyor");
  }
  assertNoSecrets(out, "production_package");
  return out;
}

// ---------------------------------------------------------------- review (Turkish)

const WEAK_BASIS = new Set(["HEURISTIC", "TEMPLATE", "DEFAULT"]);

function claimBadge(c: P2ClaimInfo | undefined, id: string): string {
  if (!c) return `\`${id}\` — **araştırmada yok**`;
  const warn = c.status === "VERIFIED" ? "" : c.status === "INFERRED" ? " ⚠ bağımsız doğrulanmamış" : " ⚠ DOĞRULANMAMIŞ — kesin bilgi gibi anlatmayın";
  return `\`${c.claim_id}\` **${c.status}**${warn} — ${c.statement}`;
}

function md(text: string): string {
  return text.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
}

/** Builds the Turkish review for a draft body (everything except review_sha256 / identity). */
export function p2ReviewMarkdown(d: Omit<P2Draft, "review_sha256" | "identity">): string {
  const pkg = d.package;
  const L: string[] = [];
  const shotsById = new Map(pkg.shots.map((s) => [s.shot_id, s]));
  const reqsByShot = new Map<string, typeof pkg.asset_requirements>();
  for (const r of pkg.asset_requirements) reqsByShot.set(r.shot_id, [...(reqsByShot.get(r.shot_id) ?? []), r]);
  const promptsByShot = new Map<string, typeof pkg.prompts>();
  for (const p of pkg.prompts) promptsByShot.set(p.spec.traceable_to.shot_id, [...(promptsByShot.get(p.spec.traceable_to.shot_id) ?? []), p]);
  const decisions = new Map(pkg.decision_log.map((x) => [x.decision_id, x]));
  const total = pkg.shots.reduce((s, sh) => s + durationSeconds(sh.duration_intention), 0);

  L.push(`# P2 kreatif taslak — inceleme (Gate A3 bekliyor)`);
  L.push("");
  L.push(`- Konu: **${d.research.topic}** · proje \`${d.project_id}\``);
  L.push(`- Araştırma: \`${d.research.research_package_id}\` · sha256 \`${shortHash(d.research.research_package_sha256)}\` · Gate A1 \`${d.research.gate_a1_record_id}\``);
  L.push(`- Directive: \`${shortHash(d.directive_hash)}\` · format **${d.format.format}**`);
  L.push(`- Üretim paketi taslağı: \`${pkg.package_id}\` · içerik hash \`${shortHash(pkg.identity.content_hash)}\``);
  L.push(`- ${pkg.scenes.length} sahne · ${pkg.shots.length} çekim · planlanan toplam süre ≈ **${Math.round(total * 10) / 10} sn** (çekim sürelerinin orta noktası; gerçek süreyi P3'te anlatım belirler)`);
  L.push("");

  L.push("## Kapılar");
  L.push("");
  L.push("Geçilen (adını sizin yazdığınız kişiler):");
  for (const g of pkg.user_approval_state) L.push(`- ✔ ${g.gate_id} ${g.state_before} → ${g.state_after} — ${g.actor}`);
  L.push(`- ✔ P2-B format karar matrisi — ${d.format.matrix.review_actor}`);
  for (const x of pkg.decision_log) L.push(`- ✔ AI Director kararı "${x.question}" (${x.recommendation}) — ${x.approving_actor}`);
  L.push("");
  L.push("Hâlâ açık:");
  L.push("- ☐ **Gate A3** — bu üretim paketinin onayı (siz; bu incelemeyi okuduktan sonra, taslak dosyasını değiştirmeden, kendi adınızla)");
  L.push("- ☐ Gate A4 — Google Flow'da üretilen görsellerin/videoların P3'e teslimi");
  L.push("- ☐ Gate A5 — anlatım önizlemesinin onayı (P3)");
  L.push("- ☐ Gate A6 — ses/zamanlama belirsizlikleri varsa çözümü (P3)");
  L.push("- ☐ Gate A7 — final QA onayı (P3)");
  L.push("- ☐ Gate F1 — bitirme (altyazı/müzik) yapılırsa bitmiş videonun onayı");
  for (const u of d.compliance_unresolved) L.push(`- ☐ B11 uyum kontrolü henüz kurulmadı: ${u}`);
  L.push("");

  L.push("## Epistemik etiketler");
  L.push("");
  L.push("- **VERIFIED**: P1'de bağımsız kaynaklarla doğrulanmış iddia. **INFERRED**: tek kaynaktan çıkarım, bağımsız doğrulanmamış. **UNKNOWN**: kanıt yok — kesin bilgi gibi anlatılmamalı.");
  L.push("- **TEMPLATE / HEURISTIC / DEFAULT**: B'nin şablon/sezgisel/varsayılan maddeleri — kanıt ya da insan kararı değildir.");
  L.push("- Format karar matrisi (P2-B) P2'nin genel şablon zinciridir (TEMPLATE); içeriğe özel ölçüm değildir.");
  L.push("- Sahneler, çekimler, Flow prompt'ları ve anlatım metni p2_input.json'da yazılan yaratıcı içeriktir; P2 bunları doğrular ve araştırma iddialarına bağlar, kendisi üretmez.");
  const unverified = Object.values(d.claims).filter((c) => c.status !== "VERIFIED");
  if (unverified.length) {
    L.push("");
    L.push("⚠ Kullanılan ama VERIFIED olmayan iddialar:");
    for (const c of unverified) L.push(`- ${claimBadge(c, c.claim_id)}`);
  }
  L.push("");

  L.push("## Strateji girdileri (B directive)");
  L.push("");
  for (const g of d.directive_goals) L.push(`- [${g.basis}${WEAK_BASIS.has(g.basis) ? " — kanıta dayalı değil" : ""}] ${g.text}`);
  if (d.format.constraints.length) {
    L.push("");
    L.push("Format kısıtları:");
    for (const c of d.format.constraints) L.push(`- ${c}`);
  }
  if (d.directive_memory.length) {
    L.push("");
    L.push("P2 hafızası (marka / kaçınılacaklar):");
    for (const m of d.directive_memory) L.push(`- ${m.bucket}${m.locked ? " 🔒" : ""}: ${m.content}`);
  }
  L.push("");

  L.push("## İçerik anlayışı ve strateji");
  L.push("");
  L.push(`- Ana fikir: ${d.content_structure.central_idea}`);
  L.push(`- Amaç: ${d.content_structure.objective}`);
  L.push(`- İletişim yönü: ${d.strategy.communication_direction}`);
  L.push(`- Anlatı yönü: ${d.strategy.narrative_direction}`);
  if (d.strategy.creative_approach) L.push(`- Yaklaşım: ${d.strategy.creative_approach}`);
  L.push(`- Öncelikler: ${d.strategy.creative_priorities.join("; ")}`);
  L.push("");
  L.push("Kullanılan araştırma iddiaları:");
  for (const id of d.content_structure.key_claims_used) L.push(`- ${claimBadge(d.claims[id], id)}`);
  L.push("");

  L.push("## Sanat yönetimi");
  L.push("");
  L.push(`- Görsel dil: ${d.art_direction.visual_language}`);
  for (const c of d.art_direction.checklist) L.push(`- ☐ ${c}`);
  L.push(`- Dayandığı kararlar: ${d.art_direction.decision_ids.map((id) => decisions.get(id)?.question ?? id).join(", ")}`);
  if (pkg.asset_requirements.some((r) => r.reference_lineage.length)) {
    const refs = new Set(pkg.asset_requirements.flatMap((r) => r.reference_lineage));
    L.push(`- Referanslar: ${[...refs].map((id) => `\`${id}\`${d.reference_notes[id] ? ` (${d.reference_notes[id]})` : ""}`).join(", ")}`);
  }
  L.push("");

  L.push("## Sahneler, çekimler ve Google Flow prompt'ları");
  for (const [i, scene] of pkg.scenes.entries()) {
    const sceneSeconds = scene.shots.reduce((s, id) => s + durationSeconds(shotsById.get(id)?.duration_intention ?? ""), 0);
    L.push("");
    L.push(`### Sahne ${i + 1}: \`${scene.scene_id}\` — ${scene.narrative_function} (≈ ${Math.round(sceneSeconds * 10) / 10} sn)`);
    L.push("");
    L.push(`Amaç: ${scene.purpose}`);
    const ids = d.scene_claims[scene.scene_id] ?? [];
    L.push("");
    if (ids.length) {
      L.push("Araştırma iddiaları:");
      for (const id of ids) L.push(`- ${claimBadge(d.claims[id], id)}`);
    } else {
      L.push("Araştırma iddiası: _yok — yaratıcı/geçiş sahnesi; olgu iddiası taşımamalı_");
    }
    if (scene.continuity_requirements.length) L.push(`\nSüreklilik: ${scene.continuity_requirements.join("; ")}`);
    L.push("");
    L.push("| Çekim | Süre | Kamera | Aksiyon | Varlık |");
    L.push("|---|---|---|---|---|");
    for (const id of scene.shots) {
      const s = shotsById.get(id)!;
      const reqs = (reqsByShot.get(id) ?? []).map((r) => `${r.expected_media_type}${r.asset_role ? ` (${r.asset_role})` : ""}`).join(", ");
      L.push(`| \`${s.shot_id}\` | ${s.duration_intention} | ${md(`${s.camera.framing}, ${s.camera.angle}, ${s.camera.movement}, ${s.camera.lens}`)} | ${md(s.action)} | ${md(reqs)} · ${md(s.generation_method)} |`);
    }
    for (const id of scene.shots) {
      for (const p of promptsByShot.get(id) ?? []) {
        L.push("");
        L.push(`**Flow prompt — \`${id}\`** → gereksinim \`${p.spec.traceable_to.asset_requirement_id}\` · karar "${decisions.get(p.spec.traceable_to.decision_id)?.question ?? p.spec.traceable_to.decision_id}"`);
        L.push("");
        L.push("```text");
        L.push(p.rendered.prompt_text);
        L.push("```");
      }
    }
  }
  L.push("");

  L.push("## Seslendirme metni");
  L.push("");
  for (const [i, line] of pkg.voice_lines.entries()) {
    const tag = line.claim_id ? claimBadge(d.claims[line.claim_id], line.claim_id) : "_iddia yok — geçiş/bağlam cümlesi_";
    L.push(`${i + 1}. ${line.text}`);
    L.push(`   - ${tag}`);
  }
  if (pkg.pronunciation_flags.length) {
    L.push("");
    L.push("Telaffuz kontrolü (P3 seslendirmeden önce):");
    for (const f of pkg.pronunciation_flags) L.push(`- \`${f.token}\` (${f.flag_type})`);
  }
  L.push("");
  L.push("## Onay");
  L.push("");
  L.push("Her şey doğruysa Gate A3'ü **kendi adınızla** verin; taslak dosyasını elle değiştirmeyin (değişirse onay reddedilir). Bir şeyi değiştirmek için p2_input.json'u düzenleyip taslağı yeniden üretin.");
  L.push("");
  return L.join("\n");
}
