// P3.09 QA — item 21 (automated QA failure cases per category), item 22
// (package-integrity QA), plus the correction-8 test that automated QA
// cannot self-approve Gate A7.

import { describe, expect, it } from "vitest";
import { GateStateError } from "../src/errors.js";
import { requireGateState } from "../src/gates.js";
import { recordHumanQAFindings, runAutomatedQA } from "../src/qa.js";
import type { AssetProbeRecord } from "../src/qa.js";
import { buildManifestAndIntegrity } from "../src/manifest.js";
import type { AssetRequirement, RenderManifest, ResolvedAsset, Timeline } from "../src/types.js";

const requirements: AssetRequirement[] = [
  { asset_requirement_id: "r1", shot_id: "s1", expected_media_type: "VISUAL_IMAGE", expected_media_properties: {}, generation_method: "x", reference_lineage: [], required: true },
  { asset_requirement_id: "r2", shot_id: "s2", expected_media_type: "VISUAL_VIDEO", expected_media_properties: {}, generation_method: "x", reference_lineage: [], required: true },
];
const resolvedBoth: ResolvedAsset[] = [
  { asset_requirement_id: "r1", shot_id: "s1", asset_file_id: "f1", hash: "h1", media_properties: {} },
  { asset_requirement_id: "r2", shot_id: "s2", asset_file_id: "f2", hash: "h2", media_properties: {} },
];
const goodRender: RenderManifest = { run_id: "RUN-1", scope: "master", target_id: "t1", fps: 30, resolution: "1080x1920", codec: "h264", outputs: [{ path: "out.mp4", sha256: "x", bytes: 100 }], result: "success" };
const timeline: Timeline = { fps: 30, total_frames: 180, entries: [] }; // 6s
const { manifest, integrity_hashes } = buildManifestAndIntegrity({ resolved_assets: [], narration: {}, timing: {}, timeline: {}, render: {}, qa: {}, kaggle: {} });

describe("Automated QA — per-category failures (item 21)", () => {
  it("missing_asset: flags a required requirement with no resolved asset", () => {
    const report = runAutomatedQA({
      targetId: "t1",
      assetRequirements: requirements,
      resolvedAssets: [resolvedBoth[0]!], // r2 missing
      assetProbes: [],
      timeline,
      render: goodRender,
      narrationDurationS: 6,
      manifest,
      integrityHashes: integrity_hashes,
      recomputedPackageSha256: integrity_hashes.package_sha256,
    });
    expect(report.findings.some((f) => f.category === "missing_asset")).toBe(true);
    expect(report.result).toBe("fail");
  });

  it("render_integrity: flags a failed render", () => {
    const report = runAutomatedQA({
      targetId: "t1",
      assetRequirements: requirements,
      resolvedAssets: resolvedBoth,
      assetProbes: [],
      timeline,
      render: { ...goodRender, result: "failed", outputs: [] },
      narrationDurationS: 6,
      manifest,
      integrityHashes: integrity_hashes,
      recomputedPackageSha256: integrity_hashes.package_sha256,
    });
    expect(report.findings.some((f) => f.category === "render_integrity")).toBe(true);
    expect(report.result).toBe("fail");
  });

  it("duration / av_sync: flags when timeline duration diverges from narration duration", () => {
    const report = runAutomatedQA({
      targetId: "t1",
      assetRequirements: requirements,
      resolvedAssets: resolvedBoth,
      assetProbes: [],
      timeline: { fps: 30, total_frames: 30, entries: [] }, // 1s timeline
      render: goodRender,
      narrationDurationS: 6, // vs 1s timeline -> big mismatch
      manifest,
      integrityHashes: integrity_hashes,
      recomputedPackageSha256: integrity_hashes.package_sha256,
    });
    expect(report.findings.some((f) => f.category === "av_sync")).toBe(true);
  });

  it("passes clean with no findings when everything is consistent", () => {
    const report = runAutomatedQA({
      targetId: "t1",
      assetRequirements: requirements,
      resolvedAssets: resolvedBoth,
      assetProbes: [],
      timeline,
      render: goodRender,
      narrationDurationS: 6,
      manifest,
      integrityHashes: integrity_hashes,
      recomputedPackageSha256: integrity_hashes.package_sha256,
    });
    expect(report.result).toBe("pass");
    expect(report.findings).toHaveLength(0);
  });
});

describe("package-integrity QA (item 22)", () => {
  it("flags a package hash mismatch", () => {
    const report = runAutomatedQA({
      targetId: "t1",
      assetRequirements: requirements,
      resolvedAssets: resolvedBoth,
      assetProbes: [],
      timeline,
      render: goodRender,
      narrationDurationS: 6,
      manifest,
      integrityHashes: integrity_hashes,
      recomputedPackageSha256: "0000000000000000000000000000000000000000000000000000000000000",
    });
    expect(report.findings.some((f) => f.category === "package_integrity")).toBe(true);
  });

  it("flags an empty manifest", () => {
    const report = runAutomatedQA({
      targetId: "t1",
      assetRequirements: requirements,
      resolvedAssets: resolvedBoth,
      assetProbes: [],
      timeline,
      render: goodRender,
      narrationDurationS: 6,
      manifest: [],
      integrityHashes: integrity_hashes,
      recomputedPackageSha256: integrity_hashes.package_sha256,
    });
    expect(report.findings.some((f) => f.category === "package_integrity")).toBe(true);
  });
});

describe("AUDIT FIX §13.2 — probe-based findings (validateAssetDecodability wired in)", () => {
  const decodableImageProbe: AssetProbeRecord = { asset_requirement_id: "r1", shot_id: "s1", probe: { decodable: true, has_audio: false } };
  const cleanVideoProbe: AssetProbeRecord = { asset_requirement_id: "r2", shot_id: "s2", probe: { decodable: true, codec: "h264", fps: 30, width: 1080, height: 1920, has_audio: false } };

  it("decode_error: flags an asset that failed to decode, and skips its other probe checks", () => {
    const report = runAutomatedQA({
      targetId: "t1",
      assetRequirements: requirements,
      resolvedAssets: resolvedBoth,
      assetProbes: [decodableImageProbe, { asset_requirement_id: "r2", shot_id: "s2", probe: { decodable: false } }],
      timeline,
      render: goodRender,
      narrationDurationS: 6,
      manifest,
      integrityHashes: integrity_hashes,
      recomputedPackageSha256: integrity_hashes.package_sha256,
    });
    expect(report.findings.filter((f) => f.category === "decode_error")).toHaveLength(1);
    expect(report.findings.some((f) => f.category === "codec" || f.category === "fps" || f.category === "dimensions")).toBe(false);
    expect(report.result).toBe("fail");
  });

  it("codec: flags a video requirement whose probe reports no codec", () => {
    const report = runAutomatedQA({
      targetId: "t1",
      assetRequirements: requirements,
      resolvedAssets: resolvedBoth,
      assetProbes: [decodableImageProbe, { ...cleanVideoProbe, probe: { ...cleanVideoProbe.probe, codec: undefined } }],
      timeline,
      render: goodRender,
      narrationDurationS: 6,
      manifest,
      integrityHashes: integrity_hashes,
      recomputedPackageSha256: integrity_hashes.package_sha256,
    });
    expect(report.findings.some((f) => f.category === "codec")).toBe(true);
  });

  it("fps: flags a video asset whose probed fps differs from the timeline fps", () => {
    const report = runAutomatedQA({
      targetId: "t1",
      assetRequirements: requirements,
      resolvedAssets: resolvedBoth,
      assetProbes: [decodableImageProbe, { ...cleanVideoProbe, probe: { ...cleanVideoProbe.probe, fps: 24 } }],
      timeline, // fps: 30
      render: goodRender,
      narrationDurationS: 6,
      manifest,
      integrityHashes: integrity_hashes,
      recomputedPackageSha256: integrity_hashes.package_sha256,
    });
    expect(report.findings.some((f) => f.category === "fps")).toBe(true);
  });

  it("dimensions: flags a video asset whose probed width/height differ from the requirement's expected properties", () => {
    const requirementsWithDims: AssetRequirement[] = [
      requirements[0]!,
      { ...requirements[1]!, expected_media_properties: { width: 1080, height: 1920 } },
    ];
    const report = runAutomatedQA({
      targetId: "t1",
      assetRequirements: requirementsWithDims,
      resolvedAssets: resolvedBoth,
      assetProbes: [decodableImageProbe, { ...cleanVideoProbe, probe: { ...cleanVideoProbe.probe, width: 720, height: 1280 } }],
      timeline,
      render: goodRender,
      narrationDurationS: 6,
      manifest,
      integrityHashes: integrity_hashes,
      recomputedPackageSha256: integrity_hashes.package_sha256,
    });
    const dimensionFindings = report.findings.filter((f) => f.category === "dimensions");
    expect(dimensionFindings).toHaveLength(2); // width mismatch + height mismatch
  });

  it("audio_presence: flags a VOICE/MUSIC/SFX requirement whose probe reports no audio track", () => {
    const voiceRequirement: AssetRequirement = { asset_requirement_id: "r3", shot_id: "s3", expected_media_type: "VOICE", expected_media_properties: {}, generation_method: "x", reference_lineage: [], required: true };
    const resolvedVoice: ResolvedAsset = { asset_requirement_id: "r3", shot_id: "s3", asset_file_id: "f3", hash: "h3", media_properties: {} };
    const report = runAutomatedQA({
      targetId: "t1",
      assetRequirements: [voiceRequirement],
      resolvedAssets: [resolvedVoice],
      assetProbes: [{ asset_requirement_id: "r3", shot_id: "s3", probe: { decodable: true, has_audio: false } }],
      timeline,
      render: goodRender,
      narrationDurationS: 6,
      manifest,
      integrityHashes: integrity_hashes,
      recomputedPackageSha256: integrity_hashes.package_sha256,
    });
    expect(report.findings.some((f) => f.category === "audio_presence")).toBe(true);
    expect(report.result).toBe("fail");
  });

  it("clean probes (decodable, matching codec/fps/dimensions/audio) produce no probe-based findings", () => {
    const report = runAutomatedQA({
      targetId: "t1",
      assetRequirements: requirements,
      resolvedAssets: resolvedBoth,
      assetProbes: [decodableImageProbe, cleanVideoProbe],
      timeline,
      render: goodRender,
      narrationDurationS: 6,
      manifest,
      integrityHashes: integrity_hashes,
      recomputedPackageSha256: integrity_hashes.package_sha256,
    });
    expect(report.findings.filter((f) => ["decode_error", "codec", "fps", "dimensions", "audio_presence"].includes(f.category))).toHaveLength(0);
    expect(report.result).toBe("pass");
  });
});

describe("automated QA cannot self-approve Gate A7 (correction 8)", () => {
  it("a passing QAReport does not itself satisfy Gate A7 — a separate human approval is always required", () => {
    const report = runAutomatedQA({
      targetId: "t1",
      assetRequirements: requirements,
      resolvedAssets: resolvedBoth,
      assetProbes: [],
      timeline,
      render: goodRender,
      narrationDurationS: 6,
      manifest,
      integrityHashes: integrity_hashes,
      recomputedPackageSha256: integrity_hashes.package_sha256,
    });
    expect(report.result).toBe("pass");
    expect(report.human_review_required).toBe(true);
    // No gate record exists yet — QA passing alone never creates one.
    expect(() => requireGateState([], "A7", "FINAL_QA_APPROVED")).toThrow(GateStateError);
  });

  it("recordHumanQAFindings only structures input — it has no way to set an approval state", () => {
    const findings = recordHumanQAFindings({ narrative_quality: "strong", notes: ["good pacing"] });
    expect(findings.narrative_quality).toBe("strong");
    expect((findings as unknown as Record<string, unknown>).status).toBeUndefined();
    expect((findings as unknown as Record<string, unknown>).approved).toBeUndefined();
  });
});
