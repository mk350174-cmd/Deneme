import assert from 'node:assert/strict';
import { validateEvidenceSemantics } from '../dist/b00/evidence.js';
import { runB01, platformRegistryProvenance, KNOWN_CANONICALIZATION_DROPS } from '../dist/b01/orchestration.js';
import { validateAnalyticsResult, providerExecutionClaim } from '../dist/b08/execution.js';
import { generateLearningObservations, isLearningEligibleAnalyticsResult } from '../dist/b09/phases/B09_01_observations.js';
import { synthesizeCampaigns } from '../dist/b04/phases/B04_03_synthesis.js';
import { synthesizeCreativeAngles } from '../dist/b05/phases/B05_02_angles.js';
import { createContentSchedules } from '../dist/b06/phases/B06_03_scheduling.js';
import { defineSuccessMetrics } from '../dist/b07/phases/B07_04_success.js';
import { createMockPersistence as createB10MockPersistence } from '../dist/b10/persistence.js';

const results=[];
async function check(name,fn){try{await fn();results.push({name,status:'PASS'});console.log(`PASS ${name}`);}catch(err){results.push({name,status:'FAIL',error:err?.stack??String(err)});console.error(`FAIL ${name}:`,err);}}

await check('B01 platform provenance is aggregated from actual entries only',()=>{
  const p={id:'p1',type:'OBSERVED',decision_authority:'B01',timestamp:'x'};
  const c={id:'c1',type:'INFERRED',decision_authority:'B01',timestamp:'x'};
  const registry={youtube:{name:'youtube',capabilities:[{capability:'video',source:'user_provided',evidence_status:'INFERRED',evidence_refs:[],provenance_refs:[c]}],evidence_refs:[],provenance_refs:[p]},empty:{name:'empty',capabilities:[],evidence_refs:[]}};
  assert.deepEqual(platformRegistryProvenance(registry).map(x=>x.id).sort(),['c1','p1']);
});
await check('B01 runB01 candidate preserves platform provenance in aggregate',async()=>{
  const candidate=await runB01({input_id:'prov-aggregate',created_at:'2026-09-06T00:00:00Z',known_channels:[{channel_id:'ch1',channel_name:'YT',platform:'youtube'}],known_platforms:[{name:'youtube',capabilities:['video']}]});
  const ids=(candidate.provenance_refs??[]).map(x=>x.id);
  assert.ok(ids.includes('prov_youtube_platform')); assert.ok(ids.includes('prov_youtube_video'));
});
await check('B01 contract-evolution drops remain explicit/documented',()=>{
  const rows=KNOWN_CANONICALIZATION_DROPS.filter(x=>x.classification==='CONTRACT_EVOLUTION_REQUIRED');
  assert.ok(rows.length>0); for(const row of rows){assert.ok(row.field);assert.ok(row.reason.length>20);}
});
await check('SYNTHETIC evidence cannot be VERIFIED or production eligible',()=>{
  const r=validateEvidenceSemantics({id:'s',source:'sim',status:'VERIFIED',origin:'DOCUMENTATION',basis:'OBSERVED',source_mode:'SYNTHETIC',production_eligible:true});
  assert.equal(r.valid,false); assert.equal(r.normalized_status,'UNKNOWN'); assert.ok(r.issues.some(x=>x.code==='SYNTHETIC_PRODUCTION_LEAK'));
});
await check('UNKNOWN-source evidence cannot be VERIFIED or production eligible',()=>{
  const r=validateEvidenceSemantics({id:'u',source:'unknown',status:'VERIFIED',origin:'DOCUMENTATION',basis:'OBSERVED',source_mode:'UNKNOWN',production_eligible:true});
  assert.equal(r.valid,false); assert.equal(r.normalized_status,'UNKNOWN'); assert.ok(r.issues.some(x=>x.code==='UNKNOWN_SOURCE_PRODUCTION_LEAK'));
});
await check('Analytics execution modes remain distinct',()=>{
  const base={source_id:'s1',source_name:'source',source_type:'manual_input',api_available:false,api_availability_basis:'UNKNOWN',real_time:false,execution_state:'VALIDATED',execution_verified:true,evidence_refs:[],provenance:{type:'INFERRED',decision_authority:'B08',timestamp:'x'}};
  assert.equal(providerExecutionClaim({...base,source_mode:'REAL'}),'EXECUTED_REAL');
  assert.equal(providerExecutionClaim({...base,source_mode:'MOCK'}),'EXECUTED_MOCK');
  assert.equal(providerExecutionClaim({...base,source_mode:'SYNTHETIC'}),'EXECUTED_SYNTHETIC');
  assert.equal(providerExecutionClaim({...base,source_mode:'UNKNOWN'}),'EXECUTED_UNKNOWN');
});
await check('SYNTHETIC analytics can be explicit simulation but cannot enter B09 learning',()=>{
  const metrics=[{metric_id:'m1',kpi_id:'k1',metric_name:'views',source_id:'s1',aggregation_method:'sum',aggregation_window:'daily',data_quality_rules:[],evidence_refs:[],provenance:{type:'INFERRED',decision_authority:'B08',timestamp:'x'},definition_state:'DEFINED'}];
  const synthetic={result_id:'sr1',metric_id:'m1',value:12,unit:'count',period_start:'x',period_end:'y',state:'VALIDATED',source_mode:'SYNTHETIC',evidence_refs:[{id:'se',source:'sim',status:'INFERRED',origin:'SYSTEM_DERIVATION',basis:'INFERRED',source_mode:'SYNTHETIC',production_eligible:false}]};
  assert.equal(validateAnalyticsResult(synthetic,metrics).valid,true);
  const b08={analytics_results:[synthetic],metrics,workflows:[]};
  assert.equal(isLearningEligibleAnalyticsResult(synthetic,b08),false); assert.equal(generateLearningObservations(b08,{}).length,0);
});
await check('B09 learning requires validated REAL analytics with VERIFIED REAL evidence',()=>{
  const metrics=[{metric_id:'m1',kpi_id:'k1',metric_name:'views',source_id:'s1',aggregation_method:'sum',aggregation_window:'daily',data_quality_rules:[],evidence_refs:[],provenance:{type:'INFERRED',decision_authority:'B08',timestamp:'x'},definition_state:'DEFINED'}];
  const real={result_id:'rr1',metric_id:'m1',value:42,unit:'count',period_start:'x',period_end:'y',state:'VALIDATED',source_mode:'REAL',evidence_refs:[{id:'re',source:'provider:test',status:'VERIFIED',origin:'PROVIDER_DATA',basis:'OBSERVED',source_mode:'REAL',production_eligible:true}]};
  const b08={analytics_results:[real],metrics,workflows:[]}; assert.equal(validateAnalyticsResult(real,metrics).valid,true); assert.equal(isLearningEligibleAnalyticsResult(real,b08),true); assert.equal(generateLearningObservations(b08,{}).length,1);
});


await check('Preserved B12 real-integration import can resolve B10 createMockPersistence',()=>{
  const persistence=createB10MockPersistence(); assert.equal(typeof persistence.load,'function'); assert.equal(typeof persistence.save,'function');
});
await check('UNKNOWN analytics source mode is rejected rather than coerced',()=>{
  const metrics=[{metric_id:'m1',kpi_id:'k1',metric_name:'views',source_id:'s1',aggregation_method:'sum',aggregation_window:'daily',data_quality_rules:[],evidence_refs:[],provenance:{type:'INFERRED',decision_authority:'B08',timestamp:'x'},definition_state:'DEFINED'}];
  const unknown={result_id:'ur1',metric_id:'m1',value:1,unit:'count',period_start:'x',period_end:'y',state:'VALIDATED',source_mode:'UNKNOWN',evidence_refs:[{id:'ue',source:'unknown',status:'UNKNOWN',origin:'UNKNOWN',basis:'UNKNOWN',source_mode:'UNKNOWN',production_eligible:false}]};
  const r=validateAnalyticsResult(unknown,metrics); assert.equal(r.valid,false); assert.ok(r.issues.some(x=>x.code==='INVALID_SOURCE_MODE'));
});
await check('B04/B05/B06/B07 framework defaults remain DEFAULT/HEURISTIC, never measured claims',()=>{
  const context={brand_profile:{name:'Brand'},opportunities:[{opportunity_id:'o1',description:'Opportunity',territories:['t1'],evidence_refs:[]}],segments:[{segment_id:'s1',segment_name:'Segment'}],territories:['t1'],channels:[],territory_ontology:[],gaps:[]};
  const campaigns=synthesizeCampaigns(context,[{alignment_id:'a1',opportunity_id:'o1',segment_id:'s1',alignment_score:0.7,rationale:'x',evidence_refs:[]}]);
  assert.equal(campaigns[0].timeline_basis,'DEFAULT'); assert.equal(campaigns[0].confidence_basis,'HEURISTIC');
  const angles=synthesizeCreativeAngles({brand_name:'Brand',brand_positioning:'Position',campaigns,segments:context.segments},{now:()=> '2026-09-06T00:00:00Z'});
  assert.equal(angles[0].confidence,0.65); assert.equal(angles[0].confidence_basis,'HEURISTIC_DEFAULT'); assert.equal(angles[0].derivation_basis,'TEMPLATE');
  const schedules=createContentSchedules({},[{selection_id:'sel1',campaign_id:'c1',channel_id:'youtube',role:'primary_channel'}],{now:()=> '2026-09-06T00:00:00Z'});
  assert.equal(schedules[0].schedule_basis,'DEFAULT'); assert.equal(schedules[0].timezone_adapted,false); assert.equal(schedules[0].empirically_optimized,false);
  const success=defineSuccessMetrics({campaigns:[{campaign_id:'c1',campaign_name:'Campaign',primary_objective:'Objective'}]},['k1'],{now:()=> '2026-09-06T00:00:00Z'});
  assert.equal(success[0].threshold_definition.basis,'DEFAULT'); assert.equal(success[0].threshold_definition.status,'INFERRED');
});

const failed=results.filter(r=>r.status==='FAIL');
console.log(`\nSUMMARY ${results.length-failed.length}/${results.length} passed`);
if(failed.length) process.exitCode=1;
