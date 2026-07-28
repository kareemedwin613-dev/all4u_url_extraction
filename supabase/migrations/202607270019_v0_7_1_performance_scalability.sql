-- v0.7.1: performance and scalability foundation. No business behavior changes.
--
-- Scope notes (read before touching this file again):
-- * RLS rewrite below only wraps helper-function calls whose arguments are CONSTANT for the
--   duration of a query (e.g. has_role('ADMIN'), application_actor_can_manage(), is_active_user(auth.uid())).
--   Wrapping those in `(select ...)` lets Postgres cache one evaluation (an InitPlan) instead of
--   re-running the function per row scanned — this is the documented Supabase/Postgres RLS
--   performance pattern. Policies that call `application_actor_can_view(<row-varying column>)`
--   (on applications, application_status_history, application_assignment_history,
--   application_screenshots) are DELIBERATELY NOT rewritten here: the argument differs per row,
--   so `(select ...)` wrapping provides no real caching benefit, and decomposing the function's
--   internal logic into a `(select ...)`-friendly form was considered and rejected — it cannot be
--   verified against a live database in this environment, and a subtly wrong decomposition of an
--   authorization check is a security bug, not a performance one. Left exactly as originally
--   authored.

-- ============================================================================
-- 1. RLS: wrap constant-argument helper calls so Postgres caches one evaluation per query.
-- ============================================================================

drop policy if exists "business roles read shared jobs" on public.job_descriptions;
drop policy if exists "managers and admins insert jobs" on public.job_descriptions;
drop policy if exists "managers own or admins update jobs" on public.job_descriptions;
drop policy if exists "managers own or admins delete jobs" on public.job_descriptions;
create policy "business roles read shared jobs" on public.job_descriptions
for select to authenticated using ((select public.has_any_role(array['APPLIER','APPLYING_MANAGER','ADMIN'])));
create policy "managers and admins insert jobs" on public.job_descriptions
for insert to authenticated with check (
  (select public.has_role('ADMIN')) or ((select public.has_role('APPLYING_MANAGER')) and (select auth.uid()) = user_id)
);
create policy "managers own or admins update jobs" on public.job_descriptions
for update to authenticated using (
  (select public.has_role('ADMIN')) or ((select public.has_role('APPLYING_MANAGER')) and (select auth.uid()) = user_id)
) with check (
  (select public.has_role('ADMIN')) or ((select public.has_role('APPLYING_MANAGER')) and (select auth.uid()) = user_id)
);
create policy "managers own or admins delete jobs" on public.job_descriptions
for delete to authenticated using (
  (select public.has_role('ADMIN')) or ((select public.has_role('APPLYING_MANAGER')) and (select auth.uid()) = user_id)
);

drop policy if exists "business roles read shared resumes" on public.resumes;
drop policy if exists "managers and admins insert resumes" on public.resumes;
drop policy if exists "managers own or admins update resumes" on public.resumes;
drop policy if exists "managers own or admins delete resumes" on public.resumes;
create policy "business roles read shared resumes" on public.resumes
for select to authenticated using ((select public.has_any_role(array['APPLIER','APPLYING_MANAGER','ADMIN'])));
create policy "managers and admins insert resumes" on public.resumes
for insert to authenticated with check (
  (select public.has_role('ADMIN')) or ((select public.has_role('APPLYING_MANAGER')) and (select auth.uid()) = user_id)
);
create policy "managers own or admins update resumes" on public.resumes
for update to authenticated using (
  (select public.has_role('ADMIN')) or ((select public.has_role('APPLYING_MANAGER')) and (select auth.uid()) = user_id)
) with check (
  (select public.has_role('ADMIN')) or ((select public.has_role('APPLYING_MANAGER')) and (select auth.uid()) = user_id)
);
create policy "managers own or admins delete resumes" on public.resumes
for delete to authenticated using (
  (select public.has_role('ADMIN')) or ((select public.has_role('APPLYING_MANAGER')) and (select auth.uid()) = user_id)
);

drop policy if exists "business roles read shared queue" on public.tailoring_jobs;
drop policy if exists "managers and admins insert queue" on public.tailoring_jobs;
drop policy if exists "managers own or admins update queue" on public.tailoring_jobs;
drop policy if exists "managers own or admins delete queue" on public.tailoring_jobs;
create policy "business roles read shared queue" on public.tailoring_jobs
for select to authenticated using ((select public.has_any_role(array['APPLIER','APPLYING_MANAGER','ADMIN'])));
create policy "managers and admins insert queue" on public.tailoring_jobs
for insert to authenticated with check (
  (select public.has_role('ADMIN')) or ((select public.has_role('APPLYING_MANAGER')) and (select auth.uid()) = user_id)
);
create policy "managers own or admins update queue" on public.tailoring_jobs
for update to authenticated using (
  (select public.has_role('ADMIN')) or ((select public.has_role('APPLYING_MANAGER')) and (select auth.uid()) = user_id)
) with check (
  (select public.has_role('ADMIN')) or ((select public.has_role('APPLYING_MANAGER')) and (select auth.uid()) = user_id)
);
create policy "managers own or admins delete queue" on public.tailoring_jobs
for delete to authenticated using (
  (select public.has_role('ADMIN')) or ((select public.has_role('APPLYING_MANAGER')) and (select auth.uid()) = user_id)
);

drop policy if exists "application scoped or manager read original resumes" on storage.objects;
create policy "application scoped or manager read original resumes" on storage.objects for select to authenticated
using (
  bucket_id='original-resumes' and (select public.is_active_user(auth.uid())) and (
    (select public.has_any_role(array['APPLYING_MANAGER','ADMIN'],auth.uid())) or
    ((select public.has_role('APPLIER',auth.uid())) and exists(
      select 1 from public.resumes r join public.applications a on a.resume_id=r.id
      where r.storage_bucket=bucket_id and r.storage_path=name and a.assigned_to=auth.uid()
    ))
  )
);
drop policy if exists "managers own or admins insert original resumes" on storage.objects;
create policy "managers own or admins insert original resumes" on storage.objects
for insert to authenticated with check (
  bucket_id = 'original-resumes'
  and ((select public.has_role('ADMIN')) or ((select public.has_role('APPLYING_MANAGER')) and (storage.foldername(name))[1] = (select auth.uid()::text)))
);
drop policy if exists "managers own or admins update original resumes" on storage.objects;
create policy "managers own or admins update original resumes" on storage.objects
for update to authenticated using (
  bucket_id = 'original-resumes'
  and ((select public.has_role('ADMIN')) or ((select public.has_role('APPLYING_MANAGER')) and (storage.foldername(name))[1] = (select auth.uid()::text)))
) with check (
  bucket_id = 'original-resumes'
  and ((select public.has_role('ADMIN')) or ((select public.has_role('APPLYING_MANAGER')) and (storage.foldername(name))[1] = (select auth.uid()::text)))
);
drop policy if exists "managers own or admins delete original resumes" on storage.objects;
create policy "managers own or admins delete original resumes" on storage.objects
for delete to authenticated using (
  bucket_id = 'original-resumes'
  and ((select public.has_role('ADMIN')) or ((select public.has_role('APPLYING_MANAGER')) and (storage.foldername(name))[1] = (select auth.uid()::text)))
);

drop policy if exists "application scoped read application screenshots" on storage.objects;
create policy "application scoped read application screenshots" on storage.objects for select to authenticated
using (
  bucket_id = 'application-screenshots' and (select public.is_active_user(auth.uid())) and (
    (select public.application_actor_can_manage()) or exists(
      select 1 from public.application_screenshots s join public.applications a on a.id = s.application_id
      where s.storage_bucket = bucket_id and s.storage_path = name and a.assigned_to = auth.uid()
    )
  )
);
drop policy if exists "assigned applier or manager insert application screenshots" on storage.objects;
create policy "assigned applier or manager insert application screenshots" on storage.objects for insert to authenticated
with check (
  bucket_id = 'application-screenshots' and (select public.is_active_user(auth.uid())) and (
    (select public.application_actor_can_manage()) or exists(
      select 1 from public.applications a where a.id::text = (storage.foldername(name))[1] and a.assigned_to = auth.uid()
    )
  )
);
drop policy if exists "assigned applier or manager delete application screenshots" on storage.objects;
create policy "assigned applier or manager delete application screenshots" on storage.objects for delete to authenticated
using (
  bucket_id = 'application-screenshots' and (select public.is_active_user(auth.uid())) and (
    (select public.application_actor_can_manage()) or exists(
      select 1 from public.applications a where a.id::text = (storage.foldername(name))[1] and a.assigned_to = auth.uid()
    )
  )
);

-- ============================================================================
-- 2. Indexes: one new composite matching the actual applier-queue query shape,
--    one confirmed-redundant index removed (PK (user_id, role_id) already covers user_id lookups).
-- ============================================================================

create index if not exists idx_applications_assignee_queue on public.applications (assigned_to, work_status, updated_at desc, id desc);

drop index if exists public.user_roles_user_id_idx;

-- ============================================================================
-- 3. Full-text search: tsvector columns + GIN indexes, maintained by a BEFORE INSERT OR UPDATE
--    trigger rather than GENERATED ALWAYS AS ... STORED. A generated column requires Postgres to
--    prove the whole expression is IMMUTABLE; on this project that check rejected the resumes
--    expression (array_to_string over the skills array) with "generation expression is not
--    immutable" (42P17) when first deployed. A trigger function has no such restriction - it can
--    call any function - so both tables use the trigger form here for one consistent, working
--    mechanism instead of two different ones. Additive only; existing ilike-based filters on
--    non-search fields (p_company, profiles email/name search) are unchanged.
-- ============================================================================

alter table public.job_descriptions add column if not exists search_vector tsvector;

create or replace function public.job_descriptions_search_vector_update()
returns trigger
language plpgsql
as $$
begin
  new.search_vector :=
    setweight(to_tsvector('english', coalesce(new.company,'')), 'A') ||
    setweight(to_tsvector('english', coalesce(new.job_title,'')), 'A') ||
    setweight(to_tsvector('english', coalesce(new.description_text,'')), 'B');
  return new;
end;
$$;

drop trigger if exists job_descriptions_search_vector_trigger on public.job_descriptions;
create trigger job_descriptions_search_vector_trigger
before insert or update of company, job_title, description_text on public.job_descriptions
for each row execute function public.job_descriptions_search_vector_update();

update public.job_descriptions set search_vector =
  setweight(to_tsvector('english', coalesce(company,'')), 'A') ||
  setweight(to_tsvector('english', coalesce(job_title,'')), 'A') ||
  setweight(to_tsvector('english', coalesce(description_text,'')), 'B')
where search_vector is null;

create index if not exists idx_job_descriptions_search on public.job_descriptions using gin (search_vector);

alter table public.resumes add column if not exists search_vector tsvector;

create or replace function public.resumes_search_vector_update()
returns trigger
language plpgsql
as $$
begin
  new.search_vector :=
    setweight(to_tsvector('english', coalesce(new.candidate_name,'')), 'A') ||
    setweight(to_tsvector('english', coalesce(new.resume_name,'')), 'A') ||
    setweight(to_tsvector('english', array_to_string(coalesce(new.skills, array[]::text[]), ' ')), 'B') ||
    setweight(to_tsvector('english', coalesce(new.resume_text,'')), 'C');
  return new;
end;
$$;

drop trigger if exists resumes_search_vector_trigger on public.resumes;
create trigger resumes_search_vector_trigger
before insert or update of candidate_name, resume_name, skills, resume_text on public.resumes
for each row execute function public.resumes_search_vector_update();

update public.resumes set search_vector =
  setweight(to_tsvector('english', coalesce(candidate_name,'')), 'A') ||
  setweight(to_tsvector('english', coalesce(resume_name,'')), 'A') ||
  setweight(to_tsvector('english', array_to_string(coalesce(skills, array[]::text[]), ' ')), 'B') ||
  setweight(to_tsvector('english', coalesce(resume_text,'')), 'C')
where search_vector is null;

create index if not exists idx_resumes_search on public.resumes using gin (search_vector);

revoke all on function public.job_descriptions_search_vector_update() from public,anon,authenticated;
revoke all on function public.resumes_search_vector_update() from public,anon,authenticated;

-- ============================================================================
-- 4. list_applications_v07: same signature, drops `notes` from the returned columns (no list view
--    anywhere reads it — confirmed via repo-wide grep; detail views use get_application_detail
--    separately) and switches the free-text search from ilike(company/job_title) to full-text
--    search against job_descriptions.search_vector (now also matches JD body text). The exact
--    application_number lookup and every other filter/sort/pagination behavior is unchanged.
-- ============================================================================

create or replace function public.list_applications_v07(
  p_search text default '', p_assigned_to uuid default null, p_work_status text default '',
  p_application_status text default '', p_priority text default '', p_company text default '',
  p_category_id uuid default null, p_due_filter text default '', p_sort text default 'updated_desc',
  p_creation_batch_id uuid default null, p_creation_mode text default '',
  p_limit integer default 25, p_offset integer default 0
)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp
as $$
declare v_manager boolean;v_limit integer;v_offset integer;v_items jsonb;v_total bigint;v_sort text:=lower(coalesce(p_sort,'updated_desc'));v_number_search text:=regexp_replace(upper(trim(coalesce(p_search,''))),'^(APP[- ]?|#)','');
begin
  v_manager:=public.application_actor_can_manage();
  if not v_manager and not(public.is_active_user(auth.uid()) and public.has_role('APPLIER',auth.uid())) then raise exception 'APPLICATION_ACCESS_DENIED: Application access is required.' using errcode='42501';end if;
  if coalesce(p_creation_mode,'')<>'' and upper(p_creation_mode) not in('BULK','INDIVIDUAL') then raise exception 'APPLICATION_INVALID_CREATION_MODE: Select a valid creation mode.' using errcode='22023';end if;
  if v_sort not in ('number_asc','number_desc','company_asc','company_desc','title_asc','title_desc','resume_asc','resume_desc','candidate_asc','candidate_desc','assignee_asc','assignee_desc','link_asc','link_desc','work_asc','work_desc','application_status_asc','application_status_desc','priority_asc','priority_desc','due_asc','due_desc','updated_asc','updated_desc','created_asc','created_desc','captured_asc','captured_desc','category_asc','category_desc','batch_asc','batch_desc') then raise exception 'APPLICATION_INVALID_SORT: Select a valid sort.' using errcode='22023';end if;
  v_limit:=least(greatest(coalesce(p_limit,25),1),100);v_offset:=greatest(coalesce(p_offset,0),0);
  with filtered as (
    select a.id,a.job_description_id,a.resume_id,a.assigned_to,a.assigned_by,a.work_status,a.application_status,a.priority,a.due_at,a.applied_at,a.application_url,a.created_by,a.created_at,a.updated_at,a.application_number,a.creation_batch_id,
      jobs.company,jobs.job_title,jobs.category_id,categories.name category_name,jobs.source_url,jobs.created_at captured_at,
      resumes.resume_name,resumes.candidate_name,coalesce(nullif(profiles.full_name,''),profiles.email) assignee_name,
      profiles.email assignee_email,batches.name creation_batch_name,
      (select count(*) from public.application_screenshots s where s.application_id=a.id)::integer screenshot_count
    from public.applications a join public.job_descriptions jobs on jobs.id=a.job_description_id join public.resumes resumes on resumes.id=a.resume_id
    left join public.categories categories on categories.id=jobs.category_id left join public.profiles profiles on profiles.id=a.assigned_to
    left join public.application_creation_batches batches on batches.id=a.creation_batch_id
    where (v_manager or a.assigned_to=auth.uid())
      and (not v_manager or p_assigned_to is null or(p_assigned_to='00000000-0000-4000-8000-000000000000'::uuid and a.assigned_to is null)or a.assigned_to=p_assigned_to)
      and(coalesce(trim(p_search),'')='' or jobs.search_vector @@ websearch_to_tsquery('english',trim(p_search)) or(v_number_search~'^[0-9]+$' and a.application_number::text=v_number_search))
      and(coalesce(trim(p_work_status),'')='' or a.work_status=upper(trim(p_work_status))) and(coalesce(trim(p_application_status),'')='' or a.application_status=upper(trim(p_application_status)))
      and(coalesce(trim(p_priority),'')='' or a.priority=upper(trim(p_priority))) and(coalesce(trim(p_company),'')='' or jobs.company ilike '%'||trim(p_company)||'%')
      and(p_category_id is null or jobs.category_id=p_category_id) and(p_creation_batch_id is null or a.creation_batch_id=p_creation_batch_id)
      and(coalesce(p_creation_mode,'')='' or(upper(p_creation_mode)='BULK' and a.creation_batch_id is not null)or(upper(p_creation_mode)='INDIVIDUAL' and a.creation_batch_id is null))
      and(coalesce(trim(p_due_filter),'')='' or(upper(trim(p_due_filter))='OVERDUE' and a.due_at<now() and a.work_status not in('COMPLETED','CANCELLED'))or(upper(trim(p_due_filter))='DUE_TODAY' and a.due_at>=date_trunc('day',now()) and a.due_at<date_trunc('day',now())+interval'1 day')or(upper(trim(p_due_filter))='NO_DUE_DATE' and a.due_at is null))
  ), counted as(select count(*) total from filtered), paged as(
    select * from filtered order by
      case when v_sort='number_asc' then application_number end asc,case when v_sort='number_desc' then application_number end desc,
      case when v_sort='company_asc' then company end asc,case when v_sort='company_desc' then company end desc,
      case when v_sort='title_asc' then job_title end asc,case when v_sort='title_desc' then job_title end desc,
      case when v_sort='resume_asc' then resume_name end asc,case when v_sort='resume_desc' then resume_name end desc,
      case when v_sort='candidate_asc' then candidate_name end asc,case when v_sort='candidate_desc' then candidate_name end desc,
      case when v_sort='assignee_asc' then assignee_name end asc nulls last,case when v_sort='assignee_desc' then assignee_name end desc nulls last,
      case when v_sort='link_asc' then coalesce(application_url,source_url) end asc nulls last,case when v_sort='link_desc' then coalesce(application_url,source_url) end desc nulls last,
      case when v_sort='work_asc' then work_status end asc,case when v_sort='work_desc' then work_status end desc,
      case when v_sort='application_status_asc' then application_status end asc,case when v_sort='application_status_desc' then application_status end desc,
      case when v_sort='priority_asc' then array_position(array['LOW','NORMAL','HIGH','URGENT'],priority) end asc,case when v_sort='priority_desc' then array_position(array['LOW','NORMAL','HIGH','URGENT'],priority) end desc,
      case when v_sort='due_asc' then due_at end asc nulls last,case when v_sort='due_desc' then due_at end desc nulls last,
      case when v_sort='updated_asc' then updated_at end asc,case when v_sort='updated_desc' then updated_at end desc,
      case when v_sort='created_asc' then created_at end asc,case when v_sort='created_desc' then created_at end desc,
      case when v_sort='captured_asc' then captured_at end asc,case when v_sort='captured_desc' then captured_at end desc,
      case when v_sort='category_asc' then category_name end asc,case when v_sort='category_desc' then category_name end desc,
      case when v_sort='batch_asc' then creation_batch_name end asc nulls last,case when v_sort='batch_desc' then creation_batch_name end desc nulls last,id
    limit v_limit offset v_offset)
  select coalesce((select jsonb_agg(to_jsonb(paged))from paged),'[]'::jsonb),coalesce((select total from counted),0) into v_items,v_total;
  return jsonb_build_object('items',v_items,'total',v_total,'limit',v_limit,'offset',v_offset);
end;
$$;

-- ============================================================================
-- 5. list_applications_cursor: new RPC, new capability only. Keyset pagination on
--    (updated_at desc, id desc) — the one fixed order keyset pagination requires. Same filters
--    and authorization as list_applications_v07 minus p_sort/p_offset. Fetches limit+1 rows to
--    compute hasMore without a separate count(*). list_applications_v07 and every existing caller
--    (including the extension) is completely untouched by this addition.
-- ============================================================================

create or replace function public.list_applications_cursor(
  p_search text default '', p_assigned_to uuid default null, p_work_status text default '',
  p_application_status text default '', p_priority text default '', p_company text default '',
  p_category_id uuid default null, p_due_filter text default '',
  p_creation_batch_id uuid default null, p_creation_mode text default '',
  p_cursor_updated_at timestamptz default null, p_cursor_id uuid default null,
  p_limit integer default 25
)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp
as $$
declare
  v_manager boolean; v_limit integer; v_items jsonb; v_has_more boolean; v_fetched integer;
  v_number_search text := regexp_replace(upper(trim(coalesce(p_search,''))),'^(APP[- ]?|#)','');
begin
  v_manager := public.application_actor_can_manage();
  if not v_manager and not(public.is_active_user(auth.uid()) and public.has_role('APPLIER',auth.uid())) then
    raise exception 'APPLICATION_ACCESS_DENIED: Application access is required.' using errcode='42501';
  end if;
  if coalesce(p_creation_mode,'')<>'' and upper(p_creation_mode) not in('BULK','INDIVIDUAL') then
    raise exception 'APPLICATION_INVALID_CREATION_MODE: Select a valid creation mode.' using errcode='22023';
  end if;
  if (p_cursor_updated_at is null) <> (p_cursor_id is null) then
    raise exception 'APPLICATION_INVALID_CURSOR: Provide both cursor fields or neither.' using errcode='22023';
  end if;
  v_limit := least(greatest(coalesce(p_limit,25),1),100);
  with filtered as (
    select a.id,a.job_description_id,a.resume_id,a.assigned_to,a.assigned_by,a.work_status,a.application_status,a.priority,a.due_at,a.applied_at,a.application_url,a.created_by,a.created_at,a.updated_at,a.application_number,a.creation_batch_id,
      jobs.company,jobs.job_title,jobs.category_id,categories.name category_name,jobs.source_url,jobs.created_at captured_at,
      resumes.resume_name,resumes.candidate_name,coalesce(nullif(profiles.full_name,''),profiles.email) assignee_name,
      profiles.email assignee_email,batches.name creation_batch_name,
      (select count(*) from public.application_screenshots s where s.application_id=a.id)::integer screenshot_count
    from public.applications a join public.job_descriptions jobs on jobs.id=a.job_description_id join public.resumes resumes on resumes.id=a.resume_id
    left join public.categories categories on categories.id=jobs.category_id left join public.profiles profiles on profiles.id=a.assigned_to
    left join public.application_creation_batches batches on batches.id=a.creation_batch_id
    where (v_manager or a.assigned_to=auth.uid())
      and (not v_manager or p_assigned_to is null or(p_assigned_to='00000000-0000-4000-8000-000000000000'::uuid and a.assigned_to is null)or a.assigned_to=p_assigned_to)
      and(coalesce(trim(p_search),'')='' or jobs.search_vector @@ websearch_to_tsquery('english',trim(p_search)) or(v_number_search~'^[0-9]+$' and a.application_number::text=v_number_search))
      and(coalesce(trim(p_work_status),'')='' or a.work_status=upper(trim(p_work_status))) and(coalesce(trim(p_application_status),'')='' or a.application_status=upper(trim(p_application_status)))
      and(coalesce(trim(p_priority),'')='' or a.priority=upper(trim(p_priority))) and(coalesce(trim(p_company),'')='' or jobs.company ilike '%'||trim(p_company)||'%')
      and(p_category_id is null or jobs.category_id=p_category_id) and(p_creation_batch_id is null or a.creation_batch_id=p_creation_batch_id)
      and(coalesce(p_creation_mode,'')='' or(upper(p_creation_mode)='BULK' and a.creation_batch_id is not null)or(upper(p_creation_mode)='INDIVIDUAL' and a.creation_batch_id is null))
      and(coalesce(trim(p_due_filter),'')='' or(upper(trim(p_due_filter))='OVERDUE' and a.due_at<now() and a.work_status not in('COMPLETED','CANCELLED'))or(upper(trim(p_due_filter))='DUE_TODAY' and a.due_at>=date_trunc('day',now()) and a.due_at<date_trunc('day',now())+interval'1 day')or(upper(trim(p_due_filter))='NO_DUE_DATE' and a.due_at is null))
      and (p_cursor_updated_at is null or (a.updated_at,a.id) < (p_cursor_updated_at,p_cursor_id))
  ), paged as (
    select * from filtered order by updated_at desc, id desc limit v_limit + 1
  ), trimmed as (
    select * from paged order by updated_at desc, id desc limit v_limit
  )
  select coalesce((select count(*) from paged),0), coalesce((select jsonb_agg(to_jsonb(trimmed) order by trimmed.updated_at desc, trimmed.id desc) from trimmed),'[]'::jsonb)
  into v_fetched, v_items;

  v_has_more := v_fetched > v_limit;
  return jsonb_build_object(
    'items', v_items,
    'hasMore', v_has_more,
    'nextCursor', case when v_has_more and jsonb_array_length(v_items) > 0 then
      jsonb_build_object('updatedAt', v_items->(jsonb_array_length(v_items)-1)->>'updated_at', 'id', v_items->(jsonb_array_length(v_items)-1)->>'id')
    else null end
  );
end;
$$;

-- ============================================================================
-- 6. list_application_jobs / list_application_resumes: same signature, ilike -> full-text search
--    against the same search_vector columns from section 3 (picker dropdowns used when creating
--    an individual Application). Everything else unchanged.
-- ============================================================================

create or replace function public.list_application_jobs(p_search text default '', p_limit integer default 100)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare v_result jsonb;
begin
  perform public.assert_application_manager();
  select coalesce(jsonb_agg(to_jsonb(x) order by x.company,x.job_title), '[]'::jsonb) into v_result
  from (
    select j.id,j.company,j.job_title,j.category_id,j.status
    from public.job_descriptions j
    where (coalesce(trim(p_search),'')='' or j.search_vector @@ websearch_to_tsquery('english',trim(p_search)))
    order by j.company,j.job_title limit least(greatest(coalesce(p_limit,100),1),200)
  ) x;
  return v_result;
end;
$$;

create or replace function public.list_application_resumes(p_job_description_id uuid, p_search text default '', p_limit integer default 100)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare v_category uuid; v_result jsonb;
begin
  perform public.assert_application_manager();
  select category_id into v_category from public.job_descriptions where id=p_job_description_id;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.same_category desc,x.candidate_name,x.resume_name), '[]'::jsonb) into v_result
  from (
    select r.id,r.candidate_name,r.resume_name,r.primary_category_id,r.seniority,
      (r.primary_category_id=v_category) same_category
    from public.resumes r
    where r.status='ACTIVE' and (
      coalesce(trim(p_search),'')='' or r.search_vector @@ websearch_to_tsquery('english',trim(p_search))
    )
    order by (r.primary_category_id=v_category) desc,r.candidate_name,r.resume_name
    limit least(greatest(coalesce(p_limit,100),1),200)
  ) x;
  return v_result;
end;
$$;

-- ============================================================================
-- 7. get_business_overview: new RPC. Consolidates BusinessOverview's 6 current requests
--    (job count x2, resume count x2, recent jobs, recent resumes) into 1. Same role scope as the
--    existing "business roles read shared jobs/resumes" policies (Applier, Applying Manager, Admin);
--    same unscoped (business-wide, not per-user) counts the direct table reads return today.
-- ============================================================================

create or replace function public.get_business_overview()
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare v_result jsonb;
begin
  if not public.has_any_role(array['APPLIER','APPLYING_MANAGER','ADMIN']) then
    raise exception 'BUSINESS_ACCESS_DENIED: Business data access is required.' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'jobCounts', jsonb_build_object(
      'total', (select count(*) from public.job_descriptions),
      'active', (select count(*) from public.job_descriptions where status = 'ACTIVE')
    ),
    'resumeCounts', jsonb_build_object(
      'total', (select count(*) from public.resumes),
      'active', (select count(*) from public.resumes where status = 'ACTIVE')
    ),
    'recentJobs', (
      select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
        select j.id, j.company, j.job_title, j.category_id, j.status, j.created_at,
          jsonb_build_object('display_name', up.display_name, 'email', up.email) captured_by
        from public.job_descriptions j
        left join public.user_profiles up on up.id = j.user_id
        order by j.created_at desc limit 5
      ) x
    ),
    'recentResumes', (
      select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
        select id, candidate_name, resume_name, primary_category_id, status, updated_at
        from public.resumes order by created_at desc limit 5
      ) x
    )
  ) into v_result;
  return v_result;
end;
$$;

-- ============================================================================
-- 8. Grants
-- ============================================================================

revoke all on function public.list_applications_v07(text,uuid,text,text,text,text,uuid,text,text,uuid,text,integer,integer) from public,anon;
revoke all on function public.list_applications_cursor(text,uuid,text,text,text,text,uuid,text,uuid,text,timestamptz,uuid,integer) from public,anon;
revoke all on function public.list_application_jobs(text,integer) from public,anon;
revoke all on function public.list_application_resumes(uuid,text,integer) from public,anon;
revoke all on function public.get_business_overview() from public,anon;

grant execute on function public.list_applications_v07(text,uuid,text,text,text,text,uuid,text,text,uuid,text,integer,integer) to authenticated;
grant execute on function public.list_applications_cursor(text,uuid,text,text,text,text,uuid,text,uuid,text,timestamptz,uuid,integer) to authenticated;
grant execute on function public.list_application_jobs(text,integer) to authenticated;
grant execute on function public.list_application_resumes(uuid,text,integer) to authenticated;
grant execute on function public.get_business_overview() to authenticated;
