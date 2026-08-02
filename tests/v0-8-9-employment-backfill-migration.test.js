import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const sql=(await readFile(new URL("../supabase/migrations/202607290026_v0_8_9_resume_employment_backfill.sql",import.meta.url),"utf8")).toLowerCase();

test("legacy employment import is authorized, bounded, and Resume-owned",()=>{
  assert.match(sql,/assert_application_manager/);
  assert.match(sql,/jsonb_array_length\(p_items\)/);
  assert.match(sql,/between 1 and 50/);
  assert.match(sql,/update public\.resumes/);
  assert.match(sql,/professional_experience_legacy_text/);
  assert.doesNotMatch(sql,/create table/);
  assert.doesNotMatch(sql,/service_role/);
});

test("legacy employment import never overwrites an existing structured array",()=>{
  assert.match(sql,/jsonb_typeof\(v_content->'professional_experience'\)='array'[\s\S]*jsonb_array_length[\s\S]*return public\.get_candidate_autofill_profile_v088/);
  assert.match(sql,/for update/);
  assert.match(sql,/profile_review_status='needs_review'/);
});
