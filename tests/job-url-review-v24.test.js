import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationUrl=new URL("../supabase/migrations/202608110052_v2_4_job_url_review.sql",import.meta.url);

test("v2.4 URL review is manager protected, audited, and reversible",async()=>{
  const sql=await readFile(migrationUrl,"utf8");
  assert.match(sql,/perform public\.assert_application_manager\(\)/i);
  assert.match(sql,/archived_at/i);
  assert.match(sql,/archived_by/i);
  assert.match(sql,/archive_reason/i);
  assert.match(sql,/grant execute on function public\.set_job_description_archived_state_v24[^;]+to authenticated/i);
  assert.match(sql,/JOB_REVIEW_FORBIDDEN/i);
});

test("v2.4 prevents archived URLs from creating new Applications",async()=>{
  const sql=await readFile(migrationUrl,"utf8");
  assert.match(sql,/before insert or update of job_description_id on public\.applications/i);
  assert.match(sql,/status = 'ACTIVE'/i);
  assert.match(sql,/APPLICATION_INACTIVE_JOB/i);
});
