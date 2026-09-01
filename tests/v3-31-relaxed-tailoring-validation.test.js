import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration=await readFile(new URL("../supabase/migrations/202608310108_v3_31_minimal_tailoring_validation.sql",import.meta.url),"utf8");

test("v3.31 validates only source role identity and order so source dates are reused",()=>{
  assert.match(migration,/create or replace function public\.assert_tailoring_preview_v14/);
  assert.match(migration,/full join jsonb_array_elements\(p_preview->'professionalExperience'\) with ordinality/);
  assert.match(migration,/sourceExperienceId/);
  assert.match(migration,/original dates can be reused/);
  assert.doesNotMatch(migration,/Tailored skills must exist on the source Resume/);
  assert.doesNotMatch(migration,/count\(distinct lower\(value\)\)/);
  assert.doesNotMatch(migration,/p_preview->'skills'|p_preview->'summary'|bullet|outcome|action verb|JD skills/i);
});

test("v3.31 routes legacy authenticated submission through the shared relaxed validator",()=>{
  assert.match(migration,/create or replace function public\.submit_tailoring_preview_v13/);
  assert.match(migration,/perform public\.assert_tailoring_preview_v14\(v_job\.resume_id,p_preview\)/);
});
