import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const sql=(await readFile(new URL("../supabase/migrations/202607240017_bulk_assignment_and_table_sorting.sql",import.meta.url),"utf8")).toLowerCase();

test("bulk assignment is authorized, bounded, deduplicated, and validates an active Applier",()=>{
  const section=sql.slice(sql.indexOf("create or replace function public.bulk_assign_applications"),sql.indexOf("create or replace function public.list_application_batches_v2"));
  assert.match(section,/perform public\.assert_application_manager\(\)/);
  assert.match(section,/select distinct id from unnest/);
  assert.match(section,/v_limit constant integer := 500/);
  assert.match(section,/profiles\.status = 'active'/);
  assert.match(section,/roles\.code = 'applier' and roles\.active/);
});

test("bulk assignment uses one set-based update and writes automatic assignment history",()=>{
  const section=sql.slice(sql.indexOf("create or replace function public.bulk_assign_applications"),sql.indexOf("create or replace function public.list_application_batches_v2"));
  assert.match(section,/update public\.applications applications set/);
  assert.match(section,/insert into public\.application_assignment_history/);
  assert.match(section,/insert into public\.application_status_history/);
  assert.match(section,/assigned_by = v_actor/);
  assert.match(section,/when p_new_assignee_id is null then 'unassigned'/);
  assert.match(section,/when applications\.work_status = 'unassigned' then 'assigned'/);
  assert.match(section,/assigned_to is distinct from p_new_assignee_id/);
  assert.match(section,/changed\.work_status is distinct from updated\.work_status/);
  assert.match(section,/'missing'/);
  assert.match(section,/'unchanged'/);
});

test("paginated RPCs allowlist every displayed sort and remain role protected",()=>{
  assert.match(sql,/create or replace function public\.list_application_batches_v2/);
  assert.match(sql,/create or replace function public\.admin_list_users_v2/);
  assert.match(sql,/create or replace function public\.list_applications_v07/);
  assert.match(sql,/perform public\.assert_application_manager\(\)/);
  assert.match(sql,/perform public\.assert_active_admin\(\)/);
  for(const key of ["number","company","title","resume","candidate","assignee","link","work","application_status","priority","due","updated","created","captured","category","batch"]){
    assert.match(sql,new RegExp(`'${key}_asc'`));
    assert.match(sql,new RegExp(`'${key}_desc'`));
  }
});

test("new RPCs are authenticated-only and expose no privileged credentials",()=>{
  for(const signature of ["bulk_assign_applications\\(uuid\\[\\],uuid,text\\)","list_application_batches_v2\\(text,text,text,integer,integer\\)","admin_list_users_v2\\(text,text,text,text,integer,integer\\)"]){
    assert.match(sql,new RegExp(`revoke all on function public\\.${signature} from public,anon`));
    assert.match(sql,new RegExp(`grant execute on function public\\.${signature} to authenticated`));
  }
  assert.doesNotMatch(sql,/service[_-]role|supabase_service|secret key/);
});
