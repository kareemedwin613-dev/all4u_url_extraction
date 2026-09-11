import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { database, JD, RESUME, PRIMARY, USER, PAIR } from "./database-helper.mjs";
import { WEIGHTS } from "../src/scoring.mjs";

const result = score => ({ sufficient: true, summary: `Evidence aligns at ${score}.`, components: Object.fromEntries(Object.keys(WEIGHTS).map(key => [key, { rating: score }])) });
const setup = async t => { const db = await database({ applyRunnerMigration: true, applyDirectScoring: true, applyMatchingChoice: true, applyScoreComparison: true }); t.after(() => db.pg.close()); return db; };
const call = (rpc, ticket, operation, payload = {}) => rpc("application_match_runner_call", { ticket, operation, payload }, "anon");
const next = (rpc, ticket) => call(rpc, ticket, "next", { modelId: "test-model", rubricVersion: "match-v1", extractorVersion: "facts-v1", scoringMode: "direct-v1" });
async function finish(rpc, ticket, score) {
  await call(rpc, ticket, "claim"); const job = await next(rpc, ticket);
  assert.equal(job.state, "JOB");
  await call(rpc, ticket, "result", { jobId: job.id, leaseToken: job.leaseToken, result: result(score) }); return job;
}
const view = (rpc, app) => rpc("get_application_match_comparison_v378", { app }, "authenticated");
const request = (rpc, app) => rpc("request_application_match_comparison_v378", { app }, "authenticated");
async function createScored(rpc) {
  const requested = await rpc("request_application_matches_with_ticket", { pairs: [PAIR] }, "authenticated");
  await finish(rpc, requested.runner.ticket, 80);
  return rpc("create_application", { jd: JD, resume: RESUME, applier: null, priority: "NORMAL", due: null, notes: null }, "authenticated");
}
async function attachTailored(pg, app) {
  const child = randomUUID();
  await pg.query("insert into resumes(id,resume_type,parent_resume_id,skills) values($1,'TAILORED',$2,'{React,TypeScript}')", [child, RESUME]);
  await pg.query("update applications set resume_id=$2 where id=$1", [app, child]); return child;
}

test("details retain original eligibility score and compare independently scored tailored content", async t => {
  const { pg, rpc } = await setup(t), app = await createScored(rpc);
  let detail = await view(rpc, app.id);
  assert.equal(detail.original.score, 80); assert.match(detail.original.reason, /Evidence aligns/);
  assert.equal(detail.creationScore, 80); assert.equal(detail.tailored, null); assert.equal(detail.difference, null);
  const child = await attachTailored(pg, app.id);
  // A tailored score must not depend on copied category metadata.
  await pg.query("delete from resume_tech_stacks where resume_id=$1", [child]);
  detail = await view(rpc, app.id); assert.equal(detail.tailored.status, "NOT_ASSESSED"); assert.equal(detail.tailored.score, null);
  const queued = await request(rpc, app.id); assert.equal(queued.queuedCount, 1);
  const job = await finish(rpc, queued.runner.ticket, 92);
  assert.deepEqual(job.resumeSource.skills, ["React", "TypeScript"]);
  detail = await view(rpc, app.id);
  assert.equal(detail.original.score, 80); assert.equal(detail.tailored.score, 92);
  assert.equal(detail.difference, 12); assert.equal(detail.comparable, true);
  assert.equal(detail.creationScore, 80); assert.equal(detail.creationReason, "Evidence aligns at 80.");
  assert.equal((await request(rpc, app.id)).runner, null);
  const stored = (await pg.query("select match_score,match_assessment_id from applications where id=$1", [app.id])).rows[0];
  assert.equal(stored.match_score, 80); assert.equal(stored.match_assessment_id, app.match_assessment_id);
  // Comparison permission never becomes permission to create a second Application.
  const preview = await rpc("preview_application_matches", { ids: [JD] }, "authenticated");
  assert.equal(preview.combinations[0].exclusionCode, "EXISTING_APPLICATION");
  assert.equal((await rpc("request_application_matches_with_ticket", { pairs: [PAIR] }, "authenticated")).runner, null);
  await assert.rejects(rpc("create_application", { jd: JD, resume: RESUME, applier: null, priority: "NORMAL", due: null, notes: null }, "authenticated"), /ALREADY_EXISTS|EXISTING_APPLICATION/);
});

test("category-created applications can evaluate both versions without changing their creation method", async t => {
  const { pg, rpc } = await setup(t);
  const app = await rpc("create_category_application_v377", { jd: JD, resume: RESUME, applier: null, priority: "NORMAL", due: null, notes: null }, "authenticated");
  await attachTailored(pg, app.id);
  const queued = await request(rpc, app.id); assert.equal(queued.queuedCount, 2);
  await finish(rpc, queued.runner.ticket, 75); await finish(rpc, queued.runner.ticket, 70);
  const detail = await view(rpc, app.id);
  assert.equal(detail.matchingMode, "CATEGORY"); assert.equal(detail.creationScore, null);
  assert.equal(detail.comparable, true); assert.equal(Math.abs(detail.difference), 5);
  assert.equal((await next(rpc, queued.runner.ticket)).state, "COMPLETED");
});

test("source/configuration changes suppress misleading score differences and preserve history", async t => {
  const { pg, rpc } = await setup(t), app = await createScored(rpc);
  const child = await attachTailored(pg, app.id), queued = await request(rpc, app.id);
  await finish(rpc, queued.runner.ticket, 88);
  await pg.query("update resumes set skills='{Changed}' where id=$1", [child]);
  let detail = await view(rpc, app.id);
  assert.equal(detail.tailored.status, "STALE"); assert.equal(detail.tailored.score, 88);
  assert.equal(detail.difference, null); assert.equal(detail.comparable, false);
  assert.equal((await request(rpc, app.id)).queuedCount, 1);
  await pg.exec("update application_match_settings set model_id='new-model'");
  detail = await view(rpc, app.id); assert.equal(detail.original.status, "STALE"); assert.equal(detail.creationScore, 80);
});

test("comparison reads respect Application access and ticket scope; source changes invalidate in-flight results", async t => {
  const { pg, rpc } = await setup(t), app = await createScored(rpc);
  await attachTailored(pg, app.id);
  const queued = await request(rpc, app.id); await call(rpc, queued.runner.ticket, "claim");
  const job = await next(rpc, queued.runner.ticket);
  await assert.rejects(call(rpc, queued.runner.ticket, "result", { jobId: randomUUID(), leaseToken: job.leaseToken, result: result(99) }), /LEASE/);
  await pg.query("update job_descriptions set description_text='Changed requirements' where id=$1", [JD]);
  const receipt = await call(rpc, queued.runner.ticket, "result", { jobId: job.id, leaseToken: job.leaseToken, result: result(99) });
  assert.equal(receipt.status, "STALE"); assert.equal((await view(rpc, app.id)).difference, null);
  await assert.rejects(rpc("get_application_match_comparison_v378", { app: app.id }, "anon"), /permission denied/);
  await pg.query("delete from user_roles where user_id=$1", [USER]);
  await assert.rejects(view(rpc, app.id), /APPLICATION_NOT_FOUND/);
  await assert.rejects(request(rpc, app.id), /ACCESS_DENIED/);
  await assert.rejects(call(rpc, queued.runner.ticket, "next", {}), /TICKET_INVALID/);
});

test("automatic materialization queues comparison without rolling back a created Resume on scoring failure", async t => {
  const { pg, rpc } = await setup(t), app = await createScored(rpc);
  await attachTailored(pg, app.id);
  // The artifact finalizer is stubbed; apply the real new wrapper and both real
  // existing ticket-scope wrappers. The rest of matching runs real migrations.
  await pg.exec(`
    create table materialized_receipts(id uuid primary key);
    create table tailoring_runner_tickets(id uuid primary key,token_hash text,status text,run_expires_at timestamptz,created_by uuid,tailoring_job_id uuid,completed_at timestamptz);
    create table tailoring_batch_runner_tickets(id uuid primary key,token_hash text,status text,run_expires_at timestamptz,created_by uuid,batch_id uuid);
    create table tailoring_batches(id uuid primary key,status text,completed_count integer);
    create table tailoring_batch_items(id uuid primary key,batch_id uuid,tailoring_job_id uuid,status text,lease_token uuid,lease_expires_at timestamptz,finished_at timestamptz,duration_ms integer,started_at timestamptz,failure_stage text,failure_code text,failure_message text,retryable boolean);
    create function public.refresh_tailoring_batch_v21(uuid) returns tailoring_batches language sql as $$select * from tailoring_batches where id=$1$$;
    create function public.digest(text,text) returns bytea language sql as $$select sha256(convert_to($1,'UTF8'))$$;
    create function public.finalize_tailoring_materialization_v19(uuid,uuid,text,text,text,bigint,text) returns jsonb language plpgsql as $$begin
      perform public.assert_application_manager();
      insert into materialized_receipts values($1) on conflict do nothing;
      return jsonb_build_object('applicationId',$1,'status','COMPLETED');
    end$$;
  `);
  await pg.exec(await readFile(new URL('../../../supabase/migrations/202609111020_v3_79_tailoring_score_comparison.sql',import.meta.url),'utf8'));
  const finalize = () => rpc("finalize_tailoring_materialization_v379", { job:app.id, token:randomUUID(), path:"test.pdf", name:"test.pdf", mime:"application/pdf", size:100, hash:"test" }, "authenticated");
  await pg.exec("update application_match_settings set model_id='UNCONFIGURED'");
  let receipt = await finalize();
  assert.equal(receipt.status,"COMPLETED"); assert.equal(receipt.matching.errorCode,"MATCHING_NOT_CONFIGURED");
  assert.equal((await pg.query("select count(*)::int n from materialized_receipts")).rows[0].n,1);
  await pg.exec("update application_match_settings set model_id='test-model'");
  receipt = await finalize(); assert.equal(receipt.matching.queuedCount,1); assert.match(receipt.matching.runner.ticket,/^mrb_/);
  const token="tailoring-test-ticket", ticketId=randomUUID();
  await pg.query("insert into tailoring_runner_tickets values($1,encode(digest($2,'sha256'),'hex'),'CLAIMED',now()+interval '1 hour',$3,$4,null)",[ticketId,token,USER,app.id]);
  receipt=await rpc("finalize_tailoring_runner_materialization_v34",{ticket:token,lease:randomUUID(),path:"p",name:"n",mime:"application/pdf",size:100,hash:"h"},"anon");
  assert.equal(receipt.status,"COMPLETED"); assert.equal(receipt.matching.queuedCount,1);
  await assert.rejects(rpc("finalize_tailoring_runner_materialization_v34",{ticket:"wrong",lease:randomUUID(),path:"p",name:"n",mime:"application/pdf",size:100,hash:"h"},"anon"),/TICKET_EXPIRED/);
  // A batch ticket may finalize only its own leased item; comparison scope comes from that item.
  const batchId=randomUUID(),itemId=randomUUID(),lease=randomUUID(),batchTicket="batch-test-ticket";
  await pg.query("insert into tailoring_batches values($1,'COMPLETED',1)",[batchId]);
  await pg.query("insert into tailoring_batch_runner_tickets values($1,encode(digest($2,'sha256'),'hex'),'CLAIMED',now()+interval '1 hour',$3,$4)",[randomUUID(),batchTicket,USER,batchId]);
  await pg.query("insert into tailoring_batch_items(id,batch_id,tailoring_job_id,status,lease_token,started_at) values($1,$2,$3,'PROCESSING',$4,now())",[itemId,batchId,app.id,lease]);
  receipt=await rpc("finalize_tailoring_batch_materialization_v34",{ticket:batchTicket,item:itemId,lease,materialization:randomUUID(),path:"p",name:"n",mime:"application/pdf",size:100,hash:"h"},"anon");
  assert.equal(receipt.matching.queuedCount,1); assert.equal(receipt.batchStatus,"COMPLETED");
  await assert.rejects(rpc("finalize_tailoring_batch_materialization_v34",{ticket:batchTicket,item:randomUUID(),lease,materialization:randomUUID(),path:"p",name:"n",mime:"application/pdf",size:100,hash:"h"},"anon"),/LEASE_INVALID/);
});
