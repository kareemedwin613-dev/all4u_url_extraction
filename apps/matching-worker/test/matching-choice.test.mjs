import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { database, applyApplicationMatchingChoice, JD, RESUME, PRIMARY, PAIR } from "./database-helper.mjs";
import { WEIGHTS } from "../src/scoring.mjs";

const setup = async t => {
  const db = await database({ applyRunnerMigration: true, applyDirectScoring: true, applyMatchingChoice: true });
  t.after(() => db.pg.close()); return db;
};
const categoryPreview = (rpc, ids = [JD], resumes = null) => rpc("preview_category_application_matches_v377", { ids, resumes }, "authenticated");
const create = (rpc, jd = JD, resume = RESUME, category = true, applier = null) => rpc(category ? "create_category_application_v377" : "create_application",
  { jd, resume, applier, priority: "NORMAL", due: null, notes: null }, "authenticated");
const bulk = (rpc, pairs = [PAIR], key = "category-key", hash = "a".repeat(64), category = true) => rpc(
  category ? "create_category_applications_bulk_api_v377" : "create_applications_bulk_api",
  { pairs, name: "Choice test", key, hash }, "authenticated");
const result = score => ({ sufficient: true, summary: "Alignment", components: Object.fromEntries(Object.keys(WEIGHTS).map(key => [key, { rating: score }])) });

test("category choice restores v3.68 Software Engineering subcategories while score mode remains primary-only", async t => {
  const { pg, rpc } = await setup(t);
  await pg.query("update categories set slug='software-engineering' where id=$1", [PRIMARY]);
  const frontend = randomUUID(), backend = randomUUID(), otherPrimary = randomUUID();
  await pg.query("insert into categories(id,name,parent_id) values($1,'Frontend',$3),($2,'Backend',$3),($4,'Data',null)", [frontend, backend, PRIMARY, otherPrimary]);
  await pg.query("update job_descriptions set subcategory_id=$2 where id=$1", [JD, frontend]);
  const multi = randomUUID(); await pg.query("insert into resumes(id,primary_category_id) values($1,$2)", [multi, otherPrimary]);
  await pg.query("insert into resume_tech_stacks(resume_id,primary_category_id,subcategory_id,sort_order) values($1,$2,$3,1),($1,$2,$4,2)", [multi, PRIMARY, frontend, backend]);
  // The original default Resume has only the primary, not the requested SE subcategory.
  const preview = await categoryPreview(rpc);
  assert.deepEqual(preview.combinations.map(row => row.resumeId), [multi]);
  assert.equal(preview.matchingMode, "CATEGORY"); assert.equal(preview.eligibleCount, 1);
  assert.equal(preview.combinations[0].matchStatus, "NOT_REQUIRED"); assert.equal(preview.combinations[0].matchScore, null);
  assert.deepEqual((await rpc("list_category_application_resumes_v377", { jd: JD }, "authenticated")).map(row => row.id), [multi]);
  assert.equal((await categoryPreview(rpc, [JD], [RESUME])).proposedCount, 0);
  assert.deepEqual((await rpc("preview_application_matches", { ids: [JD] }, "authenticated")).combinations.map(row => row.resumeId).sort(), [RESUME, multi].sort());
  assert.equal((await categoryPreview(rpc, [JD], [])).proposedCount, 0);
  await assert.rejects(create(rpc), /CATEGORY_MISMATCH/);
  const rejected = await bulk(rpc); assert.equal(rejected.skippedCount, 1); assert.equal(rejected.results[0].code, "CATEGORY_MISMATCH");
  await pg.query("update job_descriptions set subcategory_id=null where id=$1", [JD]);
  assert.equal((await categoryPreview(rpc)).proposedCount, 2);
  await pg.query("update job_descriptions set category_id=$2,subcategory_id=$3 where id=$1", [JD, otherPrimary, randomUUID()]);
  assert.deepEqual((await categoryPreview(rpc)).combinations.map(row => row.resumeId), [multi]);
});

test("category creation needs no model/assessment, records its method and retains history through tailoring", async t => {
  const { pg, rpc } = await setup(t);
  await pg.exec("update application_match_settings set model_id='UNCONFIGURED'");
  assert.equal((await categoryPreview(rpc)).eligibleCount, 1);
  await assert.rejects(create(rpc, JD, RESUME, false), /MATCHING_NOT_CONFIGURED/);
  const created = await create(rpc);
  assert.equal(created.matching_mode, "CATEGORY");
  assert.equal(created.match_score, null); assert.equal(created.match_threshold, null); assert.equal(created.match_assessment_id, null);
  assert.equal((await pg.query("select count(*)::int n from application_match_assessments")).rows[0].n, 0);
  assert.equal((await pg.query("select count(*)::int n from application_match_documents")).rows[0].n, 0);
  // Creation history cannot be relabelled or supplied with an invented score.
  await pg.query("update applications set matching_mode='SCORE',match_score=99 where id=$1", [created.id]);
  let row = (await pg.query("select * from applications where id=$1", [created.id])).rows[0];
  assert.equal(row.matching_mode, "CATEGORY"); assert.equal(row.match_score, null);
  const child = randomUUID(); await pg.query("insert into resumes(id,resume_type,parent_resume_id) values($1,'TAILORED',$2)", [child, RESUME]);
  await pg.query("update applications set resume_id=$2 where id=$1", [created.id, child]);
  row = (await pg.query("select * from applications where id=$1", [created.id])).rows[0];
  assert.equal(row.matching_mode, "CATEGORY"); assert.equal(row.match_score, null);
  const duplicate = await bulk(rpc); assert.equal(duplicate.duplicateCount, 1); assert.equal(duplicate.createdCount, 0);
  assert.equal((await categoryPreview(rpc)).combinations[0].exclusionCode, "EXISTING_APPLICATION");
  const nextJd = randomUUID(); await pg.query("insert into job_descriptions(id) values($1)", [nextJd]);
  await assert.rejects(create(rpc, nextJd, child), /ORIGINAL_RESUME_REQUIRED/);
});

test("category bulk stays idempotent and a retry key cannot switch methods in either direction", async t => {
  const { pg, rpc } = await setup(t);
  const first = await bulk(rpc), replay = await bulk(rpc);
  assert.equal(first.createdCount, 1); assert.equal(replay.replayed, true); assert.equal(replay.batchId, first.batchId);
  assert.equal(first.matchingMode, "CATEGORY"); assert.equal(replay.matchingMode, "CATEGORY");
  assert.equal((await pg.query("select matching_mode from application_creation_batches where id=$1", [first.batchId])).rows[0].matching_mode, "CATEGORY");
  await assert.rejects(bulk(rpc, [PAIR], "category-key", "a".repeat(64), false), /IDEMPOTENCY_CONFLICT/);
  await assert.rejects(bulk(rpc, [PAIR], "category-key", "b".repeat(64)), /IDEMPOTENCY_CONFLICT/);
  await bulk(rpc, [PAIR], "score-key", "a".repeat(64), false);
  await assert.rejects(bulk(rpc, [PAIR], "score-key"), /IDEMPOTENCY_CONFLICT/);
  assert.equal((await pg.query("select count(*)::int n from applications")).rows[0].n, 1);
});

test("category creation rechecks source status, bans, permissions and assignment permissions", async t => {
  const { pg, rpc } = await setup(t);
  assert.equal((await categoryPreview(rpc)).eligibleCount, 1);
  for (const [sql, restore, code] of [
    ["update job_descriptions set status='ARCHIVED'", "update job_descriptions set status='ACTIVE'", "INACTIVE_JD"],
    ["update job_descriptions set review_status='NEEDS_REVIEW'", "update job_descriptions set review_status='APPROVED'", "UNAPPROVED_JD"],
    ["update resumes set status='ARCHIVED'", "update resumes set status='ACTIVE'", "INACTIVE_RESUME"],
    ["update categories set active=false", "update categories set active=true", "MISSING_CATEGORY"],
  ]) {
    await pg.exec(sql);
    await assert.rejects(create(rpc), new RegExp(code === "INACTIVE_RESUME" ? "APPLICATION_INVALID_RESUME" : code));
    const batch = await bulk(rpc, [PAIR], randomUUID()); assert.equal(batch.skippedCount, 1); assert.equal(batch.results[0].code, code);
    await pg.exec(restore);
  }
  await pg.query("insert into resume_banned_companies values($1,'example')", [RESUME]);
  await assert.rejects(create(rpc), /BANNED_COMPANY/);
  assert.equal((await categoryPreview(rpc)).combinations[0].exclusionCode, "BANNED_COMPANY");
  await pg.query("delete from resume_banned_companies where resume_id=$1", [RESUME]);
  await assert.rejects(create(rpc, JD, RESUME, true, randomUUID()), /APPLICATION_INVALID_ASSIGNEE/);
  await pg.exec("create or replace function assert_applier_may_use_resume(uuid,uuid) returns void language plpgsql as $$ begin raise exception 'APPLIER_RESUME_NOT_ALLOWED'; end $$");
  await assert.rejects(create(rpc), /APPLIER_RESUME_NOT_ALLOWED/);
  for (const fn of ["application_category_candidate_v377", "application_category_eligibility_v377"]) {
    await assert.rejects(rpc(fn, { jd: JD, resume: RESUME }, "authenticated"), /permission denied/);
  }
  await assert.rejects(rpc("preview_category_application_matches_v377", { ids: [JD] }, "anon"), /permission denied/);
  await pg.exec("update roles set active=false where code='APPLYING_MANAGER'");
  await assert.rejects(categoryPreview(rpc), /APPLICATION_ACCESS_DENIED/);
  await assert.rejects(create(rpc), /APPLICATION_ACCESS_DENIED/);
  await assert.rejects(bulk(rpc), /APPLICATION_ACCESS_DENIED/);
  await assert.rejects(pg.query("insert into applications(job_description_id,resume_id,matching_mode) values($1,$2,'CATEGORY')", [JD, RESUME]), /APPLICATION_ACCESS_DENIED/);
});

test("score mode still requires 70, while category mode ignores failed or below-threshold scores", async t => {
  const { pg, rpc } = await setup(t);
  await rpc("request_application_matches", { pairs: [PAIR] }, "authenticated");
  let job = await rpc("claim_application_match", { model: "test-model" }, "service_role");
  await rpc("complete_application_match", { id: job.id, lease: job.leaseToken, result: result(69) }, "service_role");
  assert.equal((await categoryPreview(rpc)).eligibleCount, 1);
  await assert.rejects(create(rpc, JD, RESUME, false), /BELOW_THRESHOLD/);
  await assert.rejects(pg.query("insert into applications(job_description_id,resume_id) values($1,$2)", [JD, RESUME]), /BELOW_THRESHOLD/);
  await pg.query("update resumes set skills=array['React','TypeScript'] where id=$1", [RESUME]);
  await rpc("request_application_matches", { pairs: [PAIR] }, "authenticated");
  job = await rpc("claim_application_match", { model: "test-model" }, "service_role");
  await rpc("complete_application_match", { id: job.id, lease: job.leaseToken, result: result(70) }, "service_role");
  const created = await create(rpc, JD, RESUME, false);
  assert.equal(created.matching_mode, "SCORE"); assert.equal(created.match_score, 70); assert.equal(created.match_threshold, 70);
  await pg.query("update applications set matching_mode='CATEGORY',match_score=null where id=$1", [created.id]);
  assert.deepEqual((await pg.query("select matching_mode,match_score from applications where id=$1", [created.id])).rows[0], { matching_mode: "SCORE", match_score: 70 });
});

test("forward migration preserves existing applications/scores and null historical method provenance", async t => {
  const { pg, rpc } = await database({ applyRunnerMigration: true, applyDirectScoring: true }); t.after(() => pg.close());
  await rpc("request_application_matches", { pairs: [PAIR] }, "authenticated");
  const job = await rpc("claim_application_match", { model: "test-model" }, "service_role");
  await rpc("complete_application_match", { id: job.id, lease: job.leaseToken, result: result(80) }, "service_role");
  const application = await create(rpc, JD, RESUME, false);
  const scores = (await pg.query("select * from application_match_assessments")).rows;
  await applyApplicationMatchingChoice(pg);
  const row = (await pg.query("select * from applications where id=$1", [application.id])).rows[0];
  assert.equal(row.matching_mode, null); assert.equal(row.match_score, 80); assert.equal(row.match_assessment_id, application.match_assessment_id);
  assert.deepEqual((await pg.query("select * from application_match_assessments")).rows, scores);
});
