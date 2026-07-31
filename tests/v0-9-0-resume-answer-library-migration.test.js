import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const sql=await readFile(new URL("../supabase/migrations/202607290028_v0_9_0_resume_answer_library.sql",import.meta.url),"utf8");

test("v0.9.0 creates a Resume-owned, fixed-key answer library",()=>{
  assert.match(sql,/create table public\.resume_application_answers/i);
  assert.match(sql,/resume_id uuid not null references public\.resumes\(id\) on delete cascade/i);
  assert.match(sql,/unique\(resume_id,answer_key\)/i);
  for(const key of ["authorized_to_work","requires_sponsorship","willing_to_relocate","available_start_date","desired_salary","years_of_experience","remote_work_preference"])assert.match(sql,new RegExp(key));
  assert.match(sql,/resume_answer_prohibited_v090/);
  assert.match(sql,/race\|racial\|ethnicity/);
  assert.doesNotMatch(sql,/create table public\.(candidate|candidate_profile|candidate_link)/i);
});

test("v0.9.0 protects management and Application-scoped reads",()=>{
  assert.match(sql,/alter table public\.resume_application_answers enable row level security/i);
  assert.match(sql,/application_actor_can_manage\(\)/);
  assert.match(sql,/assert_application_manager\(\)/);
  assert.match(sql,/revoke all on table public\.resume_application_answers from public,anon,authenticated/i);
  assert.match(sql,/grant select on table public\.resume_application_answers to authenticated/i);
  assert.match(sql,/list_resume_application_answers_v090/);
  assert.match(sql,/save_resume_application_answer_v090/);
  assert.match(sql,/archive_resume_application_answer_v090/);
  assert.match(sql,/x\.active and x\.review_status='VERIFIED'/);
  assert.match(sql,/application_actor_can_view\(a\.assigned_to\)/);
  assert.doesNotMatch(sql,/service_role|secret key/i);
});
