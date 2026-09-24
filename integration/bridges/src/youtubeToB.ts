// Bridge 4 — YouTube agent (published results) -> B08 -> B07 / B03 / B09 / B10
//
// Position in the unified flow:
//   youtube-agent analytics & comment sync --export--> LearningFeed
//   --> THIS (a B08 AgentReachTransport) --> B08.AgentReachAdapter
//   --> ExternalIntelligenceContext --> B07 (KPI actuals) / B03 (audience) / B09 -> B10
//
// Why a transport and not a direct write into B? B08 is the ONLY module in
// B that may touch external data. Implementing B's own AgentReachTransport
// interface means every YouTube number goes through B08's normalisation,
// SHA-256 source hashing, evidence (status UNKNOWN, production_eligible=false),
// provenance binding and consumer-side reconstruction. Nothing bypasses it.
//
// Honesty rules enforced here:
//   * simulated / unverified analytics are never emitted (both the YouTube
//     agent and B already share this firewall; we keep it),
//   * a KPI actual is only possible through an explicit human KpiBinding
//     (youtube metric -> B07 kpi_id + unit + window); nothing is guessed,
//   * a retrieved number still needs an independent, human-approved review
//     (prepareObservationReview) before B07 will set actual_metric_value.

import { B00, B08 } from "b-branch-strategic-control-plane";
import type { KpiBinding, LearningFeed, LearningFeedSnapshot } from "./contracts.js";
import { BridgeError, assertHumanAuthority } from "./identity.js";

const BRIDGE = "YouTube->B08";
const PLATFORM = "youtube";
const WINDOW_HOURS: Record<string, number> = { "24h": 24, "7d": 168 };

function assertFeed(feed: LearningFeed): void {
  if (!feed || feed.feed_type !== "YOUTUBE_AGENT_LEARNING_FEED") throw new BridgeError(BRIDGE, "NOT_A_FEED", "unexpected feed_type");
  if (!feed.channel_id || !feed.project_id) throw new BridgeError(BRIDGE, "FEED_SCOPE_MISSING", "feed needs channel_id and project_id");
}

function period(s: LearningFeedSnapshot): { start: string; end: string } | null {
  const hours = WINDOW_HOURS[s.measurement_window];
  if (!hours || !s.published_at) return null;
  const start = new Date(s.published_at);
  if (Number.isNaN(start.getTime())) return null;
  return { start: start.toISOString(), end: new Date(start.getTime() + hours * 3600_000).toISOString() };
}

/** B-owned transport over an exported YouTube-agent learning feed. */
export class YouTubeFeedTransport implements B08.AgentReachTransport {
  readonly source_mode = "REAL" as const;

  constructor(
    private readonly feed: LearningFeed,
    private readonly bindings: KpiBinding[],
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    assertFeed(feed);
  }

  async health(): Promise<B08.AgentReachHealth> {
    return {
      installed: true,
      reachable: true,
      authenticated: "UNKNOWN",
      provider_version: `youtube-agent-feed:${this.feed.exporter}`,
      checked_at: this.now(),
      status: "AVAILABLE",
      capabilities: [
        { capability: "performance", platform: PLATFORM, backend: "youtube-agent-sqlite-export", requires_auth: false, requires_cookie: false, requires_browser_session: false, requires_mcp: false, proxy_required: false, status: "AVAILABLE", last_checked: this.now() },
        { capability: "community", platform: PLATFORM, backend: "youtube-agent-sqlite-export", requires_auth: false, requires_cookie: false, requires_browser_session: false, requires_mcp: false, proxy_required: false, status: "AVAILABLE", last_checked: this.now() },
      ],
    };
  }

  async retrieve(request: B08.ExternalAccessRequest): Promise<B08.ProviderResponse> {
    if (request.platform !== PLATFORM || request.max_results !== 1 || request.geography) {
      throw new B08.AccessError("UNSUPPORTED_CAPABILITY");
    }
    if (request.channel_id !== this.feed.channel_id || request.project_id !== this.feed.project_id) {
      throw new B08.AccessError("FAILED");
    }
    const base = { status: "OK" as const, provider_version: `youtube-agent-feed:${this.feed.exporter}`, backend: "youtube-agent-sqlite-export", retrieved_at: this.feed.exported_at };

    const perf = /^yt-perf:([A-Za-z0-9_-]{6,20}):(.+)$/.exec(request.query);
    if (perf && request.observation_kind === "PerformanceObservation") {
      const [, videoId, kpiId] = perf as unknown as [string, string, string];
      const binding = this.bindings.find((b) => b.kpi_id === kpiId);
      if (!binding) throw new B08.AccessError("UNSUPPORTED_CAPABILITY");
      const snap = this.feed.snapshots.find((s) => s.video_id === videoId && s.measurement_window === binding.measurement_window);
      if (!snap || snap.simulated) throw new B08.AccessError("UNAVAILABLE");
      const value = snap.metrics[binding.youtube_metric];
      const p = period(snap);
      if (typeof value !== "number" || !Number.isFinite(value) || !p) throw new B08.AccessError("UNAVAILABLE");
      const content = JSON.stringify({
        measurement: { metric_id: binding.kpi_id, channel_id: request.channel_id, value, unit: binding.unit, period_start: p.start, period_end: p.end },
        source: { exporter: this.feed.exporter, video_id: videoId, production_id: snap.production_id, youtube_metric: binding.youtube_metric, measurement_window: snap.measurement_window, measured_at: snap.measured_at },
      });
      return { ...base, sources: [{ canonical_url: `https://www.youtube.com/watch?v=${videoId}`, platform: PLATFORM, retrieval_method: "youtube-agent performance_snapshots export (YouTube Analytics API)", content }] };
    }

    const comments = /^yt-comments:([A-Za-z0-9_-]{6,20})$/.exec(request.query);
    if (comments && (request.observation_kind === "CommunityObservation" || request.observation_kind === "AudienceObservation")) {
      const videoId = comments[1]!;
      const insight = this.feed.engagement.find((e) => e.video_id === videoId);
      if (!insight || insight.themes.length === 0) throw new B08.AccessError("UNAVAILABLE");
      const lines = [
        `Comment themes reported by the YouTube agent for video ${videoId} (${insight.comment_count} comments; analysis method: ${insight.analysis_method}; analyzed at ${insight.analyzed_at ?? "unknown"}).`,
        "These are commenter statements summarised by the agent, not measured audience demographics.",
        ...insight.themes.slice(0, 25).map((t) => `- ${t.theme}${typeof t.count === "number" ? ` (${t.count})` : ""}`),
      ];
      return { ...base, sources: [{ canonical_url: `https://www.youtube.com/watch?v=${videoId}`, platform: PLATFORM, retrieval_method: "youtube-agent engagement_insights export (YouTube Data API comments)", content: lines.join("\n") }] };
    }
    throw new B08.AccessError("UNSUPPORTED_CAPABILITY");
  }
}

/** Deterministic request plan: one request per (video, bound KPI) plus one per video with comment themes. */
export function buildFeedRequests(feed: LearningFeed, bindings: KpiBinding[]): B08.ExternalAccessRequest[] {
  assertFeed(feed);
  const requests: B08.ExternalAccessRequest[] = [];
  const videos = [...new Set(feed.snapshots.filter((s) => !s.simulated).map((s) => s.video_id))].sort();
  for (const videoId of videos) {
    for (const b of bindings) {
      if (!feed.snapshots.some((s) => s.video_id === videoId && s.measurement_window === b.measurement_window && !s.simulated)) continue;
      requests.push({
        request_id: `yt-perf-${videoId}-${b.kpi_id}`,
        project_id: feed.project_id,
        purpose: `Actual value for B07 KPI ${b.kpi_id} from published video ${videoId}`,
        query: `yt-perf:${videoId}:${b.kpi_id}`,
        source_types: ["youtube_analytics"],
        platform: PLATFORM,
        max_results: 1,
        observation_kind: "PerformanceObservation",
        channel_id: feed.channel_id,
      });
    }
  }
  for (const e of [...feed.engagement].sort((a, b) => a.video_id.localeCompare(b.video_id))) {
    if (!e.themes.length) continue;
    requests.push({
      request_id: `yt-comments-${e.video_id}`,
      project_id: feed.project_id,
      purpose: `Audience comment themes for published video ${e.video_id}`,
      query: `yt-comments:${e.video_id}`,
      source_types: ["youtube_comments"],
      platform: PLATFORM,
      max_results: 1,
      observation_kind: "CommunityObservation",
      channel_id: feed.channel_id,
    });
  }
  return requests;
}

/** Runs every request through B's own AgentReachAdapter (normalise, hash, evidence, provenance). */
export async function collectLearningIntelligence(
  feed: LearningFeed,
  bindings: KpiBinding[],
  options: { now?: () => string } = {},
): Promise<B08.ExternalIntelligenceContext> {
  const adapter = new B08.AgentReachAdapter(new YouTubeFeedTransport(feed, bindings, options.now), 20000, options.now);
  const results: B08.ExternalAccessResult[] = [];
  for (const request of buildFeedRequests(feed, bindings)) results.push(await adapter.retrieve(request));
  return { project_id: feed.project_id, results };
}

/**
 * Independent review for one observation (required by B07 before an actual
 * KPI value is set, and by B09 before learning). The caller supplies the
 * confirmation evidence (e.g. a YouTube Studio export checked by a person);
 * this helper only binds it through B00 governance. It never fabricates it.
 */
export function prepareObservationReview(
  observation: B08.ExternalObservation,
  review: { authority: string; reviewed_at: string; confirmation_evidence: import("b-branch-strategic-control-plane").EvidenceRef[] },
): B08.ExternalObservationReview {
  try {
    assertHumanAuthority(BRIDGE, review.authority, "review.authority");
  } catch {
    throw new BridgeError(BRIDGE, "REVIEWER_REQUIRED", "a named reviewer is required");
  }
  if (!review.confirmation_evidence.length) throw new BridgeError(BRIDGE, "CONFIRMATION_REQUIRED", "independent confirmation evidence is required");
  for (const e of review.confirmation_evidence) {
    const v = B00.validateEvidenceSemantics(e);
    if (!v.valid || e.status !== "VERIFIED" || e.source_mode !== "REAL") {
      throw new BridgeError(BRIDGE, "CONFIRMATION_NOT_VERIFIED", `evidence ${e.id} is not REAL/VERIFIED: ${v.issues.map((i) => i.code).join(",") || e.status}`);
    }
    if (observation.evidence_refs.some((raw) => raw.id === e.id)) {
      throw new BridgeError(BRIDGE, "CONFIRMATION_NOT_INDEPENDENT", `evidence ${e.id} is the retrieval evidence itself`);
    }
  }
  const receipt: B08.ExternalObservationReview = {
    observation_id: observation.observation_id,
    observation_content_hash: B00.canonicalHasher.hashValue(observation),
    authority: review.authority,
    reviewed_at: review.reviewed_at,
    evidence_refs: review.confirmation_evidence,
    governance_events: [],
  };
  const binding = B08.externalReviewBinding(receipt);
  const proposed = B00.proposeItem({ itemId: binding.object_id, history: [], authority: review.authority, timestamp: review.reviewed_at });
  receipt.governance_events = B00.approveItem({
    itemId: binding.object_id,
    history: proposed.history,
    authority: review.authority,
    timestamp: review.reviewed_at,
    artifact: binding,
    requireArtifactBinding: true,
    sourceEvidenceRefs: review.confirmation_evidence.map((e) => e.id),
  }).history;
  return receipt;
}
