// P3.09 QA — automated, technical checks only (ADAPT of Studio's
// qa_report.schema.json field names, minus its subjective 0-100 axis-score
// rubric — that's creative judgment, out of scope for automated QA).
// Human QA (narrative quality, continuity, aesthetics, emotion) is recorded
// separately via recordHumanQAFindings(), which cannot itself approve
// anything — only Gate A7 (gates.ts) can.
//
// NAMING: this is the canonical P3.09 in the linear P3.01→P3.10 production
// sequence (see runP309QA in pipeline.ts). It is unrelated to the
// "P3.08-DIST" distributed-render modules (orchestration_p309.ts,
// distribution.ts, sharding.ts, scheduling.ts, merge.ts, feedback.ts,
// recovery.ts) — those implement an optional distributed variant of P3.08
// Render and, despite the "_p309"/"p309" filename fragment left over from
// an earlier numbering, are NOT phase P3.09 and do not perform QA.

import { stableQaReportId } from "./ids.js";
import type { MediaProbeResult } from "./assetValidation.js";
import type {
  AssetRequirement,
  HumanQAFindings,
  IntegrityHashes,
  ManifestEntry,
  QAFinding,
  QAReport,
  RenderManifest,
  ResolvedAsset,
  Timeline,
} from "./types.js";

// AUDIT FIX (forensic integration audit, §13 item 2): validateAssetDecodability
// (assetValidation.ts) was defined but never invoked by any orchestration
// path or by this QA report, so 5 of 14 QAFindingCategory values
// (decode_error/codec/fps/dimensions/audio_presence) were never actually
// populated by any code. This record carries real probe results in.
export interface AssetProbeRecord {
  asset_requirement_id: string;
  shot_id: string;
  probe: MediaProbeResult;
}

export function runAutomatedQA(params: {
  targetId: string;
  // TIER-1 REPAIR T1.12 — the report must name the exact artifact it
  // describes. Previously report_id was hash(scope, targetId) and nothing
  // else, so a QA report could not be tied to a render or a package version
  // and Gate A7 approved by report_id alone.
  productionPackageId: string;
  productionPackageVersion: string;
  productionPackageHash: string;
  assetRequirements: AssetRequirement[];
  resolvedAssets: ResolvedAsset[];
  assetProbes: AssetProbeRecord[];
  timeline: Timeline;
  render: RenderManifest;
  narrationDurationS: number;
  manifest: ManifestEntry[];
  integrityHashes: IntegrityHashes;
  recomputedPackageSha256: string;
}): QAReport {
  const findings: QAFinding[] = [];
  const resolvedIds = new Set(params.resolvedAssets.map((a) => a.asset_requirement_id));

  // missing_asset
  for (const req of params.assetRequirements) {
    if (req.required && !resolvedIds.has(req.asset_requirement_id)) {
      findings.push({ category: "missing_asset", severity: "error", message: `required asset for "${req.asset_requirement_id}" was never resolved`, object_id: req.asset_requirement_id });
    }
  }

  // decode_error / codec / fps / dimensions / audio_presence — derived from
  // real media-probe results (previously dead categories, never populated).
  const requirementById = new Map(params.assetRequirements.map((r) => [r.asset_requirement_id, r]));
  for (const record of params.assetProbes) {
    const requirement = requirementById.get(record.asset_requirement_id);
    const probe = record.probe;

    if (!probe.decodable) {
      findings.push({ category: "decode_error", severity: "error", message: "asset failed to decode", object_id: record.asset_requirement_id });
      continue; // other probe fields are meaningless if it didn't decode
    }

    const isVideoRequirement = requirement?.expected_media_type === "VISUAL_VIDEO";
    const isAudioRequirement = requirement !== undefined && ["VOICE", "MUSIC", "SFX"].includes(requirement.expected_media_type);

    if (isVideoRequirement && !probe.codec) {
      findings.push({ category: "codec", severity: "warning", message: "video asset has no detectable codec", object_id: record.asset_requirement_id });
    }
    if (isVideoRequirement && probe.fps !== undefined && Math.round(probe.fps) !== params.timeline.fps) {
      findings.push({ category: "fps", severity: "warning", message: `asset fps (${probe.fps}) differs from timeline fps (${params.timeline.fps})`, object_id: record.asset_requirement_id });
    }

    const expectedWidth = requirement?.expected_media_properties?.["width"];
    const expectedHeight = requirement?.expected_media_properties?.["height"];
    if (typeof expectedWidth === "number" && probe.width !== undefined && probe.width !== expectedWidth) {
      findings.push({ category: "dimensions", severity: "warning", message: `asset width ${probe.width} differs from expected ${expectedWidth}`, object_id: record.asset_requirement_id });
    }
    if (typeof expectedHeight === "number" && probe.height !== undefined && probe.height !== expectedHeight) {
      findings.push({ category: "dimensions", severity: "warning", message: `asset height ${probe.height} differs from expected ${expectedHeight}`, object_id: record.asset_requirement_id });
    }

    if (isAudioRequirement && probe.has_audio === false) {
      findings.push({ category: "audio_presence", severity: "error", message: "audio-type asset has no audio track", object_id: record.asset_requirement_id });
    }
  }

  // render_integrity
  if (params.render.result !== "success" || params.render.outputs.length === 0) {
    findings.push({ category: "render_integrity", severity: "error", message: `render did not complete successfully (result="${params.render.result}")`, object_id: params.render.run_id });
  }

  // duration / av_sync: compare timeline total duration to narration duration
  const timelineDurationS = params.timeline.total_frames / params.timeline.fps;
  const durationDeltaS = Math.abs(timelineDurationS - params.narrationDurationS);
  if (durationDeltaS > 1) {
    findings.push({ category: "duration", severity: "warning", message: `timeline duration (${timelineDurationS}s) differs from narration duration (${params.narrationDurationS}s) by ${durationDeltaS}s` });
  }
  if (durationDeltaS > 3) {
    findings.push({ category: "av_sync", severity: "error", message: `timeline/narration mismatch exceeds A/V sync tolerance (${durationDeltaS}s)` });
  }

  // package_integrity
  if (params.recomputedPackageSha256 !== params.integrityHashes.package_sha256) {
    findings.push({ category: "package_integrity", severity: "error", message: "recomputed package hash does not match declared integrity_hashes.package_sha256" });
  }
  if (!params.manifest.length) {
    findings.push({ category: "package_integrity", severity: "error", message: "manifest is empty" });
  }

  const hasError = findings.some((f) => f.severity === "error");
  const result: QAReport["result"] = hasError ? "fail" : findings.length > 0 ? "pass_with_findings" : "pass";

  // T1.12 — report identity now covers the render run and the package
  // version, so two QA reports over different renders of the same target
  // can never collide on report_id.
  const render_output_sha256 = params.render.outputs[0]?.sha256 ?? "";
  return {
    report_id: stableQaReportId(
      "master",
      `${params.targetId}::${params.productionPackageHash}::${params.render.run_id}::${render_output_sha256}`,
    ),
    scope: "master",
    target_id: params.targetId,
    result,
    findings,
    human_review_required: true, // technical QA never substitutes for Gate A7
    production_package_id: params.productionPackageId,
    production_package_version: params.productionPackageVersion,
    production_package_hash: params.productionPackageHash,
    render_run_id: params.render.run_id,
    render_output_sha256,
  };
}

// Structures caller-supplied human observations only — never fabricates a
// finding, never sets an approval state itself.
export function recordHumanQAFindings(input: {
  narrative_quality?: string;
  continuity?: string;
  aesthetics?: string;
  emotion?: string;
  notes?: string[];
}): HumanQAFindings {
  return {
    narrative_quality: input.narrative_quality,
    continuity: input.continuity,
    aesthetics: input.aesthetics,
    emotion: input.emotion,
    notes: input.notes ?? [],
  };
}
