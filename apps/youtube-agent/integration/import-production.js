#!/usr/bin/env node
// Unified pipeline — import a sealed P3_TO_YOUTUBE_IMPORT package into the
// YouTube agent's Review Studio.
//
//   node integration/import-production.js <youtube_import.json> [--db path/to.db] [--out result.json]
//
// What this does (and does not do):
//   * verifies the envelope hash (B00-compatible) and the rendered MP4's
//     SHA-256 on disk against the value A-Branch P3 recorded,
//   * writes the production, snapshot, locked scenes, Evidence-desk
//     provenance and a review record using the agent's OWN Database API and
//     ProvenanceService validation,
//   * runs the agent's own quality checks and DarkzSEO preflight so the
//     production lands in Review Studio exactly like a natively generated one,
//   * NEVER approves, schedules or publishes. Every human gate stays open.

const path = require('path');
const fs = require('fs').promises;
const { Database } = require('../database/db');
const { ProvenanceService } = require('../utils/provenance-service');
const { OperatorService } = require('../utils/operator-service');
const { DiscoverabilityService } = require('../utils/discoverability-service');
const { verifyEnvelope, fileSha256 } = require('./envelope');

const IMPORT_TYPE = 'UNIFIED_YOUTUBE_IMPORT';

async function exists(p) {
  try { return (await fs.stat(p)).isFile(); } catch (_error) { return false; }
}

async function importProduction(pkg, options = {}) {
  const identityHash = verifyEnvelope(pkg, IMPORT_TYPE);
  if (pkg.package_type !== 'P3_TO_YOUTUBE_IMPORT') throw new Error('NOT_A_YOUTUBE_IMPORT');

  const video = pkg.final_delivery;
  if (!(await exists(video.video_path))) throw new Error(`VIDEO_NOT_FOUND: ${video.video_path}`);
  if (path.extname(video.video_path).toLowerCase() !== '.mp4') throw new Error('VIDEO_NOT_MP4');
  const actualVideoHash = await fileSha256(video.video_path);
  if (actualVideoHash !== video.video_sha256) {
    throw new Error(`VIDEO_HASH_MISMATCH: P3 recorded ${video.video_sha256}, file is ${actualVideoHash}`);
  }
  const audioOk = await exists(pkg.narration_audio.path) && await fileSha256(pkg.narration_audio.path) === pkg.narration_audio.sha256;
  const finishedCaptions = pkg.finishing && pkg.finishing.captions;
  if (finishedCaptions) {
    if (!(await exists(finishedCaptions.path)) || await fileSha256(finishedCaptions.path) !== finishedCaptions.sha256) {
      throw new Error(`CAPTIONS_HASH_MISMATCH: ${finishedCaptions.path}`);
    }
  }

  const db = options.db || new Database();
  if (options.dbPath) db.dbPath = options.dbPath;
  const ownsDb = !options.db;
  if (!db.db) await db.initialize();

  try {
    const existing = await db.getProductionBundle(pkg.production_id);
    if (existing) {
      const prior = existing.assets?.unified?.identity_hash;
      if (prior !== identityHash) throw new Error(`PRODUCTION_ID_CONFLICT: ${pkg.production_id} exists with different content`);
      // The review record is written last: if it exists the import completed.
      // If not, an earlier run stopped half-way — every write below is an upsert, so resume.
      const review = await new Promise((resolve, reject) =>
        db.db.get('SELECT status FROM content_reviews WHERE production_id = ?', [pkg.production_id], (err, row) => (err ? reject(err) : resolve(row)))
      );
      if (review) return { status: 'already_imported', productionId: pkg.production_id, identityHash };
    }

    const stats = await fs.stat(video.video_path);
    const production = {
      id: pkg.production_id,
      status: 'processing',
      assets: {
        finalVideo: {
          path: video.video_path,
          fileSize: stats.size,
          duration: video.duration_seconds,
          generatedWith: 'A-Branch P3 (Remotion)',
          resolution: video.resolution,
          aspectRatio: video.aspect_ratio,
          format: 'mp4',
          sha256: video.video_sha256,
          simulated: false,
          provider: { actualProvider: 'a-branch-p3', model: 'remotion', renderRunId: video.render_run_id }
        },
        audio: {
          path: pkg.narration_audio.path,
          duration: pkg.narration_audio.duration_seconds,
          status: audioOk ? 'ready' : 'unavailable',
          simulated: !audioOk,
          provider: pkg.narration_audio.provider,
          sha256: pkg.narration_audio.sha256,
          note: 'Narration is already mixed into the A-Branch master render.'
        },
        thumbnail: null,
        captions: finishedCaptions ? {
          path: finishedCaptions.path,
          format: 'srt',
          language: finishedCaptions.language,
          timingBasis: finishedCaptions.timing_basis,
          burnedIn: finishedCaptions.burned === true,
          sha256: finishedCaptions.sha256
        } : null,
        unified: {
          finishing: pkg.finishing || null,
          identity_hash: identityHash,
          directive_hash: pkg.directive_hash,
          lineage: pkg.lineage,
          production_package: pkg.production_package,
          final_delivery_package_id: video.final_delivery_package_id,
          final_delivery_sha256: video.package_sha256,
          gate_a7_record_id: video.gate_a7_record_id,
          channel_id: pkg.channel_id,
          kpis: pkg.publishing_hints.kpis,
          schedule_hint: pkg.publishing_hints.schedule,
          open_human_gates: pkg.open_human_gates
        }
      },
      timeline: {
        created: pkg.created_at,
        importedAt: new Date().toISOString(),
        importedFrom: 'unified-pipeline',
        readyForUpload: null
      },
      scheduledPublishTime: null,
      priority: 50,
      estimatedDuration: `${Math.round(video.duration_seconds)}s`,
      contentType: pkg.publishing_hints.content_type,
      privacyStatus: 'private',
      strategy: {
        topic: pkg.lineage.topic,
        angle: 'Defined by B-Branch directive',
        source: 'unified-pipeline',
        channelId: pkg.channel_id,
        researchSources: []
      },
      script: {
        title: pkg.seo_draft.title,
        fullScript: pkg.script_text,
        duration: `${Math.round(video.duration_seconds)}s`,
        claims: []
      },
      thumbnail: {},
      seo: {
        title: pkg.seo_draft.title,
        description: pkg.seo_draft.description,
        tags: pkg.seo_draft.tags,
        metadata: { language: pkg.seo_draft.defaultLanguage, category: '27', origin: pkg.seo_draft.origin }
      }
    };

    await db.saveProductionData(production);
    await db.saveProductionSnapshot(production);
    await db.replaceProductionScenes(production.id, pkg.scenes.map(scene => ({
      ...scene,
      assetPath: video.video_path,
      audioPath: null,
      narrationProvider: pkg.narration_audio.provider,
      narrationStatus: 'current',
      status: 'ready'
    })));

    const provenanceService = new ProvenanceService(db);
    const provenance = provenanceService.build(pkg.provenance);
    await db.saveContentProvenance(production.id, provenance);
    production.provenance = await db.getContentProvenance(production.id);
    production.containsSyntheticMedia = pkg.provenance.containsSyntheticMedia === true;
    production.scenes = await db.listProductionScenes(production.id);

    let discoverability = null;
    if (options.runDiscoverability !== false) {
      try {
        discoverability = await new DiscoverabilityService(db).auditProduction(production, {}, 'youtube');
      } catch (error) {
        discoverability = { available: false, error: error.message };
      }
    }
    production.discoverability = discoverability;

    const quality = await new OperatorService(db).runQualityChecks(production, (await db.getChannelProfile()) || {});
    const reviewStatus = quality.passed ? 'needs_review' : 'needs_attention';
    await db.saveContentReview(production.id, {
      status: reviewStatus,
      qualityChecks: quality.checks,
      editorData: {},
      reviewNotes: [
        `Imported from unified pipeline (research ${pkg.lineage.research_package_id}, directive ${pkg.directive_hash.slice(0, 12)}, A7 ${video.gate_a7_record_id}).`,
        `Open human gates: ${pkg.open_human_gates.join(', ')}.`,
        quality.passed ? '' : `Blocking checks failed: ${quality.blockingFailures.join(', ')}`
      ].filter(Boolean).join(' ')
    });
    await db.updateProductionStatus(production.id, reviewStatus);

    return {
      status: 'imported',
      productionId: production.id,
      reviewStatus,
      identityHash,
      provenanceStatus: provenance.status,
      qualityBlocking: quality.blockingFailures,
      openHumanGates: pkg.open_human_gates
    };
  } finally {
    if (ownsDb && db.db) await new Promise(resolve => db.db.close(() => resolve()));
  }
}

module.exports = { importProduction };

if (require.main === module) {
  const [file, ...rest] = process.argv.slice(2);
  const dbIndex = rest.indexOf('--db');
  const outIndex = rest.indexOf('--out');
  if (!file) {
    console.error('usage: node integration/import-production.js <youtube_import.json> [--db path/to.db] [--out result.json]');
    process.exit(2);
  }
  fs.readFile(file, 'utf8')
    .then(text => importProduction(JSON.parse(text), dbIndex >= 0 ? { dbPath: rest[dbIndex + 1] } : {}))
    .then(async result => {
      const text = JSON.stringify(result, null, 2);
      if (outIndex >= 0) await fs.writeFile(rest[outIndex + 1], text + '\n');
      console.log(text);
    })
    .catch(error => { console.error(error.message); process.exit(1); });
}
