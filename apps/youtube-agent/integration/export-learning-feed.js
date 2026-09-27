#!/usr/bin/env node
// Unified pipeline — export the YouTube agent's evidence for B-Branch B08.
//
//   node integration/export-learning-feed.js --channel <B channel_id> --project <B project_id>
//        [--out learning_feed.json] [--db path/to.db]
//
// Only productions imported from the unified pipeline are exported
// (assets.unified.channel_id === --channel). Simulated analytics are
// exported with simulated=true so B's transport can refuse them explicitly;
// nothing is dropped silently and nothing is recomputed here.

const fs = require('fs').promises;
const { Database } = require('../database/db');
const { version } = require('../package.json');

async function exportLearningFeed(options) {
  if (!options.channelId || !options.projectId) throw new Error('--channel and --project are required');
  const db = options.db || new Database();
  if (options.dbPath) db.dbPath = options.dbPath;
  const ownsDb = !options.db;
  if (!db.db) await db.initialize();
  try {
    const productions = (await db.getAllRows('SELECT id, assets FROM productions'))
      .map(row => ({ id: row.id, assets: JSON.parse(row.assets || '{}') }))
      .filter(p => p.assets.unified && p.assets.unified.channel_id === options.channelId);
    const productionIds = new Set(productions.map(p => p.id));

    const schedules = await db.getAllRows('SELECT production_id, youtube_id FROM publish_schedule WHERE youtube_id IS NOT NULL');
    const productionByVideo = new Map(schedules.filter(s => productionIds.has(s.production_id)).map(s => [s.youtube_id, s.production_id]));

    const snapshots = (await db.listPerformanceSnapshots({}))
      .filter(s => productionIds.has(s.productionId) || productionByVideo.has(s.videoId))
      .map(s => ({
        video_id: s.videoId,
        production_id: s.productionId || productionByVideo.get(s.videoId),
        measurement_window: s.measurementWindow,
        published_at: s.publishedAt || null,
        measured_at: s.measuredAt,
        simulated: Boolean(s.simulated),
        metrics: Object.fromEntries(Object.entries(s.metrics || {}).filter(([, v]) => typeof v === 'number' && Number.isFinite(v)))
      }));

    const insights = (await db.getAllRows('SELECT * FROM engagement_insights'))
      .map(row => db.parseEngagementInsight(row))
      .filter(i => productionIds.has(i.productionId) || productionByVideo.has(i.videoId))
      .map(i => ({
        video_id: i.videoId,
        production_id: i.productionId || productionByVideo.get(i.videoId) || null,
        analyzed_at: i.analyzedAt || null,
        comment_count: i.commentCount,
        themes: (i.themes || []).map(t => ({
          theme: String(t.title || t.theme || t.summary || '').slice(0, 300),
          count: Array.isArray(t.commentIds) ? t.commentIds.length : (typeof t.count === 'number' ? t.count : undefined)
        })).filter(t => t.theme),
        analysis_method: i.analysisMethod || 'unknown'
      }));

    return {
      feed_type: 'YOUTUBE_AGENT_LEARNING_FEED',
      schema_version: 'unified-1.0.0',
      exported_at: options.now ? options.now() : new Date().toISOString(),
      exporter: `youtube-agent@${version}`,
      channel_id: options.channelId,
      project_id: options.projectId,
      snapshots,
      engagement: insights
    };
  } finally {
    if (ownsDb && db.db) await new Promise(resolve => db.db.close(() => resolve()));
  }
}

module.exports = { exportLearningFeed };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const arg = name => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
  exportLearningFeed({ channelId: arg('channel'), projectId: arg('project'), dbPath: arg('db') })
    .then(async feed => {
      const text = JSON.stringify(feed, null, 2) + '\n';
      if (arg('out')) { await fs.writeFile(arg('out'), text); console.error(`wrote ${arg('out')}`); } else process.stdout.write(text);
    })
    .catch(error => { console.error(error.message); process.exit(1); });
}
