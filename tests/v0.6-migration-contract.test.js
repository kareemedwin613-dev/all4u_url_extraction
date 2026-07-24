import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const migration=new URL("../supabase/migrations/202607220010_v0_6_individual_applications.sql",import.meta.url);
const sql=(await readFile(migration,"utf8")).toLowerCase();

test("v0.6 migration defines required tables constraints and RLS",()=>{
  for(const table of ["applications","application_assignment_history","application_status_history"]){
    assert.match(sql,new RegExp("create table public\\."+table+"\\b"));
    assert.match(sql,new RegExp("alter table public\\."+table+" enable row level security"));
  }
  assert.match(sql,/unique \(job_description_id, resume_id\)/);
  for(const value of ["unassigned","assigned","in_progress","blocked","completed","cancelled","not_applied","interview_scheduled","offer_received","urgent"])assert.match(sql,new RegExp("'"+value+"'"));
});

test("v0.6 mutations are RPC-only and histories are protected",()=>{
  for(const fn of ["create_application","update_application_progress","reassign_application"])assert.match(sql,new RegExp("create or replace function public\\."+fn+"\\("));
  assert.match(sql,/revoke insert,update,delete on public\.applications,public\.application_assignment_history,public\.application_status_history from authenticated/);
  assert.doesNotMatch(sql,/create policy[^;]+applications[^;]+for (insert|update|delete)/);
  assert.match(sql,/application_status_history\(application_id,status_type,previous_status,new_status,changed_by,notes\)/);
});

test("v0.6 migration scopes reads and private Resume Storage",()=>{
  assert.match(sql,/create policy "role scoped read applications"/);
  assert.match(sql,/a\.assigned_to=auth\.uid\(\)/);
  assert.match(sql,/drop policy if exists "business roles read original resumes"/);
  assert.match(sql,/create policy "application scoped or manager read original resumes"/);
  assert.match(sql,/get_application_resume_file/);
});

test("v0.6 migration includes recommended operational indexes",()=>{
  for(const field of ["assigned_to","work_status","application_status","priority","due_at","created_at","updated_at"])assert.match(sql,new RegExp("applications_"+field.replace("_at","")+".* on public\\.applications \\("+field));
  assert.match(sql,/application_assignment_history_application_idx/);
  assert.match(sql,/application_status_history_application_idx/);
});
