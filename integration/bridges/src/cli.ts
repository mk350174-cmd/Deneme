#!/usr/bin/env node
// File-based CLI for the unified pipeline bridges. Every command reads sealed
// JSON envelopes / handoffs from disk and writes a new sealed envelope, so
// each hop is inspectable, diffable and re-verifiable.

import { readFile } from "node:fs/promises";
import { UNIFIED_CYCLE, CAPABILITY_OWNERSHIP } from "./cycle.js";
import { buildStrategyInputBundle } from "./p1ToB.js";
import { assertDirectiveMatchesResearch, buildCreativeDirective, toP2FormatInput, toP2Memory, toP2UserGoals } from "./bToP2.js";
import { buildYouTubeImport } from "./p3ToYouTube.js";
import { collectLearningIntelligence } from "./youtubeToB.js";
import { verifyEnvelope } from "./identity.js";
import { commitStrategy, decisionsTemplate, proposalMarkdown, proposeStrategy } from "./bOrchestrator.js";
import { fileStrategyStore } from "./fileStore.js";
import { assertNoSecrets, atomicWrite, ERROR_HINTS, SecretLeakError } from "./safety.js";
import { auditCycle, formatStatus } from "./chainAudit.js";
import { BridgeError } from "./identity.js";
import { collectReachIntelligence, mergeIntelligence } from "./reachTransports.js";
import { approveFinishing, finishMaster } from "./finishing.js";
import { P1_ERROR_HINTS, p1Approve, p1Draft, p1Scope } from "./stages/p1.js";
import { p2Approve, p2Draft, validateP2Input } from "./stages/p2.js";
import { P3_ERROR_HINTS, assertFinalDeliveryBound, p3Approve, p3ApproveVoice, p3Ingest, p3Plan, p3Preview, p3Render, p3ResolveAmbiguity, p3Status, p3Voice, parseP3Config } from "./stages/p3.js";
import { defaultPiperModel, venvExecGtts, venvExecPiper } from "./stages/pyTools.js";

const ENVELOPE_TYPES: Record<string, string> = {
  P1_TO_B_STRATEGY_INPUT: "UNIFIED_STRATEGY_INPUT_BUNDLE",
  B_TO_P2_CREATIVE_DIRECTIVE: "UNIFIED_CREATIVE_DIRECTIVE",
  P3_TO_YOUTUBE_IMPORT: "UNIFIED_YOUTUBE_IMPORT",
  B_STRATEGY_PROPOSAL: "UNIFIED_B_STRATEGY_PROPOSAL",
  P3F_FINISHING_RECORD: "UNIFIED_P3F_FINISHING_RECORD",
  P3F_GATE_F1: "UNIFIED_P3F_GATE_F1",
  P1_SCOPE_PROPOSAL: "UNIFIED_P1_SCOPE_PROPOSAL",
  P1_RESEARCH_DRAFT: "UNIFIED_P1_RESEARCH_DRAFT",
  P2_PRODUCTION_DRAFT: "UNIFIED_P2_PRODUCTION_DRAFT",
};

const P2_HINTS: Record<string, string> = {
  P2_INPUT_INVALID: "p2_input.json'daki listelenen alanları düzeltin (docs/examples/p2_input.example.json'a bakın).",
  P2_APPROVAL_REQUIRED: "p2_input.json → approvals içinde adı geçen onayları kendi adınızla doldurun (yer tutucu kabul edilmez).",
  P2_UNKNOWN_CLAIM: "Sahne/anlatımda kullanılan claim id araştırma paketinde yok. research.json'daki claim_id'leri kullanın.",
  P2_REJECTED: "P2 kütüphanesi girdiyi reddetti; mesajdaki alanı düzeltin.",
  P2_DRAFT_CHANGED: "P2 taslağı incelemeden sonra değişmiş. p2-draft'ı yeniden çalıştırın.",
  P2_REVIEW_MISMATCH: "İnceleme dosyası bu taslağa ait değil.",
  P2_ALREADY_APPROVED: "Bu taslak zaten onaylanmış.",
  P2_UNVERIFIED_NARRATION: "Anlatımda kullanılan bir iddianın kaynağı yok (UNKNOWN). P1'de kaynak ekleyin ya da o satırı claim_id'siz/farklı yazın.",
};
const hintFor = (code: string) => ERROR_HINTS[code] ?? P1_ERROR_HINTS[code] ?? P2_HINTS[code] ?? P3_ERROR_HINTS[code];

async function text(path: string, value: string): Promise<void> {
  assertNoSecrets(value, "$text");
  await atomicWrite(path, value);
  console.error(`wrote ${path}`);
}

const need = (opts: Record<string, string | true>, name: string, what: string): string => {
  const v = opts[name];
  if (typeof v !== "string") throw new Error(`--${name} ${what} gerekli`);
  return v;
};

function args(argv: string[]): { cmd: string; opts: Record<string, string | true> } {
  const [cmd = "help", ...rest] = argv;
  const opts: Record<string, string | true> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq > 2) {
      // --notes=--literal-text : lets a value start with "--"
      opts[a.slice(2, eq)] = a.slice(eq + 1);
      continue;
    }
    const next = rest[i + 1];
    if (next === undefined || next.startsWith("--")) opts[a.slice(2)] = true;
    else {
      opts[a.slice(2)] = next;
      i++;
    }
  }
  return { cmd, opts };
}

async function json(path: string | true | undefined, name: string): Promise<any> {
  if (typeof path !== "string") throw new Error(`--${name} <file.json> is required`);
  return JSON.parse(await readFile(path, "utf8"));
}

async function out(path: string | true | undefined, value: unknown): Promise<void> {
  assertNoSecrets(value);
  const text = JSON.stringify(value, null, 2) + "\n";
  if (typeof path === "string") {
    await atomicWrite(path, text);
    console.error(`wrote ${path}`);
  } else process.stdout.write(text);
}

const HELP = `unified <command> [options]

  plan                                   print the unified cycle and capability ownership
  research-to-strategy --research r.json [--context ctx.json] [--out bundle.json]
  b-propose --bundle bundle.json --brief brief.json --store work/b-store [--intel external_intelligence.json]
            --out proposal.json [--review review.md] [--decisions decisions.json]
            runs the real B01→B11 chain as a PREVIEW; nothing is committed
  b-commit  --bundle bundle.json --brief brief.json --proposal proposal.json --decisions decisions.json
            --store work/b-store [--intel external_intelligence.json] --out strategy.json
            re-runs under your name, checks every module against the reviewed fingerprint, commits B01–B11 + B12
  directive --bundle bundle.json --strategy strategy.json [--channel id] [--strict] [--aspect 9:16] [--out directive.json]
            strategy.json = { branch, b05, b06, b07, b11, b10? } (canonical B states + committed B12)
  p2-inputs --directive directive.json --research r.json [--out p2-inputs.json]
  to-youtube --final final_delivery.json --production production_package.json --research r.json
             --directive directive.json [--external-p3] [--finishing finishing.json --f1 f1.json] [--options opts.json] [--out youtube_import.json]
  feed-to-b --feed learning_feed.json --bindings kpi_bindings.json [--out external_intelligence.json]
  reach     --plan reach_plan.json [--out reach_intelligence.json]
            Agent Reach backends (yt-dlp YouTube search, feedparser RSS) through B08
  merge-intel --in a.json --in2 b.json [--out external_intelligence.json]
  finish    --final final_delivery.json --production production_package.json --outdir work/finish
            [--captions] [--language tr] [--word-timings words.json]
            [--music bed.mp3 --music-source "…" --music-license "…" --music-attested-by "<name>" [--music-gain -18]]
            [--out finishing.json]      P3.F: burn captions / duck music under narration (ffmpeg)
  approve-f1 --finishing finishing.json --actor "<your name>" [--notes "…"] [--out f1.json]
            Gate F1 — only after you watched work/finish/finished.mp4

  ── A-Branch aşamaları (her insan kapısı sizin adınızı ister; yer tutucu kabul edilmez) ──
  p1-scope   --input p1_input.json --out scope.json [--review p1_scope.md]
  p1-draft   --input p1_input.json --scope scope.json --scope-approved-by "<ad>" --out research_draft.json --review p1_review.md
  p1-approve --draft research_draft.json --review p1_review.md --actor "<ad>" --out research.json      Gate A1
  p2-draft   --input p2_input.json --research research.json --directive directive.json --out p2_draft.json --review p2_review.md
  p2-approve --draft p2_draft.json --review p2_review.md --actor "<ad>" --out production_package.json   Gate A3
  p3-plan    --production production_package.json --dir work/cycle-001 [--language tr]      varlık listesi + Google Flow istemleri
  p3-ingest  --production … --dir … --actor "<ad>" [--assets klasör]                      Gate A4 (Flow görselleri teslim alındı)
  p3-preview --production … --dir … [--piper-model model.onnx]                            anlatım önizlemesi (Piper → gTTS)
  p3-approve-voice --production … --dir … --actor "<ad>" [--confirm "Taydula,Canibek"]     Gate A5 (önizlemeyi dinlediniz)
  p3-resolve-ambiguity --production … --dir … --actor "<ad>"                               Gate A6 (yalnızca telaffuz bayrağı varsa)
  p3-voice   --production … --dir … --config p3_input.json [--force]                       üretim anlatımı (ElevenLabs / Voicebox)
  p3-render  --production … --dir …                                                         zamanlama + Remotion render + QA
  p3-approve --production … --dir … --actor "<ad>" [--notes "…"]                            Gate A7 (render'ı izlediniz) → final_delivery.json
  p3-status  --dir …

  verify --file envelope.json
  status    --dir work/cycle-001 [--json]      where the cycle is, full chain audit, next command (exit 2 if broken)`;

async function main(): Promise<void> {
  // `npm run unified -- …` always runs from the repo root; resolve paths from where the user typed it.
  if (process.env.INIT_CWD && ["unified", "plan"].includes(process.env.npm_lifecycle_event ?? "")) process.chdir(process.env.INIT_CWD);
  const { cmd, opts } = args(process.argv.slice(2));
  switch (cmd) {
    case "plan":
      return out(opts.out, { cycle: UNIFIED_CYCLE, capability_ownership: CAPABILITY_OWNERSHIP });
    case "research-to-strategy": {
      const research = await json(opts.research, "research");
      const context = typeof opts.context === "string" ? await json(opts.context, "context") : {};
      return out(opts.out, buildStrategyInputBundle(research, context));
    }
    case "b-propose": {
      const bundle = await json(opts.bundle, "bundle");
      const brief = await json(opts.brief, "brief");
      const intelligence = typeof opts.intel === "string" ? await json(opts.intel, "intel") : undefined;
      if (typeof opts.store !== "string") throw new Error("--store <dir> is required");
      const proposal = await proposeStrategy(bundle, brief, { store: fileStrategyStore(opts.store), ...(intelligence ? { intelligence } : {}) });
      if (typeof opts.review === "string") {
        const md = proposalMarkdown(proposal, brief);
        assertNoSecrets(md, "$review");
        await atomicWrite(opts.review, md);
        console.error(`wrote ${opts.review}`);
      }
      if (typeof opts.decisions === "string") {
        await atomicWrite(opts.decisions, JSON.stringify(decisionsTemplate(proposal), null, 2) + "\n");
        console.error(`wrote ${opts.decisions} (set every module to true, fill authority + rationale)`);
      }
      console.error(proposal.readiness.ready ? `READY — version ${proposal.version}` : `NOT READY:\n- ${proposal.readiness.blockers.join("\n- ")}`);
      return out(opts.out, proposal);
    }
    case "b-commit": {
      const bundle = await json(opts.bundle, "bundle");
      const brief = await json(opts.brief, "brief");
      const proposal = await json(opts.proposal, "proposal");
      const decisions = await json(opts.decisions, "decisions");
      const intelligence = typeof opts.intel === "string" ? await json(opts.intel, "intel") : undefined;
      if (typeof opts.store !== "string") throw new Error("--store <dir> is required");
      const result = await commitStrategy(bundle, brief, proposal, decisions, { store: fileStrategyStore(opts.store), ...(intelligence ? { intelligence } : {}) });
      console.error(`committed B01–B11 ${proposal.version} + B12 ${result.branch.state_id} by ${decisions.authority}`);
      return out(opts.out, result);
    }
    case "directive": {
      const bundle = await json(opts.bundle, "bundle");
      const strategy = await json(opts.strategy, "strategy");
      return out(
        opts.out,
        buildCreativeDirective(bundle, strategy, {
          ...(typeof opts.channel === "string" ? { channel_id: opts.channel } : {}),
          ...(typeof opts.aspect === "string" ? { aspect_ratio: opts.aspect } : {}),
          include_heuristics: opts.strict !== true,
        }),
      );
    }
    case "p2-inputs": {
      const directive = await json(opts.directive, "directive");
      const research = await json(opts.research, "research");
      assertDirectiveMatchesResearch(directive, research);
      return out(opts.out, {
        note: "Pass these unchanged into P2: runP203Strategize(userGoals, priorApproaches=memory), decideFormat(format, constraints).",
        directive_hash: directive.identity.content_hash,
        userGoals: toP2UserGoals(directive),
        format: toP2FormatInput(directive),
        memory: toP2Memory(directive),
      });
    }
    case "to-youtube": {
      if ((typeof opts.f1 === "string") !== (typeof opts.finishing === "string")) {
        throw new BridgeError("CLI", "FINISHING_F1_PAIR", "--finishing and --f1 must be given together");
      }
      if (opts["external-p3"] !== true) await assertFinalDeliveryBound(need(opts, "final", "final_delivery.json"));
      return out(
        opts.out,
        buildYouTubeImport({
          finalDelivery: await json(opts.final, "final"),
          productionPackage: await json(opts.production, "production"),
          researchPackage: await json(opts.research, "research"),
          directive: await json(opts.directive, "directive"),
          ...(typeof opts.finishing === "string" ? { finishing: { record: await json(opts.finishing, "finishing"), approval: await json(opts.f1, "f1") } } : {}),
          options: typeof opts.options === "string" ? await json(opts.options, "options") : {},
        }),
      );
    }
    case "feed-to-b": {
      const feed = await json(opts.feed, "feed");
      const bindings = await json(opts.bindings, "bindings");
      return out(opts.out, await collectLearningIntelligence(feed, bindings));
    }
    case "reach":
      return out(opts.out, await collectReachIntelligence(await json(opts.plan, "plan")));
    case "merge-intel":
      return out(opts.out, mergeIntelligence(await json(opts.in, "in"), await json(opts.in2, "in2")));
    case "finish": {
      if (opts["external-p3"] !== true) await assertFinalDeliveryBound(need(opts, "final", "final_delivery.json"));
      const music =
        typeof opts.music === "string"
          ? {
              path: opts.music,
              source: String(opts["music-source"] ?? ""),
              license: String(opts["music-license"] ?? ""),
              attested_by: String(opts["music-attested-by"] ?? ""),
              ...(typeof opts["music-gain"] === "string" ? { gain_db: Number(opts["music-gain"]) } : {}),
            }
          : undefined;
      if (typeof opts.outdir !== "string") throw new Error("--outdir <dir> is required");
      const rec = await finishMaster({
        finalDelivery: await json(opts.final, "final"),
        productionPackage: await json(opts.production, "production"),
        options: {
          outDir: opts.outdir,
          ...(opts.captions === true || typeof opts["word-timings"] === "string"
            ? { captions: { enabled: true, ...(typeof opts.language === "string" ? { language: opts.language } : {}), ...(typeof opts["word-timings"] === "string" ? { word_timings: await json(opts["word-timings"], "word-timings") } : {}) } }
            : {}),
          ...(music ? { music } : {}),
        },
      });
      console.error(`finished: ${rec.finished.path} — watch it, then: unified approve-f1 --finishing <this file> --actor "<your name>"`);
      return out(opts.out, rec);
    }
    case "approve-f1": {
      if (typeof opts.actor !== "string") throw new Error('--actor "<your name>" is required');
      return out(opts.out, approveFinishing(await json(opts.finishing, "finishing"), opts.actor, typeof opts.notes === "string" ? opts.notes : ""));
    }
    // ─────────────────────────── A-Branch stages
    case "p1-scope": {
      const { proposal, review } = p1Scope({ input: await json(opts.input, "input") });
      if (typeof opts.review === "string") await text(opts.review, review);
      else console.error(review);
      return out(opts.out, proposal);
    }
    case "p1-draft": {
      const { draft, review } = await p1Draft({ input: await json(opts.input, "input"), scopeProposal: await json(opts.scope, "scope"), scopeApprovedBy: need(opts, "scope-approved-by", '"<adınız>"') });
      await text(need(opts, "review", "p1_review.md (okuyacağınız inceleme dosyası)"), review);
      await out(opts.out, draft);
      console.error(`${opts.review}'yi okuyun; onaylıyorsanız: unified p1-approve --draft ${opts.out ?? "<taslak>"} --review ${opts.review} --actor "<adınız>" --out research.json`);
      return;
    }
    case "p1-approve":
      // --review is required: the approver must have read exactly this draft's review
      return out(opts.out, p1Approve({ draft: await json(opts.draft, "draft"), actor: need(opts, "actor", '"<adınız>"'), review: await readFile(need(opts, "review", "p1_review.md (okuduğunuz inceleme)"), "utf8") }));
    case "p2-draft": {
      const { draft, review } = await p2Draft({ research: await json(opts.research, "research"), directive: await json(opts.directive, "directive"), input: validateP2Input(await json(opts.input, "input")) });
      await text(need(opts, "review", "p2_review.md (okuyacağınız inceleme dosyası)"), review);
      await out(opts.out, draft);
      console.error(`${opts.review}'yi okuyun; onaylıyorsanız: unified p2-approve --draft ${opts.out ?? "<taslak>"} --review ${opts.review} --actor "<adınız>" --out production_package.json`);
      return;
    }
    case "p2-approve":
      return out(opts.out, p2Approve({ draft: await json(opts.draft, "draft"), actor: need(opts, "actor", '"<adınız>"'), review: await readFile(need(opts, "review", "p2_review.md (okuduğunuz inceleme)"), "utf8") }));
    case "p3-plan": {
      const r = await p3Plan({ productionPackage: await json(opts.production, "production"), outDir: need(opts, "dir", "<döngü klasörü>"), language: typeof opts.language === "string" ? opts.language : "tr" });
      console.log(JSON.stringify(r, null, 2));
      return;
    }
    case "p3-ingest": {
      const r = await p3Ingest({ productionPackage: await json(opts.production, "production"), outDir: need(opts, "dir", "<döngü klasörü>"), actor: need(opts, "actor", '"<adınız>"'), ...(typeof opts.assets === "string" ? { assetsDir: opts.assets } : {}) });
      console.log(JSON.stringify(r, null, 2));
      return;
    }
    case "p3-preview": {
      const piperModel = typeof opts["piper-model"] === "string" ? opts["piper-model"] : defaultPiperModel();
      const r = await p3Preview({ productionPackage: await json(opts.production, "production"), outDir: need(opts, "dir", "<döngü klasörü>"), execGtts: venvExecGtts, execPiper: venvExecPiper, ...(piperModel ? { piperModelPath: piperModel } : {}) });
      console.log(JSON.stringify({ provider: r.provider, path: r.path }, null, 2));
      console.error(`Önizlemeyi dinleyin (${r.path}); sonra: unified p3-approve-voice … --actor "<adınız>"`);
      return;
    }
    case "p3-approve-voice": {
      const confirmed = typeof opts.confirm === "string" ? opts.confirm.split(",").map((x) => x.trim()).filter(Boolean) : undefined;
      const r = await p3ApproveVoice({ productionPackage: await json(opts.production, "production"), outDir: need(opts, "dir", "<döngü klasörü>"), actor: need(opts, "actor", '"<adınız>"'), ...(confirmed ? { confirmedPronunciations: confirmed } : {}) });
      console.log(JSON.stringify({ gate: r.gate.gate_id, unresolvedPronunciations: r.unresolvedPronunciations }, null, 2));
      return;
    }
    case "p3-resolve-ambiguity": {
      const r = await p3ResolveAmbiguity({ productionPackage: await json(opts.production, "production"), outDir: need(opts, "dir", "<döngü klasörü>"), actor: need(opts, "actor", '"<adınız>"') });
      console.log(JSON.stringify({ gate: r.gate.gate_id }, null, 2));
      return;
    }
    case "p3-voice": {
      const cfg = parseP3Config(await json(opts.config, "config"));
      if (!cfg.provider) throw new Error("p3_input.json → provider (elevenlabs | voicebox) gerekli");
      const r = await p3Voice({
        productionPackage: await json(opts.production, "production"),
        outDir: need(opts, "dir", "<döngü klasörü>"),
        provider: cfg.provider,
        ...(cfg.elevenlabs ? { elevenlabs: { voiceId: cfg.elevenlabs.voice_id, ...(cfg.elevenlabs.model_id ? { modelId: cfg.elevenlabs.model_id } : {}), ...(cfg.elevenlabs.char_budget ? { charBudget: cfg.elevenlabs.char_budget } : {}) } } : {}),
        ...(cfg.voicebox ? { voicebox: { profileId: cfg.voicebox.profile_id, ...(cfg.voicebox.engine ? { engine: cfg.voicebox.engine } : {}), ...(cfg.voicebox.base_url ? { baseUrl: cfg.voicebox.base_url } : {}) } } : {}),
        ...(opts.force === true ? { force: true } : {}),
      });
      console.log(JSON.stringify(r, null, 2));
      return;
    }
    case "p3-render": {
      const r = await p3Render({ productionPackage: await json(opts.production, "production"), outDir: need(opts, "dir", "<döngü klasörü>") });
      console.log(JSON.stringify({ mp4: r.mp4Path, qa: r.qa.result }, null, 2));
      console.error(`Videoyu izleyin (${r.mp4Path}); onaylıyorsanız: unified p3-approve … --actor "<adınız>"`);
      return;
    }
    case "p3-approve": {
      const r = await p3Approve({ productionPackage: await json(opts.production, "production"), outDir: need(opts, "dir", "<döngü klasörü>"), actor: need(opts, "actor", '"<adınız>"'), ...(typeof opts.notes === "string" ? { notes: opts.notes } : {}) });
      console.log(JSON.stringify({ final_delivery: r.finalDeliveryPath, gate: r.gate.gate_id }, null, 2));
      return;
    }
    case "p3-status":
      console.log(JSON.stringify(await p3Status(need(opts, "dir", "<döngü klasörü>")), null, 2));
      return;
    case "status":
    case "audit": {
      const dir = typeof opts.dir === "string" ? opts.dir : ".";
      const st = await auditCycle(dir);
      if (opts.json === true) return out(opts.out, st);
      console.log(formatStatus(st));
      if (!st.ok) process.exitCode = 2;
      return;
    }
    case "verify": {
      const env = await json(opts.file, "file");
      const kind = env.bundle_type ?? env.directive_type ?? env.package_type ?? env.proposal_type ?? env.record_type ?? env.approval_type ?? env.draft_type;
      const expected = ENVELOPE_TYPES[kind];
      if (!expected) throw new Error(`unknown envelope kind ${kind}`);
      verifyEnvelope("verify", env, expected);
      console.log(`OK ${kind} ${env.identity.content_hash}`);
      return;
    }
    default:
      console.log(HELP);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  if (err instanceof BridgeError && hintFor(err.code)) console.error(`→ Ne yapmalı: ${hintFor(err.code)}`);
  if (err instanceof SecretLeakError) console.error("→ Ne yapmalı: anahtarları .env'de tutun; girdilere (brief, options, bindings) yazmayın.");
  process.exit(1);
});
