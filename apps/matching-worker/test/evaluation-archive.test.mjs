import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { database, JD, RESUME, PRIMARY, PAIR } from "./database-helper.mjs";
import { createMatchingApiClient } from "../src/api-client.mjs";

test("existing worker treats the archived API response as terminal, not retryable", async () => {
  const client = createMatchingApiClient({ apiBaseUrl: "https://example.test", ticket: `mrb_${"a".repeat(43)}`,
    fetchImpl: async () => new Response(JSON.stringify({ code: "EVALUATION_ARCHIVED" }), { status: 410 }) });
  await assert.rejects(client.claim(), error => error.code === "EVALUATION_ARCHIVED" && error.stopWorker === true && !error.retryable);
});

test("archive blocks queue/tickets, preserves history, enforces category creation and finalizes without evaluation", async t => {
  const { pg, rpc } = await database({ applyRunnerMigration: true, applyDirectScoring: true, applyMatchingChoice: true, applyScoreComparison: true });
  t.after(() => pg.close());
  await rpc("request_application_matches_with_ticket", { pairs: [PAIR], retry: true }, "authenticated");
  const before = (await pg.query("select * from application_match_assessments order by id")).rows;
  await pg.exec(`create function public.finalize_tailoring_materialization_v19(uuid,uuid,text,text,text,bigint,text)
    returns jsonb language sql as $$ select '{"tailoredResumeNumber":42}'::jsonb $$;`);
  const sql = await readFile(new URL("../../../supabase/migrations/202609221000_v3_103_archive_evaluation.sql", import.meta.url), "utf8");
  await pg.transaction(tx => tx.exec(sql));
  assert.deepEqual((await pg.query("select * from application_match_assessments order by id")).rows, before);
  for (const [name, args, role] of [
    ["request_application_matches", { pairs: [PAIR], retry: true }, "authenticated"],
    ["request_application_matches_with_ticket", { pairs: [PAIR], retry: true }, "authenticated"],
    ["request_application_match_comparison_v378", { application: JD }, "authenticated"],
    ["application_match_runner_call", { ticket: "old-ticket", operation: "claim", payload: {} }, "anon"],
    ["claim_application_match", { model: "test-model" }, "service_role"],
  ]) await assert.rejects(rpc(name, args, role), /EVALUATION_ARCHIVED/);
  const receipt = await rpc("finalize_tailoring_materialization_v379", { job: JD, token: RESUME, path: "test", filename: "test.pdf", mime: "application/pdf", size: 100, sha: "test" });
  assert.deepEqual(receipt, { tailoredResumeNumber: 42 });
  await pg.exec("update application_match_settings set model_id='UNCONFIGURED'");
  const createArgs = { jd: JD, resume: RESUME, assignee: null, priority: "NORMAL", due: null, notes: null };
  await pg.query("insert into resume_banned_companies values($1,'example')", [RESUME]);
  await assert.rejects(rpc("create_category_application_v377", createArgs, "authenticated"), /BANNED_COMPANY/);
  await pg.exec("delete from resume_banned_companies");
  const sub = "40000000-0000-4000-8000-000000000002";
  await pg.query("update categories set slug='software-engineering' where id=$1", [PRIMARY]);
  await pg.query("insert into categories(id,parent_id,name) values($1,$2,'Frontend')", [sub, PRIMARY]);
  await pg.query("update job_descriptions set subcategory_id=$1 where id=$2", [sub, JD]);
  await assert.rejects(rpc("create_category_application_v377", createArgs, "authenticated"), /CATEGORY_MISMATCH/);
  await pg.query("update resume_tech_stacks set subcategory_id=$1 where resume_id=$2", [sub, RESUME]);
  await rpc("create_category_application_v377", createArgs, "authenticated");
  const app = (await pg.query("select matching_mode,match_score from applications")).rows[0];
  assert.deepEqual(app, { matching_mode: "CATEGORY", match_score: null });
  await assert.rejects(rpc("create_category_application_v377", createArgs, "authenticated"), /DUPLICATE|EXISTING_APPLICATION/);
  await pg.transaction(tx => tx.exec(sql));
  assert.deepEqual((await pg.query("select * from application_match_assessments order by id")).rows, before);
});
