-- v0.7: reviewed, set-based bulk Application creation and auditable batches.
-- Existing individual Applications remain unchanged with creation_batch_id null.

create table public.application_creation_batches (
  id uuid primary key default gen_random_uuid(),
  name text check (name is null or char_length(name) between 1 and 120),
  selected_jd_count integer not null default 0 check (selected_jd_count >= 0),
  requested_combination_count integer not null default 0 check (requested_combination_count >= 0),
  created_application_count integer not null default 0 check (created_application_count >= 0),
  duplicate_count integer not null default 0 check (duplicate_count >= 0),
  skipped_count integer not null default 0 check (skipped_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  status text not null default 'PROCESSING'
    check (status in ('PROCESSING','COMPLETED','COMPLETED_WITH_WARNINGS','FAILED')),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  check (
    (status = 'PROCESSING' and completed_at is null)
    or (status <> 'PROCESSING' and completed_at is not null)
  )
);

alter table public.applications
  add column creation_batch_id uuid references public.application_creation_batches(id) on delete set null;

create table public.application_creation_batch_results (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.application_creation_batches(id) on delete cascade,
  pair_key text not null,
  requested_job_description_id text,
  requested_resume_id text,
  job_description_id uuid references public.job_descriptions(id) on delete set null,
  resume_id uuid references public.resumes(id) on delete set null,
  application_id uuid references public.applications(id) on delete set null,
  company text,
  job_title text,
  candidate_name text,
  resume_name text,
  outcome text not null check (outcome in ('CREATED','DUPLICATE','SKIPPED','FAILED')),
  code text,
  message text,
  created_at timestamptz not null default now(),
  constraint application_creation_batch_results_pair_key unique (batch_id, pair_key)
);

create index applications_creation_batch_idx on public.applications (creation_batch_id);
create index application_creation_batches_created_by_idx on public.application_creation_batches (created_by);
create index application_creation_batches_created_at_idx on public.application_creation_batches (created_at desc);
create index application_creation_batches_status_idx on public.application_creation_batches (status);
create index application_creation_batch_results_batch_idx on public.application_creation_batch_results (batch_id, created_at);
create index application_creation_batch_results_application_idx on public.application_creation_batch_results (application_id) where application_id is not null;
create index job_descriptions_bulk_category_idx on public.job_descriptions (category_id);
create index resumes_bulk_category_status_idx on public.resumes (primary_category_id, status);

comment on table public.application_creation_batches is 'Audit summary for one reviewed v0.7 bulk Application creation request.';
comment on table public.application_creation_batch_results is 'Per-pair outcomes retained for bulk creation review and interruption recovery.';
comment on column public.applications.creation_batch_id is 'Null for individual v0.6 Applications; set for Applications created by a v0.7 bulk batch.';

alter table public.application_creation_batches enable row level security;
alter table public.application_creation_batch_results enable row level security;

create policy "application managers read creation batches"
on public.application_creation_batches for select to authenticated
using (public.application_actor_can_manage());

create policy "application managers read creation batch results"
on public.application_creation_batch_results for select to authenticated
using (public.application_actor_can_manage());

revoke all on public.application_creation_batches, public.application_creation_batch_results from anon;
revoke insert, update, delete on public.application_creation_batches, public.application_creation_batch_results from authenticated;
grant select on public.application_creation_batches, public.application_creation_batch_results to authenticated;

create or replace function public.preview_bulk_applications(p_selected_jd_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids uuid[];
  v_limit constant integer := 100;
  v_result jsonb;
begin
  perform public.assert_application_manager();

  select coalesce(array_agg(id order by id), array[]::uuid[])
  into v_ids
  from (select distinct id from unnest(coalesce(p_selected_jd_ids, array[]::uuid[])) as ids(id) where id is not null) deduplicated;

  if cardinality(v_ids) = 0 then
    raise exception 'BULK_NO_JDS: Select at least one job description.' using errcode = '22023';
  end if;
  if cardinality(v_ids) > v_limit then
    raise exception 'BULK_JD_LIMIT: You can select up to 100 job descriptions in one bulk operation.' using errcode = '22023';
  end if;

  with requested as (
    select id from unnest(v_ids) as requested_ids(id)
  ), loaded as (
    select requested.id as requested_id, jobs.id, jobs.company, jobs.job_title, jobs.category_id,
      categories.name as category_name
    from requested
    left join public.job_descriptions jobs on jobs.id = requested.id
    left join public.categories categories on categories.id = jobs.category_id and categories.active
  ), combinations as (
    select concat(loaded.id, ':', resumes.id) as key,
      loaded.id as job_description_id, resumes.id as resume_id,
      loaded.company, loaded.job_title,
      loaded.category_id as job_category_id, loaded.category_name as job_category_name,
      resumes.candidate_name, resumes.resume_name,
      resumes.primary_category_id as resume_category_id,
      resume_categories.name as resume_category_name,
      applications.id as existing_application_id,
      applications.id is null as eligible,
      case when applications.id is not null then 'EXISTING_APPLICATION' end as exclusion_code,
      case when applications.id is not null then 'Application already exists' end as exclusion_reason
    from loaded
    join public.resumes resumes
      on resumes.primary_category_id = loaded.category_id and resumes.status = 'ACTIVE'
    left join public.categories resume_categories on resume_categories.id = resumes.primary_category_id
    left join public.applications applications
      on applications.job_description_id = loaded.id and applications.resume_id = resumes.id
    where loaded.id is not null and loaded.category_id is not null and loaded.category_name is not null
  ), invalid_jds as (
    select loaded.requested_id as job_description_id,
      coalesce(loaded.company, 'Unavailable job description') as company,
      coalesce(loaded.job_title, 'Unavailable') as job_title,
      case
        when loaded.id is null then 'MISSING_JD'
        when loaded.category_id is null or loaded.category_name is null then 'MISSING_CATEGORY'
        else 'NO_MATCHING_ACTIVE_RESUMES'
      end as code,
      case
        when loaded.id is null then 'The job description does not exist or is unavailable.'
        when loaded.category_id is null or loaded.category_name is null then 'The job description has no valid primary category.'
        else 'No active Resumes have the same primary category.'
      end as reason
    from loaded
    where loaded.id is null
      or loaded.category_id is null
      or loaded.category_name is null
      or not exists (select 1 from combinations where combinations.job_description_id = loaded.id)
  )
  select jsonb_build_object(
    'selectedJdCount', cardinality(v_ids),
    'validJdCount', cardinality(v_ids) - (select count(*) from invalid_jds),
    'invalidJdCount', (select count(*) from invalid_jds),
    'activeResumeCount', (select count(distinct resume_id) from combinations),
    'proposedCount', (select count(*) from combinations),
    'eligibleCount', (select count(*) from combinations where eligible),
    'duplicateCount', (select count(*) from combinations where not eligible),
    'excludedCount', (select count(*) from combinations where not eligible) + (select count(*) from invalid_jds),
    'combinations', coalesce((select jsonb_agg(jsonb_build_object(
      'key', key,
      'jobDescriptionId', job_description_id,
      'resumeId', resume_id,
      'company', company,
      'jobTitle', job_title,
      'jobCategoryId', job_category_id,
      'jobCategoryName', job_category_name,
      'candidateName', candidate_name,
      'resumeName', resume_name,
      'resumeCategoryId', resume_category_id,
      'resumeCategoryName', resume_category_name,
      'eligible', eligible,
      'existingApplicationId', existing_application_id,
      'exclusionCode', exclusion_code,
      'exclusionReason', exclusion_reason
    ) order by company, job_title, candidate_name, resume_name) from combinations), '[]'::jsonb),
    'invalidJds', coalesce((select jsonb_agg(jsonb_build_object(
      'jobDescriptionId', job_description_id,
      'company', company,
      'jobTitle', job_title,
      'code', code,
      'reason', reason
    ) order by company, job_title) from invalid_jds), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.create_applications_bulk(
  p_combinations jsonb,
  p_batch_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_batch public.application_creation_batches;
  v_name text := nullif(btrim(coalesce(p_batch_name, '')), '');
  v_raw_count integer;
  v_created integer;
  v_duplicates integer;
  v_skipped integer;
  v_failed integer;
  v_requested integer;
  v_selected_jds integer;
  v_status text;
  v_results jsonb;
  v_uuid_pattern constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  perform public.assert_application_manager();

  if p_combinations is null or jsonb_typeof(p_combinations) <> 'array' then
    raise exception 'BULK_INVALID_REQUEST: Application combinations must be an array.' using errcode = '22023';
  end if;
  v_raw_count := jsonb_array_length(p_combinations);
  if v_raw_count = 0 then
    raise exception 'BULK_NO_COMBINATIONS: Select at least one eligible combination.' using errcode = '22023';
  end if;
  if v_raw_count > 2000 then
    raise exception 'BULK_COMBINATION_LIMIT: You can create up to 2,000 Applications in one bulk operation.' using errcode = '22023';
  end if;
  if v_name is not null and char_length(v_name) > 120 then
    raise exception 'BULK_BATCH_NAME_INVALID: Batch name cannot exceed 120 characters.' using errcode = '22023';
  end if;
  v_name := coalesce(v_name, 'Bulk Applications — ' || to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC');

  insert into public.application_creation_batches(name, created_by)
  values(v_name, v_actor)
  returning * into v_batch;

  begin
    with raw as (
      select value, ordinality
      from jsonb_array_elements(p_combinations) with ordinality as input(value, ordinality)
    ), parsed as (
      select ordinality,
        value ->> 'job_description_id' as job_text,
        value ->> 'resume_id' as resume_text,
        case when coalesce(value ->> 'job_description_id', '') ~* v_uuid_pattern then (value ->> 'job_description_id')::uuid end as job_id,
        case when coalesce(value ->> 'resume_id', '') ~* v_uuid_pattern then (value ->> 'resume_id')::uuid end as resume_id
      from raw
    ), deduplicated as (
      select distinct on (coalesce(job_text, ''), coalesce(resume_text, '')) *
      from parsed
      order by coalesce(job_text, ''), coalesce(resume_text, ''), ordinality
    ), validated as (
      select deduplicated.*,
        jobs.id as actual_job_id, resumes.id as actual_resume_id,
        jobs.company, jobs.job_title, jobs.category_id as job_category_id,
        resumes.candidate_name, resumes.resume_name, resumes.primary_category_id as resume_category_id,
        resumes.status as resume_status,
        existing.id as existing_application_id,
        case
          when deduplicated.job_id is null or deduplicated.resume_id is null then 'INVALID_IDENTIFIER'
          when jobs.id is null then 'MISSING_JD'
          when resumes.id is null then 'MISSING_RESUME'
          when jobs.category_id is null then 'MISSING_CATEGORY'
          when resumes.status <> 'ACTIVE' then 'INACTIVE_RESUME'
          when resumes.primary_category_id is null or resumes.primary_category_id <> jobs.category_id then 'CATEGORY_MISMATCH'
          when existing.id is not null then 'EXISTING_APPLICATION'
        end as exclusion_code
      from deduplicated
      left join public.job_descriptions jobs on jobs.id = deduplicated.job_id
      left join public.resumes resumes on resumes.id = deduplicated.resume_id
      left join public.applications existing
        on existing.job_description_id = deduplicated.job_id and existing.resume_id = deduplicated.resume_id
    ), created as (
      insert into public.applications(
        job_description_id, resume_id, assigned_to, assigned_by,
        work_status, application_status, priority, created_by, creation_batch_id
      )
      select job_id, resume_id, null, null, 'UNASSIGNED', 'NOT_APPLIED', 'NORMAL', v_actor, v_batch.id
      from validated
      where exclusion_code is null
      on conflict (job_description_id, resume_id) do nothing
      returning id, job_description_id, resume_id
    )
    insert into public.application_creation_batch_results(
      batch_id, pair_key, requested_job_description_id, requested_resume_id,
      job_description_id, resume_id, application_id,
      company, job_title, candidate_name, resume_name, outcome, code, message
    )
    select v_batch.id,
      case when validated.job_id is not null and validated.resume_id is not null
        then concat(validated.job_id, ':', validated.resume_id)
        else concat('invalid:', validated.ordinality) end,
      validated.job_text, validated.resume_text,
      validated.actual_job_id, validated.actual_resume_id,
      coalesce(created.id, validated.existing_application_id),
      validated.company, validated.job_title, validated.candidate_name, validated.resume_name,
      case
        when validated.exclusion_code = 'EXISTING_APPLICATION' then 'DUPLICATE'
        when validated.exclusion_code is not null then 'SKIPPED'
        when created.id is not null then 'CREATED'
        else 'DUPLICATE'
      end,
      case
        when validated.exclusion_code = 'EXISTING_APPLICATION' then 'EXISTING_APPLICATION'
        when validated.exclusion_code is not null then validated.exclusion_code
        when created.id is null then 'CONCURRENT_DUPLICATE'
      end,
      case
        when validated.exclusion_code = 'INVALID_IDENTIFIER' then 'The JD or Resume identifier is invalid.'
        when validated.exclusion_code = 'MISSING_JD' then 'The job description no longer exists.'
        when validated.exclusion_code = 'MISSING_RESUME' then 'The Resume no longer exists.'
        when validated.exclusion_code = 'MISSING_CATEGORY' then 'The job description has no valid primary category.'
        when validated.exclusion_code = 'INACTIVE_RESUME' then 'The Resume is no longer active.'
        when validated.exclusion_code = 'CATEGORY_MISMATCH' then 'The JD and Resume primary categories no longer match.'
        when validated.exclusion_code = 'EXISTING_APPLICATION' then 'Application already exists.'
        when created.id is null then 'Application was created by another request first.'
        else 'Application created.'
      end
    from validated
    left join created on created.job_description_id = validated.job_id and created.resume_id = validated.resume_id;
  exception when others then
    insert into public.application_creation_batch_results(
      batch_id, pair_key, requested_job_description_id, requested_resume_id,
      job_description_id, resume_id, outcome, code, message
    )
    select v_batch.id, concat('failed:', ordinality),
      value ->> 'job_description_id', value ->> 'resume_id',
      null, null, 'FAILED', 'BULK_CREATE_FAILED', 'The server could not create this Application.'
    from jsonb_array_elements(p_combinations) with ordinality as input(value, ordinality);
  end;

  select count(*), count(distinct requested_job_description_id),
    count(*) filter (where outcome = 'CREATED'),
    count(*) filter (where outcome = 'DUPLICATE'),
    count(*) filter (where outcome = 'SKIPPED'),
    count(*) filter (where outcome = 'FAILED')
  into v_requested, v_selected_jds, v_created, v_duplicates, v_skipped, v_failed
  from public.application_creation_batch_results
  where batch_id = v_batch.id;

  v_status := case
    when v_created = 0 and v_failed > 0 then 'FAILED'
    when v_duplicates > 0 or v_skipped > 0 or v_failed > 0 then 'COMPLETED_WITH_WARNINGS'
    else 'COMPLETED'
  end;

  update public.application_creation_batches set
    selected_jd_count = coalesce(v_selected_jds, 0),
    requested_combination_count = coalesce(v_requested, 0),
    created_application_count = coalesce(v_created, 0),
    duplicate_count = coalesce(v_duplicates, 0),
    skipped_count = coalesce(v_skipped, 0),
    failed_count = coalesce(v_failed, 0),
    status = v_status,
    completed_at = clock_timestamp()
  where id = v_batch.id
  returning * into v_batch;

  select coalesce(jsonb_agg(jsonb_build_object(
    'key', pair_key,
    'jobDescriptionId', coalesce(job_description_id::text, requested_job_description_id),
    'resumeId', coalesce(resume_id::text, requested_resume_id),
    'applicationId', application_id,
    'company', company,
    'jobTitle', job_title,
    'candidateName', candidate_name,
    'resumeName', resume_name,
    'outcome', outcome,
    'code', code,
    'message', message
  ) order by created_at, id), '[]'::jsonb)
  into v_results
  from public.application_creation_batch_results
  where batch_id = v_batch.id;

  return jsonb_build_object(
    'batchId', v_batch.id,
    'batchName', v_batch.name,
    'status', v_batch.status,
    'selectedJdCount', v_batch.selected_jd_count,
    'requestedCount', v_batch.requested_combination_count,
    'createdCount', v_batch.created_application_count,
    'duplicateCount', v_batch.duplicate_count,
    'skippedCount', v_batch.skipped_count,
    'failedCount', v_batch.failed_count,
    'results', v_results
  );
end;
$$;

create or replace function public.list_application_batches(
  p_search text default '',
  p_status text default '',
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_items jsonb;
  v_total bigint;
begin
  perform public.assert_application_manager();
  if coalesce(p_status, '') <> '' and upper(p_status) not in ('PROCESSING','COMPLETED','COMPLETED_WITH_WARNINGS','FAILED') then
    raise exception 'BULK_INVALID_STATUS: Select a valid batch status.' using errcode = '22023';
  end if;

  with filtered as (
    select batches.*, coalesce(nullif(profiles.full_name, ''), profiles.email) as creator_name
    from public.application_creation_batches batches
    join public.profiles profiles on profiles.id = batches.created_by
    where (coalesce(btrim(p_search), '') = '' or batches.name ilike '%' || btrim(p_search) || '%')
      and (coalesce(p_status, '') = '' or batches.status = upper(p_status))
  ), paged as (
    select * from filtered order by created_at desc, id limit v_limit offset v_offset
  )
  select coalesce((select jsonb_agg(to_jsonb(paged)) from paged), '[]'::jsonb),
    (select count(*) from filtered)
  into v_items, v_total;

  return jsonb_build_object('items', v_items, 'total', coalesce(v_total, 0), 'limit', v_limit, 'offset', v_offset);
end;
$$;

create or replace function public.list_application_batch_options(p_limit integer default 200)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_result jsonb;
begin
  perform public.assert_application_manager();
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'status', status, 'createdAt', created_at) order by created_at desc), '[]'::jsonb)
  into v_result
  from (select * from public.application_creation_batches order by created_at desc limit least(greatest(coalesce(p_limit, 200), 1), 500)) batches;
  return v_result;
end;
$$;

create or replace function public.get_application_batch_detail(p_batch_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_result jsonb;
begin
  perform public.assert_application_manager();

  select jsonb_build_object(
    'batch', to_jsonb(batches) || jsonb_build_object('creator_name', coalesce(nullif(profiles.full_name, ''), profiles.email)),
    'results', coalesce((select jsonb_agg(to_jsonb(results) order by results.created_at, results.id)
      from public.application_creation_batch_results results where results.batch_id = batches.id), '[]'::jsonb)
  )
  into v_result
  from public.application_creation_batches batches
  join public.profiles profiles on profiles.id = batches.created_by
  where batches.id = p_batch_id;

  if v_result is null then
    raise exception 'BULK_BATCH_NOT_FOUND: The Application batch was not found.' using errcode = 'P0001';
  end if;
  return v_result;
end;
$$;

create or replace function public.list_applications_v07(
  p_search text default '', p_assigned_to uuid default null, p_work_status text default '',
  p_application_status text default '', p_priority text default '', p_company text default '',
  p_category_id uuid default null, p_due_filter text default '', p_sort text default 'updated_desc',
  p_creation_batch_id uuid default null, p_creation_mode text default '',
  p_limit integer default 25, p_offset integer default 0
)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_manager boolean;
  v_limit integer;
  v_offset integer;
  v_items jsonb;
  v_total bigint;
  v_number_search text := regexp_replace(upper(trim(coalesce(p_search, ''))), '^(APP[- ]?|#)', '');
begin
  v_manager := public.application_actor_can_manage();
  if not v_manager and not (public.is_active_user(auth.uid()) and public.has_role('APPLIER', auth.uid())) then
    raise exception 'APPLICATION_ACCESS_DENIED: Application access is required.' using errcode = '42501';
  end if;
  if coalesce(p_creation_mode, '') <> '' and upper(p_creation_mode) not in ('BULK','INDIVIDUAL') then
    raise exception 'APPLICATION_INVALID_CREATION_MODE: Select a valid creation mode.' using errcode = '22023';
  end if;
  v_limit := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset := greatest(coalesce(p_offset, 0), 0);

  with filtered as (
    select a.*, jobs.company, jobs.job_title, jobs.category_id, categories.name as category_name,
      jobs.source_url, jobs.created_at as captured_at,
      resumes.resume_name, resumes.candidate_name,
      coalesce(nullif(profiles.full_name, ''), profiles.email) as assignee_name,
      profiles.email as assignee_email, batches.name as creation_batch_name
    from public.applications a
    join public.job_descriptions jobs on jobs.id = a.job_description_id
    join public.resumes resumes on resumes.id = a.resume_id
    left join public.categories categories on categories.id = jobs.category_id
    left join public.profiles profiles on profiles.id = a.assigned_to
    left join public.application_creation_batches batches on batches.id = a.creation_batch_id
    where (v_manager or a.assigned_to = auth.uid())
      and (not v_manager or p_assigned_to is null
        or (p_assigned_to = '00000000-0000-4000-8000-000000000000'::uuid and a.assigned_to is null)
        or a.assigned_to = p_assigned_to)
      and (coalesce(trim(p_search), '') = '' or jobs.company ilike '%' || trim(p_search) || '%'
        or jobs.job_title ilike '%' || trim(p_search) || '%'
        or (v_number_search ~ '^[0-9]+$' and a.application_number::text = v_number_search))
      and (coalesce(trim(p_work_status), '') = '' or a.work_status = upper(trim(p_work_status)))
      and (coalesce(trim(p_application_status), '') = '' or a.application_status = upper(trim(p_application_status)))
      and (coalesce(trim(p_priority), '') = '' or a.priority = upper(trim(p_priority)))
      and (coalesce(trim(p_company), '') = '' or jobs.company ilike '%' || trim(p_company) || '%')
      and (p_category_id is null or jobs.category_id = p_category_id)
      and (p_creation_batch_id is null or a.creation_batch_id = p_creation_batch_id)
      and (coalesce(p_creation_mode, '') = ''
        or (upper(p_creation_mode) = 'BULK' and a.creation_batch_id is not null)
        or (upper(p_creation_mode) = 'INDIVIDUAL' and a.creation_batch_id is null))
      and (coalesce(trim(p_due_filter), '') = '' or
        (upper(trim(p_due_filter)) = 'OVERDUE' and a.due_at < now() and a.work_status not in ('COMPLETED','CANCELLED')) or
        (upper(trim(p_due_filter)) = 'DUE_TODAY' and a.due_at >= date_trunc('day', now()) and a.due_at < date_trunc('day', now()) + interval '1 day') or
        (upper(trim(p_due_filter)) = 'NO_DUE_DATE' and a.due_at is null))
  ), counted as (select count(*) total from filtered), paged as (
    select * from filtered order by
      case when p_sort = 'created_asc' then created_at end asc,
      case when p_sort = 'created_desc' then created_at end desc,
      case when p_sort = 'updated_asc' then updated_at end asc,
      case when p_sort = 'due_asc' then due_at end asc nulls last,
      case when p_sort = 'priority_desc' then array_position(array['LOW','NORMAL','HIGH','URGENT'], priority) end desc,
      case when p_sort = 'company_asc' then company end asc,
      case when p_sort = 'title_asc' then job_title end asc,
      updated_at desc, id
    limit v_limit offset v_offset
  )
  select coalesce((select jsonb_agg(to_jsonb(paged)) from paged), '[]'::jsonb),
    coalesce((select total from counted), 0)
  into v_items, v_total;
  return jsonb_build_object('items', v_items, 'total', v_total, 'limit', v_limit, 'offset', v_offset);
end;
$$;

revoke all on function public.preview_bulk_applications(uuid[]) from public, anon;
revoke all on function public.create_applications_bulk(jsonb, text) from public, anon;
revoke all on function public.list_application_batches(text, text, integer, integer) from public, anon;
revoke all on function public.list_application_batch_options(integer) from public, anon;
revoke all on function public.get_application_batch_detail(uuid) from public, anon;
revoke all on function public.list_applications_v07(text, uuid, text, text, text, text, uuid, text, text, uuid, text, integer, integer) from public, anon;

grant execute on function public.preview_bulk_applications(uuid[]) to authenticated;
grant execute on function public.create_applications_bulk(jsonb, text) to authenticated;
grant execute on function public.list_application_batches(text, text, integer, integer) to authenticated;
grant execute on function public.list_application_batch_options(integer) to authenticated;
grant execute on function public.get_application_batch_detail(uuid) to authenticated;
grant execute on function public.list_applications_v07(text, uuid, text, text, text, text, uuid, text, text, uuid, text, integer, integer) to authenticated;
