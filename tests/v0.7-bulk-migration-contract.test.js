import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const migration=new URL("../supabase/migrations/202607240016_v0_7_bulk_application_creation.sql",import.meta.url);
const sql=(await readFile(migration,"utf8")).toLowerCase();

test("v0.7 migration defines auditable batch schema and individual compatibility",()=>{
  assert.match(sql,/create table public\.application_creation_batches/);
  assert.match(sql,/create table public\.application_creation_batch_results/);
  assert.match(sql,/add column creation_batch_id uuid references public\.application_creation_batches/);
  for(const status of ["processing","completed","completed_with_warnings","failed"])assert.match(sql,new RegExp(`'${status}'`));
  assert.match(sql,/creation_batch_id is 'null for individual v0\.6 applications/);
});

test("preview is authorized, deduplicated, limited, set-based, and read-only",()=>{
  const section=sql.slice(sql.indexOf("create or replace function public.preview_bulk_applications"),sql.indexOf("create or replace function public.create_applications_bulk"));
  assert.match(section,/perform public\.assert_application_manager\(\)/);
  assert.match(section,/select distinct id from unnest/);
  assert.match(section,/v_limit constant integer := 100/);
  assert.match(section,/resumes\.primary_category_id = loaded\.category_id and resumes\.status = 'active'/);
  assert.match(section,/existing_application/);
  assert.match(section,/missing_jd/);assert.match(section,/missing_category/);assert.match(section,/no_matching_active_resumes/);
  assert.doesNotMatch(section,/insert into|update public|delete from/);
});

test("bulk creation revalidates pairs and applies immutable defaults in one call",()=>{
  const section=sql.slice(sql.indexOf("create or replace function public.create_applications_bulk"),sql.indexOf("create or replace function public.list_application_batches"));
  assert.match(section,/perform public\.assert_application_manager\(\)/);
  assert.match(section,/v_raw_count > 2000/);
  assert.match(section,/resumes\.status <> 'active'/);
  assert.match(section,/resumes\.primary_category_id is null or resumes\.primary_category_id <> jobs\.category_id/);
  assert.match(section,/on conflict \(job_description_id, resume_id\) do nothing/);
  assert.match(section,/null, null, 'unassigned', 'not_applied', 'normal', v_actor, v_batch\.id/);
  assert.match(section,/completed_with_warnings/);
  assert.match(section,/application_creation_batch_results/);
});

test("new tables use RLS and direct mutation is RPC-only",()=>{
  for(const table of ["application_creation_batches","application_creation_batch_results"]){assert.match(sql,new RegExp(`alter table public\\.${table} enable row level security`));assert.match(sql,new RegExp(`revoke insert, update, delete on public\\.application_creation_batches, public\\.application_creation_batch_results from authenticated`));}
  for(const fn of ["preview_bulk_applications","create_applications_bulk","list_application_batches","list_application_batch_options","get_application_batch_detail","list_applications_v07"])assert.match(sql,new RegExp(`grant execute on function public\\.${fn}`));
  assert.match(sql,/application_actor_can_manage\(\)/);
  assert.doesNotMatch(sql,/service[_-]role|supabase_service|secret key/);
});

test("v0.7 includes batch, result, category, resume, and Application indexes",()=>{for(const name of ["applications_creation_batch_idx","application_creation_batches_created_at_idx","application_creation_batch_results_batch_idx","job_descriptions_bulk_category_idx","resumes_bulk_category_status_idx"])assert.match(sql,new RegExp(name));});
