// Bridge 3 — A-Branch P3 (Final Delivery) -> YouTube agent (Review / Publish)
//
// Position in the unified flow:  P3.10 --[Gate A7]--> THIS --> youtube-agent Review Studio
//
// The YouTube agent is used as the distribution + learning runtime. Its own
// research / script / TTS / video-generation stages are NOT used for this
// lane: the video was already produced under A-Branch governance. The import
// therefore:
//   * re-verifies P2's Production Package with P3's own ingest verifier,
//   * re-verifies the Final Delivery Package section hashes with P3's own
//     manifest verifier, and requires Gate A7 FINAL_QA_APPROVED,
//   * requires the directive (B) and the research lineage (P1) to agree with
//     the Production Package's recorded research hash,
//   * carries P1-verified claims into the agent's Evidence desk as
//     "supported" ONLY when they are P1 VERIFIED and backed by a URL source;
//     everything else arrives "pending" and blocks publishing until a human
//     resolves it (the agent's own fail-closed rule),
//   * leaves every YouTube-agent human gate OPEN (factual review, media
//     rights, synthetic-media disclosure, approval, publish time/privacy).

import { parseProductionPackage } from "pipeline3-production/dist/ingest.js";
import { verifyIntegrity } from "pipeline3-production/dist/manifest.js";
import type { FinalDeliveryPackage } from "pipeline3-production/dist/types.js";
import type {
  StrategicCreativeDirective,
  YouTubeImportClaim,
  YouTubeImportPackage,
  YouTubeImportScene,
  YouTubeImportSource,
} from "./contracts.js";
import { UNIFIED_SCHEMA_VERSION } from "./contracts.js";
import { assertDirectiveMatchesResearch } from "./bToP2.js";
import { BridgeError, assertHumanAuthority, sealEnvelope, shortHash, verifyEnvelope } from "./identity.js";
import { assertFinishingApproved, type FinishingApproval, type FinishingRecord } from "./finishing.js";

const BRIDGE = "P3->YouTube";

export interface YouTubeImportOptions {
  title?: string;
  tags?: string[];
  language?: string;
  /** AI-generated realistic visuals => true (default). Reviewed again in the agent. */
  contains_synthetic_media?: boolean;
  /** Long-form vs Shorts cut-off in seconds for vertical video. Default 180. */
  shorts_max_seconds?: number;
  now?: () => string;
}

interface RawClaim {
  claim_id: string;
  statement: string;
  evidence_refs: string[];
  contradiction_refs: string[];
  dimension: string;
}
interface RawSource {
  source_id: string;
  origin: string;
  source_type: string;
}
interface RawEvidence {
  evidence_id: string;
  source_id: string;
}
interface RawVerification {
  verification_id: string;
  claim_id: string;
  status: string;
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function safeId(prefix: string, raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 90);
  return `${prefix}_${cleaned}`;
}

export function buildYouTubeImport(params: {
  finalDelivery: FinalDeliveryPackage;
  productionPackage: unknown;
  researchPackage: unknown;
  directive: StrategicCreativeDirective;
  /** Optional P3.F finishing record + its Gate F1 approval. */
  finishing?: { record: FinishingRecord; approval: FinishingApproval };
  options?: YouTubeImportOptions;
}): YouTubeImportPackage {
  const { finalDelivery: fd, directive } = params;
  const options = params.options ?? {};
  verifyEnvelope(BRIDGE, directive, "UNIFIED_CREATIVE_DIRECTIVE");
  assertDirectiveMatchesResearch(directive, params.researchPackage);

  // --- P2 production package (P3's own verifier) ------------------------------
  let pp;
  try {
    pp = parseProductionPackage(params.productionPackage);
  } catch (err) {
    throw new BridgeError(BRIDGE, "PRODUCTION_PACKAGE_REJECTED", (err as Error).message);
  }
  const recordedResearch = pp.research_package_content_hash;
  if (!recordedResearch || recordedResearch !== directive.lineage.research_package_sha256) {
    throw new BridgeError(
      BRIDGE,
      "LINEAGE_BROKEN",
      `Production Package was built from research ${shortHash(recordedResearch ?? "<none>")}, directive/research is ${shortHash(directive.lineage.research_package_sha256)}`,
    );
  }

  // --- P3 final delivery (P3's own integrity + Gate A7) ------------------------
  if (fd.production_package_ref !== pp.package_id) {
    throw new BridgeError(BRIDGE, "DELIVERY_PACKAGE_MISMATCH", `final delivery references ${fd.production_package_ref}, not ${pp.package_id}`);
  }
  const intact = verifyIntegrity(
    {
      resolved_assets: fd.resolved_assets,
      narration: fd.narration,
      timing: fd.timing,
      timeline: fd.timeline,
      render: fd.render,
      qa: fd.qa,
      kaggle: fd.kaggle,
    },
    fd.integrity_hashes,
  );
  if (!intact) throw new BridgeError(BRIDGE, "FINAL_DELIVERY_TAMPERED", "final delivery section hashes do not match its integrity block");
  const a7 = fd.gates.find((g) => g.gate_id === "A7" && g.state_after === "FINAL_QA_APPROVED");
  if (!a7) throw new BridgeError(BRIDGE, "GATE_A7_MISSING", "final delivery has no FINAL_QA_APPROVED record");
  for (const g of fd.gates) {
    try {
      assertHumanAuthority(BRIDGE, g.actor, `Gate ${g.gate_id} actor`);
    } catch {
      throw new BridgeError(BRIDGE, "GATE_ACTOR_INVALID", `Gate ${g.gate_id} (${g.state_after}) was not given by a named person (${JSON.stringify(g.actor)})`);
    }
  }
  if (fd.render.result !== "success") throw new BridgeError(BRIDGE, "RENDER_NOT_SUCCESSFUL", `render result is ${fd.render.result}`);
  if (!["pass", "pass_with_findings"].includes(fd.qa.result)) {
    throw new BridgeError(BRIDGE, "QA_NOT_PASSED", `automated QA result is ${fd.qa.result}`);
  }
  const master = fd.render.outputs.find((o) => o.path.toLowerCase().endsWith(".mp4")) ?? fd.render.outputs[0];
  if (!master) throw new BridgeError(BRIDGE, "NO_RENDER_OUTPUT", "render manifest lists no outputs");
  const fin = params.finishing;
  if (fin) {
    assertFinishingApproved(fin.record, fin.approval, master.sha256);
    if (fin.record.final_delivery_package_id !== fd.final_delivery_package_id) throw new BridgeError(BRIDGE, "FINISHING_OF_OTHER_DELIVERY", "finishing record belongs to another final delivery");
  }
  const video = fin ? { path: fin.record.finished.path, sha256: fin.record.finished.sha256, bytes: fin.record.finished.bytes } : master;

  const fps = fd.timeline.fps;
  const duration = fin
    ? fin.record.finished.duration_seconds
    : fd.narration.production_voice?.duration_s && fd.narration.production_voice.duration_s > 0
      ? fd.narration.production_voice.duration_s
      : fd.timeline.total_frames / fps;

  // --- Scenes: informational, locked, all pointing at the master render ------
  const framesByShot = new Map<string, number>();
  for (const e of fd.timeline.entries) framesByShot.set(e.shot_id, (framesByShot.get(e.shot_id) ?? 0) + e.duration_frames);
  const synthetic = options.contains_synthetic_media ?? true;
  const scenes: YouTubeImportScene[] = pp.scenes.map((s: { scene_id: string; purpose: string; shots: string[]; narrative_function: string }) => {
    const frames = s.shots.reduce((sum, id) => sum + (framesByShot.get(id) ?? 0), 0);
    return {
      label: s.purpose.slice(0, 120) || s.scene_id,
      scriptText: s.narrative_function,
      prompt: `A-Branch scene ${s.scene_id} (shots: ${s.shots.join(", ")})`,
      duration: Math.max(0.1, Math.round((frames / fps) * 100) / 100),
      assetType: "video",
      assetOrigin: "generated",
      provider: "a-branch-p3-remotion",
      provenanceSourceIds: [],
      containsSyntheticMedia: synthetic,
      rightsConfirmed: false,
      locked: true,
    };
  });

  // --- Provenance: only claims actually narrated (P2 voice_lines lineage) ----
  const research = params.researchPackage as Record<string, unknown>;
  const claims = new Map((research.claims as RawClaim[]).map((c) => [c.claim_id, c]));
  const sources = new Map((research.sources as RawSource[]).map((s) => [s.source_id, s]));
  const evidence = new Map((research.evidence as RawEvidence[]).map((e) => [e.evidence_id, e]));
  const verification = new Map(((research.verifications ?? []) as RawVerification[]).map((v) => [v.claim_id, v]));

  const narrated = [...new Set((pp.voice_lines ?? []).map((l: { claim_id?: string }) => l.claim_id).filter((x: unknown): x is string => typeof x === "string"))];
  const ySources = new Map<string, YouTubeImportSource>();
  const yClaims: YouTubeImportClaim[] = [];
  for (const claimId of narrated) {
    const claim = claims.get(claimId);
    if (!claim) throw new BridgeError(BRIDGE, "UNKNOWN_NARRATED_CLAIM", `voice line cites claim ${claimId} absent from research package`);
    const v = verification.get(claimId);
    const status = v?.status ?? "UNKNOWN";
    const urlSourceIds: string[] = [];
    const nonUrl: string[] = [];
    for (const evId of claim.evidence_refs) {
      const src = sources.get(evidence.get(evId)?.source_id ?? "");
      if (!src) continue;
      if (isHttpUrl(src.origin)) {
        const id = safeId("p1src", src.source_id);
        const prev = ySources.get(id);
        ySources.set(id, {
          id,
          url: src.origin,
          title: src.origin,
          sourceType: src.source_type === "primary" ? "official" : "article",
          status: prev?.status === "verified" || status === "VERIFIED" ? "verified" : "pending",
          notes: `A-Branch P1 source ${src.source_id} (${src.source_type}); research package ${directive.lineage.research_package_id}; Gate A1 ${directive.lineage.gate_a1_record_id}`,
        });
        urlSourceIds.push(id);
      } else {
        nonUrl.push(src.origin);
      }
    }
    const supported = status === "VERIFIED" && urlSourceIds.length > 0;
    yClaims.push({
      id: safeId("p1claim", claimId),
      text: claim.statement,
      sourceIds: urlSourceIds,
      status: supported ? "supported" : "pending",
      riskLevel: claim.contradiction_refs.length > 0 ? "high" : "standard",
      notes: supported
        ? `P1.04 verification ${v?.verification_id} = VERIFIED`
        : `P1 status ${status}${nonUrl.length ? `; non-URL sources need manual evidence: ${nonUrl.join(" | ")}` : ""}`,
    });
  }
  // A "verified" source must back at least one supported claim.
  for (const s of ySources.values()) {
    if (!yClaims.some((c) => c.status === "supported" && c.sourceIds.includes(s.id))) s.status = "pending";
  }

  // --- SEO draft (a starting point; edited by a human in Review Studio) -------
  const scope = research.research_scope as { topic: string; objective?: string; output_language?: string };
  const lang = options.language ?? (scope.output_language && /^[a-z]{2,3}$/.test(scope.output_language) ? scope.output_language : "en");
  const verifiedUrls = [...ySources.values()].filter((s) => s.status === "verified").map((s) => s.url);
  const description = [
    scope.objective ?? scope.topic,
    "",
    verifiedUrls.length ? "Sources:" : "",
    ...verifiedUrls.slice(0, 15).map((u) => `- ${u}`),
    synthetic ? "\nThis video contains AI-generated visual reconstructions." : "",
  ]
    .filter((l) => l !== "")
    .join("\n");
  const tags = options.tags ?? [scope.topic, ...scope.topic.split(/[\s,;:]+/).filter((w) => w.length >= 4)].slice(0, 8);

  const shortsMax = options.shorts_max_seconds ?? 180;
  const contentType = directive.format.aspect_ratio === "9:16" && duration <= shortsMax ? "short" : "long_form";
  const pendingClaims = yClaims.filter((c) => c.status === "pending").length;
  const open_human_gates = [
    "YT:factual_review_attestation",
    "YT:media_rights_attestation",
    "YT:synthetic_media_disclosure",
    "YT:seo_title_description_review",
    "YT:approval",
    "YT:publish_time_and_privacy",
    ...(pendingClaims ? [`YT:evidence_desk_pending_claims(${pendingClaims})`] : []),
    ...(directive.compliance.unresolved.length ? [`B11:unresolved_compliance(${directive.compliance.unresolved.length})`] : []),
  ];

  const now = options.now ?? (() => new Date().toISOString());
  const created_at = now();
  const body: Omit<YouTubeImportPackage, "identity"> = {
    package_type: "P3_TO_YOUTUBE_IMPORT",
    schema_version: UNIFIED_SCHEMA_VERSION,
    production_id: `up_${shortHash(fd.final_delivery_package_id.replace(/[^a-zA-Z0-9]/g, ""), 24)}`,
    project_id: directive.project_id,
    lineage: directive.lineage,
    directive_hash: directive.identity.content_hash,
    production_package: {
      package_id: pp.package_id,
      version: pp.production_package_version,
      content_hash: (pp as unknown as { identity?: { content_hash?: string } }).identity?.content_hash ?? pp.integrity_hashes.package_sha256,
    },
    final_delivery: {
      final_delivery_package_id: fd.final_delivery_package_id,
      package_sha256: fd.integrity_hashes.package_sha256,
      render_run_id: fd.render.run_id,
      video_path: video.path,
      video_sha256: video.sha256,
      video_bytes: video.bytes,
      duration_seconds: Math.round(duration * 100) / 100,
      resolution: fd.render.resolution,
      aspect_ratio: directive.format.aspect_ratio,
      qa_result: fd.qa.result,
      gate_a7_record_id: a7.approval_record_id,
    },
    channel_id: directive.channel.channel_id,
    script_text: pp.voice_script,
    narration_audio: {
      path: fd.narration.production_voice.audio_path,
      sha256: fd.narration.production_voice.audio_hash,
      provider: (fd.narration.production_voice as { provider?: string }).provider ?? "elevenlabs",
      duration_seconds: fd.narration.production_voice.duration_s,
    },
    seo_draft: {
      title: (options.title ?? scope.topic).slice(0, 100),
      description: description.length >= 50 ? description.slice(0, 5000) : `${description}\n\nResearch-backed production (${directive.lineage.research_package_id}).`,
      tags,
      defaultLanguage: lang,
      origin: "unified-pipeline-draft",
    },
    scenes,
    provenance: { sources: [...ySources.values()], claims: yClaims, containsSyntheticMedia: synthetic },
    publishing_hints: {
      content_type: contentType,
      privacy_status: "private",
      schedule: directive.schedule,
      kpis: directive.kpis,
    },
    finishing: fin
      ? {
          record_hash: fin.record.identity.content_hash,
          f1_approval_hash: fin.approval.identity.content_hash,
          f1_actor: fin.approval.actor,
          master_sha256: master.sha256,
          captions: fin.record.captions ? { path: fin.record.captions.path, sha256: fin.record.captions.sha256, language: fin.record.captions.language, timing_basis: fin.record.captions.timing_basis, burned: fin.record.captions.burned } : null,
          music: fin.record.music ? { sha256: fin.record.music.sha256, source: fin.record.music.source, license: fin.record.music.license, attested_by: fin.record.music.attested_by } : null,
        }
      : null,
    open_human_gates,
    created_at,
  };
  return sealEnvelope<YouTubeImportPackage>(body, {
    object_id: body.production_id,
    object_type: "UNIFIED_YOUTUBE_IMPORT",
    version: "v1",
    created_at,
  });
}
