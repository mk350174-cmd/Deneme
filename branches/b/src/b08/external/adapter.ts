import { canonicalHasher, canonicalStringify } from "../../b00/hashing.js";
import { createArtifactBinding, createCanonicalIdentity, validateCanonicalIdentity } from "../../b00/identity.js";
import { bindProvenanceToSubject } from "../../b00/provenanceRef.js";
import { validateEvidenceSemantics, type EvidenceSourceMode } from "../../b00/evidence.js";
import type { EvidenceRef } from "../../types/entities.js";
import type { ExternalAccessRequest, ExternalAccessResult, ExternalMeasurement, ExternalObservation, ProviderResponse, AgentReachTransport, AccessFailure } from "./types.js";

const modes = ["REAL", "MOCK", "SYNTHETIC", "UNKNOWN"] as const;
const failures: AccessFailure[] = ["FAILED", "UNAVAILABLE", "AUTH_REQUIRED", "UNSUPPORTED_CAPABILITY", "RATE_LIMITED", "MALFORMED_RESULT"];
const kinds = ["PerformanceObservation", "AudienceObservation", "CommunityObservation", "TrendObservation", "CompetitiveObservation"];
const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const nonempty = (x: unknown): x is string => typeof x === "string" && x.trim().length > 0;
export const validTime = (x: unknown): x is string => typeof x === "string" && /^\d{4}-\d\d-\d\dT/.test(x) && Number.isFinite(Date.parse(x));
/** Public source locators only. Credentials and query secrets must not enter artifacts. */
export function canonicalSourceUrl(value: string): string {
  const u = new URL(value);
  if (!["https:", "http:"].includes(u.protocol) || u.username || u.password) throw new Error("INVALID_SOURCE_URL");
  if ([...u.searchParams.keys()].some(k => /token|secret|password|cookie|session|api[_-]?key|signature/i.test(k))) throw new Error("SECRET_SOURCE_URL");
  u.hash = "";
  return u.href;
}
export function serializeExternalRequest(value: ExternalAccessRequest): string {
  if (!record(value) || ![value.request_id, value.project_id, value.purpose, value.query, value.channel_id].every(nonempty)
    || value.query.length > 16000 || !Array.isArray(value.source_types) || !value.source_types.length || !value.source_types.every(nonempty)
    || !Number.isInteger(value.max_results) || value.max_results < 1 || value.max_results > 100 || !kinds.includes(value.observation_kind)
    || (value.platform !== undefined && !nonempty(value.platform)) || (value.geography !== undefined && !nonempty(value.geography))) throw new Error("INVALID_ACCESS_REQUEST");
  if (value.time_range && (!validTime(value.time_range.start) || !validTime(value.time_range.end) || Date.parse(value.time_range.start) > Date.parse(value.time_range.end))) throw new Error("INVALID_TIME_RANGE");
  // Allowlist serialization: no arbitrary provider auth/config fields.
  return canonicalStringify({ request_id:value.request_id, project_id:value.project_id, purpose:value.purpose, query:value.query,
    source_types:value.source_types, platform:value.platform, geography:value.geography, time_range:value.time_range,
    max_results:value.max_results, observation_kind:value.observation_kind, channel_id:value.channel_id });
}
export function parseProviderResponse(value: unknown, request: ExternalAccessRequest): ProviderResponse {
  if (!record(value) || !(value.status === "OK" || failures.includes(value.status as AccessFailure)) || !nonempty(value.backend)
    || !(value.provider_version === null || nonempty(value.provider_version)) || !validTime(value.retrieved_at) || !Array.isArray(value.sources)
    || value.sources.length > request.max_results || (value.status !== "OK" && value.sources.length > 0)) throw new Error("MALFORMED_RESULT");
  const sources = value.sources.map(s => {
    if (!record(s) || ![s.canonical_url, s.platform, s.retrieval_method, s.content].every(nonempty) || (s.content as string).length > 1000000) throw new Error("MALFORMED_SOURCE");
    if (request.platform && s.platform !== request.platform) throw new Error("PLATFORM_MISMATCH");
    return { canonical_url:canonicalSourceUrl(s.canonical_url as string), platform:s.platform as string, retrieval_method:s.retrieval_method as string, content:s.content as string };
  });
  return { status:value.status as ProviderResponse["status"], provider_version:value.provider_version as string | null,
    backend:value.backend as string, retrieved_at:value.retrieved_at as string, sources };
}
/** Only an explicit structured measurement inside the retained source text can be mapped. */
function measurement(content: string, request: ExternalAccessRequest): ExternalMeasurement | undefined {
  if (request.observation_kind !== "PerformanceObservation") return undefined;
  const data: unknown = JSON.parse(content);
  if (!record(data) || !record(data.measurement)) throw new Error("MISSING_MEASUREMENT");
  const m = data.measurement;
  if (![m.metric_id,m.channel_id,m.unit].every(nonempty) || m.channel_id !== request.channel_id || typeof m.value !== "number" || !Number.isFinite(m.value)
    || !validTime(m.period_start) || !validTime(m.period_end) || Date.parse(m.period_start) > Date.parse(m.period_end)) throw new Error("INVALID_MEASUREMENT");
  if (request.time_range && (Date.parse(m.period_start) < Date.parse(request.time_range.start) || Date.parse(m.period_end) > Date.parse(request.time_range.end))) throw new Error("MEASUREMENT_OUTSIDE_RANGE");
  return { metric_id:m.metric_id as string, channel_id:m.channel_id as string, value:m.value, unit:m.unit as string, period_start:m.period_start, period_end:m.period_end };
}
export function normalizeExternalResponse(input: ExternalAccessRequest, raw: unknown, mode: EvidenceSourceMode): ExternalAccessResult {
  const request: ExternalAccessRequest = JSON.parse(serializeExternalRequest(input));
  if (!modes.includes(mode)) throw new Error("INVALID_SOURCE_MODE");
  const response = parseProviderResponse(raw, request);
  const sources = response.sources.map(s => ({...s, source_id:`extsrc_${canonicalHasher.hashValue({project:request.project_id,url:s.canonical_url,backend:response.backend,mode})}`,
    project_id:request.project_id, retrieved_at:response.retrieved_at, content_hash:canonicalHasher.hash(s.content), source_mode:mode, backend:response.backend, provider_version:response.provider_version }));
  // Same locator and content can appear twice; differing content must not be collapsed.
  const uniqueSources = [...new Map(sources.map(s => [`${s.source_id}:${s.content_hash}`,s])).values()];
  const evidence: EvidenceRef[] = uniqueSources.map(s => ({ id:`extev_${canonicalHasher.hashValue({source:s.source_id,hash:s.content_hash,at:s.retrieved_at})}`,
    source:s.canonical_url, status:"UNKNOWN", origin:mode === "MOCK" ? "MOCK" : "PROVIDER_DATA", basis:mode === "REAL" ? "OBSERVED" : mode === "MOCK" ? "MOCK" : "UNKNOWN",
    source_mode:mode, production_eligible:false, excerpt:s.content }));
  for (const e of evidence) if (!validateEvidenceSemantics(e).valid) throw new Error("B00_EVIDENCE_REJECTED");
  const provenance = uniqueSources.map((s,i) => bindProvenanceToSubject({ id:`extprov_${evidence[i].id}`, type:mode === "REAL" ? "OBSERVED" : "INFERRED",
    decision_authority:"B08:AgentReachAdapter", timestamp:s.retrieved_at, rationale:"Source retrieval recorded; content truth remains UNKNOWN" },
    createArtifactBinding(s, s.source_id, "B08_EXTERNAL_SOURCE", s.content_hash), [evidence[i].id], "agent_reach_retrieval_to_source"));
  const observations: ExternalObservation[] = uniqueSources.map((s,i) => {
    const body = { observation_id:`extobs_${canonicalHasher.hashValue({request,source:s})}`, kind:request.observation_kind, project_id:request.project_id,
      channel_id:request.channel_id, source_id:s.source_id, source_mode:mode, observed_at:s.retrieved_at, statement:s.content,
      ...(request.observation_kind === "PerformanceObservation" ? {measurement:measurement(s.content,request)} : {}), evidence_refs:[evidence[i]] };
    return {...body, provenance:bindProvenanceToSubject({id:`obsprov_${body.observation_id}`, type:mode === "REAL" ? "OBSERVED" : "INFERRED",
      decision_authority:"B08:normalizeExternalResponse",timestamp:s.retrieved_at,prior_provenance_id:provenance[i].id,rationale:"Normalized source report; not verified truth"},
      createArtifactBinding(body,body.observation_id,"B08_EXTERNAL_OBSERVATION","v1"),[evidence[i].id],"source_to_b08_observation")};
  });
  const body = {request, provider:"agent-reach" as const, provider_version:response.provider_version, backend:response.backend,
    status:response.status === "OK" ? `EXECUTED_${mode}` as ExternalAccessResult["status"] : response.status, source_mode:mode, retrieved_at:response.retrieved_at,
    sources:uniqueSources, evidence, provenance:[...provenance,...observations.map(o=>o.provenance)], observations};
  return {...body, identity:createCanonicalIdentity({object_id:`extresult_${canonicalHasher.hashValue(body)}`,object_type:"B08_EXTERNAL_ACCESS_RESULT",version:"v1",artifact:body,created_at:body.retrieved_at})};
}
/** Rebuild every B-derived field; an attacker cannot just rehash promoted evidence. */
export function validateExternalResult(result: unknown): result is ExternalAccessResult {
  try {
    if (!record(result)) return false;
    const r = result as unknown as ExternalAccessResult;
    if (!validateCanonicalIdentity(r,r.identity).valid) return false;
    const rebuilt = normalizeExternalResponse(r.request,{status:r.status.startsWith("EXECUTED_") ? "OK" : r.status,provider_version:r.provider_version,backend:r.backend,retrieved_at:r.retrieved_at,
      sources:r.sources.map(s=>({canonical_url:s.canonical_url,platform:s.platform,retrieval_method:s.retrieval_method,content:s.content}))},r.source_mode);
    return canonicalStringify(rebuilt) === canonicalStringify(r);
  } catch { return false; }
}
export class AgentReachAdapter {
  constructor(private readonly transport: AgentReachTransport, private readonly timeoutMs = 20000, private readonly now = () => new Date().toISOString()) {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new Error("INVALID_TIMEOUT");
  }
  health() { return this.transport.health(); }
  async retrieve(input: ExternalAccessRequest): Promise<ExternalAccessResult> {
    const request = JSON.parse(serializeExternalRequest(input)) as ExternalAccessRequest;
    const mode = this.transport.source_mode;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await Promise.race([this.transport.retrieve(structuredClone(request),controller.signal),new Promise<never>((_,reject)=>{
        timer=setTimeout(()=>{controller.abort();reject(new Error("TIMEOUT"));},this.timeoutMs);
      })]);
      return normalizeExternalResponse(request,response,mode);
    } catch (error) {
      const status: AccessFailure = error instanceof AccessError ? error.status : error instanceof Error && error.message === "TIMEOUT" ? "FAILED" : "MALFORMED_RESULT";
      // Never echo arbitrary provider stderr, cookies, tokens, or exception payloads.
      return normalizeExternalResponse(request,{status,provider_version:null,backend:"UNKNOWN",retrieved_at:this.now(),sources:[]},mode);
    } finally { if (timer) clearTimeout(timer); }
  }
}
export class AccessError extends Error { constructor(readonly status: AccessFailure) { super(status); } }
