import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const sql=(await readFile(new URL("../supabase/migrations/202607280023_v0_8_8_resume_autofill_metadata.sql",import.meta.url),"utf8")).toLowerCase();

test("v0.8.8 keeps the Resume as the only Candidate metadata record",()=>{
  assert.match(sql,/alter table public\.resumes/);
  for(const column of ["candidate_first_name","candidate_middle_name","candidate_last_name","address_line_1","address_city","linkedin_url","github_url","portfolio_url","profile_review_status","profile_reviewed_by","profile_reviewed_at"])assert.match(sql,new RegExp(`add column ${column}`));
  for(const table of ["candidate_profiles","candidate_addresses","candidate_employment_history","candidate_education","candidate_certifications","candidate_links"])assert.doesNotMatch(sql,new RegExp(`create table public\\.${table}`));
  assert.doesNotMatch(sql,/create table public\.candidates\b/);
});

test("structured Resume content is upgraded without reparsing or automatic verification",()=>{
  assert.match(sql,/structured_schema_version=greatest\(structured_schema_version,3\)/);
  assert.match(sql,/'education_legacy_text'/);
  assert.match(sql,/'education',[\s\S]*'\[\]'::jsonb/);
  assert.match(sql,/'certifications'/);
  assert.match(sql,/profile_review_status='needs_review',profile_reviewed_by=null,profile_reviewed_at=null/);
  assert.doesNotMatch(sql,/resume_text[\s\S]*(regexp|parse|extract)/);
});

test("Resume metadata APIs enforce manager writes and assigned-Applier reads",()=>{
  assert.match(sql,/candidate_resume_actor_can_view_v088/);
  assert.match(sql,/application_actor_can_manage\(\)/);
  assert.match(sql,/a\.resume_id=p_resume_id and a\.assigned_to=auth\.uid\(\)/);
  for(const fn of ["get_candidate_autofill_profile_v088","update_candidate_profile_v088","save_candidate_employment_v088","save_candidate_education_v088"])assert.match(sql,new RegExp(`grant execute on function public\\.${fn}`));
  assert.doesNotMatch(sql,/service_role/);
});

test("employment and education mutations edit the existing structured_content document",()=>{
  assert.match(sql,/jsonb_set[\s\S]*professional_experience/);
  assert.match(sql,/jsonb_set[\s\S]*education/);
  assert.match(sql,/candidate_employment_not_found/);
  assert.match(sql,/candidate_education_not_found/);
  assert.match(sql,/profile_review_status='needs_review'/);
  assert.match(sql,/'canautofill',[\s\S]*r\.profile_review_status='verified'/);
});
