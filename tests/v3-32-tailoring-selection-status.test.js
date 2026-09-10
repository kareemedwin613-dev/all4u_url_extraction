import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration=await readFile(new URL("../supabase/migrations/202608310109_v3_32_tailoring_selection_status.sql",import.meta.url),"utf8"),
  listMigration=await readFile(new URL("../supabase/migrations/202609041700_v3_60_application_list_tailoring_status.sql",import.meta.url),"utf8"),
  page=await readFile(new URL("../dashboard/src/features/applications/application-pages.jsx",import.meta.url),"utf8"),
  applicationService=await readFile(new URL("../apps/api/src/applications/application.service.ts",import.meta.url),"utf8"),
  batchService=await readFile(new URL("../apps/api/src/platform/tailoring-batch.service.ts",import.meta.url),"utf8");

test("Application selection shows and links the current tailoring status",()=>{
  assert.match(page,/title: "Tailoring Status"/);
  assert.match(page,/tailoring_status/);
  assert.match(page,/#\/tailoring-jobs\/\$\{record\.tailoring_job_id\}/);
  assert.match(applicationService,/list_applications_v360/);
  assert.doesNotMatch(applicationService,/get_application_tailoring_statuses_v32/);
});

test("approved or materialized Applications cannot be selected or submitted again",()=>{
  assert.match(page,/FINAL_TAILORING_STATUSES = new Set\(\["APPROVED", "MATERIALIZING", "COMPLETED"\]\)/);
  assert.match(page,/selectionMode==="TAILOR"&&tailoringIsFinal\(record\)/);
  assert.match(batchService,/create_tailoring_batch_v32/);
  assert.match(migration,/t\.status in\('APPROVED','MATERIALIZING','COMPLETED'\)/);
  assert.match(migration,/TAILORING_BATCH_ALREADY_APPROVED/);
});

test("tailoring status lookup remains Application-access scoped",()=>{
  assert.match(migration,/application_actor_can_manage\(\)/);
  assert.match(migration,/has_role\('APPLIER'\).*a\.assigned_to=auth\.uid\(\)/s);
  assert.match(migration,/grant execute on function public\.get_application_tailoring_statuses_v32\(uuid\[\]\) to authenticated/);
  assert.doesNotMatch(migration,/grant execute on function public\.get_application_tailoring_statuses_v32.*to anon/);
});

test("Application list and tailoring status are returned by one protected RPC",()=>{
  assert.match(listMigration,/public\.list_applications_v07\(/);
  assert.match(listMigration,/left join public\.tailoring_jobs/);
  assert.match(listMigration,/'tailoring_status', tailoring\.status/);
  assert.match(listMigration,/grant execute on function public\.list_applications_v360[\s\S]*to authenticated/);
  assert.doesNotMatch(listMigration,/grant execute on function public\.list_applications_v360.*to anon/);
});
