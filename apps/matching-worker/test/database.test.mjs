import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { database, JD, RESUME, PAIR } from "./database-helper.mjs";
import { WEIGHTS, calculateScore } from "../src/scoring.mjs";
import { createMatchingWorker } from "../src/worker.mjs";
const result = rating => ({sufficient:true,summary:"Relevant experience",missingRequirements:[],components:Object.fromEntries(Object.keys(WEIGHTS).map(key=>[key,{rating,reason:"Evidence"}]))});

test("Postgres migrations: queue, scoring, cache, permissions and creation enforcement", async t => {
  const {pg,rpc}=await database(); t.after(()=>pg.close());
  const preview=()=>rpc("preview_application_matches",{ids:[JD],resumes:[RESUME]},"authenticated");
  const enqueue=(pairs=[PAIR],retry=false)=>rpc("request_application_matches",{pairs:JSON.stringify(pairs),retry},"authenticated");
  const complete=(job,rating)=>rpc("complete_application_match",{id:job.id,token:job.leaseToken,result:JSON.stringify(result(rating))},"service_role");
  const claim=()=>rpc("claim_application_match",{model:"test-model"},"service_role");
  await t.test("unassessed pairs cannot create through single or direct insert",async()=>{
    assert.equal((await preview()).combinations[0].matchStatus,"NOT_ASSESSED");
    await assert.rejects(()=>rpc("create_application",{jd:JD,resume:RESUME,applier:null,priority:"NORMAL",due:null,notes:null},"authenticated"),/MATCH_NOT_ASSESSED/);
    await assert.rejects(()=>pg.query("insert into applications(job_description_id,resume_id) values($1,$2)",[JD,RESUME]),/MATCH_NOT_ASSESSED/);
  });
  await t.test("request is idempotent and score-writing RPCs are not public",async()=>{
    assert.equal((await enqueue([PAIR,PAIR])).queuedCount,1);
    assert.equal((await enqueue()).queuedCount,0);
    assert.equal((await pg.query("select count(*)::integer n from application_match_documents")).rows[0].n,2);
    await assert.rejects(()=>rpc("claim_application_match",{model:"test-model"},"authenticated"),/permission denied/);
    await assert.rejects(()=>rpc("complete_application_match",{id:randomUUID(),token:randomUUID(),result:"{}"},"authenticated"),/permission denied/);
    await pg.exec("update roles set active=false where code='APPLYING_MANAGER'");
    await assert.rejects(()=>preview(),/APPLICATION_ACCESS_DENIED/); await assert.rejects(()=>enqueue(),/APPLICATION_ACCESS_DENIED/);
    await pg.exec("update roles set active=true where code='APPLYING_MANAGER'");
  });
  let job;
  await t.test("lease ownership, SQL/JS weighted score parity, and 69 exclusion",async()=>{
    job=await claim(); assert.ok(job.leaseToken); assert.equal(await claim(),null);
    await assert.rejects(()=>rpc("complete_application_match",{id:job.id,token:randomUUID(),result:JSON.stringify(result(100))},"service_role"),/MATCH_LEASE_EXPIRED/);
    for(const rating of [0,69,70,71,100]) assert.equal(await rpc("calculate_application_match_score",{result:JSON.stringify(result(rating))}),calculateScore(result(rating)));
    await complete(job,69);
    const p=await preview(); assert.equal(p.combinations[0].eligible,false); assert.equal(p.belowThresholdCount,1); assert.equal(p.duplicateCount,0);
    const bulk=await rpc("create_applications_bulk",{pairs:JSON.stringify([PAIR]),name:"Below threshold"},"authenticated");
    assert.equal(bulk.createdCount,0); assert.equal(bulk.results[0].code,"BELOW_THRESHOLD");
    assert.match(bulk.results[0].message,/below the current threshold/);
  });
  await t.test("threshold changes reuse score; exactly threshold is eligible",async()=>{
    await pg.exec("update application_match_settings set threshold=69");
    assert.equal((await preview()).combinations[0].eligible,true);
    assert.equal((await enqueue()).queuedCount,0);
    await pg.exec("update application_match_settings set threshold=70");
    await pg.query("update resumes set skills=array['React','TypeScript'] where id=$1",[RESUME]);
    assert.equal((await preview()).combinations[0].matchStatus,"STALE");
    await enqueue(); await complete(await claim(),70);
    assert.equal((await preview()).combinations[0].eligible,true);
  });
  await t.test("subcategory changes do not invalidate or exclude; unrelated edits reuse score",async()=>{
    await pg.query("update resumes set candidate_name='Changed name',subcategory_id=$2 where id=$1",[RESUME,randomUUID()]);
    await pg.query("update job_descriptions set subcategory_id=$2 where id=$1",[JD,randomUUID()]);
    assert.equal((await preview()).combinations[0].matchScore,70);
    assert.equal((await preview()).combinations[0].eligible,true);
  });
  await t.test("source changes during generation reject late results",async()=>{
    await pg.query("update job_descriptions set description_text=description_text || ' Build TypeScript apps.' where id=$1",[JD]);
    await enqueue(); job=await claim();
    await pg.query("update job_descriptions set description_text=description_text || ' Own releases.' where id=$1",[JD]);
    assert.equal((await complete(job,100)).status,"STALE");
    await enqueue(); await complete(await claim(),71);
  });
  await t.test("banned/archived/unapproved checks rechecked at creation",async()=>{
    await pg.query("insert into resume_banned_companies values($1,'example')",[RESUME]);
    assert.equal((await preview()).combinations[0].exclusionCode,"BANNED_COMPANY");
    await assert.rejects(()=>rpc("create_application",{jd:JD,resume:RESUME,applier:null,priority:"NORMAL",due:null,notes:null},"authenticated"),/BANNED_COMPANY/);
    await pg.exec("delete from resume_banned_companies");
    await pg.query("update job_descriptions set review_status='NEEDS_REVIEW' where id=$1",[JD]);
    await assert.rejects(()=>rpc("create_application",{jd:JD,resume:RESUME,applier:null,priority:"NORMAL",due:null,notes:null},"authenticated"),/UNAPPROVED_JD/);
    await pg.query("update job_descriptions set review_status='APPROVED' where id=$1",[JD]);
  });
  let created;
  await t.test("bulk snapshots score and idempotent retries do not create twice",async()=>{
    const args={pairs:JSON.stringify([PAIR]),name:"Passing match",key:"matching-test-1",hash:"a".repeat(64)};
    const batch=await rpc("create_applications_bulk_api",args,"authenticated");
    assert.equal(batch.createdCount,1); created=batch.results[0].applicationId;
    assert.equal((await rpc("create_applications_bulk_api",args,"authenticated")).replayed,true);
    const row=(await pg.query("select * from applications where id=$1",[created])).rows[0];
    assert.equal(row.match_score,71); assert.equal(row.match_threshold,70); assert.ok(row.match_assessment_id);
    const repeat=await rpc("create_applications_bulk",{pairs:JSON.stringify([PAIR,{job_description_id:"invalid",resume_id:RESUME}]),name:"Repeated pair"},"authenticated");
    assert.equal(repeat.createdCount,0);assert.equal(repeat.duplicateCount,1);assert.equal(repeat.skippedCount,1);
    assert.ok(repeat.results.some(row=>row.code==="INVALID_IDENTIFIER"));
  });
  await t.test("tailoring keeps historical score and duplicates resolve to original family",async()=>{
    const tailored=randomUUID();
    await pg.query("insert into resumes(id,resume_type,parent_resume_id) values($1,'TAILORED',$2)",[tailored,RESUME]);
    await pg.query("update resumes set skills=array['Changed'] where id=$1",[RESUME]);
    await pg.query("update applications set resume_id=$2,match_score=100 where id=$1",[created,tailored]);
    assert.equal((await pg.query("select match_score from applications where id=$1",[created])).rows[0].match_score,71);
    const p=await preview(); assert.equal(p.duplicateCount,1); assert.equal(p.combinations[0].exclusionCode,"EXISTING_APPLICATION");
  });
});

test("obsolete queued snapshots are skipped; retry limits, reclaimed leases and insufficient data never create scores",async t=>{
  const {pg,rpc}=await database({applyRunnerMigration:true,applyDirectScoring:true});t.after(()=>pg.close());
  const enqueue=(retry=false)=>rpc("request_application_matches",{pairs:JSON.stringify([PAIR]),retry},"authenticated");
  const claim=()=>rpc("claim_application_match",{model:"test-model"},"service_role");
  await enqueue();
  await pg.query("update job_descriptions set description_text='New React duties' where id=$1",[JD]);
  assert.equal(await claim(),null);
  assert.equal((await pg.query("select status from application_match_assessments")).rows[0].status,"STALE");
  // Reverting to a previous hash with a stale queue entry must allow it to be requested again.
  await pg.query("update job_descriptions set description_text='Build React interfaces and APIs' where id=$1",[JD]);
  assert.equal((await enqueue()).queuedCount,1);
  for(let attempt=1;attempt<=3;attempt++) {
    const job=await claim();assert.equal(job.attempt,attempt);
    await rpc("fail_application_match",{id:job.id,token:job.leaseToken,code:"MODEL_RATE_LIMIT",retryable:true,wait:5},"service_role");
    const row=(await pg.query("select status,score from application_match_assessments where id=$1",[job.id])).rows[0];
    assert.equal(row.score,null);assert.equal(row.status,attempt===3?"FAILED":"PENDING");
    await pg.exec("update application_match_assessments set next_attempt_at=now()-interval '1 second'");
  }
  assert.equal(await claim(),null);assert.equal((await enqueue()).queuedCount,0);assert.equal((await enqueue(true)).queuedCount,1);
  const expired=await claim();await pg.exec("update application_match_assessments set lease_expires_at=now()-interval '1 second'");
  const reclaimed=await claim();assert.equal(reclaimed.id,expired.id);assert.notEqual(reclaimed.leaseToken,expired.leaseToken);
  await assert.rejects(()=>rpc("complete_application_match",{id:expired.id,token:expired.leaseToken,result:JSON.stringify(result(100))},"service_role"),/MATCH_LEASE_EXPIRED/);
  await rpc("fail_application_match",{id:reclaimed.id,token:reclaimed.leaseToken,code:"DOCUMENT_BUSY",retryable:true,wait:5},"service_role");
  await pg.exec("update application_match_assessments set next_attempt_at=now()-interval '1 second'");
  let calls=0;
  const worker=createMatchingWorker({rpc:(name,args)=>rpc(name,args,"service_role"),model:"test-model",provider:{generate:async()=>{
    calls++;return {sufficient:false,summary:"Title only",ratings:Object.fromEntries(Object.keys(WEIGHTS).map(key=>[key,null]))};
  }}});
  await worker.runOne();assert.equal(calls,1);
  const preview=await rpc("preview_application_matches",{ids:[JD],resumes:[RESUME]},"authenticated");
  assert.equal(preview.combinations[0].matchStatus,"INSUFFICIENT_DATA");assert.equal(preview.combinations[0].matchScore,null);
  assert.equal(preview.combinations[0].eligible,false);assert.equal((await enqueue(true)).queuedCount,0);
});

test("document leases share cached work; configuration invalidation and source whitelisting",async t=>{
  const {pg,rpc}=await database();t.after(()=>pg.close());
  const enqueue=()=>rpc("request_application_matches",{pairs:JSON.stringify([PAIR]),retry:false},"authenticated");
  await enqueue();const job=await rpc("claim_application_match",{model:"test-model"},"service_role");
  const doc=await rpc("claim_application_match_document",{id:job.resumeDocumentId},"service_role");
  assert.equal(doc.status,"PROCESSING");assert.ok(!("candidate_name" in doc.source));assert.ok(!("resume_text" in doc.source));
  assert.equal((await rpc("claim_application_match_document",{id:job.resumeDocumentId},"service_role")).status,"BUSY");
  assert.equal(await rpc("complete_application_match_document",{id:job.resumeDocumentId,token:randomUUID(),analysis:null},"service_role"),false);
  await pg.query("update application_match_documents set lease_expires_at=now()-interval '1 second' where id=$1",[job.resumeDocumentId]);
  const replacement=await rpc("claim_application_match_document",{id:job.resumeDocumentId},"service_role");
  assert.notEqual(replacement.leaseToken,doc.leaseToken);
  await pg.exec("update application_match_settings set model_id='new-model'");
  assert.equal((await rpc("complete_application_match",{id:job.id,token:job.leaseToken,result:JSON.stringify(result(100))},"service_role")).status,"STALE");
  await assert.rejects(()=>rpc("claim_application_match",{model:"test-model"},"service_role"),/MATCH_MODEL_MISMATCH/);
  await pg.exec("update application_match_settings set model_id='UNCONFIGURED'");
  await assert.rejects(()=>enqueue(),/MATCHING_NOT_CONFIGURED/);
  await pg.exec("update application_match_settings set model_id='test-model',rubric_version='future-version'");
  await enqueue();
  await assert.rejects(()=>rpc("claim_application_match",{model:"test-model"},"service_role"),/MATCH_WORKER_VERSION_MISMATCH/);
  assert.equal((await pg.query("select status from application_match_assessments where rubric_version='future-version'")).rows[0].status,"PENDING");
  await assert.rejects(()=>rpc("preview_application_matches",{ids:[JD],resumes:[RESUME]},"anon"),/permission denied/);
});

test("worker makes one direct comparison per pair and reuses completed pair scores",async t=>{
  const {pg,rpc}=await database({applyRunnerMigration:true,applyDirectScoring:true}); t.after(()=>pg.close());
  const second=randomUUID(); await pg.query("insert into job_descriptions(id) values($1)",[second]);
  await rpc("request_application_matches",{pairs:JSON.stringify([PAIR,{...PAIR,job_description_id:second}]),retry:false},"authenticated");
  let documents=0,assessments=0;
  const provider={generate:async ({name})=>{
    if(name==="application_match"){assessments++;return {sufficient:true,summary:"Relevant source",ratings:Object.fromEntries(Object.keys(WEIGHTS).map(key=>[key,80]))};}
    documents++;
    return {sufficient:true,summary:"Relevant source",...Object.fromEntries(Object.keys(WEIGHTS).map(key=>[key,[{text:"React",quote:"React"}]]))};
  }};
  const worker=createMatchingWorker({rpc:(name,args)=>rpc(name,args,"service_role"),provider,model:"test-model"});
  await Promise.all([worker.runOne(),worker.runOne()]);assert.equal(await worker.runOne(),false);
  assert.equal(documents,0);assert.equal(assessments,2);
  const statuses=(await pg.query("select status,score from application_match_assessments")).rows;
  assert.ok(statuses.every(row=>row.status==="COMPLETED"&&row.score===80));
  await rpc("request_application_matches",{pairs:JSON.stringify([PAIR]),retry:false},"authenticated");
  assert.equal(await worker.runOne(),false);assert.equal(assessments,2);
});
