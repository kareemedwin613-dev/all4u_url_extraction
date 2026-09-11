import test from "node:test";
import assert from "node:assert/strict";
import { database, applyMatchingRunnerIssuerFix, USER, JD, RESUME, PAIR } from "./database-helper.mjs";
import { WEIGHTS, EXTRACTOR_VERSION, RUBRIC_VERSION } from "../src/scoring.mjs";
import { createMatchingWorker } from "../src/worker.mjs";
import { createMatchingApiClient } from "../src/api-client.mjs";

const facets = Object.keys(WEIGHTS);
const profile = { sufficient: true, summary: "React engineer", ...Object.fromEntries(facets.map(key => [key, [{text:"React",quote:"React"}]])) };
const assessment = score => ({ sufficient: true, summary: "Evidenced alignment", missingRequirements: [], components: Object.fromEntries(facets.map(key => [key,{rating:score,reason:"React experience"}])) });
const version = { modelId:"test-model",rubricVersion:RUBRIC_VERSION,extractorVersion:EXTRACTOR_VERSION };

test("v3.74 repairs existing tickets under real anonymous auth without weakening caller-bound helpers",async t=>{
  const {pg,rpc}=await database({applyRunnerMigration:true,applyRunnerIssuerFix:false});t.after(()=>pg.close());
  const queued=await rpc("request_application_matches_with_ticket",{pairs:[PAIR],retry:true},"authenticated");
  const call=(operation,payload={})=>rpc("application_match_runner_call",{ticket:queued.runner.ticket,operation,payload},"anon");
  const helpers=()=>pg.query("select oid::regprocedure::text as name,pg_get_functiondef(oid) as definition,proacl::text as grants from pg_proc where oid in('public.is_active_user(uuid)'::regprocedure,'public.has_any_role(text[],uuid)'::regprocedure) order by name");
  const before=(await helpers()).rows;
  const beforeTicket=(await pg.query("select * from application_match_runner_tickets where id=$1",[queued.runner.ticketId])).rows[0];
  await pg.transaction(async tx=>{
    await tx.exec("set local request.jwt.claim.sub='';set local role anon");
    assert.equal((await tx.query("select auth.uid() as id")).rows[0].id,null);
  });
  // Reproduce the user's failure with a fresh valid ticket, no escaping/expiry.
  await assert.rejects(call("claim"),/MATCH_TICKET_INVALID: The issuing manager no longer has access/);
  await applyMatchingRunnerIssuerFix(pg);
  assert.deepEqual((await helpers()).rows,before);
  assert.deepEqual((await pg.query("select * from application_match_runner_tickets where id=$1",[queued.runner.ticketId])).rows[0],beforeTicket);
  assert.equal((await call("claim")).ticketId,queued.runner.ticketId);
  const job=await call("next",version);
  assert.equal(job.state,"JOB");
  assert.equal((await call("document",{jobId:job.id,leaseToken:job.leaseToken,documentId:job.jdDocumentId})).status,"PROCESSING");
  await assert.rejects(rpc("assert_application_match_ticket",{ticket:queued.runner.ticket,allow:true},"anon"),/permission denied/);
  await assert.rejects(rpc("is_active_user",{id:USER},"anon"),/permission denied/);
  // Applying the same replacement again is safe and does not reset the lease.
  await applyMatchingRunnerIssuerFix(pg);
  assert.equal((await call("next",version)).state,"WAITING");
});

test("ticket checks remain tied to its issuer's current profile and active manager/admin assignment",async t=>{
  const {pg,rpc}=await database({applyRunnerMigration:true});t.after(()=>pg.close());
  const issue=()=>rpc("request_application_matches_with_ticket",{pairs:[PAIR],retry:true},"authenticated");
  const queued=await issue();
  const call=()=>rpc("application_match_runner_call",{ticket:queued.runner.ticket,operation:"claim",payload:{}},"anon");
  await pg.query("update profiles set status='INACTIVE' where id=$1",[USER]);
  await assert.rejects(call(),/MATCH_TICKET_INVALID/);
  await assert.rejects(issue(),/APPLICATION_ACCESS_DENIED/);
  await pg.query("update profiles set status='ACTIVE' where id=$1",[USER]);
  await pg.exec("update roles set active=false where code='APPLYING_MANAGER'");
  await assert.rejects(call(),/MATCH_TICKET_INVALID/);
  await pg.exec("update roles set active=true where code='APPLYING_MANAGER'");
  await pg.query("delete from user_roles where user_id=$1",[USER]);
  const otherUser="10000000-0000-4000-8000-000000000002";
  await pg.query("insert into profiles(id) values($1)",[otherUser]);
  await pg.query("insert into user_roles select $1::uuid,id from roles where code='APPLYING_MANAGER'",[otherUser]);
  await pg.query("insert into user_roles select $1::uuid,id from roles where code='APPLIER'",[USER]);
  await assert.rejects(call(),/MATCH_TICKET_INVALID/);
  await assert.rejects(issue(),/APPLICATION_ACCESS_DENIED/);
  await pg.query("insert into user_roles select $1::uuid,id from roles where code='ADMIN'",[USER]);
  assert.equal((await call()).ticketId,queued.runner.ticketId);
  await pg.exec("update roles set active=false where code='ADMIN'");
  await assert.rejects(call(),/MATCH_TICKET_INVALID/);
});

test("ticket runner migration: scope, expiry, revocation, leases, score gates and retries", async t => {
  const {pg,rpc} = await database({applyRunnerMigration:true});
  t.after(()=>pg.close());
  const issue = async (pairs=[PAIR]) => (await rpc("request_application_matches_with_ticket",{p_combinations:pairs,p_retry_failed:true},"authenticated")).runner;
  const call = (ticket,operation,payload={}) => rpc("application_match_runner_call",{p_ticket:ticket,p_operation:operation,p_payload:payload},"anon");
  let runner, job;

  await t.test("only managers issue commands; tokens are hashed and never grant unrestricted RPC access",async()=>{
    await pg.exec("update roles set active=false where code='APPLYING_MANAGER'");
    await assert.rejects(issue(),/APPLICATION_ACCESS_DENIED/);
    await pg.exec("update roles set active=true where code='APPLYING_MANAGER'");
    runner = await issue();
    assert.match(runner.ticket,/^mrb_[A-Za-z0-9_-]{43}$/);
    assert.equal(runner.pairCount,1);
    const stored=(await pg.query("select * from application_match_runner_tickets")).rows;
    assert.equal(JSON.stringify(stored).includes(runner.ticket),false);
    await assert.rejects(rpc("claim_application_match",{model:"test-model"},"anon"),/permission denied/);
    await assert.rejects(rpc("request_application_matches_with_ticket",{pairs:[PAIR],retry:false},"anon"),/permission denied/);
    await assert.rejects(call(runner.ticket,"next",version),/MATCH_TICKET_EXPIRED/);
    const first=await call(runner.ticket,"claim"), second=await call(runner.ticket,"claim");
    assert.equal(first.modelId,"test-model");
    assert.equal(first.runExpiresAt,second.runExpiresAt);
    await assert.rejects(call(runner.ticket,"next",{...version,modelId:"wrong"}),/MATCH_WORKER_VERSION_MISMATCH/);
  });

  await t.test("one ticket cannot claim or write unrelated assessments or documents",async()=>{
    const otherJd="20000000-0000-4000-8000-000000000002", otherResume="30000000-0000-4000-8000-000000000002";
    await pg.query("insert into job_descriptions(id) values($1)",[otherJd]);
    await pg.query("insert into resumes(id) values($1)",[otherResume]);
    const other=await issue([{job_description_id:otherJd,resume_id:otherResume}]);
    await call(other.ticket,"claim");
    const unrelated=await call(other.ticket,"next",version);
    job=await call(runner.ticket,"next",version);
    assert.equal(job.state,"JOB");
    assert.notEqual(job.id,unrelated.id);
    await assert.rejects(call(runner.ticket,"failure",{jobId:unrelated.id,leaseToken:unrelated.leaseToken,code:"FAIL",retryable:false}),/MATCH_LEASE_EXPIRED/);
    await assert.rejects(call(runner.ticket,"document",{jobId:job.id,leaseToken:job.leaseToken,documentId:unrelated.jdDocumentId}),/MATCH_TICKET_SCOPE/);
    const overlap=await issue();
    await call(overlap.ticket,"claim");
    assert.equal((await call(overlap.ticket,"next",version)).state,"WAITING");
    await assert.rejects(call(overlap.ticket,"result",{jobId:job.id,leaseToken:job.leaseToken,result:assessment(100)}),/MATCH_LEASE_EXPIRED/);
  });

  await t.test("server requires valid profiles and leases before storing a score; 70 still qualifies",async()=>{
    await assert.rejects(call(runner.ticket,"result",{jobId:job.id,leaseToken:job.leaseToken,result:assessment(70)}),/Both source profiles/);
    for (const documentId of [job.jdDocumentId,job.resumeDocumentId]) {
      const doc=await call(runner.ticket,"document",{jobId:job.id,leaseToken:job.leaseToken,documentId});
      const payload={jobId:job.id,leaseToken:job.leaseToken,documentId,documentLeaseToken:doc.leaseToken};
      assert.equal(await call(runner.ticket,"document-result",{...payload,documentLeaseToken:JD,analysis:profile}),false);
      const fabricated=structuredClone(profile);fabricated.requiredSkills[0].quote="Invented experience absent from input";
      await assert.rejects(call(runner.ticket,"document-result",{...payload,analysis:fabricated}),/not supported/);
      const blank=structuredClone(profile);blank.requiredSkills[0].quote="\t\u00a0\n";
      await assert.rejects(call(runner.ticket,"document-result",{...payload,analysis:blank}),/Invalid document fact/);
      if (documentId===job.resumeDocumentId) {
        const numeric=structuredClone(profile);numeric.seniority=[{text:"Started in 2020",quote:"2020"}];
        assert.equal(await call(runner.ticket,"document-result",{...payload,analysis:numeric}),true);
        continue;
      }
      assert.equal(await call(runner.ticket,"document-result",{...payload,analysis:profile}),true);
    }
    const payload={jobId:job.id,leaseToken:job.leaseToken,result:assessment(70)};
    assert.equal((await call(runner.ticket,"result",payload)).score,70);
    assert.equal((await call(runner.ticket,"result",payload)).score,70);
    await assert.rejects(call(runner.ticket,"result",{...payload,result:assessment(100)}),/MATCH_LEASE_EXPIRED/);
    const eligibility=await rpc("application_match_eligibility",{jd:JD,resume:RESUME});
    assert.equal(eligibility.eligible,true);
    assert.equal((await call(runner.ticket,"next",version)).state,"COMPLETED");
    assert.equal(await issue(),null);
  });

  await t.test("revocation releases only the owned lease; pending runs can be resumed",async()=>{
    await pg.query("update resumes set skills=array['React','TypeScript'] where id=$1",[RESUME]);
    const next=await issue();await call(next.ticket,"claim");
    const current=await call(next.ticket,"next",version);
    assert.equal(await rpc("revoke_application_match_ticket",{id:next.ticketId},"authenticated"),true);
    await assert.rejects(call(next.ticket,"document",{jobId:current.id,leaseToken:current.leaseToken,documentId:current.jdDocumentId}),/MATCH_TICKET_INVALID/);
    const after=(await pg.query("select status,attempt_count from application_match_assessments where id=$1",[current.id])).rows[0];
    assert.equal(after.status,"PENDING");assert.equal(after.attempt_count,0);
    const resumed=await issue();await call(resumed.ticket,"claim");
    const newer=await call(resumed.ticket,"next",version);
    assert.equal(newer.id,current.id);assert.notEqual(newer.leaseToken,current.leaseToken);
    await call(resumed.ticket,"failure",{jobId:newer.id,leaseToken:newer.leaseToken,code:"MODEL_RATE_LIMIT",retryable:true,retryAfterSeconds:60});
    const waiting=await call(resumed.ticket,"next",version);
    assert.equal(waiting.state,"WAITING");assert.ok(waiting.retryAfterSeconds>5);
  });

  await t.test("expired commands and disabled managers cannot read source data",async()=>{
    const expired=await issue();
    await pg.query("update application_match_runner_tickets set expires_at=now()-interval '1 second' where id=$1",[expired.ticketId]);
    await assert.rejects(call(expired.ticket,"claim"),/MATCH_TICKET_EXPIRED/);
    const active=await issue();await call(active.ticket,"claim");
    await pg.query("update profiles set status='INACTIVE' where id=$1",[USER]);
    await assert.rejects(call(active.ticket,"next",version),/MATCH_TICKET_INVALID/);
    await pg.query("update profiles set status='ACTIVE' where id=$1",[USER]);
    await pg.query("update application_match_runner_tickets set run_expires_at=now()-interval '1 second' where id=$1",[active.ticketId]);
    await assert.rejects(call(active.ticket,"claim"),/MATCH_TICKET_EXPIRED/);
    const config=await issue();await call(config.ticket,"claim");
    await pg.exec("update application_match_settings set model_id='changed-model'");
    await assert.rejects(call(config.ticket,"next",version),/MATCH_WORKER_VERSION_MISMATCH/);
  });
});

test("completed tickets do not reopen when their failed pairs are retried with a new command",async t=>{
  const {pg,rpc}=await database({applyRunnerMigration:true});t.after(()=>pg.close());
  const issue=async()=> (await rpc("request_application_matches_with_ticket",{pairs:[PAIR],retry:true},"authenticated")).runner;
  const call=(ticket,operation,payload={})=>rpc("application_match_runner_call",{ticket,operation,payload},"anon");
  const original=await issue();await call(original.ticket,"claim");
  const job=await call(original.ticket,"next",version);
  await call(original.ticket,"failure",{jobId:job.id,leaseToken:job.leaseToken,code:"INVALID_MODEL_OUTPUT",retryable:false});
  assert.equal((await call(original.ticket,"next",version)).state,"COMPLETED");
  const retry=await issue();await call(retry.ticket,"claim");
  assert.equal((await call(original.ticket,"next",version)).state,"COMPLETED");
  const resumed=await call(retry.ticket,"next",version);
  assert.equal(resumed.id,job.id);assert.notEqual(resumed.leaseToken,job.leaseToken);
});

test("worker runs end to end through ticket API transport and PostgreSQL without a service key",async t=>{
  const {pg,rpc}=await database({applyRunnerMigration:true,applyDirectScoring:true});t.after(()=>pg.close());
  const queued=await rpc("request_application_matches_with_ticket",{pairs:[PAIR],retry:true},"authenticated");
  const calls=[];
  const api=createMatchingApiClient({apiBaseUrl:"https://api.example.com",ticket:queued.runner.ticket,fetchImpl:async(url,options)=>{
    const {ticket,...payload}=JSON.parse(options.body), operation=url.split("/").at(-1);
    calls.push({operation,headers:options.headers});
    const data=await rpc("application_match_runner_call",{ticket,operation,payload},"anon");
    return new Response(JSON.stringify({data}));
  }});
  const claim=await api.claim();
  let modelCalls=0;
  const provider={generate:async({schema,input})=>{
    modelCalls++;assert.ok(schema.properties.ratings);assert.ok(input.resume.experience.length);
    return {sufficient:true,summary:"Direct comparison",ratings:Object.fromEntries(Object.keys(WEIGHTS).map(key=>[key,69]))};
  }};
  const worker=createMatchingWorker({rpc:api.rpc,model:claim.modelId,provider});
  assert.equal(await worker.runOne(),true);
  assert.equal(await worker.runOne(),false);
  assert.equal(api.finished,true);
  const eligibility=await rpc("application_match_eligibility",{jd:JD,resume:RESUME});
  assert.equal(eligibility.matchScore,69);assert.equal(eligibility.eligible,false);
  assert.equal(modelCalls,1);
  assert.deepEqual(calls.map(call=>call.operation),["claim","next","result","next"]);
  assert.ok(calls.every(call=>!call.headers.Authorization&&!call.headers.apikey));
});
