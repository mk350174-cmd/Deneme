// Live checks are deliberately separate from Vitest. Do not count fixture
// retrieval as a live provider PASS. No cookies or provider output are logged.
import { writeFileSync } from 'node:fs';
import { AgentReachAdapter, LocalAgentReachTransport, validateExternalResult } from '../dist/b08/index.js';
const executable=process.argv[2] || 'agent-reach';
const output=process.argv[3];
if(!output) throw new Error('Usage: node scripts/live-agent-reach.mjs /path/to/agent-reach /absolute/report.json');
const adapter=new AgentReachAdapter(new LocalAgentReachTransport(executable));
const health=await adapter.health();
const result=await adapter.retrieve({request_id:'live-public-web-check',project_id:'b-branch-provider-verification',purpose:'Verify access and normalization; not content truth',query:'https://example.com/',source_types:['web'],platform:'web',max_results:1,observation_kind:'CommunityObservation',channel_id:'verification-only'});
const fetched=result.status==='EXECUTED_REAL' && result.sources.length>0;
const report={checked_at:new Date().toISOString(),provider:'agent-reach',health,execution_status:result.status,
  installed:health.installed?'VERIFIED':'NOT VERIFIED',reachable:fetched?'VERIFIED (jina-reader backend only)':health.reachable?'VERIFIED (doctor process only)':'NOT VERIFIED',doctor_completed:health.reachable?'VERIFIED':'NOT VERIFIED',authenticated:'NOT VERIFIED — public no-auth backend only',
  retrieval_works:fetched?'VERIFIED':'NOT VERIFIED',data_parsed:fetched&&validateExternalResult(result)?'VERIFIED':'NOT VERIFIED',
  evidence_generated:fetched&&result.evidence.length>0?'VERIFIED (retrieval evidence, status UNKNOWN)':'NOT VERIFIED',content_truth:'NOT VERIFIED',external_compliance:'NOT VERIFIED',
  source_metadata:result.sources.map(({content,...source})=>source),evidence_statuses:result.evidence.map(e=>({id:e.id,status:e.status,source_mode:e.source_mode,production_eligible:e.production_eligible}))};
writeFileSync(output.replace(/\.json$/, '')+'.result.json',JSON.stringify(result,null,2)+'\n');
writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
process.exitCode=fetched?0:1;
