import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const sql=(await readFile(new URL("../supabase/migrations/202607280023_v0_8_8_structured_candidate_profiles.sql",import.meta.url),"utf8")).toLowerCase();

test("v0.8.8 uses one Resume-scoped profile and does not create a separate candidates table",()=>{
  for(const table of ["candidate_profiles","candidate_addresses","candidate_employment_history","candidate_education","candidate_certifications","candidate_links"])assert.match(sql,new RegExp(`create table public\\.${table}`));
  assert.match(sql,/resume_id uuid not null unique references public\.resumes\(id\) on delete cascade/);
  assert.doesNotMatch(sql,/create table public\.candidates\b/);
  assert.match(sql,/insert into public\.candidate_profiles[\s\S]*from public\.resumes/);
  assert.match(sql,/resumes_create_candidate_profile_v088/);
  assert.match(sql,/candidate_partial_date_v088/);
  assert.match(sql,/jsonb_array_elements[\s\S]*professional_experience/);
  assert.match(sql,/'resume_imported'/);
});

test("Resume extraction seeds reviewable data but never verifies it automatically",()=>{
  assert.match(sql,/review_status text not null default 'needs_review'/);
  assert.match(sql,/values\(new\.id,new\.candidate_name[\s\S]*'needs_review'/);
  assert.match(sql,/'profileavailable',coalesce\(cp\.review_status='verified',false\)/);
  assert.match(sql,/'canautofill',[\s\S]*cp\.review_status='verified'/);
});

test("Candidate Profile tables use RLS and RPC-only manager writes",()=>{
  for(const table of ["candidate_profiles","candidate_addresses","candidate_employment_history","candidate_education","candidate_certifications","candidate_links"]){
    assert.match(sql,new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(sql,/candidate_profile_actor_can_view/);
  assert.match(sql,/application_actor_can_manage\(\)/);
  assert.match(sql,/a\.assigned_to = auth\.uid\(\)/);
  assert.match(sql,/revoke insert, update, delete on public\.candidate_profiles[\s\S]*from authenticated/);
  for(const fn of ["get_candidate_autofill_profile_v088","update_candidate_profile_v088","create_candidate_employment_v088","update_candidate_employment_v088","create_candidate_education_v088","update_candidate_education_v088"])assert.match(sql,new RegExp(`grant execute on function public\\.${fn}`));
  assert.match(sql,/grant execute on function public\.candidate_profile_actor_can_view\(uuid\) to authenticated/);
  assert.doesNotMatch(sql,/service_role/);
});

test("structured history has ordering, dates, combined details, constraints, and indexes",()=>{
  assert.match(sql,/experience_details text/);
  assert.match(sql,/start_date date/);
  assert.match(sql,/end_date date/);
  assert.match(sql,/candidate_employment_dates_check/);
  assert.match(sql,/candidate_education_dates_check/);
  assert.match(sql,/candidate_addresses_one_primary_idx/);
  assert.match(sql,/candidate_employment_profile_order_idx/);
});
