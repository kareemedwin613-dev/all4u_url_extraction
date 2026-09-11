import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { database, applyMatchingDirectScoring, JD, RESUME, PAIR } from "./database-helper.mjs";
import { WEIGHTS, RUBRIC_VERSION, EXTRACTOR_VERSION } from "../src/scoring.mjs";
import { SCORING_MODE } from "../src/direct-scoring.mjs";

const version = { modelId: "test-model", rubricVersion: RUBRIC_VERSION, extractorVersion: EXTRACTOR_VERSION, scoringMode: SCORING_MODE };
const result = (rating = 70) => ({ sufficient: true, components: Object.fromEntries(Object.keys(WEIGHTS).map(key => [key, { rating }])) });
const setup = async t => {
  const db = await database({ applyRunnerMigration: true, applyDirectScoring: true });
  t.after(() => db.pg.close());
  const issue = async (pairs = [PAIR]) => (await db.rpc("request_application_matches_with_ticket", { pairs, retry: true }, "authenticated")).runner;
  const call = (ticket, operation, payload = {}) => db.rpc("application_match_runner_call", { ticket, operation, payload }, "anon");
  const start = async (pairs = [PAIR]) => { const { ticket } = await issue(pairs); await call(ticket, "claim");
    return { ticket, job: await call(ticket, "next", version) }; };
  const finish = ({ ticket, job }, value) => call(ticket, "result", { jobId: job.id, leaseToken: job.leaseToken, result: value });
  const eligibility = () => db.rpc("application_match_eligibility", { jd: JD, resume: RESUME });
  return { ...db, issue, call, start, finish, eligibility };
};

test("v3.76 returns sources with the job and enforces protocol/ticket/lease scope without extraction", async t => {
  const { pg, rpc, issue, call, start, finish } = await setup(t);
  const { ticket } = await issue();
  assert.equal((await call(ticket, "claim")).scoringMode, SCORING_MODE);
  await assert.rejects(call(ticket, "next", { ...version, scoringMode: undefined }), /MATCH_WORKER_VERSION_MISMATCH/);
  assert.equal((await pg.query("select attempt_count from application_match_assessments")).rows[0].attempt_count, 0);
  const job = await call(ticket, "next", version);
  assert.equal(job.scoringMode, SCORING_MODE);
  assert.equal(job.jdSource.description, "Build React interfaces and APIs");
  assert.equal(job.resumeSource.experience[0].start.year, 2020);
  assert.deepEqual(Object.keys(job.resumeSource).sort(), ["certifications", "education", "experience", "skills", "summary"]);
  assert.doesNotMatch(JSON.stringify(job.resumeSource), /candidate_name|resume_name|email|phone|source-file/);
  assert.deepEqual((await pg.query("select status,analysis from application_match_documents")).rows,
    [{ status: "PENDING", analysis: null }, { status: "PENDING", analysis: null }]);
  for (const operation of ["document", "document-result"]) await assert.rejects(call(ticket, operation,
    { jobId: job.id, leaseToken: job.leaseToken, documentId: job.jdDocumentId }), /MATCH_WORKER_VERSION_MISMATCH/);
  await assert.rejects(finish({ ticket, job: { ...job, leaseToken: randomUUID() } }, result()), /MATCH_LEASE_EXPIRED/);
  const otherJd = randomUUID(); await pg.query("insert into job_descriptions(id) values($1)", [otherJd]);
  const other = await start([{ job_description_id: otherJd, resume_id: RESUME }]);
  await assert.rejects(finish({ ...other, job }, result()), /MATCH_LEASE_EXPIRED/);
  await assert.rejects(call("mrb_" + "z".repeat(43), "claim"), /MATCH_TICKET_INVALID/);
  for (const role of ["anon", "authenticated"]) {
    await assert.rejects(rpc("claim_application_match", { model: "test-model" }, role), /permission denied/);
    await assert.rejects(rpc("normalize_application_match_score_result", { value: result() }, role), /permission denied/);
    assert.equal((await pg.query("select has_function_privilege($1,'public.application_match_direct_sources(public.application_match_assessments)','EXECUTE') as allowed", [role])).rows[0].allowed, false);
  }
  assert.deepEqual(await finish({ ticket, job }, result()), { status: "COMPLETED", score: 70 });
  assert.deepEqual(await finish({ ticket, job }, result()), { status: "COMPLETED", score: 70 });
  assert.ok((await pg.query("select analysis from application_match_documents")).rows.every(row => row.analysis === null));
});

test("v3.76 checks numeric integrity only, preserving 69/70, stale-source and creation gates", async t => {
  const { pg, rpc, start, finish, eligibility } = await setup(t);
  let run = await start();
  for (const rating of ["70", 70.5, -1, 101, undefined]) {
    const invalid = result(); invalid.components.requiredSkills.rating = rating;
    await assert.rejects(finish(run, invalid), /MATCH_INVALID_RESULT/);
  }
  for (const invalid of [{}, result(null), { ...result(), sufficient: false }, { ...result(), sufficient: "true" }]) {
    await assert.rejects(finish(run, invalid), /MATCH_INVALID_RESULT/);
  }
  const valid = { ...result(69), summary: "x".repeat(900), missingRequirements: "ignored" };
  valid.components.requiredSkills.reason = { bad: "ignored" };
  assert.deepEqual(await finish(run, valid), { status: "COMPLETED", score: 69 });
  const saved = (await pg.query("select result from application_match_assessments where id=$1", [run.job.id])).rows[0].result;
  assert.equal(saved.summary.length, 500); assert.equal(saved.components.requiredSkills.reason, "");
  assert.deepEqual(saved.missingRequirements, []);
  assert.deepEqual(await finish(run, valid), { status: "COMPLETED", score: 69 });
  assert.equal((await eligibility()).exclusionCode, "BELOW_THRESHOLD");
  await assert.rejects(pg.query("insert into applications(job_description_id,resume_id) values($1,$2)", [JD, RESUME]), /BELOW_THRESHOLD/);
  await pg.query("update resumes set skills=array['React','TypeScript'] where id=$1", [RESUME]);
  run = await start();
  await pg.query("update job_descriptions set description_text=description_text || ' Own releases.' where id=$1", [JD]);
  assert.deepEqual(await finish(run, result(100)), { status: "STALE" });
  run = await start();
  assert.deepEqual(await finish(run, result(70)), { status: "COMPLETED", score: 70 });
  assert.equal((await eligibility()).eligible, true);
  const originalCategory = (await pg.query("select category_id from job_descriptions where id=$1", [JD])).rows[0].category_id;
  const otherCategory = randomUUID(); await pg.query("insert into categories(id,name) values($1,'Other')", [otherCategory]);
  await pg.query("update job_descriptions set category_id=$2 where id=$1", [JD, otherCategory]);
  assert.equal((await eligibility()).exclusionCode, "PRIMARY_CATEGORY_MISMATCH");
  await pg.query("update job_descriptions set category_id=$2 where id=$1", [JD, originalCategory]);
  await pg.query("insert into resume_banned_companies values($1,'example')", [RESUME]);
  assert.equal((await eligibility()).exclusionCode, "BANNED_COMPANY");
  await pg.query("delete from resume_banned_companies where resume_id=$1", [RESUME]);
  await pg.query("insert into applications(job_description_id,resume_id) values($1,$2)", [JD, RESUME]);
  assert.equal((await eligibility()).exclusionCode, "EXISTING_APPLICATION");
  const stored = (await pg.query("select match_score,match_threshold from applications")).rows[0];
  assert.deepEqual(stored, { match_score: 70, match_threshold: 70 });
  // Service-only completion uses the same compact validator and nullable scoring.
  const nextJd = randomUUID(); await pg.query("insert into job_descriptions(id) values($1)", [nextJd]);
  const insufficient = await start([{ job_description_id: nextJd, resume_id: RESUME }]);
  assert.deepEqual(await rpc("complete_application_match", { id: insufficient.job.id, token: insufficient.job.leaseToken,
    value: { ...result(null), sufficient: false } }, "service_role"), { status: "INSUFFICIENT_DATA", score: null });
});

test("v3.76 preserves completed scores, settings and cached eligibility without mass rescoring", async t => {
  const { pg, rpc } = await database({ applyRunnerMigration: true }); t.after(() => pg.close());
  await rpc("request_application_matches", { pairs: [PAIR] }, "authenticated");
  const job = await rpc("claim_application_match", { model: "test-model" }, "service_role");
  const oldResult = { ...result(), summary: "Previously evaluated", missingRequirements: [] };
  for (const component of Object.values(oldResult.components)) component.reason = "Previous evidence";
  await rpc("complete_application_match", { id: job.id, lease: job.leaseToken, result: oldResult }, "service_role");
  const settings = (await pg.query("select * from application_match_settings")).rows;
  const scores = (await pg.query("select * from application_match_assessments")).rows;
  await applyMatchingDirectScoring(pg);
  assert.deepEqual((await pg.query("select * from application_match_settings")).rows, settings);
  assert.deepEqual((await pg.query("select * from application_match_assessments")).rows, scores);
  assert.equal((await rpc("request_application_matches", { pairs: [PAIR] }, "authenticated")).queuedCount, 0);
  assert.equal((await rpc("application_match_eligibility", { jd: JD, resume: RESUME })).eligible, true);
});
