-- Retire the broad shared-language subtype without deleting skills, applications,
-- or history. Keep recoverable copies of removed taxonomy assignments.
set local lock_timeout = '3s';
lock table public.job_descriptions,public.resumes,public.job_description_subcategories,
  public.resume_tech_stacks in share row exclusive mode;

alter table public.job_descriptions add column subcategory_match_required boolean not null default false;
comment on column public.job_descriptions.subcategory_match_required is
  'Retired-subtype JDs must retain a specific subtype match; removing their last tag must not enable primary-only matching.';

create table public.retired_taxonomy_assignments (
  category_id uuid not null references public.categories(id),
  source_table text not null,
  source_id uuid not null,
  previous_assignment jsonb not null,
  retired_at timestamptz not null default now(),
  primary key(category_id,source_table,source_id)
);
alter table public.retired_taxonomy_assignments enable row level security;
revoke all on public.retired_taxonomy_assignments from public,anon,authenticated;
grant select on public.retired_taxonomy_assignments to authenticated;
create policy retired_taxonomy_manager_read on public.retired_taxonomy_assignments
  for select to authenticated using(public.application_actor_can_manage());

do $$
declare retired uuid;
begin
  select c.id into retired from public.categories c join public.categories p on p.id=c.parent_id
    where c.slug='javascript-typescript-engineering' and p.slug='software-engineering' and p.parent_id is null;
  if retired is null then raise exception 'RETIRE_SUBTYPE_NOT_FOUND: Expected the Software Engineering JavaScript/TypeScript subtype.'; end if;

  insert into public.retired_taxonomy_assignments(category_id,source_table,source_id,previous_assignment)
    select retired,'job_description_subcategories',s.id,to_jsonb(s) from public.job_description_subcategories s where s.subcategory_id=retired;
  insert into public.retired_taxonomy_assignments(category_id,source_table,source_id,previous_assignment)
    select retired,'resume_tech_stacks',s.id,to_jsonb(s) from public.resume_tech_stacks s where s.subcategory_id=retired;
  insert into public.retired_taxonomy_assignments(category_id,source_table,source_id,previous_assignment)
    select retired,'job_descriptions',j.id,jsonb_build_object('category_id',j.category_id,'subcategory_id',j.subcategory_id)
    from public.job_descriptions j where j.subcategory_id=retired or exists(
      select 1 from public.job_description_subcategories s where s.job_description_id=j.id and s.subcategory_id=retired);
  insert into public.retired_taxonomy_assignments(category_id,source_table,source_id,previous_assignment)
    select retired,'resumes',r.id,jsonb_build_object('primary_category_id',r.primary_category_id,'subcategory_id',r.subcategory_id)
    from public.resumes r where r.subcategory_id=retired;

  update public.job_descriptions j set subcategory_match_required=true where j.subcategory_id=retired or exists(
    select 1 from public.job_description_subcategories s where s.job_description_id=j.id and s.subcategory_id=retired);

  -- Preserve a Resume's primary category when its only row used the retired tag.
  insert into public.resume_tech_stacks(resume_id,primary_category_id,subcategory_id,sort_order)
    select s.resume_id,s.primary_category_id,null,min(s.sort_order) from public.resume_tech_stacks s
    where s.subcategory_id=retired and not exists(select 1 from public.resume_tech_stacks other
      where other.resume_id=s.resume_id and other.primary_category_id=s.primary_category_id
        and other.subcategory_id is distinct from retired)
    group by s.resume_id,s.primary_category_id;

  delete from public.job_description_subcategories where subcategory_id=retired;
  delete from public.resume_tech_stacks where subcategory_id=retired;
  update public.job_descriptions j set subcategory_id=(select s.subcategory_id from public.job_description_subcategories s
    join public.categories c on c.id=s.subcategory_id and c.active and c.parent_id=j.category_id
    where s.job_description_id=j.id order by s.sort_order,s.id limit 1),updated_at=now()
    where j.subcategory_id=retired;
  update public.resumes r set subcategory_id=(select s.subcategory_id from public.resume_tech_stacks s
    join public.categories c on c.id=s.subcategory_id and c.active and c.parent_id=r.primary_category_id
    where s.resume_id=r.id and s.primary_category_id=r.primary_category_id order by s.sort_order,s.id limit 1),updated_at=now()
    where r.subcategory_id=retired;
  update public.categories set active=false,updated_at=now() where id=retired;
end $$;

-- Preserve the existing category gate's other behavior. Only change the fallback
-- for JDs touched by this retirement; new inserts and existing previews share it.
do $$
declare definition text:=pg_get_functiondef('public.application_category_candidate_v377(uuid,uuid)'::regprocedure);
begin
  if strpos(definition,'or j.subcategory_id is null or')=0 then
    raise exception 'RETIRE_MATCH_PATCH_CONFLICT: Review the installed category matching definition.';
  end if;
  execute replace(definition,'or j.subcategory_id is null or',
    'or (j.subcategory_id is null and not j.subcategory_match_required) or');
end $$;

-- Older bulk-preview callers may still use a primary-only helper. Apply the same
-- retirement gate for affected jobs, without changing unrelated jobs' behavior.
-- Preserve the installed helper's argument names, grants, and invoker/definer
-- security mode. Do not expose an alternate helper that bypasses retirement.
do $$
declare definition text; source text; language_name text; replacement text;
begin
  select pg_get_functiondef(p.oid),p.prosrc,l.lanname into definition,source,language_name
    from pg_proc p join pg_language l on l.oid=p.prolang
    where p.oid='public.resume_matches_job_for_bulk(uuid,uuid,uuid)'::regprocedure;
  if language_name<>'sql' or strpos(definition,source)=0 then
    raise exception 'RETIRE_MATCH_PATCH_CONFLICT: Review the installed bulk matching definition.';
  end if;
  replacement:='select ('||rtrim(source,E' ;\n\r\t')||$guard$) and not exists(
    select 1 from public.job_descriptions j where j.id=$3 and j.subcategory_match_required
      and (j.category_id is distinct from $2 or not exists(
        select 1 from public.resume_tech_stacks s join public.categories c
          on c.id=j.category_id and c.active and c.parent_id is null
        where s.resume_id=$1 and s.primary_category_id=c.id
          and (c.slug<>'software-engineering' or s.subcategory_id=j.subcategory_id)
      ))
  );$guard$;
  execute replace(definition,source,replacement);
end;
$$;
notify pgrst,'reload schema';
