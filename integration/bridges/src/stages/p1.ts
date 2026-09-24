// P1 (research) stage runner — the A-Branch P1 library driven from files.
//
// P1 is a library of phase functions (runP101Input … approvePackage). Research
// content itself is gathered by a person (or by Claude with the person), written
// into one JSON (docs/examples/p1_input.example.json) and run through P1's REAL
// phases with its ManualResearchEngine: P1 structures, links and seals it and
// never invents a finding. Anything not supplied comes back UNKNOWN.
//
//   p1Scope   input → scope proposal (envelope) + Turkish review      (no gate)
//   p1Draft   input + scope + scope approver → research draft + review (Gate A1, part 1: scope)
//   p1Approve draft + approver → research.json (ResearchPackageHandoff) (Gate A1, part 2: package)
//
// Every approver is a named person (assertHumanAuthority). Nothing defaults.

import {
  approvePackage,
  approveScope,
  draftHandoff,
  runP101Input,
  runP102ProposeScope,
  runP103DomainResearch,
  runP104Verification,
  runP105And106Synthesis,
} from "pipeline1-research/dist/pipeline.js";
import { ManualResearchEngine } from "pipeline1-research/dist/researchEngine.js";
import { CLAIM_DIMENSIONS } from "pipeline1-research/dist/types.js";
import { BridgeError, assertHumanAuthority, hashValue, sealEnvelope, shortHash, verifyEnvelope } from "../identity.js";
import { assertNoSecrets } from "../safety.js";
import type { CanonicalIdentity } from "../contracts.js";

const STAGE = "P1";
const fail = (code: string, msg: string): never => {
  throw new BridgeError(STAGE, code, msg);
};

export const P1_SCOPE_TYPE = "UNIFIED_P1_SCOPE_PROPOSAL";
export const P1_DRAFT_TYPE = "UNIFIED_P1_RESEARCH_DRAFT";

type Dimension = (typeof CLAIM_DIMENSIONS)[number];
type Status = "VERIFIED" | "INFERRED" | "UNKNOWN";

export interface P1Input {
  input_type: "P1_RESEARCH_INPUT";
  _readme?: unknown;
  topic: string;
  question?: string;
  objective?: string;
  constraints?: string[];
  output_language?: string;
  research_language?: string;
  source_language?: string;
  target_context?: Record<string, unknown>;
  user_example_references?: string[];
  queries: Array<{ query: string; dimension: Dimension }>;
  findings: Array<{
    query: string;
    dimension: Dimension;
    statement: string;
    source: { origin: string; source_type: "primary" | "secondary" | "tertiary"; retrieved_at?: string; access_method?: string; reliability_notes?: string };
    excerpt: string;
    unresolved_reason?: string;
  }>;
  /** VERIFIED needs `cross_checked_with`: at least one independent source other than the finding's own. */
  verifications?: Array<{ statement: string; status: Status; rationale: string; cross_checked_with?: string[]; unresolved_reason?: string }>;
  handoff_notes?: string;
}

const norm = (s: string) => s.trim().toLowerCase();
const isStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const placeholder = (v: unknown) => typeof v === "string" && /<[^>]+>/.test(v);

/** Validates a P1 input file; lists every problem at once with its path. */
/** Fields the scope approval covers. Research (queries, findings, verifications) is added after it. */
function scopeFields(input: P1Input) {
  const { topic, question, objective, constraints, output_language, research_language, source_language, target_context, user_example_references } = input;
  return { topic, question, objective, constraints, output_language, research_language, source_language, target_context, user_example_references };
}

/** Validates a P1 input file; lists every problem at once with its path. `scopeOnly` skips the research part (not written yet). */
export function validateP1Input(raw: unknown, opts: { scopeOnly?: boolean } = {}): P1Input {
  const errs: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("P1_INPUT_INVALID", "girdi bir JSON nesnesi olmalı");
  assertNoSecrets(raw, "$p1_input");
  const x = raw as Record<string, any>;
  const allowed = new Set(["input_type", "_readme", "topic", "question", "objective", "constraints", "output_language", "research_language", "source_language", "target_context", "user_example_references", "queries", "findings", "verifications", "handoff_notes"]);
  for (const k of Object.keys(x)) if (!allowed.has(k)) errs.push(`${k}: bilinmeyen alan`);
  if (x.input_type !== "P1_RESEARCH_INPUT") errs.push(`input_type: "P1_RESEARCH_INPUT" olmalı`);
  if (!isStr(x.topic) || placeholder(x.topic)) errs.push("topic: konu gerekli");
  if (x.question !== undefined && (!isStr(x.question) || placeholder(x.question))) errs.push("question: ana soruyu yazın (ya da alanı silin)");
  if (x.objective !== undefined && placeholder(x.objective)) errs.push("objective: yer tutucuyu doldurun");
  if (opts.scopeOnly) {
    if (errs.length) fail("P1_INPUT_INVALID", `${errs.length} sorun:\n  - ${errs.join("\n  - ")}`);
    return x as P1Input;
  }
  const dims = new Set<string>(CLAIM_DIMENSIONS);
  const queries: any[] = Array.isArray(x.queries) ? x.queries : (errs.push("queries: dizi olmalı"), []);
  const qkeys = new Set<string>();
  queries.forEach((q, i) => {
    if (!isStr(q?.query) || placeholder(q?.query)) errs.push(`queries[${i}].query: gerekli`);
    if (!dims.has(q?.dimension)) errs.push(`queries[${i}].dimension: şunlardan biri olmalı: ${CLAIM_DIMENSIONS.join(", ")}`);
    const key = `${q?.dimension}::${norm(String(q?.query ?? ""))}`;
    if (qkeys.has(key)) errs.push(`queries[${i}]: aynı soru iki kez`);
    qkeys.add(key);
  });
  if (queries.length === 0) errs.push("queries: en az bir araştırma sorusu gerekli");
  if (Array.isArray(x.findings) && x.findings.length === 0) errs.push("findings: araştırma bulgularını ekleyin (kaynaklı)");
  const findings: any[] = Array.isArray(x.findings) ? x.findings : (errs.push("findings: dizi olmalı"), []);
  const statements = new Set<string>();
  findings.forEach((f, i) => {
    const p = `findings[${i}]`;
    if (!qkeys.has(`${f?.dimension}::${norm(String(f?.query ?? ""))}`)) errs.push(`${p}: query + dimension, queries listesindeki bir soruyla eşleşmeli`);
    if (!isStr(f?.statement) || placeholder(f?.statement)) errs.push(`${p}.statement: gerekli`);
    else if (statements.has(norm(f.statement))) errs.push(`${p}.statement: aynı ifade iki kez`);
    else statements.add(norm(f.statement));
    if (!f?.source || typeof f.source !== "object") errs.push(`${p}.source: gerekli`);
    else {
      if (!isStr(f.source.origin) || placeholder(f.source.origin)) errs.push(`${p}.source.origin: kaynak (URL ya da künye) gerekli`);
      if (!["primary", "secondary", "tertiary"].includes(f.source.source_type)) errs.push(`${p}.source.source_type: primary | secondary | tertiary`);
    }
    const unknownSource = isStr(f?.source?.origin) && norm(f.source.origin) === "unknown";
    if ((!isStr(f?.excerpt) || placeholder(f?.excerpt)) && !unknownSource) errs.push(`${p}.excerpt: kaynaktaki ilgili alıntı ya da sayfa/yer bilgisi gerekli`);
    if (unknownSource && !isStr(f?.unresolved_reason)) errs.push(`${p}.unresolved_reason: kaynak "unknown" ise neden çözülemediği yazılmalı`);
  });
  const verifs: any[] = x.verifications === undefined ? [] : Array.isArray(x.verifications) ? x.verifications : (errs.push("verifications: dizi olmalı"), []);
  verifs.forEach((v, i) => {
    const p = `verifications[${i}]`;
    if (!isStr(v?.statement) || !statements.has(norm(v.statement))) errs.push(`${p}.statement: findings içindeki bir ifadeyle birebir aynı olmalı`);
    if (!["VERIFIED", "INFERRED", "UNKNOWN"].includes(v?.status)) errs.push(`${p}.status: VERIFIED | INFERRED | UNKNOWN`);
    if (!isStr(v?.rationale) || placeholder(v?.rationale)) errs.push(`${p}.rationale: gerekçe gerekli`);
    if (v?.cross_checked_with !== undefined && !Array.isArray(v.cross_checked_with)) errs.push(`${p}.cross_checked_with: dizi olmalı`);
    if (v?.status === "VERIFIED") {
      const own = new Set(findings.filter((f) => isStr(f?.statement) && isStr(v?.statement) && norm(f.statement) === norm(v.statement)).map((f) => norm(String(f?.source?.origin ?? ""))));
      const independent = (Array.isArray(v.cross_checked_with) ? v.cross_checked_with : []).filter((o: unknown) => isStr(o) && !placeholder(o) && norm(o as string) !== "unknown" && !own.has(norm(o as string)));
      if (independent.length === 0) errs.push(`${p}: VERIFIED için cross_checked_with içinde bulgunun kendi kaynağından BAŞKA en az bir bağımsız kaynak (URL/künye) gerekli — tek kaynak = INFERRED`);
    }
  });
  if (errs.length) fail("P1_INPUT_INVALID", `${errs.length} sorun:\n  - ${errs.join("\n  - ")}`);
  return x as P1Input;
}

function rawInput(input: P1Input) {
  return {
    topic: input.topic,
    question: input.question,
    objective: input.objective,
    constraints: input.constraints ?? [],
    output_language: input.output_language,
    research_language: input.research_language,
    source_language: input.source_language,
    target_context: input.target_context,
    user_example_references: input.user_example_references,
  } as any;
}

// ------------------------------------------------------------------ scope

export interface P1ScopeProposal {
  proposal_type: "P1_SCOPE_PROPOSAL";
  input_hash: string;
  scope: any;
  identity: CanonicalIdentity;
}

export function p1Scope(params: { input: unknown; now?: () => string }): { proposal: P1ScopeProposal; review: string } {
  const input = validateP1Input(params.input, { scopeOnly: true });
  const scope = runP102ProposeScope(runP101Input(rawInput(input)));
  const created_at = (params.now ?? (() => new Date().toISOString()))();
  const body = { proposal_type: "P1_SCOPE_PROPOSAL" as const, input_hash: hashValue(scopeFields(input)), scope };
  const proposal = sealEnvelope<P1ScopeProposal>(body, { object_id: `p1scope_${shortHash(body.input_hash)}`, object_type: P1_SCOPE_TYPE, version: "v1", created_at });
  const L = [
    `# P1 araştırma kapsamı — onay bekliyor`,
    "",
    `- Konu: **${scope.topic}**`,
    scope.question ? `- Soru: ${scope.question}` : "",
    scope.objective ? `- Amaç: ${scope.objective}` : "",
    `- Kısıtlar: ${scope.constraints.length ? scope.constraints.join("; ") : "(yok)"}`,
    `- Kaynak türleri: ${scope.source_type_preferences.join(", ")}`,
    `- Aday kaynak aileleri: ${scope.candidate_source_families.length ? scope.candidate_source_families.join("; ") : "(yok)"}`,
    "",
    ...(Array.isArray(input.queries) && input.queries.length ? [`## Planlanan araştırma soruları (${input.queries.length})`, ...input.queries.map((q) => `- [${q.dimension}] ${q.query}`), ""] : []),
    "Kapsam onaylandıktan sonra araştırmayı yapıp bulguları (kaynaklarıyla) p1_input.json'a ekleyin; kapsam alanlarını (konu, soru, amaç, kısıtlar, dil) değiştirirseniz kapsam yeniden onaylanmalı.",
    "",
    `Kapsamı onaylıyorsanız: \`npm run unified -- p1-draft --input <p1_input.json> --scope <bu dosyanın .json'u> --scope-approved-by "<adınız>" --out research_draft.json --review p1_review.md\``,
    "",
    `Proposal hash: \`${proposal.identity.content_hash}\``,
  ].filter((l) => l !== "");
  return { proposal, review: L.join("\n") + "\n" };
}

// ------------------------------------------------------------------ draft

export interface P1Draft {
  draft_type: "P1_RESEARCH_DRAFT";
  input_hash: string;
  scope_proposal_hash: string;
  handoff: any;
  review_sha256: string;
  identity: CanonicalIdentity;
}

export async function p1Draft(params: { input: unknown; scopeProposal: unknown; scopeApprovedBy: string; now?: () => string }): Promise<{ draft: P1Draft; review: string }> {
  const actor = assertHumanAuthority(STAGE, params.scopeApprovedBy, "Gate A1 (kapsam) onaylayan");
  const input = validateP1Input(params.input);
  const sp = params.scopeProposal as P1ScopeProposal;
  verifyEnvelope(STAGE, sp as any, P1_SCOPE_TYPE);
  if (sp.input_hash !== hashValue(scopeFields(input))) fail("P1_INPUT_CHANGED", "kapsam alanları (konu, soru, amaç, kısıtlar, dil) kapsam onayından sonra değişmiş — yeniden p1-scope çalıştırıp kapsamı yeniden inceleyin");
  const fresh = runP102ProposeScope(runP101Input(rawInput(input)));
  if (hashValue(fresh) !== hashValue(sp.scope)) fail("P1_SCOPE_CHANGED", "kapsam önerisi girdiden üretilenle aynı değil");

  const { scope, gate } = approveScope(sp.scope, actor);
  const topicKey = norm(input.topic);
  const findings: Record<string, any[]> = {};
  for (const f of input.findings) {
    const key = `${topicKey}::${f.dimension}::${norm(f.query)}`;
    (findings[key] ??= []).push({
      statement: f.statement.trim(),
      dimension: f.dimension,
      derived_from: f.query.trim(),
      source: {
        source_id: "",
        origin: f.source.origin.trim(),
        source_type: f.source.source_type,
        retrieved_at: f.source.retrieved_at ?? (params.now ?? (() => new Date().toISOString()))(),
        access_method: f.source.access_method ?? "manual_entry",
        ...(f.source.reliability_notes ? { reliability_notes: f.source.reliability_notes } : {}),
      },
      excerpt_or_pointer: f.excerpt ?? "",
      extraction_method: "manual_entry",
      ...(f.unresolved_reason ? { unresolved_reason: f.unresolved_reason } : {}),
    });
  }
  const verifications: Record<string, any> = {};
  for (const v of input.verifications ?? []) {
    const cross = (v.cross_checked_with ?? []).filter((o) => isStr(o));
    const rationale = cross.length ? `${v.rationale.trim()} | Bağımsız kaynaklar: ${cross.join("; ")}` : v.rationale.trim();
    verifications[norm(v.statement)] = { status: v.status, rationale, ...(v.unresolved_reason ? { unresolved_reason: v.unresolved_reason } : {}) };
  }
  const engine = new ManualResearchEngine({ topic: input.topic, findings, verifications });

  let draft: any;
  try {
    const research = await runP103DomainResearch(engine, scope, input.queries.map((q) => ({ query: q.query.trim(), dimension: q.dimension })));
    const { verifications: verified } = await runP104Verification(engine, research.claims);
    const { knowledge_package, unresolved_questions } = runP105And106Synthesis(research.claims, verified, scope.project_id, research.sources);
    draft = draftHandoff({ approvedScope: scope, sources: research.sources, evidence: research.evidence, claims: research.claims, verifications: verified, knowledge_package, unresolved_questions, gates: [gate], handoff_notes: input.handoff_notes ?? "" } as any);
  } catch (e) {
    fail("P1_REJECTED", (e as Error).message);
  }
  const handoff = JSON.parse(JSON.stringify(draft));
  const review = p1ReviewMarkdown(handoff, actor);
  const created_at = (params.now ?? (() => new Date().toISOString()))();
  const body = { draft_type: "P1_RESEARCH_DRAFT" as const, input_hash: sp.input_hash, scope_proposal_hash: sp.identity.content_hash, handoff, review_sha256: hashValue(review) };
  const sealed = sealEnvelope<P1Draft>(body, { object_id: `p1draft_${shortHash(hashValue(handoff))}`, object_type: P1_DRAFT_TYPE, version: "v1", created_at });
  return { draft: sealed, review };
}

export function p1ReviewMarkdown(h: any, scopeApprover: string): string {
  const status = new Map<string, any>((h.verifications ?? []).map((v: any) => [v.claim_id, v]));
  const src = new Map<string, any>((h.sources ?? []).map((s: any) => [s.source_id, s]));
  const ev = new Map<string, any>((h.evidence ?? []).map((e: any) => [e.evidence_id, e]));
  const icon = (s: string) => (s === "VERIFIED" ? "✔ VERIFIED" : s === "INFERRED" ? "≈ INFERRED" : "? UNKNOWN");
  const L = [
    `# P1 araştırma paketi — onay bekliyor (Gate A1)`,
    "",
    `Konu: **${h.topic ?? h.approved_scope?.topic ?? ""}** · Kapsamı onaylayan: ${scopeApprover}`,
    "",
    `## İddialar (${h.claims?.length ?? 0})`,
    "Yalnızca **VERIFIED** iddialar videoda kesin bilgi olarak kullanılabilir; INFERRED olanlar yorum diliyle, UNKNOWN olanlar hiç kullanılmamalı.",
    "",
  ];
  for (const c of h.claims ?? []) {
    const v = status.get(c.claim_id);
    const sources = (c.evidence_refs ?? []).map((id: string) => src.get(ev.get(id)?.source_id)?.origin).filter(Boolean);
    L.push(`- **${icon(v?.status ?? "UNKNOWN")}** \`${c.claim_id}\` [${c.dimension}] ${c.statement}`, `  - Gerekçe: ${v?.rationale ?? "—"}`, `  - Kaynak: ${sources.length ? sources.join("; ") : "yok"}`);
  }
  if (h.unresolved_questions?.length) L.push("", "## Çözülemeyen sorular", ...h.unresolved_questions.map((q: string) => `- ${q}`));
  L.push("", `Paketi onaylıyorsanız: \`npm run unified -- p1-approve --draft research_draft.json --review p1_review.md --actor "<adınız>" --out research.json\``);
  return L.join("\n") + "\n";
}

// ------------------------------------------------------------------ approve

export function p1Approve(params: { draft: unknown; actor: string; review?: string }): any {
  const actor = assertHumanAuthority(STAGE, params.actor, "Gate A1 (paket) onaylayan");
  const d = params.draft as P1Draft;
  try {
    verifyEnvelope(STAGE, d as any, P1_DRAFT_TYPE);
  } catch (e) {
    fail("P1_DRAFT_CHANGED", `taslak incelemeden sonra değişmiş: ${(e as Error).message}`);
  }
  if (params.review !== undefined && hashValue(params.review) !== d.review_sha256) fail("P1_REVIEW_MISMATCH", "verilen inceleme dosyası bu taslağa ait değil");
  let out: any;
  try {
    out = approvePackage(JSON.parse(JSON.stringify(d.handoff)), actor).handoff;
  } catch (e) {
    fail("P1_REJECTED", (e as Error).message);
  }
  return JSON.parse(JSON.stringify(out));
}

export const P1_ERROR_HINTS: Record<string, string> = {
  P1_INPUT_INVALID: "p1_input.json'daki listelenen alanları düzeltin (docs/examples/p1_input.example.json'a bakın).",
  P1_INPUT_CHANGED: "Kapsam alanları (konu/soru/amaç/kısıtlar/dil) onaydan sonra değişmiş. p1-scope ile yeniden kapsam üretip inceleyin.",
  P1_SCOPE_CHANGED: "Kapsam dosyası bu girdiye ait değil. p1-scope'u yeniden çalıştırın.",
  P1_DRAFT_CHANGED: "Araştırma taslağı incelemeden sonra değişmiş. p1-draft'ı yeniden çalıştırın.",
  P1_REVIEW_MISMATCH: "İnceleme dosyası bu taslağa ait değil.",
  P1_REJECTED: "P1 kütüphanesi girdiyi reddetti; mesajdaki alanı düzeltin.",
};
