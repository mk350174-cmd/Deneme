/** Thin B-owned binding to externally installed Agent Reach and its documented
 * Jina Reader backend. No upstream internals, credentials, auto-install or shell. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AccessError, canonicalSourceUrl } from "./adapter.js";
import type { AgentReachTransport, AgentReachHealth, AgentReachCapability, ExternalAccessRequest, ProviderResponse } from "./types.js";
const exec = promisify(execFile);
export class LocalAgentReachTransport implements AgentReachTransport {
  readonly source_mode = "REAL" as const;
  private capabilities: AgentReachCapability[] = [{capability:"read",platform:"web",backend:"jina-reader",requires_auth:false,requires_cookie:false,
    requires_browser_session:false,requires_mcp:false,proxy_required:false,status:"UNKNOWN",last_checked:null}];
  constructor(private readonly executable = "agent-reach", private readonly now = () => new Date().toISOString()) {}
  private async version(): Promise<string> {
    try {
      const {stdout} = await exec(this.executable,["--version"],{timeout:10000,maxBuffer:65536});
      // Persist only the version, never arbitrary CLI output.
      const match = stdout.match(/Agent Reach v(\d+\.\d+\.\d+(?:[-+.][a-zA-Z0-9.-]+)?)/i);
      if (!match) throw new AccessError("UNAVAILABLE");
      return match[1];
    } catch { throw new AccessError("UNAVAILABLE"); }
  }
  async health(): Promise<AgentReachHealth> {
    const base = {checked_at:this.now(),capabilities:structuredClone(this.capabilities),authenticated:"UNKNOWN" as const};
    let version: string;
    try { version = await this.version(); } catch { return {...base,installed:false,reachable:false,provider_version:null,status:"UNAVAILABLE"}; }
    try {
      // doctor output is not research data and is deliberately not retained.
      await exec(this.executable,["doctor"],{timeout:15000,maxBuffer:262144});
      return {...base,installed:true,reachable:true,provider_version:version,status:"AVAILABLE"};
    } catch { return {...base,installed:true,reachable:false,provider_version:version,status:"FAILED"}; }
  }
  async retrieve(request: ExternalAccessRequest, signal: AbortSignal): Promise<ProviderResponse> {
    if (request.platform !== "web" || request.source_types.length !== 1 || request.source_types[0] !== "web" || request.max_results !== 1
      || request.geography || request.time_range) throw new AccessError("UNSUPPORTED_CAPABILITY");
    const url = canonicalSourceUrl(request.query);
    const parsed = new URL(url);
    // Explicit domain URL only. This backend does not fetch private addresses,
    // accept auth inputs, or pretend to implement search/filtering.
    if (parsed.protocol !== "https:" || parsed.port || !parsed.hostname.includes(".") || /^[\d.]+$/.test(parsed.hostname)
      || parsed.hostname.includes(":") || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(parsed.hostname)) throw new AccessError("UNSUPPORTED_CAPABILITY");
    const version = await this.version();
    let response: Response;
    try { response=await fetch(`https://r.jina.ai/${url}`,{signal,redirect:"error",headers:{Accept:"text/plain"}}); }
    catch { throw new AccessError("FAILED"); }
    const status = response.status === 401 || response.status === 403 ? "AUTH_REQUIRED" : response.status === 429 ? "RATE_LIMITED" : response.ok ? "AVAILABLE" : "FAILED";
    this.capabilities[0]={...this.capabilities[0],status,last_checked:this.now()};
    if (!response.ok) throw new AccessError(status === "AVAILABLE" ? "FAILED" : status);
    const reader = response.body?.getReader();
    if (!reader) throw new AccessError("MALFORMED_RESULT");
    const chunks: Uint8Array[]=[]; let size=0;
    try { for (;;) { const {done,value}=await reader.read(); if(done) break; size+=value.byteLength;
      if(size>1000000) { await reader.cancel(); throw new AccessError("MALFORMED_RESULT"); } chunks.push(value); } }
    finally { reader.releaseLock(); }
    const content=Buffer.concat(chunks).toString("utf8");
    return {status:"OK",provider_version:version,backend:"jina-reader",retrieved_at:this.now(),sources:[{canonical_url:url,platform:"web",retrieval_method:"jina-reader HTTPS read (Agent Reach documented backend)",content}]};
  }
}
