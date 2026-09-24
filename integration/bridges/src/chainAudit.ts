// Cycle status + end-to-end chain audit.
//
// Point it at one cycle folder (e.g. work/cycle-001). Every JSON file is
// classified by its own type markers (never by file name), then each link is
// checked against the previous one with the SAME verifiers the bridges use:
//
//   research ─▶ bundle ─▶ proposal ─▶ strategy ─▶ directive ─▶ production
//        ─▶ final delivery ─▶ (finishing + F1) ─▶ youtube import
//   (+ external intelligence files: every result re-validated by B08)
//
// The result says which links hold, which are broken or missing, what stage
// the cycle is at, and the next command to run. Nothing is modified.

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { B00, B08 } from "b-branch-strategic-control-plane";
import { parseProductionPackage } from "pipeline3-production/dist/ingest.js";
import { verifyIntegrity } from "pipeline3-production/dist/manifest.js";
import { researchLineage } from "./p1ToB.js";
import { verifyEnvelope, hashValue } from "./identity.js";
import { assertCommitBinding, assertStrategySigned } from "./bToP2.js";
import { assertFinalDeliveryBound, p3Status } from "./stages/p3.js";

export type ArtifactKind =
  | "research"
  | "bundle"
  | "brief"
  | "proposal"
  | "decisions"
  | "strategy"
  | "directive"
  | "production"
  | "final_delivery"
  | "finishing"
  | "f1"
  | "youtube_import"
  | "intelligence"
  | "learning_feed"
  | "reach_plan"
  | "p1_scope"
  | "p1_draft"
  | "p2_draft"
  | "p3_state";

export function classify(doc: any): ArtifactKind | null {
  if (!doc || typeof doc !== "object") return null;
  if (doc.bundle_type === "P1_TO_B_STRATEGY_INPUT") return "bundle";
  if (doc.brief_type === "OWNER_STRATEGY_BRIEF") return "brief";
  if (doc.proposal_type === "B_STRATEGY_PROPOSAL") return "proposal";
  if (doc.commit_type === "B_STRATEGY_COMMIT") return "strategy";
  if (doc.directive_type === "B_TO_P2_CREATIVE_DIRECTIVE") return "directive";
  if (doc.record_type === "P3F_FINISHING_RECORD") return "finishing";
  if (doc.approval_type === "P3F_GATE_F1") return "f1";
  if (doc.package_type === "P3_TO_YOUTUBE_IMPORT") return "youtube_import";
  if (doc.feed_type === "YOUTUBE_AGENT_LEARNING_FEED") return "learning_feed";
  if (doc.plan_type === "B08_REACH_PLAN") return "reach_plan";
  if (doc.proposal_type === "P1_SCOPE_PROPOSAL") return "p1_scope";
  if (doc.draft_type === "P1_RESEARCH_DRAFT") return "p1_draft";
  if (doc.draft_type === "P2_PRODUCTION_DRAFT") return "p2_draft";
  if (doc.state_type === "P3_STAGE_RUNNER_STATE") return "p3_state";
  if (typeof doc.proposal_hash === "string" && doc.approve && typeof doc.authority === "string") return "decisions";
  if (typeof doc.project_id === "string" && Array.isArray(doc.results)) return "intelligence";
  if (typeof doc.final_delivery_package_id === "string" && doc.render) return "final_delivery";
  if (typeof doc.production_package_version === "string" && Array.isArray(doc.scenes)) return "production";
  if (typeof doc.package_id === "string" && doc.research_scope && Array.isArray(doc.claims)) return "research";
  return null;
}

export interface AuditCheck {
  link: string;
  status: "PASS" | "FAIL" | "MISSING" | "SKIPPED";
  detail: string;
}

export interface CycleStatus {
  dir: string;
  files: Partial<Record<ArtifactKind, string[]>>;
  checks: AuditCheck[];
  stage: string;
  next: string;
  ok: boolean;
}

const STAGES: Array<{ kind: ArtifactKind; stage: string; next: string }> = [
  { kind: "research", stage: "S01 araştırma (P1) hazır", next: "npm run unified -- research-to-strategy --research <research.json> --context <context.json> --out bundle.json" },
  { kind: "bundle", stage: "S02 strateji girdisi hazır", next: "npm run unified -- b-propose --bundle bundle.json --brief brief.json --store ../b-store --out proposal.json --review review.md --decisions decisions.json" },
  { kind: "proposal", stage: "S03–S06 B önerisi hazır (onay bekliyor)", next: "review.md'yi okuyun, decisions.json'u doldurun, sonra: npm run unified -- b-commit --bundle bundle.json --brief brief.json --proposal proposal.json --decisions decisions.json --store ../b-store --out strategy.json" },
  { kind: "strategy", stage: "S07 B stratejisi commit edildi", next: "npm run unified -- directive --bundle bundle.json --strategy strategy.json --out directive.json && npm run unified -- p2-inputs --directive directive.json --research <research.json> --out p2-inputs.json" },
  { kind: "directive", stage: "S08 kreatif directive hazır", next: "p2_input.json'u yazın (docs/examples/p2_input.example.json), sonra: npm run unified -- p2-draft --input p2_input.json --research research.json --directive directive.json --out p2_draft.json --review p2_review.md" },
  { kind: "production", stage: "S09 P2 üretim paketi hazır (A3)", next: "npm run unified -- p3-plan --production production_package.json --dir . → assets_checklist.md'deki görselleri Google Flow'da üretip assets/ içine koyun" },
  { kind: "final_delivery", stage: "S10 P3 master (A7) hazır", next: "(önerilir) npm run unified -- finish --final final_delivery.json --production production_package.json --outdir finish --captions --out finishing.json — veya doğrudan to-youtube" },
  { kind: "finishing", stage: "S10F bitirme hazır (F1 bekliyor)", next: "finish/finished.mp4'ü izleyin, sonra: npm run unified -- approve-f1 --finishing finishing.json --actor \"<adınız>\" --out f1.json" },
  { kind: "f1", stage: "S10F bitirme onaylandı (F1)", next: "npm run unified -- to-youtube --final final_delivery.json --production production_package.json --research <research.json> --directive directive.json --finishing finishing.json --f1 f1.json --out youtube_import.json" },
  { kind: "youtube_import", stage: "S11 YouTube aktarım paketi hazır", next: "cd apps/youtube-agent && npm run unified:import -- <youtube_import.json> — sonra Review Studio'da onaylar" },
];

const MAX_BYTES = 64 * 1024 * 1024;

async function loadAll(dir: string): Promise<{ all: Map<ArtifactKind, Array<{ file: string; doc: any }>>; unreadable: Array<{ file: string; why: string }> }> {
  const all = new Map<ArtifactKind, Array<{ file: string; doc: any }>>();
  const unreadable: Array<{ file: string; why: string }> = [];
  const names = (await readdir(dir, { withFileTypes: true })).filter((d) => d.isFile() && d.name.endsWith(".json")).map((d) => d.name).sort();
  for (const name of names) {
    let doc: unknown;
    try {
      if ((await stat(join(dir, name))).size > MAX_BYTES) {
        unreadable.push({ file: name, why: "64 MB'tan büyük" });
        continue;
      }
      doc = JSON.parse(await readFile(join(dir, name), "utf8"));
    } catch {
      unreadable.push({ file: name, why: "geçerli JSON değil (yarım yazılmış ya da bozuk)" });
      continue;
    }
    const kind = classify(doc);
    if (!kind) continue; // context.json, p2-inputs.json, … are inputs, not chain links
    all.set(kind, [...(all.get(kind) ?? []), { file: name, doc }]);
  }
  return { all, unreadable };
}

export async function auditCycle(dir: string): Promise<CycleStatus> {
  const { all, unreadable } = await loadAll(dir);
  const checks: AuditCheck[] = unreadable.map((u) => ({ link: `dosya ${u.file}`, status: "FAIL" as const, detail: u.why }));
  const one = (k: ArtifactKind) => {
    const list = all.get(k) ?? [];
    if (list.length > 1) {
      checks.push({ link: k, status: "FAIL", detail: `birden fazla ${k} dosyası (${list.map((x) => x.file).join(", ")}) — her döngü için ayrı klasör kullanın` });
      return undefined;
    }
    return list[0]?.doc;
  };
  const check = (link: string, fn: () => string | void, needs: unknown[]) => {
    if (needs.some((x) => x === undefined)) {
      checks.push({ link, status: needs[needs.length - 1] === undefined ? "MISSING" : "SKIPPED", detail: needs[needs.length - 1] === undefined ? "henüz yok" : "önceki halka eksik" });
      return;
    }
    try {
      const d = fn();
      checks.push({ link, status: "PASS", detail: d || "ok" });
    } catch (e) {
      checks.push({ link, status: "FAIL", detail: (e as Error).message });
    }
  };
  const must = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(msg);
  };

  const research = one("research");
  const bundle = one("bundle");
  const brief = one("brief");
  const proposal = one("proposal");
  const strategy = one("strategy");
  const directive = one("directive");
  const production = one("production");
  const fd = one("final_delivery");
  const finishing = one("finishing");
  const f1 = one("f1");
  const yip = one("youtube_import");

  let lineage: ReturnType<typeof researchLineage> | undefined;
  check("research (P1, Gate A1, SHA-256)", () => {
    lineage = researchLineage(research);
    return `${lineage.research_package_id} · ${lineage.verified_claim_ids.length} VERIFIED`;
  }, [research]);

  check("research → bundle", () => {
    verifyEnvelope("audit", bundle, "UNIFIED_STRATEGY_INPUT_BUNDLE");
    must(bundle.lineage.research_package_sha256 === research.integrity_hashes.package_sha256, "bundle başka bir araştırma paketinden üretilmiş");
  }, [research, bundle]);

  check("bundle + brief → proposal", () => {
    verifyEnvelope("audit", proposal, "UNIFIED_B_STRATEGY_PROPOSAL");
    must(proposal.bundle_hash === bundle.identity.content_hash, "proposal başka bir bundle için");
    if (brief) must(proposal.brief_hash === hashValue(brief), "brief proposal'dan sonra değişmiş — yeniden b-propose");
    return proposal.readiness.ready ? `hazır · ${proposal.version}` : `HAZIR DEĞİL: ${proposal.readiness.blockers[0]}`;
  }, [bundle, proposal]);

  check("proposal → strategy (B12 commit, G-B)", () => {
    must(strategy.proposal_hash === proposal.identity.content_hash, "strategy başka bir proposal'dan commit edilmiş");
    must(strategy.bundle_hash === bundle.identity.content_hash, "strategy başka bir bundle için");
    must(strategy.branch?.cannot_be_modified_until_next_version === true, "B12 commit edilmemiş");
    must(B00.validateCanonicalIdentity(strategy.branch, strategy.branch.identity).valid, "B12 snapshot değiştirilmiş");
    const decision = [...strategy.branch.state_transitions].reverse().find((t: any) => t.triggered_by === "user_decision");
    must(!!decision, "B12'de isimli commit kararı yok");
    try {
      assertCommitBinding(bundle, strategy, decision.rationale);
      assertStrategySigned(strategy);
    } catch (e) {
      throw new Error(`strategy.json commit'ten sonra değişmiş: ${(e as Error).message}`);
    }
    return `commit: ${strategy.branch.state_transitions.at(-1)?.decision_authority}`;
  }, [proposal, strategy]);

  check("strategy → directive", () => {
    verifyEnvelope("audit", directive, "UNIFIED_CREATIVE_DIRECTIVE");
    must(directive.strategy_input_bundle_hash === bundle.identity.content_hash, "directive başka bir bundle için");
    must(directive.branch_state.content_hash === strategy.branch.identity.content_hash, "directive başka bir B12 snapshot'ından");
    if (lineage) must(directive.lineage.research_package_sha256 === lineage.research_package_sha256, "directive başka bir araştırma için");
    return `${directive.user_goals.length} hedef · ${directive.format.aspect_ratio}`;
  }, [strategy, directive]);

  check("directive → production (P2, A3)", () => {
    const pp = parseProductionPackage(production);
    must(pp.research_package_content_hash === directive.lineage.research_package_sha256, "üretim paketi başka bir araştırmadan");
    return pp.package_id;
  }, [directive, production]);

  check("production → final delivery (P3, A7)", () => {
    must(fd.production_package_ref === production.package_id, "final delivery başka bir üretim paketine ait");
    must(verifyIntegrity({ resolved_assets: fd.resolved_assets, narration: fd.narration, timing: fd.timing, timeline: fd.timeline, render: fd.render, qa: fd.qa, kaggle: fd.kaggle }, fd.integrity_hashes), "final delivery bölüm hash'leri tutmuyor");
    must(fd.gates.some((g: any) => g.gate_id === "A7" && g.state_after === "FINAL_QA_APPROVED"), "Gate A7 yok");
    return `render ${fd.render.run_id} · QA ${fd.qa.result}`;
  }, [production, fd]);

  const fdFile = (all.get("final_delivery") ?? [])[0]?.file;
  if (fd && fdFile && (all.get("p3_state") ?? []).length) {
    try {
      await assertFinalDeliveryBound(join(dir, fdFile));
      checks.push({ link: "final delivery ↔ P3 onay kaydı (imzalı)", status: "PASS", detail: "p3-approve'un yazdığı dosya" });
    } catch (e) {
      checks.push({ link: "final delivery ↔ P3 onay kaydı (imzalı)", status: "FAIL", detail: (e as Error).message });
    }
  }

  if (finishing || f1) {
    check("final delivery → finishing (P3.F)", () => {
      verifyEnvelope("audit", finishing, "UNIFIED_P3F_FINISHING_RECORD");
      const master = fd.render.outputs.find((o: any) => String(o.path).toLowerCase().endsWith(".mp4")) ?? fd.render.outputs[0];
      must(finishing.master.sha256 === master.sha256, "bitirme başka bir master'dan yapılmış");
      return `${finishing.captions ? `altyazı ${finishing.captions.timing_basis}` : "altyazı yok"} · ${finishing.music ? "müzik var" : "müzik yok"}`;
    }, [fd, finishing]);
    check("finishing → F1", () => {
      verifyEnvelope("audit", f1, "UNIFIED_P3F_GATE_F1");
      must(f1.record_hash === finishing.identity.content_hash && f1.finished_sha256 === finishing.finished.sha256, "F1 bu bitirme kaydını onaylamıyor");
      return `onaylayan: ${f1.actor}`;
    }, [finishing, f1]);
  }

  check("→ youtube import", () => {
    verifyEnvelope("audit", yip, "UNIFIED_YOUTUBE_IMPORT");
    must(yip.directive_hash === directive.identity.content_hash, "aktarım başka bir directive'e ait");
    must(yip.final_delivery.final_delivery_package_id === fd.final_delivery_package_id, "aktarım başka bir final delivery'ye ait");
    if (finishing) {
      must(yip.finishing?.record_hash === finishing.identity.content_hash, "bitirme kaydı varken aktarım bitmemiş master'ı taşıyor");
      must(yip.final_delivery.video_sha256 === finishing.finished.sha256, "aktarımdaki video bitmiş dosya değil");
    }
    return `${yip.production_id} · açık kapılar: ${yip.open_human_gates.length}`;
  }, [directive, fd, yip]);

  for (const { file, doc } of all.get("intelligence") ?? []) {
    check(`intelligence ${file} (B08 yeniden doğrulama)`, () => {
      const bad = doc.results.filter((r: unknown) => !B08.validateExternalResult(r)).length;
      must(bad === 0, `${bad} sonuç B08 doğrulamasından geçmiyor`);
      const ok = doc.results.filter((r: any) => r.status === "EXECUTED_REAL").length;
      return `${ok}/${doc.results.length} gerçek sonuç`;
    }, [doc]);
  }

  // A gap is a break: a later link passed while an earlier one has no file
  // (e.g. proposal.json deleted, finishing without F1). Order = main chain.
  const chain = [
    "research (P1, Gate A1, SHA-256)",
    "research → bundle",
    "bundle + brief → proposal",
    "proposal → strategy (B12 commit, G-B)",
    "strategy → directive",
    "directive → production (P2, A3)",
    "production → final delivery (P3, A7)",
    "final delivery → finishing (P3.F)",
    "finishing → F1",
    "→ youtube import",
  ];
  const at = (link: string) => checks.find((c) => c.link === link);
  const furthest = Math.max(-1, ...chain.map((l, i) => (at(l)?.status === "PASS" ? i : -1)));
  for (let i = 0; i < furthest; i++) {
    const c = at(chain[i]!);
    if (c && (c.status === "MISSING" || c.status === "SKIPPED")) {
      c.status = "FAIL";
      c.detail = `ara halka eksik — sonraki aşama var ama bu adımın dosyası yok (${c.detail})`;
    }
  }

  // Furthest stage whose own link passed.
  const passed = new Set(checks.filter((c) => c.status === "PASS").map((c) => c.link));
  const linkFor: Record<string, string> = {
    research: "research (P1, Gate A1, SHA-256)",
    bundle: "research → bundle",
    proposal: "bundle + brief → proposal",
    strategy: "proposal → strategy (B12 commit, G-B)",
    directive: "strategy → directive",
    production: "directive → production (P2, A3)",
    final_delivery: "production → final delivery (P3, A7)",
    finishing: "final delivery → finishing (P3.F)",
    f1: "finishing → F1",
    youtube_import: "→ youtube import",
  };
  let current = { stage: "S00 başlanmadı", next: "p1_input.json'u yazın (docs/examples/p1_input.example.json), sonra: npm run unified -- p1-scope --input p1_input.json --out scope.json --review p1_scope.md" };
  for (const s of STAGES) if (passed.has(linkFor[s.kind]!)) current = { stage: s.stage, next: s.next };
  // Work in progress inside a stage (drafts waiting for a human gate, P3 steps).
  const has = (k: ArtifactKind) => (all.get(k) ?? []).length > 0;
  if (!passed.has(linkFor.research!)) {
    if (has("p1_draft")) current = { stage: "S01 P1 taslağı hazır (Gate A1 onayı bekliyor)", next: "p1_review.md'yi okuyun; onaylıyorsanız: npm run unified -- p1-approve --draft research_draft.json --review p1_review.md --actor \"<adınız>\" --out research.json" };
    else if (has("p1_scope")) current = { stage: "S01 P1 kapsamı önerildi (onay bekliyor)", next: "p1_scope.md'yi okuyun; onaylıyorsanız: npm run unified -- p1-draft --input p1_input.json --scope scope.json --scope-approved-by \"<adınız>\" --out research_draft.json --review p1_review.md" };
  }
  if (passed.has(linkFor.directive!) && !passed.has(linkFor.production!) && has("p2_draft")) {
    current = { stage: "S08 P2 taslağı hazır (Gate A3 onayı bekliyor)", next: "p2_review.md'yi okuyun; onaylıyorsanız: npm run unified -- p2-approve --draft p2_draft.json --review p2_review.md --actor \"<adınız>\" --out production_package.json" };
  }
  if (passed.has(linkFor.production!) && !passed.has(linkFor.final_delivery!) && has("p3_state")) {
    try {
      const p3 = await p3Status(dir);
      current = { stage: `S10 P3 sürüyor (tamamlanan: ${p3.completed.join(", ") || "—"})`, next: p3.next };
    } catch (e) {
      checks.push({ link: "P3 durum dosyası", status: "FAIL", detail: (e as Error).message });
    }
  }
  const files: CycleStatus["files"] = {};
  for (const [k, v] of all) files[k] = v.map((x) => x.file);
  const ok = !checks.some((c) => c.status === "FAIL");
  if (!ok) current = { ...current, next: "Önce FAIL satırlarını düzeltin (ilgili dosyayı kaynağından yeniden üretin)." };
  return { dir, files, checks, stage: current.stage, next: current.next, ok };
}

export function formatStatus(s: CycleStatus): string {
  const icon = { PASS: "✔", FAIL: "✘", MISSING: "·", SKIPPED: "–" } as const;
  return [
    `Döngü: ${s.dir}`,
    ...s.checks.map((c) => `${icon[c.status]} ${c.link} — ${c.detail}`),
    "",
    `Aşama: ${s.stage}`,
    `Sıradaki: ${s.next}`,
    s.ok ? "Zincir: SAĞLAM" : "Zincir: KIRIK",
  ].join("\n");
}
