import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration=await readFile(new URL("../supabase/migrations/202609010110_v3_33_expanded_tailored_resume_templates.sql",import.meta.url),"utf8"),
  renderer=await readFile(new URL("../apps/api/src/platform/tailored-resume.renderer.ts",import.meta.url),"utf8"),
  dto=await readFile(new URL("../apps/api/src/platform/platform.dto.ts",import.meta.url),"utf8");
const keys=[
  "CLASSIC_V1","MODERN_V1","COMPACT_V1","EXECUTIVE_V1","TECHNICAL_V1","MINIMAL_V1",
  "CORPORATE_V1","ELEGANT_V1","SLATE_V1","EMERALD_V1","ACADEMIC_V1","IMPACT_V1",
];

test("v3.33 exposes twelve code-owned tailored Resume templates",()=>{
  for(const key of keys){assert.match(renderer,new RegExp(`key:\"${key}\"`));assert.match(migration,new RegExp(`'${key}'`));}
  assert.match(renderer,/TAILORED_RESUME_TEMPLATE_KEYS/);
  assert.match(dto,/@IsIn\(\[\.\.\.TAILORED_RESUME_TEMPLATE_KEYS\]\)/);
});

test("v3.33 expands both persistence constraints and the protected selector",()=>{
  assert.match(migration,/drop constraint if exists tailoring_jobs_render_template_check/);
  assert.match(migration,/add constraint tailoring_jobs_render_template_check/);
  assert.match(migration,/drop constraint if exists resumes_render_template_check/);
  assert.match(migration,/add constraint resumes_render_template_check/);
  assert.match(migration,/perform public\.assert_application_manager\(\)/);
  assert.match(migration,/status<>'APPROVED'/);
  assert.match(migration,/updated_at is distinct from p_expected_updated_at/);
  assert.match(migration,/grant execute on function public\.select_tailoring_template_v18\(uuid,text,timestamptz\) to authenticated/);
  assert.doesNotMatch(migration,/grant execute on function public\.select_tailoring_template_v18.*to anon/);
});
