// Golden end-to-end test (item 29): static Production Package fixture +
// static Production Delivery fixture -> P3.01 (all three validation
// layers) -> asset validation -> deterministic matching -> Piper preview
// (fixture adapter) -> Gate A5 -> ElevenLabs preflight -> production voice
// (fixture adapter) -> narration-master timing -> timeline -> render
// (fixture adapter) -> automated QA -> Gate A7 -> Kaggle delivery (fixture
// adapter) -> schema-complete Final Delivery Package.
//
// Every external interaction below is a clearly-named fixture/reference
// adapter at the low-level I/O boundary only. No real Piper/ElevenLabs/
// Remotion/Kaggle service is contacted.

import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseProductionDelivery, parseProductionPackage } from "../src/ingest.js";
import { resolveAllAssetRequirements } from "../src/assetMatching.js";
import { validateAssetHash } from "../src/assetValidation.js";
import type { MediaProbe } from "../src/assetValidation.js";
import type { ExecPiperSubprocess } from "../src/piper.js";
import { approvePiperPreview } from "../src/voiceApproval.js";
import { runElevenLabsPreflight } from "../src/preflight.js";
import type { PreflightCheckFns } from "../src/preflight.js";
import type { PostElevenLabsHttp, VoiceLock } from "../src/elevenlabs.js";
import { CostLedger } from "../src/costLedger.js";
import { StageCache } from "../src/checkpoint.js";
import { runP306Timing, runP307Timeline, runP308Render, runP309QA, runP310Kaggle } from "../src/pipeline.js";
import type { ExecRemotionRender } from "../src/render.js";
import { recordHumanQAFindings } from "../src/qa.js";
import type { ExecKaggleCli } from "../src/kaggle.js";
import type { StageAssetFile, WriteStagingFile } from "../src/assetStaging.js";
import {
  approveAmbiguityResolution,
  approveDeliveryReceived,
  approveFinalQA,
  assembleFinalDeliveryPackage,
  runIngestValidateMatch,
  runP302AssetValidation,
  runP304VoicePreviewWithFallback,
  runP305ElevenLabsProductionVoice,
} from "../src/pipeline.js";
import type { ExecGttsSubprocess } from "../src/gtts.js";
import { buildManifestAndIntegrity } from "../src/manifest.js";
import { PRODUCTION_PACKAGE_FIXTURE } from "./fixtures/production_package.fixture.js";
import { PRODUCTION_DELIVERY_FIXTURE } from "./fixtures/production_delivery.fixture.js";
import { approvedA4Fixture } from "./helpers/gateFixtures.js";

// --- Fixture / reference adapters — the ONLY things "external" in this test ---

const fixtureExecPiper: ExecPiperSubprocess = async ({ text }) => {
  const words = text.trim().split(/\s+/).length;
  return { measuredDurationS: words / 2.5 }; // deterministic, no real subprocess
};

const allGoodPreflightFns: PreflightCheckFns = {
  checkApiConnectivity: async () => true,
  checkVoiceAvailability: async () => true,
  checkModelAvailability: async () => true,
  getQuotaRemaining: async () => 1_000_000,
};

function fixturePostElevenLabsHttp(narrationDurationS: number): PostElevenLabsHttp {
  const PCM_SAMPLE_RATE = 24000;
  const PCM_BYTES_PER_SAMPLE = 2;
  const bytes = Math.round(narrationDurationS * PCM_SAMPLE_RATE * PCM_BYTES_PER_SAMPLE);
  return async () => ({ status: 200, bodyBytes: Buffer.alloc(bytes) });
}

const fixtureListenCheck = async () => ({ ratio: 0.96, attempts: 1 }); // no real Whisper/NVCF call

const fixtureExecRemotionRender: ExecRemotionRender = async ({ outputPath }) => {
  // Real bytes on disk, not just a metadata claim — render.ts hashes actual
  // file content, so the fixture must produce a real (if fake-video) file.
  await fs.writeFile(outputPath, Buffer.alloc(4_200_000, 0x42));
  return { bytes: 4_200_000 };
}; // no real remotion CLI

// R07 REPAIR NOTE: this fixture used to report a HARDCODED filename
// ("final_video.mp4") unrelated to the real file being staged
// (render.outputs[0]!.path, an actual temp path from the real Remotion
// render earlier in this test) — only viable while post-upload
// verification compared counts only. Now that it compares the exact
// (name, size) set, this fixture tracks the REAL basename staged via the
// stageFile callback, same pattern as kaggle.test.ts's own R07 fix.
let goldenStagedNames: string[] = [];
const fixtureExecKaggleCli: ExecKaggleCli = async (args) => {
  if (args[0] === "datasets" && args[1] === "files") {
    const rows = goldenStagedNames.map((name) => `${name},100`);
    return { exitCode: 0, stdout: `name,size\n${rows.join("\n")}\n` };
  }
  return { exitCode: 0, stdout: "dataset created (fixture)" };
}; // no real kaggle CLI

const fixtureStageAssetFile: StageAssetFile = async (_src, dest) => {
  goldenStagedNames.push(path.basename(dest));
};
const fixtureWriteStagingFile: WriteStagingFile = async () => {};

// AUDIT FIX (§13 item 2): deterministic fixture media probe, keyed by
// asset_file_id (matches PRODUCTION_DELIVERY_FIXTURE) — no real ffprobe call.
const fixtureMediaProbe: MediaProbe = async (assetFileId: string) => {
  if (assetFileId === "file_water_flow_001") {
    return { decodable: true, codec: "h264", has_audio: false };
  }
  return { decodable: true }; // file_wide_arch_001 (image) — no video-only checks apply
};

describe("Pipeline 3 golden end-to-end (item 29)", () => {
  it("runs the full P3.01 -> P3.10 sequence from static fixtures to a schema-complete Final Delivery Package", async () => {
    const actor = "user:mk350174";

    // P3.01 — all three validation layers, both inputs
    const pkg = parseProductionPackage(PRODUCTION_PACKAGE_FIXTURE);
    const delivery = parseProductionDelivery(PRODUCTION_DELIVERY_FIXTURE);

    // Gate A4
    const gateA4 = approveDeliveryReceived(actor, pkg.package_id);

    // P3.02 (asset validation) + P3.03 (asset matching), gated on A4
    for (const file of delivery.generated_assets) validateAssetHash(file);
    const resolvedAssets = runIngestValidateMatch(pkg, delivery, [gateA4]);
    expect(resolvedAssets).toHaveLength(2);
    // Cross-check against the standalone matcher too.
    expect(resolveAllAssetRequirements(pkg.asset_requirements, delivery.asset_delivery_map, delivery.generated_assets)).toHaveLength(2);

    // P3.02 (decodability) — validateAssetDecodability wired into real
    // orchestration (AUDIT FIX §13 item 2), feeding QA's probe-based findings.
    const assetProbes = await runP302AssetValidation(resolvedAssets, delivery.generated_assets, fixtureMediaProbe);
    expect(assetProbes).toHaveLength(2);

    // P3.04 — voice preview through the REAL tiered production path
    // (runP304VoicePreviewWithFallback): Piper first, gTTS only on Piper
    // failure, never automatic ElevenLabs. This fixture Piper succeeds, so
    // per policy gTTS must never be invoked — the failing gTTS fixture below
    // proves that (it would throw and fail this test if it were called).
    const intendedTotalS = 3.5 + 2.5; // matches the fixture shots' duration_intention midpoints
    const costLedger = new CostLedger(1_000_000);
    const piperCache = new StageCache();
    let piperSeamCalls = 0;
    let gttsSeamCalls = 0;
    const countedFixtureExecPiper: ExecPiperSubprocess = async (p) => {
      piperSeamCalls += 1;
      return fixtureExecPiper(p);
    };
    const shouldNotBeCalledExecGtts: ExecGttsSubprocess = async () => {
      gttsSeamCalls += 1;
      throw new Error("gTTS seam invoked despite Piper succeeding — Tier-1-success-skips-Tier-2 policy violated");
    };
    const piperPreviewParams = {
      text: pkg.voice_script,
      piperOutputPath: "preview.wav",
      gttsOutputPath: "preview_gtts.wav",
      modelPath: "tr_TR-dfki-medium.onnx",
      language: "tr",
      targetDurationS: intendedTotalS,
    };
    const piperPreview = await runP304VoicePreviewWithFallback(piperPreviewParams, piperCache, costLedger, countedFixtureExecPiper, shouldNotBeCalledExecGtts);
    expect(piperPreview.output_path).toBe("preview.wav");
    expect("provider" in piperPreview && piperPreview.provider === "gtts").toBe(false); // Tier 1 (Piper) result, not Tier 2
    expect(gttsSeamCalls).toBe(0);
    // Repeat call, identical inputs: proves the real StageCache wiring —
    // the fixture seam is not re-invoked, and cost is not re-logged.
    const piperPreviewAgain = await runP304VoicePreviewWithFallback(piperPreviewParams, piperCache, costLedger, countedFixtureExecPiper, shouldNotBeCalledExecGtts);
    expect(piperSeamCalls).toBe(1);
    expect(piperPreviewAgain).toEqual(piperPreview);

    // Gate A5 — human approval of the Piper preview
    const gateA5 = approvePiperPreview(piperPreview, actor, [approvedA4Fixture()]);

    // ElevenLabs preflight — all flags explicitly resolved by the user
    const preflight = await runElevenLabsPreflight({
      text: pkg.voice_script,
      voiceId: "voice_1",
      modelId: "eleven_multilingual_v2",
      pronunciationFlags: pkg.pronunciation_flags,
      resolvedFlagTokens: new Set(pkg.pronunciation_flags.map((f) => f.token)),
      costLedger,
      provider: "elevenlabs",
      fns: allGoodPreflightFns,
    });
    expect(preflight.proceed).toBe(true);
    expect(preflight.route_to_gate_a6).toBe(false);

    // P3.05 — ElevenLabs production voice (fixture HTTP adapter), gated on
    // A5, through the AUDIT-FIX cached orchestration wrapper (§13.4).
    const targetNarrationS = 6.2; // deliberately close to, not identical to, intended (6s) — realistic
    const voiceLock: VoiceLock = { providers: { elevenlabs: { voice_id: "voice_1", model: "eleven_multilingual_v2" } } };
    const elevenlabsCache = new StageCache();
    let elevenlabsSeamCalls = 0;
    const httpSeam = fixturePostElevenLabsHttp(targetNarrationS);
    const countedHttpSeam: PostElevenLabsHttp = async (p) => {
      elevenlabsSeamCalls += 1;
      return httpSeam(p);
    };
    const productionVoiceParams = {
      text: pkg.voice_script,
      voiceId: "voice_1",
      modelId: "eleven_multilingual_v2",
      apiKey: "fixture-key-not-real",
      voiceLock,
      gates: [gateA5],
      listenCheck: fixtureListenCheck,
    };
    const productionVoice = await runP305ElevenLabsProductionVoice(productionVoiceParams, elevenlabsCache, costLedger, countedHttpSeam);
    expect(productionVoice.duration_s).toBeCloseTo(targetNarrationS, 1);
    expect(productionVoice.listen_check_word_ratio).toBe(0.96);
    // Repeat call, identical inputs: proves the real StageCache wiring —
    // the fixture HTTP seam is not re-invoked, and cost is not re-logged.
    const productionVoiceAgain = await runP305ElevenLabsProductionVoice(productionVoiceParams, elevenlabsCache, costLedger, countedHttpSeam);
    expect(elevenlabsSeamCalls).toBe(1);
    expect(productionVoiceAgain).toEqual(productionVoice);
    expect(costLedger.allEntries()).toHaveLength(2); // one Piper entry + one ElevenLabs entry, neither double-charged

    // P3.06 — Timing: narration is the master clock (via orchestration)
    const timing = runP306Timing(pkg.shots, productionVoice.duration_s);
    expect(timing.actual_narration_duration_s).toBeCloseTo(targetNarrationS, 1);
    expect(timing.intended_total_duration_s).toBeCloseTo(intendedTotalS, 1);

    // P3.07 — Timeline (via orchestration)
    const timeline = runP307Timeline(pkg.scenes, timing, resolvedAssets, pkg.shots);
    expect(timeline.entries).toHaveLength(2);

    // P3.08 — Render (via orchestration, fixture adapter). resolvedAssets/stagingDir are
    // threaded through per AUDIT FIX §13.5 correction 2 (real asset
    // resolution) — the fixture adapter itself stays a fixture here (no
    // real Remotion/Chrome in the hermetic suite; see the separate real
    // render smoke verification for that).
    // TIER-1 REPAIR T1.11 NOTE: production mode (the default) now hard-fails
    // when a required asset is not actually staged on disk. This hermetic
    // test intentionally never stages real files — it substitutes a FIXTURE
    // render seam to test pipeline WIRING, not asset safety — so it opts
    // into development mode explicitly. The real safety check is exercised
    // by the dedicated T1.11 tests in tier1.semantics.test.ts, which do
    // stage/omit real files.
    const render = await runP308Render(
      { projectId: pkg.project_id, targetId: pkg.package_id, outputPath: path.join(os.tmpdir(), `p3-golden-final_video-${Date.now()}.mp4`), resolution: "1080x1920", codec: "h264", timeline, resolvedAssets, stagingDir: "/tmp/p3-golden-staging", mode: "development" },
      fixtureExecRemotionRender,
    );
    expect(render.result).toBe("success");

    // P3.09 — Automated QA
    const { integrity_hashes: pkgIntegrity } = buildManifestAndIntegrity({
      resolved_assets: resolvedAssets, narration: {}, timing, timeline, render, qa: {}, kaggle: {},
    });
    // T1.12 — QA now identifies the exact package version and render it
    // examined.
    const qaReport = runP309QA({
      targetId: pkg.package_id,
      productionPackageId: pkg.package_id,
      productionPackageVersion: pkg.production_package_version,
      productionPackageHash: pkgIntegrity.package_sha256,
      assetRequirements: pkg.asset_requirements,
      resolvedAssets,
      assetProbes,
      timeline,
      render,
      narrationDurationS: productionVoice.duration_s,
      manifest: pkg.manifest,
      integrityHashes: pkgIntegrity,
      recomputedPackageSha256: pkgIntegrity.package_sha256, // recomputed == declared, by construction here
    });
    expect(["pass", "pass_with_findings"]).toContain(qaReport.result);

    // Human QA findings, structured only — never itself an approval.
    const humanQA = recordHumanQAFindings({ narrative_quality: "clear and engaging", continuity: "consistent stone color across shots", notes: [] });

    // Gate A7 — the only thing that can approve
    // T1.12 — approveFinalQA now verifies the QA result AND that the report
    // describes this exact render.
    const gateA7 = approveFinalQA(actor, qaReport, render);

    // P3.10 — Kaggle delivery (fixture adapters — staging + CLI), gated on A7
    const kaggleRecord = await runP310Kaggle(
      {
        finalVideoId: pkg.package_id,
        files: [render.outputs[0]!.path],
        existingDeliveryRecords: [],
        gates: [gateA7],
      },
      fixtureExecKaggleCli,
      fixtureStageAssetFile,
      fixtureWriteStagingFile,
    );
    expect(kaggleRecord.final_video_id).toBe(pkg.package_id);
    expect(kaggleRecord.kaggle_dataset_id).toBeTruthy();

    // Final Delivery Package assembly. R02.3: humanQA (built above via
    // recordHumanQAFindings — previously imported but never actually
    // wired anywhere) is now passed as a real constructor parameter
    // instead of being bolted on via a post-construction mutation.
    const finalPackage = assembleFinalDeliveryPackage({
      pkg,
      resolvedAssets,
      narration: { piper_preview: piperPreview, production_voice: productionVoice },
      timing,
      timeline,
      render,
      qa: qaReport,
      kaggle: kaggleRecord,
      gates: [gateA4, gateA5, gateA7],
      humanQa: humanQA,
    });

    // --- Schema-complete Final Delivery Package assertions ---
    expect(finalPackage.production_package_ref).toBe(pkg.package_id);
    expect(finalPackage.resolved_assets).toHaveLength(2);
    expect(finalPackage.narration.piper_preview).toBeDefined();
    expect(finalPackage.narration.production_voice).toBeDefined();
    expect(finalPackage.timing.conflicts).toBeDefined();
    expect(finalPackage.timeline.entries.length).toBeGreaterThan(0);
    expect(finalPackage.render.result).toBe("success");
    expect(finalPackage.qa.report_id).toBeTruthy();
    expect(finalPackage.gates.map((g) => g.gate_id)).toEqual(["A4", "A5", "A7"]);
    expect(finalPackage.kaggle.kaggle_dataset_id).toBeTruthy();
    expect(finalPackage.manifest.length).toBeGreaterThan(0);
    expect(finalPackage.integrity_hashes.package_sha256).toBeTruthy();
    expect(finalPackage.human_qa?.narrative_quality).toBe("clear and engaging");

    // Canonical creative data was never mutated across the whole run.
    expect(JSON.stringify(pkg.scenes)).toBe(JSON.stringify(PRODUCTION_PACKAGE_FIXTURE.scenes));
    expect(JSON.stringify(pkg.shots)).toBe(JSON.stringify(PRODUCTION_PACKAGE_FIXTURE.shots));
  });
});
