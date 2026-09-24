import { platformRegistryProvenance } from "../../src/b01/orchestration.js";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe,it,expect,vi } from "vitest";
import { AgentReachAdapter, AccessError, normalizeExternalResponse, validateExternalResult, serializeExternalRequest } from "../../src/b08/external/adapter.js";
import { LocalAgentReachTransport } from "../../src/b08/external/runtime.js";
import { externalObservations, externalReviewBinding, eligibleExternalReview } from "../../src/b08/external/context.js";
import type { ExternalAccessRequest, ExternalAccessResult, ExternalObservationReview, AgentReachTransport, ExternalIntelligenceContext } from "../../src/b08/external/types.js";
import { canonicalHasher } from "../../src/b00/hashing.js";
import { createCanonicalIdentity, validateCanonicalIdentity } from "../../src/b00/identity.js";
import { proposeItem,approveItem } from "../../src/b00/governance.js";
import { runB02 } from "../../src/b02/orchestration.js";
import { runB03 } from "../../src/b03/orchestration.js";
import { runB07 } from "../../src/b07/orchestration.js";
import { runB08,commitVersion as commitB08 } from "../../src/b08/orchestration.js";
import { InMemoryB08Persistence } from "../../src/b08/persistence.js";
import { runB09 } from "../../src/b09/orchestration.js";
import { runB10 } from "../../src/b10/orchestration.js";
import { runComplianceChecks } from "../../src/b11/phases/B11_03_checks.js";
import { calculateComplianceCompleteness } from "../../src/b11/phases/B11_04_validation.js";

const at="2026-09-06T00:00:00Z";
const request:ExternalAccessRequest={request_id:"r1",project_id:"project-a",purpose:"Research channel audience",query:"https://example.com/report",source_types:["web"],platform:"web",max_results:1,observation_kind:"AudienceObservation",channel_id:"ch1"};
const raw={status:"OK",provider_version:"fixture-only",backend:"controlled-fixture",retrieved_at:at,sources:[{canonical_url:"https://example.com/report#fragment",platform:"web",retrieval_method:"controlled fixture (no network)",content:"An individual developer reports needing a testing tool."}]};
function result(mode:"REAL"|"MOCK"|"SYNTHETIC"|"UNKNOWN"="REAL",req=request,content=raw.sources[0].content){return normalizeExternalResponse(req,{...raw,sources:[{...raw.sources[0],content}]},mode);}
function context(r=result()):ExternalIntelligenceContext{return{project_id:"project-a",results:[r]};}
function review(r:ExternalAccessResult):ExternalObservationReview {
  const o=r.observations[0];
  const receipt:ExternalObservationReview={observation_id:o.observation_id,observation_content_hash:canonicalHasher.hashValue(o),authority:"independent-test-reviewer",reviewed_at:at,
    evidence_refs:[{id:"independent-confirmation",source:"fixture:independent-review",status:"VERIFIED",origin:"DOCUMENTATION",basis:"OBSERVED",source_mode:"REAL",production_eligible:true}],governance_events:[]};
  const b=externalReviewBinding(receipt);
  const p=proposeItem({itemId:b.object_id,history:[],authority:receipt.authority,timestamp:at});
  receipt.governance_events=approveItem({itemId:b.object_id,history:p.history,authority:receipt.authority,timestamp:at,artifact:b,requireArtifactBinding:true,sourceEvidenceRefs:receipt.evidence_refs.map(e=>e.id)}).history;
  return receipt;
}
const b01:any={version:"v1.0",created_at:at,updated_at:at,user_decision_authority:"fixture",brand_profile:{brand_name:"Fixture",positioning:"Tools",mission:"Explain",values:[]},
  channels:[{channel_id:"ch1",name:"Fixture channel",platform:"YOUTUBE",role:"primary",audience_category:"broad",evidence_refs:[]},{channel_id:"ch2",name:"Other channel",platform:"YOUTUBE",role:"secondary",audience_category:"broad",evidence_refs:[]}],
  platforms:[{platform_id:"youtube",name:"YOUTUBE",capabilities:[],evidence_refs:[]}],ecosystems:[],content_territories:[],strategic_constraints:[],
  editorial_constitution:{constitution_id:"ec",rules:[],evidence_refs:[]},distribution_strategy:{channel_assignments:[],evidence_refs:[]},evidence_refs:[],provenance_refs:[],audit_trail:[],decisions_made:[],recommendations_considered:[]};
const b04:any={candidate_id:"b04",campaigns:[{campaign_id:"campaign",campaign_name:"Fixture",primary_objective:"Growth"}]};
const b06:any={candidate_id:"b06",distribution_strategies:[{campaign_id:"campaign",channel_selections:[{channel_id:"ch1",channel_name:"YouTube"}]}]};
function transport(response:unknown=raw,mode:AgentReachTransport["source_mode"]="REAL"):AgentReachTransport{return{source_mode:mode,retrieve:async()=>response,health:async()=>({installed:true,reachable:true,authenticated:"UNKNOWN",provider_version:"fixture",checked_at:at,status:"AVAILABLE",capabilities:[]})};}

describe("B08 Agent Reach adapter and trust boundary",()=>{
  it("serializes deterministically and strips unrecognized auth/config properties",()=>{
    expect(serializeExternalRequest({...request,token:"never-serialize"} as any)).not.toContain("never-serialize");
    expect(JSON.parse(serializeExternalRequest(request))).toEqual(request);
  });
  it.each([0,101,1.5,NaN])("rejects invalid result limit %s",limit=>expect(()=>serializeExternalRequest({...request,max_results:limit})).toThrow());
  it("rejects malformed requests and timestamps",()=>{
    expect(()=>serializeExternalRequest({...request,time_range:{start:"invalid",end:at}})).toThrow();
    expect(()=>normalizeExternalResponse(request,{...raw,retrieved_at:"yesterday"},"REAL")).toThrow();
  });
  it("records canonical source hash and complete subject-bound source/evidence/provenance",()=>{
    const r=result();expect(validateExternalResult(r)).toBe(true);expect(r.sources[0].canonical_url).toBe("https://example.com/report");
    expect(r.sources[0].content_hash).toBe(canonicalHasher.hash(raw.sources[0].content));
    expect(r.provenance[0].subject_id).toBe(r.sources[0].source_id);
    expect(r.provenance[0].source_evidence_refs).toEqual([r.evidence[0].id]);
    expect(r.observations[0].provenance.prior_provenance_id).toBe(r.provenance[0].id);
    expect(r.observations[0].statement).toBe(raw.sources[0].content);
    expect(validateCanonicalIdentity(r,r.identity).valid).toBe(true);
  });
  it("is deterministic but content/project/mode changes affect identity",()=>{
    expect(result()).toEqual(result());expect(result().identity.object_id).not.toBe(result("REAL",request,"changed").identity.object_id);
    expect(result().sources[0].source_id).not.toBe(result("MOCK").sources[0].source_id);
    expect(result().sources[0].source_id).not.toBe(result("REAL",{...request,project_id:"other"}).sources[0].source_id);
  });
  it.each(["REAL","MOCK","SYNTHETIC","UNKNOWN"] as const)("never promotes %s retrieval to VERIFIED",async mode=>{
    const r=await new AgentReachAdapter(transport({...raw,status:"OK",source_mode:"REAL",verified:true},mode)).retrieve(request);
    expect(r.status).toBe(`EXECUTED_${mode}`);expect(r.source_mode).toBe(mode);
    expect(r.evidence.every(e=>e.status==="UNKNOWN" && e.production_eligible===false && e.source_mode===mode)).toBe(true);
    if(mode!=="REAL")expect(externalObservations(context(r),["AudienceObservation"])).toEqual([]);
  });
  it.each(["UNAVAILABLE","AUTH_REQUIRED","RATE_LIMITED","FAILED","UNSUPPORTED_CAPABILITY"] as const)("maps %s without evidence",async status=>{
    const t=transport();t.retrieve=async()=>{throw new AccessError(status)};
    const r=await new AgentReachAdapter(t).retrieve(request);expect(r.status).toBe(status);expect(r.sources).toEqual([]);expect(r.evidence).toEqual([]);
  });
  it.each([null,{},"not json",{...raw,status:"VERIFIED"},{...raw,sources:[{content:"missing source"}]}])("rejects malformed provider data %#",async rawValue=>{
    expect((await new AgentReachAdapter(transport(rawValue)).retrieve(request)).status).toBe("MALFORMED_RESULT");
  });
  it("failure responses cannot smuggle sources",()=>expect(()=>normalizeExternalResponse(request,{...raw,status:"FAILED"},"REAL")).toThrow());
  it("rejects credential URLs and platform mismatch",()=>{
    for(const url of ["file:///etc/passwd","https://user:password@example.com/","https://example.com/?api_key=secret"])
      expect(()=>normalizeExternalResponse(request,{...raw,sources:[{...raw.sources[0],canonical_url:url}]},"REAL")).toThrow();
    expect(()=>normalizeExternalResponse(request,{...raw,sources:[{...raw.sources[0],platform:"reddit"}]},"REAL")).toThrow();
  });
  it("timeout aborts an uncooperative transport",async()=>{
    const t=transport();let signal:AbortSignal|undefined;t.retrieve=async(_,s)=>{signal=s;return new Promise(()=>{});};
    const r=await new AgentReachAdapter(t,5).retrieve(request);expect(r.status).toBe("FAILED");expect(signal?.aborted).toBe(true);
  });
  it("health is telemetry and never source evidence",async()=>{
    const adapter=new AgentReachAdapter(transport());const h=await adapter.health();expect(h.installed).toBe(true);expect(h).not.toHaveProperty("evidence");
    const unavailable=new LocalAgentReachTransport("/definitely-missing-agent-reach");expect((await unavailable.health()).status).toBe("UNAVAILABLE");
    expect((await new AgentReachAdapter(unavailable).retrieve(request)).status).toBe("UNAVAILABLE");
  });
  it("reports unsupported native search separately",async()=>{
    const native=new LocalAgentReachTransport("/missing");expect((await new AgentReachAdapter(native).retrieve({...request,platform:"reddit"})).status).toBe("UNSUPPORTED_CAPABILITY");
  });
  it("rejects tampering even when an attacker recomputes the envelope hash",()=>{
    const r=result();r.evidence[0].status="VERIFIED";r.evidence[0].production_eligible=true;
    r.identity=createCanonicalIdentity({object_id:r.identity.object_id,object_type:r.identity.object_type,version:"v1",artifact:r,created_at:at});
    expect(validateExternalResult(r)).toBe(false);expect(()=>externalObservations(context(r),["AudienceObservation"])).toThrow();
  });
  it("rejects cross-project context",()=>expect(()=>externalObservations({project_id:"other",results:[result()]},["AudienceObservation"])).toThrow());
  it("requires exact-bound independent reviewed evidence and B00 approval",()=>{
    const r=result(),c=context(r);expect(eligibleExternalReview(r.observations[0],c)).toBeUndefined();
    c.reviews=[review(r)];expect(eligibleExternalReview(r.observations[0],c)).toBeDefined();
    c.reviews[0].observation_content_hash="changed";expect(eligibleExternalReview(r.observations[0],c)).toBeUndefined();
    c.reviews=[review(r)];c.reviews[0].governance_events=[];expect(eligibleExternalReview(r.observations[0],c)).toBeUndefined();
  });
  it("review cannot reuse retrieval evidence or promote a MOCK source",()=>{
    const r=result(),c=context(r);const receipt=review(r);receipt.evidence_refs=r.evidence;c.reviews=[receipt];expect(eligibleExternalReview(r.observations[0],c)).toBeUndefined();
    const mock=result("MOCK");expect(eligibleExternalReview(mock.observations[0],{...context(mock),reviews:[review(mock)]})).toBeUndefined();
  });
});

describe("B08 external module integration (controlled fixtures; NOT live)",()=>{
  it("feeds B02 only channel-bound source reports without changing heuristic scores",async()=>{
    const r=result("REAL",{...request,observation_kind:"TrendObservation"}),plain=await runB02(b01),updated=await runB02(b01,{external_intelligence:context(r)});
    expect(updated.opportunities.filter(o=>o.channel_id==="ch1").some(o=>o.supporting_evidence.some(e=>e.id===r.evidence[0].id))).toBe(true);
    expect(updated.opportunities.filter(o=>o.channel_id==="ch2").every(o=>!o.supporting_evidence.some(e=>e.id===r.evidence[0].id))).toBe(true);
    expect(updated.opportunities.map(o=>o.strategic_relevance)).toEqual(plain.opportunities.map(o=>o.strategic_relevance));
    expect(updated.opportunities.every(o=>o.strategic_relevance_basis==="HEURISTIC")).toBe(true);
  });
  it("feeds B03 without fabricated demographics, geographic scope or verified truth",()=>{
    const r=result(),candidate=runB03(b01,{b01_canonical_state:b01,external_intelligence:context(r)});
    expect(candidate.audience_segments).toHaveLength(1);expect(candidate.audience_segments[0].channel_ids).toEqual(["ch1"]);
    expect(candidate.audience_segments[0].evidence_refs).toEqual(r.evidence);
    expect(candidate.audience_segments[0].geography).toBeUndefined();expect(candidate.evidence_refs[0].status).toBe("UNKNOWN");
  });
  it.each(["MOCK","SYNTHETIC","UNKNOWN"] as const)("blocks %s results from B02/B03/B09",async mode=>{
    const r=result(mode),c=context(r),audience=runB03(b01,{b01_canonical_state:b01,external_intelligence:c});
    expect(audience.audience_segments).toEqual([]);
    const opportunity=await runB02(b01,{external_intelligence:c});expect(opportunity.evidence_refs.some(e=>e.id===r.evidence[0].id)).toBe(false);
    const b08=await runB08({kpi_definitions:[]} as any,b06,b01,{external_intelligence:c});
    expect((await runB09(b08,b06)).observations).toEqual([]);
  });
  it("does not parse generic social text as KPI values",()=>expect(()=>result("REAL",{...request,observation_kind:"PerformanceObservation"},"Popular post with 100 likes")).toThrow());
  it("retains B08 context through canonical persistence without fabricated analytics",async()=>{
    const r=result(),b08=await runB08({kpi_definitions:[]} as any,b06,b01,{external_intelligence:context(r)});
    const p=new InMemoryB08Persistence(),canonical=await commitB08(b08,"v1.0","fixture",p);
    expect((await p.load("v1.0"))?.external_intelligence).toEqual(context(r));expect(canonical.analytics_results).toEqual([]);
    expect((await runB09(canonical,b06)).observations).toEqual([]);
  });
  it("maps explicit measured KPI only after independent bound review",async()=>{
    const base=await runB07(b04,b06),kpi=base.kpi_definitions[0];expect(kpi).toBeDefined();
    const content=JSON.stringify({measurement:{metric_id:kpi.kpi_id,channel_id:"ch1",value:42,unit:kpi.target_unit,period_start:at,period_end:at}});
    const r=result("REAL",{...request,observation_kind:"PerformanceObservation"},content),c=context(r);
    const unreviewed=await runB07(b04,b06,{external_intelligence:c});expect(unreviewed.kpi_definitions[0].actual_metric_value).toBeUndefined();
    c.reviews=[review(r)];const measured=await runB07(b04,b06,{external_intelligence:c});expect(measured.kpi_definitions[0].actual_metric_value).toBe(42);
    expect(measured.kpi_definitions[0].target_definition).toEqual(base.kpi_definitions[0].target_definition);
    expect(r.evidence[0].status).toBe("UNKNOWN");
  });
  it("B09 reviewed nonmetric observation reaches B10 as an unapproved review proposal",async()=>{
    const r=result(),c=context(r);c.reviews=[review(r)];const b08=await runB08({kpi_definitions:[]} as any,b06,b01,{external_intelligence:c});
    const b09=await runB09(b08,b06);expect(b09.observations).toHaveLength(1);expect(b09.observations[0].observation_type).toBe("external_audience");
    expect(b09.observations[0].magnitude).toBeUndefined();expect(b09.signals[0].signal_type).toBe("neutral_observation");
    const b10=await runB10(b09);expect(b10.optimization_proposals).toHaveLength(1);expect(b10.optimization_proposals[0].required_approval).toBe(true);
    expect(b10.optimization_proposals[0].provenance.type).toBe("RECOMMENDED");expect(b10.governance_events).toEqual({});
    expect(b10.optimization_proposals[0].evidence_refs.some(e=>e.id===r.evidence[0].id)).toBe(true);
  });
});

describe("B11 exact subject binding",()=>{
  const rule:any={rule_id:"rule",scope:["B10"]};const subject:any={subject_id:"s",subject_type:"B10_OPT",subject_version:"v1.0",subject_content_hash:"hash",affected_modules:["B10"]};
  const evidence:any={rule_id:"rule",subject_id:"s",subject_type:"B10_OPT",subject_version:"v1.0",subject_content_hash:"hash",assertion:"SATISFIES",rationale:"Controlled reviewer fixture",evidence_ref:{id:"confirmed",source:"fixture",status:"VERIFIED",origin:"DOCUMENTATION",basis:"OBSERVED",source_mode:"REAL"}};
  it.each(["subject_id","subject_type","subject_version","subject_content_hash"])("rejects wrong %s",field=>{
    expect(runComplianceChecks([rule],[subject],{complianceEvidence:[{...evidence,[field]:"wrong"} ]})[0].status).toBe("UNKNOWN");
  });
  it("accepts eligible bound confirmation, rejects raw retrieval and unbound legacy evidence",()=>{
    expect(runComplianceChecks([rule],[subject],{complianceEvidence:[evidence]})[0].status).toBe("COMPLIANT");
    expect(runComplianceChecks([rule],[subject],{complianceEvidence:[{...evidence,evidence_ref:result().evidence[0]}]})[0].status).toBe("UNKNOWN");
    expect(runComplianceChecks([rule],[subject],{complianceEvidence:[{...evidence,subject_version:undefined} ]})[0].status).toBe("UNKNOWN");
  });
  it("legacy numeric count summaries never establish semantic compliance",()=>expect(calculateComplianceCompleteness(5,5,0,[]).semantic_status).toBe("UNKNOWN"));
});


describe("Native Agent Reach backend binding (subprocess/fetch fixtures)",()=>{
  it("parses the upstream version format, calls doctor, and bounds native retrieval",async()=>{
    const dir=await mkdtemp(join(tmpdir(),"b08-native-fixture-"));
    const cli=join(dir,"agent-reach-fixture");
    await writeFile(cli,`#!${process.execPath}\nconsole.log(process.argv.includes('--version') ? 'Agent Reach v1.5.0' : 'fixture doctor');\n`,{mode:0o755});
    const fetchMock=vi.fn().mockResolvedValue(new Response("retrieved public report",{status:200}));
    vi.stubGlobal("fetch",fetchMock);
    try {
      const native=new LocalAgentReachTransport(cli,()=>at),adapter=new AgentReachAdapter(native);
      const health=await adapter.health();expect(health.installed).toBe(true);expect(health.reachable).toBe(true);expect(health.provider_version).toBe("1.5.0");
      expect(health.capabilities[0].status).toBe("UNKNOWN");
      const r=await adapter.retrieve(request);expect(r.status).toBe("EXECUTED_REAL");expect(r.evidence[0].status).toBe("UNKNOWN");
      expect(fetchMock.mock.calls[0][0]).toBe("https://r.jina.ai/https://example.com/report");
      expect((await adapter.health()).capabilities[0].status).toBe("AVAILABLE");
      for(const [code,status] of [[401,"AUTH_REQUIRED"],[403,"AUTH_REQUIRED"],[429,"RATE_LIMITED"],[500,"FAILED"]] as const){
        fetchMock.mockResolvedValueOnce(new Response("backend error",{status:code}));expect((await adapter.retrieve(request)).status).toBe(status);
      }
      for(const url of ["https://127.0.0.1/","https://localhost/","https://host.internal/","http://example.com/"]){
        expect((await adapter.retrieve({...request,query:url})).status).toBe("UNSUPPORTED_CAPABILITY");
      }
      expect((await adapter.retrieve({...request,time_range:{start:at,end:at}})).status).toBe("UNSUPPORTED_CAPABILITY");
    } finally {vi.unstubAllGlobals();await rm(dir,{recursive:true,force:true});}
  });
});

it("preserves distinct id-less B01 provenance while deduplicating actual duplicates",()=>{
 const a:any={type:"OBSERVED",decision_authority:"source-a",timestamp:at};
 const b:any={type:"OBSERVED",decision_authority:"source-b",timestamp:at};
 expect(platformRegistryProvenance({web:{provenance_refs:[a,b,a],capabilities:[]}} as any)).toEqual([a,b]);
});

it("B12 preserves external evidence lineage without promoting operational readiness",async()=>{
 const {createBranchState}=await import("../../src/b12/orchestration.js");
 const r=result(),p=new InMemoryB08Persistence();
 const candidate=await runB08({kpi_definitions:[]} as any,b06,b01,{external_intelligence:context(r)});
 await commitB08(candidate,"v1.0","fixture",p);
 const branch=await createBranchState(undefined,undefined,undefined,undefined,undefined,undefined,undefined,"v1.0",undefined,undefined,undefined,{upstreamReader:{b08:p} as any});
 expect(branch.evidence_refs.some(e=>e.id===r.evidence[0].id && e.status==="UNKNOWN")).toBe(true);
 expect(branch.provenance_refs.some(p=>p.subject_id===r.sources[0].source_id)).toBe(true);
 expect(branch.completeness_summary.operational_readiness).toBe("NOT_READY");
});

it.each(["MOCK","SYNTHETIC","UNKNOWN"] as const)("B07 never uses %s measured fixtures as actual values",async mode=>{
 const base=await runB07(b04,b06),kpi=base.kpi_definitions[0];
 const content=JSON.stringify({measurement:{metric_id:kpi.kpi_id,channel_id:"ch1",value:42,unit:kpi.target_unit,period_start:at,period_end:at}});
 const r=result(mode,{...request,observation_kind:"PerformanceObservation"},content);
 const measured=await runB07(b04,b06,{external_intelligence:{...context(r),reviews:[review(r)]}});
 expect(measured.kpi_definitions.every(k=>k.actual_metric_value===undefined && k.external_measurements===undefined)).toBe(true);
});

it("B08 never fabricates a missing campaign or mixes metric ownership between campaigns",async()=>{
 const {buildAnalyticsContext}=await import("../../src/b08/phases/B08_01_registry.js");
 const {defineAnalyticsWorkflows}=await import("../../src/b08/phases/B08_04_workflows.js");
 const missing=buildAnalyticsContext({kpi_definitions:[{kpi_id:"orphan",channel_id:"ch1",metric_name:"views"}]} as any,b06,b01);
 expect(missing.campaigns).toEqual([]);expect(missing.gaps).toContain("missing_campaign_for_kpi:orphan");
 const ctx:any={campaigns:[{campaign_id:"a",campaign_name:"A"},{campaign_id:"b",campaign_name:"B"}],kpis:[{kpi_id:"ka",campaign_id:"a"},{kpi_id:"kb",campaign_id:"b"}],channels:[],gaps:[]};
 const workflows=defineAnalyticsWorkflows(ctx,[],[{metric_id:"ma",kpi_id:"ka",source_id:"sa"},{metric_id:"mb",kpi_id:"kb",source_id:"sb"}] as any);
 expect(workflows[0].metric_ids).toEqual(["ma"]);expect(workflows[1].metric_ids).toEqual(["mb"]);
});
