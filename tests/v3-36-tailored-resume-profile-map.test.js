import assert from"node:assert/strict";
import{readFileSync}from"node:fs";
import test from"node:test";

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),"utf8");
const migration=read("supabase/migrations/202609010113_v3_36_tailored_resume_profile_map.sql");

test("Profile Map resolves tailored children to their original Resume",()=>{
  assert.match(migration,/resume_profile_root_id_v336/);
  assert.match(migration,/coalesce\(r\.parent_resume_id, r\.id\)/);
  assert.match(migration,/v_profile_resume uuid := public\.resume_profile_root_id_v336\(p_resume\)/);
  assert.match(migration,/m\.resume_id = v_profile_resume/);
});

test("PROFILE assignment preview and commit share canonical profile identity",()=>{
  assert.match(migration,/m\.resume_id = public\.resume_profile_root_id_v336\(v_app\.resume_id\)/);
  assert.match(migration,/create or replace function public\.applier_resume_allowlist_code/);
  assert.match(migration,/create or replace function public\.preview_bulk_assignment_v08/);
  const commit=read("supabase/migrations/202608260078_v3_18_profile_assign_ignore_capacity.sql");
  assert.match(commit,/applier_resume_allowlist_code\(v_request\.assigned_to, v_app\.resume_id\)/);
});

test("reading a tailored Resume returns its original Profile Map owner",()=>{
  assert.match(migration,/v_profile_resume := public\.resume_profile_root_id_v336\(p_resume_id\)/);
  assert.match(migration,/where m\.resume_id = v_profile_resume/);
  assert.match(migration,/ORIGINAL Resume and every TAILORED child share one Profile Map identity/);
});
