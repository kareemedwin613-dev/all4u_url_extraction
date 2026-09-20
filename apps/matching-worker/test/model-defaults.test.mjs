import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { database, JD, RESUME, PAIR } from "./database-helper.mjs";
import { WEIGHTS, RUBRIC_VERSION, EXTRACTOR_VERSION } from "../src/scoring.mjs";
import { SCORING_MODE } from "../src/direct-scoring.mjs";

const version = { modelId: "test-model", rubricVersion: RUBRIC_VERSION, extractorVersion: EXTRACTOR_VERSION, scoringMode: SCORING_MODE };

for (const [model, filename] of [
  ["gpt-5.6-terra", "202609171000_v3_100_match_model_terra.sql"],
  ["gpt-5.6-sol", "202609181100_v3_102_match_model_sol.sql"],
]) {
const migration = await readFile(new URL(`../../../supabase/migrations/${filename}`, import.meta.url), "utf8");
test(`${model} migration updates defaults and new tickets without rewriting historical scores`, async t => {
  const { pg, rpc } = await database({ applyRunnerMigration: true, applyDirectScoring: true });
  t.after(() => pg.close());
  const issue = async () => (await rpc("request_application_matches_with_ticket", { pairs: [PAIR], retry: true }, "authenticated")).runner;
  const call = (ticket, operation, payload = {}) => rpc("application_match_runner_call", { ticket, operation, payload }, "anon");
  const old = await issue();
  await call(old.ticket, "claim");
  const job = await call(old.ticket, "next", version);
  await call(old.ticket, "result", { jobId: job.id, leaseToken: job.leaseToken,
    result: { sufficient: true, components: Object.fromEntries(Object.keys(WEIGHTS).map(key => [key, { rating: 80 }])) } });
  await rpc("create_application", { jd: JD, resume: RESUME, applier: null, priority: "NORMAL", due: null, notes: null }, "authenticated");
  // Preserve the deployed threshold rather than resetting it as part of a model change.
  await pg.exec("update application_match_settings set threshold=60");
  const before = (await pg.query("select * from application_match_assessments order by id")).rows;
  const apps = (await pg.query("select * from applications order by id")).rows;
  const settings = (await pg.query("select * from application_match_settings")).rows[0];

  await pg.transaction(tx => tx.exec(migration));
  assert.deepEqual((await pg.query("select * from application_match_settings")).rows[0], { ...settings, model_id: model });
  assert.deepEqual((await pg.query("select * from application_match_assessments order by id")).rows, before);
  assert.deepEqual((await pg.query("select * from applications order by id")).rows, apps);
  const column = (await pg.query("select column_default from information_schema.columns where table_schema='public' and table_name='application_match_settings' and column_name='model_id'")).rows[0];
  assert.equal(column.column_default, `'${model}'::text`);
  await assert.rejects(call(old.ticket, "claim"), /MATCH_WORKER_VERSION_MISMATCH/);

  // A different unassigned pair can now be queued under the new model cache identity.
  const secondJd = "20000000-0000-4000-8000-000000000002";
  await pg.query("insert into job_descriptions(id) values($1)", [secondJd]);
  const fresh = (await rpc("request_application_matches_with_ticket", {
    pairs: [{ job_description_id: secondJd, resume_id: RESUME }], retry: true,
  }, "authenticated")).runner;
  assert.equal(fresh.modelId, model);
  assert.equal((await call(fresh.ticket, "claim")).modelId, model);
  const nextJob = await call(fresh.ticket, "next", { ...version, modelId: model });
  assert.equal(nextJob.state, "JOB");
  assert.equal(nextJob.modelId, model);

  // Reapplying the SQL does not reset an active lease or historical results.
  const after = (await pg.query("select * from application_match_assessments order by id")).rows;
  await pg.transaction(tx => tx.exec(migration));
  assert.deepEqual((await pg.query("select * from application_match_assessments order by id")).rows, after);
});
}
