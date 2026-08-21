import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql=await readFile(new URL("../supabase/migrations/202608130056_v2_8_reset_existing_jds_for_review.sql",import.meta.url),"utf8");
const reviewMigration=await readFile(new URL("../supabase/migrations/202608120055_v2_7_jd_review_workflow.sql",import.meta.url),"utf8");

test("v2.8 resets every existing JD to needs review without erasing lifecycle history",()=>{
  assert.match(sql,/from public\.job_descriptions;/);
  assert.match(sql,/update public\.job_descriptions set\s+review_status='NEEDS_REVIEW'/);
  assert.doesNotMatch(sql,/status='ACTIVE'/);
  assert.match(sql,/System reset: existing JD requires an explicit manager approval/);
});

test("Application creation remains restricted to active approved JDs at picker, preview, and final insert",()=>{
  assert.match(reviewMigration,/status='ACTIVE' and review_status='APPROVED'/);
  assert.match(reviewMigration,/j\.status='ACTIVE' and j\.review_status='APPROVED'/);
  assert.match(reviewMigration,/loaded\.status='ACTIVE' and loaded\.review_status='APPROVED'/);
});
