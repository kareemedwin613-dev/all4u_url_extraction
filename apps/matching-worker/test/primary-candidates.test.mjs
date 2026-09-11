import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { database, applyMatchingPrimaryCandidates, JD, RESUME, PRIMARY, PAIR } from './database-helper.mjs';
import { WEIGHTS, EXTRACTOR_VERSION, RUBRIC_VERSION } from '../src/scoring.mjs';

const version={modelId:'test-model',rubricVersion:RUBRIC_VERSION,extractorVersion:EXTRACTOR_VERSION};
const result=score=>({sufficient:true,summary:'Supported alignment',missingRequirements:[],components:Object.fromEntries(Object.keys(WEIGHTS).map(key=>[key,{rating:score,reason:'Source evidence'}]))});
const preview=(rpc,jobs=[JD],resumes=null)=>rpc('preview_application_matches',{jobs,resumes},'authenticated');
const issue=(rpc,pairs=[PAIR])=>rpc('request_application_matches_with_ticket',{pairs,retry:true},'authenticated');
const next=(rpc,ticket)=>rpc('application_match_runner_call',{ticket,operation:'next',payload:version},'anon');
async function category(pg,name='Other',parent=null) {
  const id=randomUUID();await pg.query('insert into categories(id,name,parent_id) values($1,$2,$3)',[id,name,parent]);return id;
}
async function resume(pg,primary=PRIMARY,fields={}) {
  const id=randomUUID();await pg.query('insert into resumes(id,primary_category_id,status,resume_type,parent_resume_id) values($1,$2,$3,$4,$5)',[id,primary,fields.status||'ACTIVE',fields.type||'ORIGINAL',fields.parent||null]);return id;
}

test('primary candidate pool matches any primary, ignores subcategories and deduplicates pairs',async t=>{
  const {pg,rpc}=await database({applyRunnerMigration:true});t.after(()=>pg.close());
  const second=await category(pg,'AI'),outside=await category(pg,'Finance');
  const subA=await category(pg,'Frontend',PRIMARY),subB=await category(pg,'Backend',PRIMARY);
  const multi=await resume(pg,second),unrelated=await resume(pg,outside);
  await resume(pg,null);await resume(pg,PRIMARY,{status:'ARCHIVED'});await resume(pg,PRIMARY,{type:'TAILORED',parent:RESUME});
  await pg.query('insert into resume_tech_stacks(resume_id,primary_category_id,subcategory_id,sort_order) values($1,$2,$3,1),($1,$2,$4,2)',[multi,PRIMARY,subA,subB]);
  await pg.query('update job_descriptions set subcategory_id=$2 where id=$1',[JD,randomUUID()]);
  const otherJd=randomUUID(),missingJd=randomUUID();
  await pg.query('insert into job_descriptions(id,category_id) values($1,$2),($3,null)',[otherJd,second,missingJd]);
  const p=await preview(rpc,[JD,otherJd,missingJd,JD]);
  assert.equal(p.selectedJdCount,3);assert.equal(p.validJdCount,2);assert.equal(p.invalidJdCount,1);
  assert.equal(p.invalidJds[0].code,'MISSING_CATEGORY');
  assert.equal(p.totalCombinationCount,3);assert.equal(p.proposedCount,3);assert.equal(p.activeResumeCount,2);
  assert.equal(p.truncated,false);
  assert.deepEqual(new Set(p.combinations.map(r=>r.key)),new Set([`${JD}:${RESUME}`,`${JD}:${multi}`,`${otherJd}:${multi}`]));
  assert.deepEqual(new Set(p.resumeOptions.map(r=>r.resumeId)),new Set([RESUME,multi]));
  const options=await rpc('list_application_resumes',{jd:JD,search:'',limit:200},'authenticated');
  assert.deepEqual(new Set(options.map(r=>r.id)),new Set([RESUME,multi]));
  assert.ok(options.every(r=>r.same_category));
  assert.deepEqual(await rpc('list_application_resumes',{jd:missingJd,search:'',limit:200},'authenticated'),[]);
  const scoped=await preview(rpc,[JD,otherJd],[RESUME]);
  assert.equal(scoped.totalCombinationCount,1);assert.equal(scoped.resumeOptions.length,2);
  assert.equal((await preview(rpc,[JD,otherJd],[unrelated])).totalCombinationCount,0);
  assert.equal((await preview(rpc,[JD],[])).totalCombinationCount,0);
});

test('direct queue and creation requests cannot bypass primary category filtering',async t=>{
  const {pg,rpc}=await database({applyRunnerMigration:true});t.after(()=>pg.close());
  const unrelated=await resume(pg,await category(pg));
  const unmatched={job_description_id:JD,resume_id:unrelated};
  const denied=await issue(rpc,[unmatched]);
  assert.equal(denied.queuedCount,0);assert.equal(denied.runner,null);
  assert.equal((await pg.query('select count(*)::int n from application_match_documents')).rows[0].n,0);
  const receipt=await issue(rpc,[PAIR,unmatched]);assert.equal(receipt.queuedCount,1);assert.equal(receipt.runner.pairCount,1);
  const gate=await rpc('application_match_eligibility',{jd:JD,resume:unrelated});
  assert.equal(gate.exclusionCode,'PRIMARY_CATEGORY_MISMATCH');
  await assert.rejects(rpc('create_application',{jd:JD,resume:unrelated,applier:null,priority:'NORMAL',due:null,notes:null},'authenticated'),/PRIMARY_CATEGORY_MISMATCH/);
  await assert.rejects(pg.query('insert into applications(job_description_id,resume_id) values($1,$2)',[JD,unrelated]),/PRIMARY_CATEGORY_MISMATCH/);
  const bulk=await rpc('create_applications_bulk',{pairs:[unmatched]},'authenticated');
  assert.equal(bulk.skippedCount,1);assert.equal(bulk.results[0].code,'PRIMARY_CATEGORY_MISMATCH');
  await pg.query('update categories set active=false where id=$1',[PRIMARY]);
  assert.equal((await preview(rpc)).invalidJds[0].code,'MISSING_CATEGORY');
  assert.equal((await issue(rpc)).runner,null);
});

test('category changes recheck eligibility without erasing reusable scores or existing Applications',async t=>{
  const {pg,rpc}=await database();t.after(()=>pg.close());
  await rpc('request_application_matches',{pairs:[PAIR],retry:true},'authenticated');
  const job=await rpc('claim_application_match',{model:'test-model'},'service_role');
  await rpc('complete_application_match',{id:job.id,token:job.leaseToken,result:result(80)},'service_role');
  const hash=(await pg.query('select matching_hash from job_descriptions where id=$1',[JD])).rows[0].matching_hash;
  const other=await category(pg);
  await pg.query('update job_descriptions set category_id=$2 where id=$1',[JD,other]);
  const excluded=await rpc('application_match_eligibility',{jd:JD,resume:RESUME});
  assert.equal(excluded.eligible,false);assert.equal(excluded.matchScore,80);assert.equal(excluded.exclusionCode,'PRIMARY_CATEGORY_MISMATCH');
  assert.equal((await preview(rpc)).totalCombinationCount,0);
  assert.equal((await pg.query('select matching_hash from job_descriptions where id=$1',[JD])).rows[0].matching_hash,hash);
  await assert.rejects(rpc('create_application',{jd:JD,resume:RESUME,applier:null,priority:'NORMAL',due:null,notes:null},'authenticated'),/PRIMARY_CATEGORY_MISMATCH/);
  await pg.query('update job_descriptions set category_id=$2 where id=$1',[JD,PRIMARY]);
  const restored=await rpc('application_match_eligibility',{jd:JD,resume:RESUME});
  assert.equal(restored.eligible,true);assert.equal(restored.assessmentId,job.id);
  assert.equal((await rpc('request_application_matches',{pairs:[PAIR],retry:true},'authenticated')).queuedCount,0);
  await rpc('create_application',{jd:JD,resume:RESUME,applier:null,priority:'NORMAL',due:null,notes:null},'authenticated');
  await pg.query('update job_descriptions set category_id=$2 where id=$1',[JD,other]);
  assert.equal((await pg.query('select match_score from applications where job_description_id=$1',[JD])).rows[0].match_score,80);
});

test('old tickets skip previously queued cross-category jobs after the forward migration',async t=>{
  const {pg,rpc}=await database({applyRunnerMigration:true,applyPrimaryCandidates:false});t.after(()=>pg.close());
  const unrelated=await resume(pg,await category(pg));
  const receipt=await issue(rpc,[PAIR,{job_description_id:JD,resume_id:unrelated}]);
  assert.equal(receipt.runner.pairCount,2);
  await applyMatchingPrimaryCandidates(pg);
  await rpc('application_match_runner_call',{ticket:receipt.runner.ticket,operation:'claim',payload:{}},'anon');
  const job=await next(rpc,receipt.runner.ticket);assert.equal(job.state,'JOB');
  const rows=(await pg.query('select resume_id,status,attempt_count from application_match_assessments')).rows;
  assert.equal(rows.find(r=>r.resume_id===RESUME).status,'PROCESSING');
  assert.equal(rows.find(r=>r.resume_id===unrelated).status,'STALE');
  assert.equal(rows.find(r=>r.resume_id===unrelated).attempt_count,0);
  await rpc('application_match_runner_call',{ticket:receipt.runner.ticket,operation:'failure',payload:{jobId:job.id,leaseToken:job.leaseToken,code:'TEST_FAILURE',retryable:false,retryAfterSeconds:30}},'anon');
  assert.equal((await next(rpc,receipt.runner.ticket)).state,'COMPLETED');
});

test('legacy claims skip cross-category work and category changes discard in-flight scores',async t=>{
  const {pg,rpc}=await database({applyPrimaryCandidates:false});t.after(()=>pg.close());
  await rpc('request_application_matches',{pairs:[PAIR],retry:true},'authenticated');
  const other=await category(pg);
  await pg.query('update job_descriptions set category_id=$2 where id=$1',[JD,other]);
  await applyMatchingPrimaryCandidates(pg);
  assert.equal(await rpc('claim_application_match',{model:'test-model'},'service_role'),null);
  await pg.query('update job_descriptions set category_id=$2 where id=$1',[JD,PRIMARY]);
  await rpc('request_application_matches',{pairs:[PAIR],retry:true},'authenticated');
  const job=await rpc('claim_application_match',{model:'test-model'},'service_role');
  await pg.query('delete from resume_tech_stacks where resume_id=$1',[RESUME]);
  assert.equal((await rpc('complete_application_match',{id:job.id,token:job.leaseToken,result:result(99)},'service_role')).status,'STALE');
  assert.equal((await pg.query('select score from application_match_assessments where id=$1',[job.id])).rows[0].score,null);
});

test('preview counts and the 5000-pair limit apply after category filtering',async t=>{
  const {pg,rpc}=await database();t.after(()=>pg.close());
  const other=await category(pg);
  await pg.query('insert into resumes(id,primary_category_id) select gen_random_uuid(),$1 from generate_series(1,71)',[other]);
  await pg.exec('insert into job_descriptions(id) select gen_random_uuid() from generate_series(1,71)');
  const ids=(await pg.query('select id from job_descriptions')).rows.map(r=>r.id);
  const filtered=await preview(rpc,ids);
  assert.equal(filtered.totalCombinationCount,72);assert.equal(filtered.truncated,false);assert.equal(filtered.activeResumeCount,1);
  await pg.query('update resume_tech_stacks set primary_category_id=$1 where primary_category_id=$2',[PRIMARY,other]);
  const full=await preview(rpc,ids);
  assert.equal(full.totalCombinationCount,5184);assert.equal(full.truncated,true);assert.equal(full.proposedCount,5000);assert.equal(full.combinations.length,5000);
});
