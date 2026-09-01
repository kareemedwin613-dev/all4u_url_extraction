import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const sql=await readFile(new URL("../supabase/migrations/202608310110_v3_48_application_list_profile_resume_filters.sql",import.meta.url),"utf8");

test("list_applications_v07 filters by profile and resume name",()=>{
  assert.match(sql,/p_profile_name text default ''/);
  assert.match(sql,/p_resume_name text default ''/);
  assert.match(sql,/resumes\.candidate_name ilike/);
  assert.match(sql,/resumes\.resume_name ilike/);
  assert.match(sql,/grant execute on function public\.list_applications_v07/);
});
