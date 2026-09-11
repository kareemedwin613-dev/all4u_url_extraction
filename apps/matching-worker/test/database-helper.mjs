import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
export const USER = "10000000-0000-4000-8000-000000000001";
export const JD = "20000000-0000-4000-8000-000000000001";
export const RESUME = "30000000-0000-4000-8000-000000000001";
export const PRIMARY = "40000000-0000-4000-8000-000000000001";
export const PAIR = { job_description_id: JD, resume_id: RESUME };
const root = new URL("../../../", import.meta.url);
export async function database({ applyMatchingMigrations = true, applyRunnerMigration = false, applyRunnerIssuerFix = true, applyPrimaryCandidates = true, applyDirectScoring = false, applyMatchingChoice = false, applyScoreComparison = false } = {}) {
  const pg = await PGlite.create();
  await pg.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to anon,authenticated,service_role;
    select set_config('request.jwt.claim.sub','${USER}',false);
    create table public.profiles(id uuid primary key,full_name text default '',email text default '',status text not null default 'ACTIVE');
    insert into profiles(id) values('${USER}');
    create table public.roles(id uuid primary key default gen_random_uuid(),code text not null unique,active boolean not null default true);
    create table public.user_roles(user_id uuid references profiles(id),role_id uuid references roles(id),primary key(user_id,role_id));
    insert into roles(code) values('APPLYING_MANAGER'),('ADMIN'),('APPLIER');
    insert into user_roles select '${USER}'::uuid,id from roles where code='APPLYING_MANAGER';
    create table public.categories(id uuid primary key default gen_random_uuid(),name text,slug text,active boolean not null default true,parent_id uuid references categories(id));
    insert into categories(id,name) values('${PRIMARY}','Engineering');
    create table public.job_descriptions(id uuid primary key default gen_random_uuid(),company text default 'Example',job_title text default 'Engineer',
      description_text text default 'Build React interfaces and APIs',structured_content jsonb default '{}',detected_skills text[] default '{}',
      seniority text default 'SENIOR',status text default 'ACTIVE',review_status text default 'APPROVED',category_id uuid default '${PRIMARY}',subcategory_id uuid);
    create table public.resumes(id uuid primary key default gen_random_uuid(),resume_number integer default 1,resume_type text default 'ORIGINAL',parent_resume_id uuid references resumes(id),
      candidate_name text default 'Candidate',resume_name text default 'Original',status text default 'ACTIVE',primary_category_id uuid default '${PRIMARY}',subcategory_id uuid,
      structured_content jsonb default '{"summary":"React engineer","professional_experience":[{"job_title":"Engineer","experience_details":"Built React interfaces and APIs","start_date":{"year":2020}}]}',
      skills text[] default '{React}',file_sha256 text default 'source-file',resume_text text default 'Source text',seniority text default 'SENIOR',search_vector tsvector default ''::tsvector);
    create table public.resume_banned_companies(resume_id uuid references resumes(id),normalized_company text);
    create function public.normalize_company_name(text) returns text language sql immutable as $$ select lower(trim($1)) $$;
    create table public.applications(id uuid primary key default gen_random_uuid(),application_number integer generated always as identity,
      job_description_id uuid references job_descriptions(id),resume_id uuid references resumes(id),assigned_to uuid,assigned_by uuid,
      work_status text,application_status text,priority text,created_by uuid,due_at timestamptz,notes text,unique(job_description_id,resume_id));
    create table public.application_assignment_history(application_id uuid,previous_assignee_id uuid,new_assignee_id uuid,assigned_by uuid,reason text);
    create function public.assert_active_applier(uuid) returns void language plpgsql as $$ begin
      if $1 is not null then raise exception 'APPLICATION_INVALID_ASSIGNEE: Select an active Applier.'; end if; end $$;
    create function public.assert_applier_may_use_resume(uuid,uuid) returns void language plpgsql as $$ begin return; end $$;
    insert into job_descriptions(id) values('${JD}'); insert into resumes(id) values('${RESUME}');
  `);
  // Real many-primary Resume mapping, seed/validation triggers and category helpers.
  const stacks=await readFile(new URL('supabase/migrations/202609031235_v3_57_resume_tech_stacks.sql',root),'utf8');
  await pg.exec(stacks.slice(0,stacks.indexOf('create or replace function public.replace_resume_tech_stacks_v357(')));
  const categoryNames=await readFile(new URL('supabase/migrations/202609031315_v3_58_application_list_tech_stacks.sql',root),'utf8');
  await pg.exec(categoryNames.slice(0,categoryNames.indexOf('create or replace function public.list_applications_v07(')));
  // Use the real caller-bound access helpers. Anonymous ticket RPCs have no JWT
  // subject; a constant auth.uid() or permissive helper stub hides that boundary.
  const access=await readFile(new URL('supabase/migrations/202607220009_v0_5_users_basic_rbac.sql',root),'utf8');
  await pg.exec(access.slice(access.indexOf('create or replace function public.is_active_user('),access.indexOf('create or replace function public.get_my_access_context(')));
  await pg.exec(`
    revoke all on function public.is_active_user(uuid),public.has_role(text,uuid),public.has_any_role(text[],uuid) from public,anon;
    grant execute on function public.is_active_user(uuid),public.has_role(text,uuid),public.has_any_role(text[],uuid) to authenticated;
  `);
  const managers=await readFile(new URL('supabase/migrations/202607220010_v0_6_individual_applications.sql',root),'utf8');
  await pg.exec(managers.slice(managers.indexOf('create or replace function public.application_actor_can_manage('),managers.indexOf('create or replace function public.assert_active_applier(')));
  const profiles=await readFile(new URL("supabase/migrations/202608250073_v3_13_applier_resume_profiles.sql",root),"utf8");
  await pg.exec(profiles.slice(profiles.indexOf("create or replace function public.create_application("),profiles.indexOf("create or replace function public.reassign_application(")));
  const family=await readFile(new URL("supabase/migrations/202608030042_v1_6_tailored_resume_materialization.sql",root),"utf8");
  await pg.exec(family.slice(family.indexOf("create or replace function public.prevent_application_resume_family_duplicate_v16()"),family.indexOf("create or replace function public.begin_tailoring_materialization_v16(")));
  const variant=await readFile(new URL("supabase/migrations/202608030038_v1_1_resume_variants.sql",root),"utf8");
  await pg.exec(variant.slice(variant.indexOf("create or replace function public.validate_application_resume_variant()"),variant.indexOf("-- General duplicate detection")));
  const bulk = await readFile(new URL("supabase/migrations/202607240016_v0_7_bulk_application_creation.sql",root),"utf8");
  await pg.exec(bulk.slice(0,bulk.indexOf("create or replace function public.preview_bulk_applications")));
  if (applyMatchingMigrations) for (const name of ["202609101000_v3_70_application_matching.sql","202609101010_v3_71_application_matching_preview.sql","202609101020_v3_72_application_matching_create.sql"]) {
    const sql=await readFile(new URL(`supabase/migrations/${name}`,root),"utf8");
    await pg.transaction(tx=>tx.exec(sql));
  }
  // Use the actual existing API idempotency wrapper as well.
  const api=await readFile(new URL("supabase/migrations/202607270020_v0_7_4_bulk_backend_api.sql",root),"utf8");
  await pg.exec(api.slice(0,api.indexOf("create or replace function public.list_application_batches_v074")));
  if (applyMatchingMigrations) await pg.exec("update application_match_settings set model_id='test-model'");
  if (applyRunnerMigration) await pg.transaction(async tx => tx.exec(await readFile(new URL('supabase/migrations/202609101030_v3_73_application_matching_runner.sql',root),'utf8')));
  if (applyRunnerMigration && applyRunnerIssuerFix) await applyMatchingRunnerIssuerFix(pg);
  if (applyMatchingMigrations && applyPrimaryCandidates) await applyMatchingPrimaryCandidates(pg);
  if (applyDirectScoring) await applyMatchingDirectScoring(pg);
  if (applyMatchingChoice) await applyApplicationMatchingChoice(pg);
  if (applyScoreComparison) await pg.transaction(async tx => tx.exec(await readFile(new URL('supabase/migrations/202609111010_v3_78_application_score_comparison.sql',root),'utf8')));
  const rpc = async (name,args={},role="postgres") => {
    assertName(name);
    return pg.transaction(async tx => {
      await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[role==='anon'||role==='service_role'?'':USER]);
      if(role!=="postgres") await tx.exec(`set local role ${role}`);
      const values=Object.values(args), params=values.map((_,i)=>`$${i+1}`).join(",");
      return (await tx.query(`select public.${name}(${params}) as value`,values)).rows[0].value;
    });
  };
  return { pg, rpc };
}
export async function applyMatchingRunnerIssuerFix(pg) {
  const sql=await readFile(new URL('supabase/migrations/202609101040_v3_74_application_matching_runner_issuer.sql',root),'utf8');
  await pg.transaction(tx=>tx.exec(sql));
}
export async function applyMatchingPrimaryCandidates(pg) {
  const sql=await readFile(new URL('supabase/migrations/202609101050_v3_75_application_matching_primary_candidates.sql',root),'utf8');
  await pg.transaction(tx=>tx.exec(sql));
}
export async function applyMatchingDirectScoring(pg) {
  const sql=await readFile(new URL('supabase/migrations/202609101060_v3_76_application_matching_direct.sql',root),'utf8');
  await pg.transaction(tx=>tx.exec(sql));
}
export async function applyApplicationMatchingChoice(pg) {
  const sql=await readFile(new URL('supabase/migrations/202609111000_v3_77_application_matching_choice.sql',root),'utf8');
  await pg.transaction(tx=>tx.exec(sql));
}
function assertName(name) { if(!/^[a-z_][a-z0-9_]*$/.test(name)) throw Error("Invalid test RPC"); }
