import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const sql=(await readFile(new URL("../supabase/migrations/202607270019_v0_7_1_performance_scalability.sql",import.meta.url),"utf8")).toLowerCase();

test("RLS policies on high-row-count tables wrap constant-argument helper calls",()=>{
  for(const table of ["job_descriptions","resumes","tailoring_jobs"]){
    const marker=`on public.${table}`;
    assert.ok(sql.includes(marker),`policies exist for ${table}`);
  }
  assert.match(sql,/\(select public\.has_any_role\(array\['applier','applying_manager','admin'\]\)\)\)/);
  assert.match(sql,/\(select public\.has_role\('admin'\)\)/);
  assert.match(sql,/\(select public\.has_role\('applying_manager'\)\)/);
  assert.match(sql,/\(select public\.is_active_user\(auth\.uid\(\)\)\)/);
  assert.match(sql,/\(select public\.application_actor_can_manage\(\)\)/);
});

test("row-varying application_actor_can_view calls are documented as intentionally unrewritten",()=>{
  assert.match(sql,/deliberately not rewritten here/i);
  assert.doesNotMatch(sql,/\(select public\.application_actor_can_view/);
});

test("one new composite index is added and one confirmed-redundant index is dropped, with no duplicate indexes introduced",()=>{
  assert.match(sql,/create index if not exists idx_applications_assignee_queue on public\.applications \(assigned_to, work_status, updated_at desc, id desc\)/);
  assert.match(sql,/drop index if exists public\.user_roles_user_id_idx/);
});

test("full-text search columns are trigger-maintained (not a generated column) and GIN indexed",()=>{
  // A GENERATED ALWAYS AS ... STORED column requires Postgres to prove the whole expression is
  // IMMUTABLE; the resumes expression (array_to_string over skills) failed that check on a real
  // project with "generation expression is not immutable" (42P17). Both tables use a
  // BEFORE INSERT OR UPDATE trigger instead, which has no such restriction.
  assert.doesNotMatch(sql,/generated always as\s*\(/);
  assert.match(sql,/to_tsvector\('english',/);
  assert.match(sql,/using gin \(search_vector\)/);
  for(const table of ["job_descriptions","resumes"]){
    assert.match(sql,new RegExp(`alter table public\\.${table} add column if not exists search_vector`));
    assert.match(sql,new RegExp(`create or replace function public\\.${table}_search_vector_update`));
    assert.match(sql,new RegExp(`create trigger ${table}_search_vector_trigger`));
    assert.match(sql,new RegExp(`before insert or update of .* on public\\.${table}`));
  }
});

test("list_applications_v07 excludes notes and searches by full-text instead of ilike on company/title",()=>{
  const section=sql.slice(sql.indexOf("create or replace function public.list_applications_v07"),sql.indexOf("create or replace function public.list_applications_cursor"));
  assert.doesNotMatch(section,/a\.notes/);
  assert.match(section,/jobs\.search_vector @@ websearch_to_tsquery\('english',trim\(p_search\)\)/);
  assert.match(section,/screenshot_count/);
});

test("list_applications_cursor is a new function with a fixed deterministic order and a unique tie-breaker",()=>{
  const section=sql.slice(sql.indexOf("create or replace function public.list_applications_cursor"),sql.indexOf("create or replace function public.list_application_jobs"));
  assert.match(section,/order by updated_at desc, id desc/);
  assert.match(section,/p_cursor_updated_at is null or \(a\.updated_at,a\.id\) < \(p_cursor_updated_at,p_cursor_id\)/);
  assert.match(section,/hasmore/i);
  assert.match(section,/nextcursor/i);
});

test("get_business_overview is role-gated the same way as the shared jobs/resumes read policies",()=>{
  const section=sql.slice(sql.indexOf("create or replace function public.get_business_overview"));
  assert.match(section,/has_any_role\(array\['applier','applying_manager','admin'\]\)/);
  assert.match(section,/jobcounts/);
  assert.match(section,/resumecounts/);
  assert.match(section,/recentjobs/);
  assert.match(section,/recentresumes/);
});

test("new RPCs are authenticated-only and expose no privileged credentials",()=>{
  for(const signature of [
    "list_applications_cursor\\(text,uuid,text,text,text,text,uuid,text,uuid,text,timestamptz,uuid,integer\\)",
    "get_business_overview\\(\\)",
  ]){
    assert.match(sql,new RegExp(`revoke all on function public\\.${signature} from public,anon`));
    assert.match(sql,new RegExp(`grant execute on function public\\.${signature} to authenticated`));
  }
  assert.doesNotMatch(sql,/service[_-]role|supabase_service|secret key/);
});
