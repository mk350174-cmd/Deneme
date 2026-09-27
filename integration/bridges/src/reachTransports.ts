// Agent Reach backends as B08 transports — YouTube search (yt-dlp) and RSS
// (feedparser). These are the zero-config, no-cookie backends Agent Reach
// selects for those platforms (Panniantong/Agent-Reach@a19a171:
// agent_reach/channels/youtube.py → yt-dlp, channels/rss.py → feedparser).
//
// B's own adapter (branches/b/src/b08/external/runtime.ts) implements only
// the web/Jina read and lists search / RSS / YouTube as DEFERRED. These two
// transports close that gap WITHOUT editing B: they implement B's
// AgentReachTransport interface, so every result still goes through
// B08.AgentReachAdapter (normalise → SHA-256 source hash → evidence UNKNOWN,
// production_eligible=false → provenance → consumer re-validation).
//
// Deliberately NOT integrated: cookie / browser-session channels (Twitter,
// XiaoHongShu, Facebook, Instagram, Reddit-with-cookie, LinkedIn, Xueqiu)
// and `agent-reach configure --from-browser` cookie extraction. B08's policy
// forbids credentials inside B, and those channels act as the user's
// logged-in identity.
//
// Safety: fixed argv (no shell), bounded output, timeouts, no redirects of
// untrusted input into commands (the query is a single argv element after a
// fixed "ytsearchN:" prefix), result URLs pass B's canonicalSourceUrl.

import { execFile } from "node:child_process";
import { B08 } from "b-branch-strategic-control-plane";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Feeds are public web sources: never local or private-network addresses. */
export function isInternalHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || !h.includes(".") && !h.includes(":")) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (h.includes(":")) return h === "::1" || h === "::" || /^f[cd]/.test(h) || /^fe[89ab]/.test(h) || h.startsWith("::ffff:");
  return false;
}

/** Repo-local venv created by `npm run setup:reach` (tools/.venv), if present. */
function venvTool(name: string): string | undefined {
  const win = process.platform === "win32";
  const p = join(fileURLToPath(new URL("../../../tools/.venv", import.meta.url)), win ? "Scripts" : "bin", win ? `${name}.exe` : name);
  return existsSync(p) ? p : undefined;
}

export type ExecSeam = (cmd: string, args: string[], opts: { timeoutMs: number; maxBytes: number }) => Promise<{ code: number; stdout: string }>;

export const defaultExec: ExecSeam = (cmd, args, { timeoutMs, maxBytes }) =>
  new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: maxBytes, shell: false, windowsHide: true }, (err, stdout) => {
      resolve({ code: err ? ((err as NodeJS.ErrnoException & { code?: number }).code as unknown as number) || 1 : 0, stdout: String(stdout ?? "") });
    });
  });

const now = () => new Date().toISOString();

function capability(capabilityName: string, platform: string, backend: string, status: B08.AgentReachCapability["status"]): B08.AgentReachCapability {
  return { capability: capabilityName, platform, backend, requires_auth: false, requires_cookie: false, requires_browser_session: false, requires_mcp: false, proxy_required: false, status, last_checked: now() };
}

// ------------------------------------------------------------------ YouTube

export interface YtDlpOptions {
  executable?: string;
  exec?: ExecSeam;
  timeoutMs?: number;
}

/** Fields kept from each yt-dlp flat search entry. Everything else is dropped. */
const YT_FIELDS = ["id", "title", "channel", "channel_id", "duration", "view_count", "description", "url"] as const;

export class YtDlpSearchTransport implements B08.AgentReachTransport {
  readonly source_mode = "REAL" as const;
  private readonly exe: string;
  private readonly exec: ExecSeam;
  private readonly timeoutMs: number;
  constructor(options: YtDlpOptions = {}) {
    this.exe = options.executable ?? process.env.YTDLP_BIN ?? venvTool("yt-dlp") ?? "yt-dlp";
    this.exec = options.exec ?? defaultExec;
    this.timeoutMs = options.timeoutMs ?? 60000;
  }

  private async version(): Promise<string> {
    const r = await this.exec(this.exe, ["--version"], { timeoutMs: 10000, maxBytes: 4096 });
    const v = r.stdout.trim().split("\n")[0] ?? "";
    if (r.code !== 0 || !/^\d{4}\.\d{1,2}\.\d{1,2}/.test(v)) throw new B08.AccessError("UNAVAILABLE");
    return v;
  }

  async health(): Promise<B08.AgentReachHealth> {
    try {
      const v = await this.version();
      return { installed: true, reachable: true, authenticated: "UNKNOWN", provider_version: `yt-dlp ${v}`, checked_at: now(), status: "AVAILABLE", capabilities: [capability("search", "youtube", "yt-dlp", "AVAILABLE")] };
    } catch {
      return { installed: false, reachable: false, authenticated: "UNKNOWN", provider_version: null, checked_at: now(), status: "UNAVAILABLE", capabilities: [capability("search", "youtube", "yt-dlp", "UNAVAILABLE")] };
    }
  }

  async retrieve(request: B08.ExternalAccessRequest): Promise<B08.ProviderResponse> {
    if (request.platform !== "youtube" || request.source_types.length !== 1 || request.source_types[0] !== "youtube_search") throw new B08.AccessError("UNSUPPORTED_CAPABILITY");
    // yt-dlp flat search cannot filter by geography or date: refuse instead of pretending.
    if (request.geography || request.time_range) throw new B08.AccessError("UNSUPPORTED_CAPABILITY");
    const query = request.query.replace(/[\r\n]+/g, " ").trim();
    if (!query || query.length > 200) throw new B08.AccessError("MALFORMED_RESULT");
    const n = Math.min(request.max_results, 25);
    const version = await this.version();
    const r = await this.exec(this.exe, ["--flat-playlist", "--no-warnings", "--ignore-config", "-J", `ytsearch${n}:${query}`], { timeoutMs: this.timeoutMs, maxBytes: 5_000_000 });
    if (r.code !== 0) throw new B08.AccessError("FAILED");
    let data: { entries?: Array<Record<string, unknown>> };
    try {
      data = JSON.parse(r.stdout);
    } catch {
      throw new B08.AccessError("MALFORMED_RESULT");
    }
    const sources = (data.entries ?? [])
      .filter((e) => typeof e.id === "string" && /^[A-Za-z0-9_-]{6,20}$/.test(e.id as string))
      .slice(0, n)
      .map((e) => {
        const kept = Object.fromEntries(YT_FIELDS.filter((k) => e[k] !== undefined && e[k] !== null).map((k) => [k, k === "description" ? String(e[k]).slice(0, 500) : e[k]]));
        return {
          canonical_url: `https://www.youtube.com/watch?v=${e.id as string}`,
          platform: "youtube",
          retrieval_method: `yt-dlp flat ytsearch (Agent Reach YouTube backend); query="${query}"`,
          content: JSON.stringify({ kind: "youtube_search_result", query, rank: (data.entries ?? []).indexOf(e) + 1, ...kept }),
        };
      });
    return { status: "OK", provider_version: `yt-dlp ${version}`, backend: "yt-dlp", retrieved_at: now(), sources };
  }
}

// ------------------------------------------------------------------ RSS

export interface FeedparserOptions {
  python?: string;
  exec?: ExecSeam;
  timeoutMs?: number;
}

const FEED_SCRIPT = [
  "import json,sys",
  "import feedparser",
  "d=feedparser.parse(sys.argv[1])",
  "out=[{'title':e.get('title'),'link':e.get('link'),'published':e.get('published'),'summary':(e.get('summary') or '')[:500]} for e in d.entries[:int(sys.argv[2])]]",
  "print(json.dumps({'version':feedparser.__version__,'bozo':bool(d.bozo),'feed_title':d.feed.get('title'),'entries':out}))",
].join("\n");

export class FeedparserRssTransport implements B08.AgentReachTransport {
  readonly source_mode = "REAL" as const;
  private readonly py: string;
  private readonly exec: ExecSeam;
  private readonly timeoutMs: number;
  constructor(options: FeedparserOptions = {}) {
    this.py = options.python ?? process.env.REACH_PYTHON ?? venvTool("python") ?? (process.platform === "win32" ? "python" : "python3");
    this.exec = options.exec ?? defaultExec;
    this.timeoutMs = options.timeoutMs ?? 30000;
  }

  async health(): Promise<B08.AgentReachHealth> {
    const r = await this.exec(this.py, ["-c", "import feedparser;print(feedparser.__version__)"], { timeoutMs: 10000, maxBytes: 4096 });
    const ok = r.code === 0;
    return { installed: ok, reachable: ok, authenticated: "UNKNOWN", provider_version: ok ? `feedparser ${r.stdout.trim()}` : null, checked_at: now(), status: ok ? "AVAILABLE" : "UNAVAILABLE", capabilities: [capability("read", "rss", "feedparser", ok ? "AVAILABLE" : "UNAVAILABLE")] };
  }

  async retrieve(request: B08.ExternalAccessRequest): Promise<B08.ProviderResponse> {
    if (request.platform !== "rss" || request.source_types.length !== 1 || request.source_types[0] !== "rss" || request.geography || request.time_range) throw new B08.AccessError("UNSUPPORTED_CAPABILITY");
    let feedUrl: string;
    try {
      feedUrl = B08.canonicalSourceUrl(request.query);
    } catch {
      throw new B08.AccessError("MALFORMED_RESULT");
    }
    if (!feedUrl.startsWith("https://") || isInternalHost(new URL(feedUrl).hostname)) throw new B08.AccessError("UNSUPPORTED_CAPABILITY");
    const r = await this.exec(this.py, ["-c", FEED_SCRIPT, feedUrl, String(Math.min(request.max_results, 50))], { timeoutMs: this.timeoutMs, maxBytes: 2_000_000 });
    if (r.code !== 0) throw new B08.AccessError("FAILED");
    let data: { version?: string; bozo?: boolean; feed_title?: string; entries?: Array<Record<string, unknown>> };
    try {
      data = JSON.parse(r.stdout);
    } catch {
      throw new B08.AccessError("MALFORMED_RESULT");
    }
    if (data.bozo && !(data.entries ?? []).length) throw new B08.AccessError("MALFORMED_RESULT");
    const sources = (data.entries ?? [])
      .filter((e) => typeof e.link === "string" && /^https?:\/\//.test(e.link as string))
      .map((e) => {
        let url: string;
        try {
          url = B08.canonicalSourceUrl(e.link as string);
        } catch {
          return null;
        }
        return { canonical_url: url, platform: "rss", retrieval_method: `feedparser (Agent Reach RSS backend); feed=${feedUrl}`, content: JSON.stringify({ kind: "rss_entry", feed: data.feed_title ?? feedUrl, ...e }) };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .slice(0, request.max_results);
    return { status: "OK", provider_version: `feedparser ${data.version ?? "unknown"}`, backend: "feedparser", retrieved_at: now(), sources };
  }
}

// ------------------------------------------------------------------ plan + collect

export interface ReachPlanItem {
  id: string;
  backend: "youtube_search" | "rss";
  /** Search terms (youtube_search) or an https feed URL (rss). */
  query: string;
  observation_kind: "TrendObservation" | "CompetitiveObservation" | "CommunityObservation" | "AudienceObservation";
  purpose: string;
  max_results?: number;
}

export interface ReachPlan {
  plan_type: "B08_REACH_PLAN";
  project_id: string;
  channel_id: string;
  items: ReachPlanItem[];
}

function validMax(i: ReachPlanItem): number {
  const n = i.max_results ?? 10;
  if (!Number.isInteger(n) || n < 1 || n > 50) throw new Error(`reach plan item ${i.id}: max_results must be an integer 1–50 (got ${i.max_results})`);
  return n;
}

export function reachRequests(plan: ReachPlan): B08.ExternalAccessRequest[] {
  return plan.items.map((i) => ({
    request_id: `reach-${i.id}`,
    project_id: plan.project_id,
    purpose: i.purpose,
    query: i.query,
    source_types: [i.backend],
    platform: i.backend === "youtube_search" ? "youtube" : "rss",
    max_results: validMax(i),
    observation_kind: i.observation_kind,
    channel_id: plan.channel_id,
  }));
}

export async function collectReachIntelligence(
  plan: ReachPlan,
  transports: { youtube?: B08.AgentReachTransport; rss?: B08.AgentReachTransport } = {},
): Promise<B08.ExternalIntelligenceContext> {
  if (plan.plan_type !== "B08_REACH_PLAN") throw new Error("NOT_A_REACH_PLAN");
  const yt = new B08.AgentReachAdapter(transports.youtube ?? new YtDlpSearchTransport(), 90000);
  const rss = new B08.AgentReachAdapter(transports.rss ?? new FeedparserRssTransport(), 60000);
  const results: B08.ExternalAccessResult[] = [];
  for (const req of reachRequests(plan)) results.push(await (req.platform === "youtube" ? yt : rss).retrieve(req));
  return { project_id: plan.project_id, results };
}

/** Merge several validated contexts for the same project (e.g. YouTube feed + reach). */
export function mergeIntelligence(...contexts: B08.ExternalIntelligenceContext[]): B08.ExternalIntelligenceContext {
  const project = contexts[0]?.project_id;
  if (!project || contexts.some((c) => c.project_id !== project)) throw new Error("CROSS_PROJECT_MERGE");
  for (const c of contexts) for (const r of c.results) if (!B08.validateExternalResult(r)) throw new Error("INVALID_EXTERNAL_RESULT");
  const reviews = contexts.flatMap((c) => c.reviews ?? []);
  return { project_id: project, results: contexts.flatMap((c) => c.results), ...(reviews.length ? { reviews } : {}) };
}
