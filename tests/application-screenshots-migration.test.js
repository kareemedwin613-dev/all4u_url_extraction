import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const sql=(await readFile(new URL("../supabase/migrations/202607260018_application_screenshots.sql",import.meta.url),"utf8")).toLowerCase();

test("application_screenshots table is RLS protected with read-only table grants",()=>{
  assert.match(sql,/create table public\.application_screenshots/);
  assert.match(sql,/alter table public\.application_screenshots enable row level security/);
  assert.match(sql,/revoke insert, update, delete on public\.application_screenshots from authenticated/);
  assert.match(sql,/grant select on public\.application_screenshots to authenticated/);
  assert.match(sql,/mime_type in \('image\/png','image\/jpeg','image\/webp','application\/pdf'\)/);
  assert.match(sql,/file_size_bytes between 1 and 5242880/);
});

test("application-screenshots storage bucket is private with a matching size and mime allowlist",()=>{
  assert.match(sql,/insert into storage\.buckets\(id, name, public, file_size_limit, allowed_mime_types\)/);
  assert.match(sql,/values \('application-screenshots', 'application-screenshots', false, 5242880,/);
  assert.match(sql,/array\['image\/png','image\/jpeg','image\/webp','application\/pdf'\]/);
});

test("attach and remove RPCs authorize the manager or the assigned active Applier",()=>{
  const section=sql.slice(sql.indexOf("create or replace function public.attach_application_screenshot"),sql.indexOf("create or replace function public.update_application_progress"));
  assert.match(section,/public\.application_actor_can_manage\(\)/);
  assert.match(section,/v_application\.assigned_to = v_actor and public\.is_active_user\(v_actor\) and public\.has_role\('applier', v_actor\)/);
  assert.match(section,/create or replace function public\.remove_application_screenshot/);
});

test("marking Applied as an Applier requires an existing URL and at least one screenshot",()=>{
  const section=sql.slice(sql.indexOf("create or replace function public.update_application_progress"),sql.indexOf("create or replace function public.list_applications_v07"));
  assert.match(section,/not v_manager and v_application_status = 'applied' and v_current\.application_status is distinct from v_application_status/);
  assert.match(section,/application_applied_requires_url/);
  assert.match(section,/application_applied_requires_screenshot/);
  assert.match(section,/not exists \(select 1 from public\.application_screenshots where application_id = p_application_id\)/);
});

test("list_applications_v07 additively reports a screenshot_count without changing its signature",()=>{
  assert.match(sql,/create or replace function public\.list_applications_v07\(\s*p_search text default '', p_assigned_to uuid default null/);
  assert.match(sql,/\(select count\(\*\) from public\.application_screenshots s where s\.application_id=a\.id\)::integer screenshot_count/);
});

test("new RPCs are authenticated-only and expose no privileged credentials",()=>{
  for(const signature of ["attach_application_screenshot\\(uuid,text,text,text,bigint\\)","remove_application_screenshot\\(uuid\\)"]){
    assert.match(sql,new RegExp(`revoke all on function public\\.${signature} from public,anon`));
    assert.match(sql,new RegExp(`grant execute on function public\\.${signature} to authenticated`));
  }
  assert.doesNotMatch(sql,/service[_-]role|supabase_service|secret key/);
});
