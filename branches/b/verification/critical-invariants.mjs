import assert from 'node:assert/strict';
import { canonicalHasher, canonicalStringify } from '../dist/b00/hashing.js';
import { createArtifactBinding, createCanonicalIdentity, validateCanonicalIdentity } from '../dist/b00/identity.js';
import { proposeItem, approveItem, canonicalizeItem, revokeItem, GovernanceTransitionError, isApprovedForArtifact } from '../dist/b00/governance.js';
import { validateEvidenceSemantics } from '../dist/b00/evidence.js';
import { validateEvidenceCollection, validateGovernanceEventMap } from '../dist/b00/validation.js';
import { validateLineageGraph } from '../dist/b00/lineage.js';
import { validateAnalyticsResult, providerExecutionClaim } from '../dist/b08/execution.js';
import { generateLearningObservations, identifyOperationalGaps } from '../dist/b09/phases/B09_01_observations.js';
import { assessProposalImpact } from '../dist/b10/phases/B10_02_impact.js';
import { runComplianceChecks } from '../dist/b11/phases/B11_03_checks.js';
import { validateBranchCompleteness } from '../dist/b12/phases/B12_03_completeness.js';

const results = [];
async function check(name, fn) {
  try { await fn(); results.push({name,status:'PASS'}); console.log(`PASS ${name}`); }
  catch (err) { results.push({name,status:'FAIL',error:err?.stack ?? String(err)}); console.error(`FAIL ${name}:`, err); }
}

await check('R01 canonical hash stable under object field reordering', () => {
  const a = {z:1,a:{y:2,x:3}}; const b = {a:{x:3,y:2},z:1};
  assert.equal(canonicalHasher.hashValue(a), canonicalHasher.hashValue(b));
  assert.equal(canonicalStringify(a), canonicalStringify(b));
});
await check('R01 one-byte semantic change changes SHA-256 identity', () => {
  assert.notEqual(canonicalHasher.hashValue({v:'abc'}), canonicalHasher.hashValue({v:'abd'}));
  assert.equal(canonicalHasher.hash('abc').length,64);
});
await check('R02 canonical identity detects post-identity mutation', () => {
  const artifact = {version:'v1.0', value:1};
  const id = createCanonicalIdentity({object_id:'obj1',object_type:'TEST',version:'v1.0',artifact,created_at:'2026-09-06T00:00:00Z'});
  assert.equal(validateCanonicalIdentity(artifact,id).valid,true);
  assert.equal(validateCanonicalIdentity({...artifact,value:2},id).valid,false);
});
await check('R04 direct PROPOSED -> CANONICAL is rejected', () => {
  const p = proposeItem({itemId:'obj1',history:[],authority:'u',timestamp:'2026-09-06T00:00:00Z'});
  assert.throws(() => canonicalizeItem({itemId:'obj1',history:p.history,authority:'u',timestamp:'2026-09-06T00:01:00Z'}), GovernanceTransitionError);
});
await check('R04 terminal CANONICAL mutation is rejected', () => {
  const artifact={value:1}; const binding=createArtifactBinding(artifact,'obj2','TEST','v1.0');
  const p=proposeItem({itemId:'obj2',history:[],authority:'u',timestamp:'2026-09-06T00:00:00Z'});
  const a=approveItem({itemId:'obj2',history:p.history,authority:'u',timestamp:'2026-09-06T00:01:00Z',artifact:binding,requireArtifactBinding:true});
  const c=canonicalizeItem({itemId:'obj2',history:a.history,authority:'u',timestamp:'2026-09-06T00:02:00Z',artifact:binding,requireArtifactBinding:true});
  assert.throws(() => revokeItem({itemId:'obj2',history:c.history,authority:'u',timestamp:'2026-09-06T00:03:00Z'}), GovernanceTransitionError);
});
await check('R05 approval binds exact artifact/version/hash', () => {
  const artifact={value:1}; const binding=createArtifactBinding(artifact,'obj3','TEST','v1.0');
  const p=proposeItem({itemId:'obj3',history:[],authority:'u',timestamp:'2026-09-06T00:00:00Z'});
  const a=approveItem({itemId:'obj3',history:p.history,authority:'u',timestamp:'2026-09-06T00:01:00Z',artifact:binding,requireArtifactBinding:true});
  assert.equal(isApprovedForArtifact(a.history,binding),true);
  const mutated=createArtifactBinding({value:2},'obj3','TEST','v1.0');
  assert.equal(isApprovedForArtifact(a.history,mutated),false);
  assert.throws(() => canonicalizeItem({itemId:'obj3',history:a.history,authority:'u',timestamp:'2026-09-06T00:02:00Z',artifact:mutated,requireArtifactBinding:true}), GovernanceTransitionError);
});
await check('R03 user assertion cannot silently become VERIFIED', () => {
  const r=validateEvidenceSemantics({id:'e1',source:'user_input:x',status:'VERIFIED',origin:'USER_ASSERTION',basis:'ASSERTED',source_mode:'REAL'});
  assert.equal(r.valid,false); assert.equal(r.normalized_status,'INFERRED');
  assert.ok(r.issues.some(x=>x.code==='EVIDENCE_STATUS_INFLATION'));
});
await check('R19 mock evidence cannot be VERIFIED/production-eligible', () => {
  const r=validateEvidenceSemantics({id:'e2',source:'mock',status:'VERIFIED',origin:'MOCK',basis:'MOCK',source_mode:'MOCK',production_eligible:true});
  assert.equal(r.valid,false); assert.equal(r.normalized_status,'UNKNOWN');
  assert.ok(r.issues.some(x=>x.code==='MOCK_PRODUCTION_LEAK'));
});
await check('R20 malformed validators return structured invalid result', () => {
  const a=validateEvidenceCollection(null); assert.equal(a.valid,false); assert.equal(a.issues[0].severity,'ERROR');
  const b=validateGovernanceEventMap('not-a-map'); assert.equal(b.valid,false); assert.equal(b.issues[0].code,'MALFORMED_GOVERNANCE_MAP');
});
await check('R13 analytics definition is not an executed measurement', () => {
  const source={source_id:'s1',source_name:'YouTube',source_type:'native_platform',api_available:true,api_availability_basis:'CATALOG_DEFAULT',real_time:false,execution_state:'DEFINED',source_mode:'UNKNOWN',execution_verified:false,evidence_refs:[],provenance:{type:'INFERRED',decision_authority:'B08',timestamp:'2026-09-06T00:00:00Z'}};
  assert.equal(providerExecutionClaim(source),'DEFINED_ONLY');
});
await check('R19 MOCK analytics cannot carry VERIFIED/REAL evidence', () => {
  const metrics=[{metric_id:'m1',kpi_id:'k1',metric_name:'views',source_id:'s1',aggregation_method:'sum',aggregation_window:'daily',data_quality_rules:[],evidence_refs:[],provenance:{type:'INFERRED',decision_authority:'B08',timestamp:'2026-09-06T00:00:00Z'},definition_state:'DEFINED'}];
  const r=validateAnalyticsResult({result_id:'r1',metric_id:'m1',value:10,unit:'count',period_start:'2026-09-01',period_end:'2026-09-02',state:'VALIDATED',source_mode:'MOCK',evidence_refs:[{id:'e3',source:'mock',status:'VERIFIED',origin:'MOCK',basis:'MOCK',source_mode:'REAL'}]},metrics);
  assert.equal(r.valid,false); assert.ok(r.issues.some(x=>x.code==='MOCK_REAL_FIREWALL_VIOLATION'));
});
await check('R14 no REAL validated analytics means no learning observation', () => {
  const b08={analytics_results:[{result_id:'r1',metric_id:'m1',value:99,unit:'count',period_start:'x',period_end:'y',state:'USABLE',source_mode:'MOCK',evidence_refs:[]}],workflows:[]};
  const b06={distribution_strategies:[]};
  assert.equal(generateLearningObservations(b08,b06).length,0);
  const gaps=identifyOperationalGaps(b08,b06,{now:()=> '2026-09-06T00:00:00Z'});
  assert.ok(gaps.some(x=>x.gap_id==='opgap_b08_actual_data'));
});
await check('R15 B10 impact/risk derives from dependency graph, not proposal hash', () => {
  const base={proposal_id:'p1',proposal_type:'strategy_refinement',target_module:'B04',parameter_name:'owner_selected_change',current_state:'UNKNOWN',observed_problem:'problem',hypothesis:'h',proposed_change:'change',expected_effect:'effect',required_approval:true,proposal_basis:'LEARNING_SIGNAL',current_value:'UNKNOWN',proposed_value:'change',confidence:0.7,confidence_basis:'SIGNAL_CHAIN',expected_impact:'effect',evidence_refs:[],provenance:{type:'RECOMMENDED',decision_authority:'B10',timestamp:'2026-09-06T00:00:00Z'}};
  const a=assessProposalImpact([base],{hash:{stableProposalId:()=> 'x',stableAssessmentId:()=> 'A'},now:()=> '2026-09-06T00:00:00Z'})[0];
  const b=assessProposalImpact([{...base,proposal_id:'totally-different-hash-input'}],{hash:{stableProposalId:()=> 'x',stableAssessmentId:()=> 'B'},now:()=> '2026-09-06T00:00:00Z'})[0];
  assert.deepEqual(a.affected_modules,b.affected_modules); assert.equal(a.risk_level,b.risk_level); assert.equal(a.affected_modules_basis,'DEPENDENCY_GRAPH');
});
await check('R16 no compliance evidence => UNKNOWN, never COMPLIANT', () => {
  const rules=[{rule_id:'rule1',rule_category:'legal',description:'Must disclose',scope:['B10'],required:true,rule_basis:'FRAMEWORK_DEFAULT',external_verified:false,evidence_refs:[],provenance:{type:'INFERRED',decision_authority:'B11',timestamp:'2026-09-06T00:00:00Z'}}];
  const subjects=[{subject_id:'subj1',subject_type:'B10_OPT',subject_version:'v1.0',subject_content_hash:'h',affected_modules:['B10']}];
  const r=runComplianceChecks(rules,subjects,{hash:{stableRuleId:()=> 'x',stableCheckId:()=> 'fixed'},now:()=> '2026-09-06T00:00:00Z',complianceEvidence:[]});
  assert.equal(r[0].status,'UNKNOWN'); assert.equal(r[0].check_basis,'NO_EVIDENCE');
});
await check('R16 compliance result is evidence-based, not rule/check hash', () => {
  const rule={rule_id:'ruleX',rule_category:'platform',description:'x',scope:['B10'],required:true,rule_basis:'USER_DEFINED',external_verified:false,evidence_refs:[],provenance:{type:'DECIDED',decision_authority:'u',timestamp:'2026-09-06T00:00:00Z'}};
  const subject={subject_id:'subjX',subject_type:'B10_OPT',subject_version:'v1.0',subject_content_hash:'h',affected_modules:['B10']};
  const ev={evidence_ref:{id:'real1',source:'review',status:'VERIFIED',origin:'DOCUMENTATION',basis:'OBSERVED',source_mode:'REAL',production_eligible:true},rule_id:'ruleX',subject_id:'subjX',subject_type:subject.subject_type,subject_version:subject.subject_version,subject_content_hash:subject.subject_content_hash,assertion:'SATISFIES',rationale:'Reviewed source satisfies rule'};
  const mk=(id)=>runComplianceChecks([rule],[subject],{hash:{stableRuleId:()=>id,stableCheckId:()=>id},now:()=> '2026-09-06T00:00:00Z',complianceEvidence:[ev]})[0];
  assert.equal(mk('aaa').status,'COMPLIANT'); assert.equal(mk('bbb').status,'COMPLIANT');
});
await check('R16 evidence for wrong subject cannot establish compliance', () => {
  const rule={rule_id:'ruleY',rule_category:'legal',description:'x',scope:['B10'],required:true,rule_basis:'USER_DEFINED',external_verified:false,evidence_refs:[],provenance:{type:'DECIDED',decision_authority:'u',timestamp:'2026-09-06T00:00:00Z'}};
  const subject={subject_id:'correct',subject_type:'B10_OPT',subject_version:'v1.0',subject_content_hash:'h',affected_modules:['B10']};
  const ev={evidence_ref:{id:'real2',source:'review',status:'VERIFIED',origin:'DOCUMENTATION',basis:'OBSERVED',source_mode:'REAL'},rule_id:'ruleY',subject_id:'wrong',assertion:'SATISFIES',rationale:'wrong subject'};
  assert.equal(runComplianceChecks([rule],[subject],{complianceEvidence:[ev]})[0].status,'UNKNOWN');
});
await check('R17 100% structural completeness does not imply semantic validity/readiness', () => {
  const modules=['b01','b02','b03','b04','b05','b06','b07','b08','b09','b10','b11'];
  const versions=modules.map(m=>({module:m,version:'v1.0',created_at:'x',canonical_state_id:`${m}:v1.0`,object_type:`${m.toUpperCase()}_CANONICAL_STATE`,content_hash:'h',identity_status:'VERIFIED'}));
  const c=validateBranchCompleteness(versions,{semantic_validity:'UNKNOWN',operational_readiness:'NOT_READY',semantic_findings:['unresolved compliance'],operational_findings:['no real analytics']});
  assert.equal(c.structural_completeness,100); assert.equal(c.structural_status,'COMPLETE'); assert.equal(c.semantic_validity,'UNKNOWN'); assert.equal(c.operational_readiness,'NOT_READY');
});
await check('R18 lineage mismatch is an ERROR', () => {
  const p=createCanonicalIdentity({object_id:'p',object_type:'B01_CANONICAL_STATE',version:'v1.0',artifact:{x:1},created_at:'x'});
  const child=createCanonicalIdentity({object_id:'c',object_type:'B02_CANONICAL_STATE',version:'v1.0',artifact:{x:2},parent_references:[{module:'B01',object_id:'p',object_type:'B01_CANONICAL_STATE',version:'v0.9',content_hash:'WRONG'}],created_at:'x'});
  const r=validateLineageGraph({B01:p,B02:child}); assert.equal(r.valid,false); assert.ok(r.issues.some(x=>x.code==='PARENT_IDENTITY_MISMATCH'));
});

const failed=results.filter(r=>r.status==='FAIL');
console.log(`\nSUMMARY ${results.length-failed.length}/${results.length} passed`);
if(failed.length){process.exitCode=1;}
