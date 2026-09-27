#!/usr/bin/env node
// Integration tests for the unified-pipeline adapters of the YouTube agent.
// Uses a throw-away SQLite database and real files; no network, no YouTube.

const assert = require('assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const { Database } = require('../database/db');
const { importProduction } = require('./import-production');
const { exportLearningFeed } = require('./export-learning-feed');
const { sealEnvelope, verifyEnvelope, canonicalStringify } = require('./envelope');

const results = [];
async function test(name, fn) {
  try { await fn(); results.push([name, true]); console.log(`✅ ${name}`); } catch (error) { results.push([name, false]); console.log(`❌ ${name}\n   ${error.stack}`); }
}

function sha(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

async function fixture(dir, { pendingClaim = false } = {}) {
  const video = Buffer.from(`fake-mp4-${crypto.randomUUID()}`);
  const audio = Buffer.from(`fake-wav-${crypto.randomUUID()}`);
  const videoPath = path.join(dir, 'final_master.mp4');
  const audioPath = path.join(dir, 'narration.wav');
  await fs.writeFile(videoPath, video);
  await fs.writeFile(audioPath, audio);
  const lineage = { research_package_id: 'rpkg_test', research_package_sha256: 'a'.repeat(64), research_identity_hash: 'b'.repeat(64), project_id: 'proj_test', topic: 'The Roman Aqueducts', gate_a1_record_id: 'appr_a1', verified_claim_ids: ['c1'], inferred_claim_ids: ['c2'], unknown_claim_ids: [] };
  const claims = [{ id: 'p1claim_c1', text: "The Aqua Appia was completed in 312 BC.", sourceIds: ['p1src_s1'], status: 'supported', riskLevel: 'standard', notes: 'P1.04 VERIFIED' }];
  if (pendingClaim) claims.push({ id: 'p1claim_c2', text: 'The network exceeded 400 km.', sourceIds: [], status: 'pending', riskLevel: 'standard', notes: 'P1 status INFERRED' });
  const body = {
    package_type: 'P3_TO_YOUTUBE_IMPORT', schema_version: 'unified-1.0.0',
    production_id: `up_${crypto.randomBytes(6).toString('hex')}`, project_id: 'proj_test', lineage, directive_hash: 'c'.repeat(64),
    production_package: { package_id: 'ppkg_x', version: '1.0.0', content_hash: 'd'.repeat(64) },
    final_delivery: { final_delivery_package_id: 'fdp_x', package_sha256: 'e'.repeat(64), render_run_id: 'run_1', video_path: videoPath, video_sha256: sha(video), video_bytes: video.length, duration_seconds: 64.2, resolution: '1080x1920', aspect_ratio: '9:16', qa_result: 'pass', gate_a7_record_id: 'appr_a7' },
    channel_id: 'ch_yt_main',
    script_text: 'The Aqua Appia, Rome\'s first aqueduct, was completed in 312 BC. Over the following centuries the city kept adding new lines, and the network eventually stretched for hundreds of kilometres, carrying water across valleys on arches of stone.',
    narration_audio: { path: audioPath, sha256: sha(audio), provider: 'elevenlabs', duration_seconds: 64.2 },
    seo_draft: { title: 'How Rome Moved Water Without Pumps', description: 'How the Roman aqueducts carried water by gravity alone.\nSources:\n- https://example.org/frontinus', tags: ['roman aqueducts', 'ancient engineering', 'history'], defaultLanguage: 'en', origin: 'unified-pipeline-draft' },
    scenes: [{ label: 'establish the aqueduct system', scriptText: 'opening', prompt: 'A-Branch scene s1', duration: 64.2, assetType: 'video', assetOrigin: 'generated', provider: 'a-branch-p3-remotion', provenanceSourceIds: [], containsSyntheticMedia: true, rightsConfirmed: false, locked: true }],
    provenance: { sources: [{ id: 'p1src_s1', url: 'https://example.org/frontinus', title: 'Frontinus', sourceType: 'article', status: 'verified', notes: 'P1' }], claims, containsSyntheticMedia: true },
    publishing_hints: { content_type: 'short', privacy_status: 'private', schedule: null, kpis: [{ kpi_id: 'kpi_views_7d', channel_id: 'ch_yt_main', metric_name: 'Views (7d)', metric_category: 'reach', target_value: 5000, target_unit: 'views', target_basis: 'USER_DEFINED', data_sources: [] }] },
    open_human_gates: ['YT:factual_review_attestation', 'YT:media_rights_attestation', 'YT:approval'],
    created_at: '2026-09-20T10:00:00.000Z'
  };
  return { pkg: sealEnvelope(body, { object_id: body.production_id, object_type: 'UNIFIED_YOUTUBE_IMPORT', created_at: body.created_at }), videoPath };
}

async function freshDb(dir) {
  const db = new Database();
  db.dbPath = path.join(dir, 'test.db');
  await db.initialize();
  return db;
}

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'unified-yt-'));
  const db = await freshDb(dir);

  await test('envelope hash mirrors B00 canonical rules (sorted keys, undefined omitted, array order kept)', async () => {
    assert.equal(canonicalStringify({ b: 1, a: [3, 1], c: undefined }), '{"a":[3,1],"b":1}');
    const { pkg } = await fixture(dir);
    assert.equal(verifyEnvelope(pkg, 'UNIFIED_YOUTUBE_IMPORT'), pkg.identity.content_hash);
    assert.throws(() => verifyEnvelope({ ...pkg, channel_id: 'x' }, 'UNIFIED_YOUTUBE_IMPORT'), /ENVELOPE_TAMPERED/);
  });

  await test('imports a verified delivery into Review Studio as needs_review, never approved', async () => {
    const { pkg } = await fixture(dir);
    const res = await importProduction(pkg, { db, runDiscoverability: true });
    assert.equal(res.status, 'imported');
    assert.equal(res.reviewStatus, 'needs_review', `blocking: ${res.qualityBlocking}`);
    const bundle = await db.getProductionBundle(pkg.production_id);
    assert.equal(bundle.status, 'needs_review');
    assert.equal(bundle.schedule, null);
    assert.equal(bundle.assets.finalVideo.simulated, false);
    assert.equal(bundle.assets.unified.gate_a7_record_id, 'appr_a7');
    assert.equal(bundle.provenance.status, 'verified');
    assert.equal(bundle.scenes.length, 1);
    assert.equal(Boolean(bundle.scenes[0].locked), true);
    assert.equal(Boolean(bundle.scenes[0].rightsConfirmed ?? bundle.scenes[0].rights_confirmed), false);
    assert.equal(bundle.editorData.factChecked, undefined);
  });

  await test('re-import of the same envelope is idempotent; a different envelope with the same id is refused', async () => {
    const { pkg } = await fixture(dir);
    await importProduction(pkg, { db, runDiscoverability: false });
    assert.equal((await importProduction(pkg, { db, runDiscoverability: false })).status, 'already_imported');
    const { identity: _old, ...body } = pkg;
    const conflicting = sealEnvelope({ ...body, seo_draft: { ...pkg.seo_draft, title: 'Other' } }, { object_id: pkg.production_id, object_type: 'UNIFIED_YOUTUBE_IMPORT', created_at: pkg.created_at });
    await assert.rejects(() => importProduction(conflicting, { db, runDiscoverability: false }), /PRODUCTION_ID_CONFLICT/);
  });

  await test('an import that stopped half-way (no review record) is resumed, not reported as done', async () => {
    const { pkg } = await fixture(dir);
    await importProduction(pkg, { db, runDiscoverability: false });
    await new Promise((resolve, reject) => db.db.run('DELETE FROM content_reviews WHERE production_id = ?', [pkg.production_id], err => (err ? reject(err) : resolve())));
    const res = await importProduction(pkg, { db, runDiscoverability: false });
    assert.equal(res.status, 'imported');
    assert.equal((await db.getProductionBundle(pkg.production_id)).status, 'needs_review');
    assert.equal((await importProduction(pkg, { db, runDiscoverability: false })).status, 'already_imported');
  });

  await test('an unresolved P1 claim keeps the production blocked (needs_attention: provenance)', async () => {
    const { pkg } = await fixture(dir, { pendingClaim: true });
    const res = await importProduction(pkg, { db, runDiscoverability: false });
    assert.equal(res.reviewStatus, 'needs_attention');
    assert.ok(res.qualityBlocking.includes('provenance'));
  });

  await test('refuses a video file that differs from what A-Branch P3 rendered', async () => {
    const { pkg, videoPath } = await fixture(dir);
    await fs.writeFile(videoPath, Buffer.from('swapped video'));
    await assert.rejects(() => importProduction(pkg, { db, runDiscoverability: false }), /VIDEO_HASH_MISMATCH/);
  });

  await test('exports a learning feed only for unified productions and marks simulated analytics', async () => {
    const { pkg } = await fixture(dir);
    await importProduction(pkg, { db, runDiscoverability: false });
    await db.executeQuery(`INSERT INTO publish_schedule (id, production_id, title, publish_time, status, youtube_id) VALUES (?, ?, ?, ?, 'published', ?)`, ['sch_t', pkg.production_id, 'x', '2026-09-20T15:00:00.000Z', 'abcDEF12345']);
    await db.savePerformanceSnapshot({ videoId: 'abcDEF12345', productionId: pkg.production_id, measurementWindow: '7d', publishedAt: '2026-09-20T15:00:00.000Z', metrics: { views: 6120, ctr: 5.1 }, contentAttributes: {}, simulated: false });
    await db.savePerformanceSnapshot({ videoId: 'otherVideo1', productionId: 'native_production', measurementWindow: '7d', publishedAt: '2026-09-20T15:00:00.000Z', metrics: { views: 1 }, contentAttributes: {}, simulated: false });
    const feed = await exportLearningFeed({ db, channelId: 'ch_yt_main', projectId: 'history-vertical' });
    assert.equal(feed.feed_type, 'YOUTUBE_AGENT_LEARNING_FEED');
    assert.deepEqual(feed.snapshots.map(s => s.video_id), ['abcDEF12345']);
    assert.equal(feed.snapshots[0].metrics.views, 6120);
    assert.equal(feed.snapshots[0].simulated, false);
  });

  await test('UNIFIED_PIPELINE_MODE stops self-generated content and self-strategy only', async () => {
    const { DailyAutomation } = require('../schedules/daily-automation');
    process.env.UNIFIED_PIPELINE_MODE = 'true';
    let generated = false;
    const automation = new DailyAutomation({}, db, { generateContent: async () => { generated = true; } });
    assert.deepEqual(await automation.runDailyContentGeneration(), { skipped: true, reason: 'unified_pipeline_mode' });
    assert.deepEqual(await automation.weeklyStrategyReview(), { skipped: true, reason: 'unified_pipeline_mode' });
    assert.equal(generated, false);
    delete process.env.UNIFIED_PIPELINE_MODE;
  });

  await new Promise(resolve => db.db.close(() => resolve()));
  await fs.rm(dir, { recursive: true, force: true });
  const failed = results.filter(([, ok]) => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} unified integration tests passed`);
  process.exit(failed ? 1 : 0);
})();
