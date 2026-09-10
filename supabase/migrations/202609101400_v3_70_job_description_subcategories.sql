-- v3.70: multiple subcategories per job description.
-- SE JDs require ≥1 subcategory on edit. Bulk match: resume needs ANY of the JD's SE subcategories.

create table if not exists public.job_description_subcategories (
  id uuid primary key default gen_random_uuid(),
  job_description_id uuid not null references public.job_descriptions(id) on delete cascade,
  subcategory_id uuid not null references public.categories(id),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint job_description_subcategories_sort_order_chk check (sort_order >= 0),
  constraint job_description_subcategories_unique unique (job_description_id, subcategory_id)
);

create index if not exists job_description_subcategories_job_sort_idx
  on public.job_description_subcategories (job_description_id, sort_order, id);
create index if not exists job_description_subcategories_sub_job_idx
  on public.job_description_subcategories (subcategory_id, job_description_id);

create or replace function public.validate_job_description_subcategory_row()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_job_category uuid;
  v_sub_parent uuid;
begin
  select category_id into v_job_category
  from public.job_descriptions
  where id = new.job_description_id;
  if v_job_category is null then
    raise exception 'JOB_SUBCATEGORY_INVALID: The job description was not found.' using errcode = '23514';
  end if;
  select parent_id into v_sub_parent
  from public.categories
  where id = new.subcategory_id and active;
  if v_sub_parent is distinct from v_job_category then
    raise exception 'JOB_SUBCATEGORY_INVALID: Each subcategory must belong to the job primary category.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists job_description_subcategories_validate on public.job_description_subcategories;
create trigger job_description_subcategories_validate
before insert or update on public.job_description_subcategories
for each row execute function public.validate_job_description_subcategory_row();

insert into public.job_description_subcategories (job_description_id, subcategory_id, sort_order)
select j.id, j.subcategory_id, 0
from public.job_descriptions j
where j.subcategory_id is not null
  and not exists (
    select 1 from public.job_description_subcategories s
    where s.job_description_id = j.id and s.subcategory_id = j.subcategory_id
  );

create or replace function public.job_description_subcategory_ids(p_job_description_id uuid)
returns uuid[]
language sql
stable
parallel safe
set search_path = public, pg_temp
as $$
  select coalesce(
    array_agg(s.subcategory_id order by s.sort_order, s.id),
    array[]::uuid[]
  )
  from public.job_description_subcategories s
  where s.job_description_id = p_job_description_id;
$$;

create or replace function public.replace_job_description_subcategories(
  p_job_description_id uuid,
  p_category_id uuid,
  p_subcategory_ids uuid[],
  p_enforce_se_required boolean default false
)
returns uuid[]
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids uuid[];
  v_first uuid;
  v_is_se boolean := false;
  v_id uuid;
  v_ord integer := 0;
begin
  if p_job_description_id is null or p_category_id is null then
    raise exception 'JOB_EDIT_INVALID: Select an active primary category.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.categories
    where id = p_category_id and parent_id is null and active
  ) then
    raise exception 'JOB_EDIT_INVALID: Select an active primary category.' using errcode = '22023';
  end if;

  select exists (
    select 1 from public.categories
    where id = p_category_id and parent_id is null and active and slug = 'software-engineering'
  ) into v_is_se;

  -- Preserve caller order; first occurrence of each id wins.
  select coalesce(array_agg(id order by ord), array[]::uuid[])
  into v_ids
  from (
    select id, min(ord) ord
    from (
      select x id, ordinality::integer ord
      from unnest(coalesce(p_subcategory_ids, array[]::uuid[])) with ordinality as t(x, ordinality)
      where x is not null
    ) raw
    group by id
  ) ordered;

  if cardinality(v_ids) > 12 then
    raise exception 'JOB_EDIT_INVALID: Select at most 12 subcategories.' using errcode = '22023';
  end if;

  if p_enforce_se_required and v_is_se and cardinality(v_ids) < 1 then
    raise exception 'JOB_EDIT_INVALID: Software Engineering jobs require at least one subcategory.' using errcode = '22023';
  end if;

  foreach v_id in array v_ids loop
    if not exists (
      select 1 from public.categories
      where id = v_id and parent_id = p_category_id and active
    ) then
      raise exception 'JOB_EDIT_INVALID: The subcategory does not belong to the primary category.' using errcode = '22023';
    end if;
  end loop;

  delete from public.job_description_subcategories where job_description_id = p_job_description_id;

  v_ord := 0;
  foreach v_id in array v_ids loop
    insert into public.job_description_subcategories (job_description_id, subcategory_id, sort_order)
    values (p_job_description_id, v_id, v_ord);
    v_ord := v_ord + 1;
  end loop;

  v_first := case when cardinality(v_ids) > 0 then v_ids[1] else null end;

  update public.job_descriptions
  set subcategory_id = v_first,
      updated_at = clock_timestamp()
  where id = p_job_description_id;

  return v_ids;
end;
$$;

revoke all on function public.replace_job_description_subcategories(uuid, uuid, uuid[], boolean) from public, anon;
grant execute on function public.replace_job_description_subcategories(uuid, uuid, uuid[], boolean) to authenticated;

comment on function public.replace_job_description_subcategories(uuid, uuid, uuid[], boolean) is
  'Replace JD subcategory junction rows, sync legacy subcategory_id to the first entry, optionally require ≥1 for Software Engineering.';

-- Matching: SE with any junction subcategory → resume must share ANY; else primary-only.
drop function if exists public.resume_matches_job_for_bulk(uuid, uuid, uuid);

create or replace function public.resume_matches_job_for_bulk(
  p_resume_id uuid,
  p_category_id uuid,
  p_job_description_id uuid default null
)
returns boolean
language sql
stable
parallel safe
set search_path = public, pg_temp
as $$
  select p_category_id is not null
    and case
      when p_job_description_id is not null
        and exists (
          select 1
          from public.categories c
          where c.id = p_category_id
            and c.parent_id is null
            and c.active
            and c.slug = 'software-engineering'
        )
        and exists (
          select 1
          from public.job_description_subcategories jds
          where jds.job_description_id = p_job_description_id
        )
      then exists (
        select 1
        from public.resume_tech_stacks s
        join public.job_description_subcategories jds
          on jds.job_description_id = p_job_description_id
         and jds.subcategory_id = s.subcategory_id
        where s.resume_id = p_resume_id
          and s.primary_category_id = p_category_id
      )
      else public.resume_has_primary_category(p_resume_id, p_category_id)
    end;
$$;

revoke all on function public.resume_matches_job_for_bulk(uuid, uuid, uuid) from public, anon;
grant execute on function public.resume_matches_job_for_bulk(uuid, uuid, uuid) to authenticated;

comment on function public.resume_matches_job_for_bulk(uuid, uuid, uuid) is
  'Bulk JD↔Resume match: primary by default; Software Engineering with JD subcategories requires the resume to share any of those subcategories.';

create or replace function public.preview_bulk_applications(p_selected_jd_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids uuid[];
  v_limit constant integer := 1000;
  v_result jsonb;
begin
  perform public.assert_application_manager();
  select coalesce(array_agg(id order by id), array[]::uuid[])
  into v_ids
  from (
    select distinct id
    from unnest(coalesce(p_selected_jd_ids, array[]::uuid[])) ids(id)
    where id is not null
  ) x;
  if cardinality(v_ids) = 0 then
    raise exception 'BULK_NO_JDS: Select at least one job description.' using errcode = '22023';
  end if;
  if cardinality(v_ids) > v_limit then
    raise exception 'BULK_JD_LIMIT: You can select up to 1000 job descriptions in one bulk operation.' using errcode = '22023';
  end if;

  with requested as (
    select id from unnest(v_ids) requested_ids(id)
  ), loaded as (
    select requested.id requested_id,
      jobs.id,
      jobs.company,
      jobs.job_title,
      jobs.category_id,
      jobs.subcategory_id,
      jobs.status,
      jobs.review_status,
      categories.name category_name
    from requested
    left join public.job_descriptions jobs on jobs.id = requested.id
    left join public.categories categories on categories.id = jobs.category_id and categories.active
  ), combinations as (
    select concat(loaded.id, ':', resumes.id) key,
      loaded.id job_description_id,
      resumes.id resume_id,
      loaded.company,
      loaded.job_title,
      loaded.category_id job_category_id,
      loaded.category_name job_category_name,
      resumes.resume_number,
      resumes.resume_type,
      resumes.candidate_name,
      resumes.resume_name,
      loaded.category_id resume_category_id,
      array_to_string(public.resume_primary_category_names(resumes.id), ', ') resume_category_name,
      applications.id existing_application_id,
      exists (
        select 1 from public.resume_banned_companies banned
        where banned.resume_id = resumes.id
          and banned.normalized_company = public.normalize_company_name(loaded.company)
      ) as banned_company,
      applications.id is null
        and not exists (
          select 1 from public.resume_banned_companies banned
          where banned.resume_id = resumes.id
            and banned.normalized_company = public.normalize_company_name(loaded.company)
        ) as eligible,
      case
        when applications.id is not null then 'EXISTING_APPLICATION'
        when exists (
          select 1 from public.resume_banned_companies banned
          where banned.resume_id = resumes.id
            and banned.normalized_company = public.normalize_company_name(loaded.company)
        ) then 'BANNED_COMPANY'
      end as exclusion_code,
      case
        when applications.id is not null then 'Application already exists'
        when exists (
          select 1 from public.resume_banned_companies banned
          where banned.resume_id = resumes.id
            and banned.normalized_company = public.normalize_company_name(loaded.company)
        ) then 'This Resume bans applications to this company'
      end as exclusion_reason
    from loaded
    join public.resumes resumes
      on resumes.status = 'ACTIVE'
     and resumes.resume_type = 'ORIGINAL'
     and public.resume_matches_job_for_bulk(resumes.id, loaded.category_id, loaded.id)
    left join public.applications applications
      on applications.job_description_id = loaded.id
     and coalesce(
       (select parent_resume_id from public.resumes where id = applications.resume_id),
       applications.resume_id
     ) = resumes.id
    where loaded.id is not null
      and loaded.status = 'ACTIVE'
      and loaded.review_status = 'APPROVED'
      and loaded.category_id is not null
      and loaded.category_name is not null
  ), invalid_jds as (
    select loaded.requested_id job_description_id,
      coalesce(loaded.company, 'Unavailable job description') company,
      coalesce(loaded.job_title, 'Unavailable') job_title,
      case
        when loaded.id is null then 'MISSING_JD'
        when loaded.status <> 'ACTIVE' then 'INACTIVE_JD'
        when loaded.review_status <> 'APPROVED' then 'UNAPPROVED_JD'
        when loaded.category_id is null or loaded.category_name is null then 'MISSING_CATEGORY'
        else 'NO_MATCHING_ACTIVE_RESUMES'
      end code,
      case
        when loaded.id is null then 'The job description does not exist or is unavailable.'
        when loaded.status <> 'ACTIVE' then 'The job description is archived.'
        when loaded.review_status <> 'APPROVED' then 'The job description has not been approved.'
        when loaded.category_id is null or loaded.category_name is null then 'The job description has no valid primary category.'
        else 'No active original Resumes match this job category. Software Engineering jobs with subcategories require a matching subcategory on the Resume.'
      end reason
    from loaded
    where loaded.id is null
      or loaded.status <> 'ACTIVE'
      or loaded.review_status <> 'APPROVED'
      or loaded.category_id is null
      or loaded.category_name is null
      or not exists (
        select 1 from combinations where combinations.job_description_id = loaded.id
      )
  )
  select jsonb_build_object(
    'selectedJdCount', cardinality(v_ids),
    'validJdCount', cardinality(v_ids) - (select count(*) from invalid_jds),
    'invalidJdCount', (select count(*) from invalid_jds),
    'activeResumeCount', (select count(distinct resume_id) from combinations),
    'proposedCount', (select count(*) from combinations),
    'eligibleCount', (select count(*) from combinations where eligible),
    'duplicateCount', (select count(*) from combinations where not eligible and exclusion_code = 'EXISTING_APPLICATION'),
    'excludedCount', (select count(*) from combinations where not eligible) + (select count(*) from invalid_jds),
    'combinations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', key,
        'jobDescriptionId', job_description_id,
        'resumeId', resume_id,
        'resumeNumber', resume_number,
        'resumeType', resume_type,
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
      ) order by company, job_title, candidate_name, resume_name)
      from combinations
    ), '[]'::jsonb),
    'invalidJds', coalesce((
      select jsonb_agg(jsonb_build_object(
        'jobDescriptionId', job_description_id,
        'company', company,
        'jobTitle', job_title,
        'code', code,
        'reason', reason
      ) order by company, job_title)
      from invalid_jds
    ), '[]'::jsonb)
  )
  into v_result;

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
  if v_raw_count > 5000 then
    raise exception 'BULK_COMBINATION_LIMIT: You can create up to 5,000 Applications in one bulk operation.' using errcode = '22023';
  end if;
  if v_name is not null and char_length(v_name) > 120 then
    raise exception 'BULK_BATCH_NAME_INVALID: Batch name cannot exceed 120 characters.' using errcode = '22023';
  end if;
  v_name := coalesce(v_name, 'Bulk Applications — ' || to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC');

  insert into public.application_creation_batches(name, created_by)
  values (v_name, v_actor)
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
        jobs.id as actual_job_id,
        resumes.id as actual_resume_id,
        jobs.company,
        jobs.job_title,
        jobs.category_id as job_category_id,
        resumes.candidate_name,
        resumes.resume_name,
        resumes.primary_category_id as resume_category_id,
        resumes.status as resume_status,
        existing.id as existing_application_id,
        case
          when deduplicated.job_id is null or deduplicated.resume_id is null then 'INVALID_IDENTIFIER'
          when jobs.id is null then 'MISSING_JD'
          when resumes.id is null then 'MISSING_RESUME'
          when jobs.category_id is null then 'MISSING_CATEGORY'
          when resumes.status <> 'ACTIVE' then 'INACTIVE_RESUME'
          when not public.resume_matches_job_for_bulk(resumes.id, jobs.category_id, jobs.id) then 'CATEGORY_MISMATCH'
          when exists (
            select 1 from public.resume_banned_companies banned
            where banned.resume_id = resumes.id
              and banned.normalized_company = public.normalize_company_name(jobs.company)
          ) then 'BANNED_COMPANY'
          when existing.id is not null then 'EXISTING_APPLICATION'
        end as exclusion_code
      from deduplicated
      left join public.job_descriptions jobs on jobs.id = deduplicated.job_id
      left join public.resumes resumes on resumes.id = deduplicated.resume_id
      left join public.applications existing
        on existing.job_description_id = deduplicated.job_id
       and existing.resume_id = deduplicated.resume_id
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
        else concat('invalid:', validated.ordinality)
      end,
      validated.job_text,
      validated.resume_text,
      validated.actual_job_id,
      validated.actual_resume_id,
      coalesce(created.id, validated.existing_application_id),
      validated.company,
      validated.job_title,
      validated.candidate_name,
      validated.resume_name,
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
        when validated.exclusion_code = 'CATEGORY_MISMATCH' then 'The JD and Resume categories no longer match (Software Engineering requires sharing any of the JD subcategories).'
        when validated.exclusion_code = 'BANNED_COMPANY' then 'This Resume bans applications to this company.'
        when validated.exclusion_code = 'EXISTING_APPLICATION' then 'Application already exists.'
        when created.id is null then 'Application was created by another request first.'
        else 'Application created.'
      end
    from validated
    left join created
      on created.job_description_id = validated.job_id
     and created.resume_id = validated.resume_id;
  exception when others then
    insert into public.application_creation_batch_results(
      batch_id, pair_key, requested_job_description_id, requested_resume_id,
      job_description_id, resume_id, outcome, code, message
    )
    select v_batch.id,
      concat('failed:', ordinality),
      value ->> 'job_description_id',
      value ->> 'resume_id',
      null,
      null,
      'FAILED',
      'BULK_CREATE_FAILED',
      'The server could not create this Application.'
    from jsonb_array_elements(p_combinations) with ordinality as input(value, ordinality);
  end;

  select count(*),
    count(distinct requested_job_description_id),
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

comment on function public.preview_bulk_applications(uuid[]) is
  'Preview bulk Application combinations. Software Engineering JDs with subcategories require the resume to share any of those subcategories.';

comment on function public.create_applications_bulk(jsonb, text) is
  'Create bulk Applications. Software Engineering JDs with subcategories require the resume to share any of those subcategories.';

-- Edit RPCs: add p_subcategory_ids, enforce SE requirement, sync junction.
drop function if exists public.update_my_job_description_v31(uuid,text,text,uuid,uuid,text,text,text,text,text,text,text,text[],text[],boolean,text,numeric,numeric,text,text,text);
drop function if exists public.manager_update_job_description_v312(uuid,text,text,uuid,uuid,text,text,text,text,text,text,text,text[],text[],boolean,text,numeric,numeric,text,text,text);

create or replace function public.update_my_job_description_v31(
  p_job_description_id uuid,
  p_company text,
  p_job_title text,
  p_category_id uuid,
  p_subcategory_id uuid,
  p_seniority text,
  p_location_text text,
  p_work_arrangement text,
  p_source_url text,
  p_normalized_source_url text,
  p_source_site text,
  p_description_text text,
  p_detected_skills text[],
  p_clearance_requirements text[],
  p_travel_required boolean,
  p_travel_details text,
  p_salary_min numeric,
  p_salary_max numeric,
  p_salary_currency text,
  p_salary_period text,
  p_salary_text text,
  p_subcategory_ids uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_job public.job_descriptions;
  v_company text := regexp_replace(btrim(coalesce(p_company,'')), '\s+', ' ', 'g');
  v_title text := regexp_replace(btrim(coalesce(p_job_title,'')), '\s+', ' ', 'g');
  v_subs uuid[];
begin
  if v_actor is null or not public.is_active_user(v_actor) or not public.has_role('JD_FINDER',v_actor) then
    raise exception 'JOB_EDIT_FORBIDDEN: An active JD Finder account is required.' using errcode='42501';
  end if;

  select * into v_job from public.job_descriptions
  where id=p_job_description_id and user_id=v_actor for update;
  if not found then
    raise exception 'JOB_NOT_FOUND: The job description was not found or does not belong to you.' using errcode='P0002';
  end if;
  if v_job.review_status not in ('NEEDS_REVIEW','NEEDS_CORRECTION') then
    raise exception 'JOB_EDIT_LOCKED: Approved and declined job descriptions are immutable.' using errcode='P0001';
  end if;

  if char_length(v_company) not between 1 and 200 or char_length(v_title) not between 1 and 200
     or char_length(coalesce(p_description_text,'')) not between 100 and 200000
     or char_length(coalesce(p_source_url,'')) not between 1 and 4000 then
    raise exception 'JOB_EDIT_INVALID: Required job-description fields are invalid.' using errcode='22023';
  end if;
  if p_salary_min is not null and p_salary_max is not null and p_salary_max < p_salary_min then
    raise exception 'JOB_EDIT_INVALID: Salary maximum must be at least the minimum.' using errcode='22023';
  end if;
  if not exists(select 1 from public.categories where id=p_category_id and parent_id is null and active) then
    raise exception 'JOB_EDIT_INVALID: Select an active primary category.' using errcode='22023';
  end if;

  if p_subcategory_ids is not null then
    v_subs := p_subcategory_ids;
  elsif p_subcategory_id is not null then
    v_subs := array[p_subcategory_id];
  else
    v_subs := array[]::uuid[];
  end if;

  if exists(select 1 from public.job_descriptions
    where user_id=v_actor and id<>p_job_description_id
      and normalized_source_url=p_normalized_source_url and coalesce(p_normalized_source_url,'')<>'')
    or exists(select 1 from public.job_descriptions
      where user_id=v_actor and id<>p_job_description_id
        and lower(regexp_replace(btrim(company),'\s+',' ','g'))=lower(v_company)
        and lower(regexp_replace(btrim(job_title),'\s+',' ','g'))=lower(v_title)) then
    raise exception 'JOB_DUPLICATE: Another capture has this URL or company and title.' using errcode='23505';
  end if;

  update public.job_descriptions set
    company=v_company,
    job_title=v_title,
    category_id=p_category_id,
    seniority=coalesce(p_seniority,'UNSPECIFIED'),
    location_text=nullif(btrim(coalesce(p_location_text,'')),''),
    work_arrangement=coalesce(p_work_arrangement,'UNSPECIFIED'),
    source_url=btrim(p_source_url),
    normalized_source_url=btrim(p_normalized_source_url),
    source_site=btrim(p_source_site),
    description_text=btrim(p_description_text),
    detected_skills=coalesce(p_detected_skills,'{}'::text[]),
    clearance_requirements=coalesce(p_clearance_requirements,'{}'::text[]),
    travel_required=p_travel_required,
    travel_details=nullif(btrim(coalesce(p_travel_details,'')),''),
    salary_min=p_salary_min,
    salary_max=p_salary_max,
    salary_currency=nullif(upper(btrim(coalesce(p_salary_currency,''))),''),
    salary_period=nullif(upper(btrim(coalesce(p_salary_period,''))),''),
    salary_text=nullif(btrim(coalesce(p_salary_text,'')),''),
    updated_at=clock_timestamp()
  where id=p_job_description_id
  returning * into v_job;

  perform public.replace_job_description_subcategories(p_job_description_id, p_category_id, v_subs, true);

  select * into v_job from public.job_descriptions where id = p_job_description_id;
  return to_jsonb(v_job) || jsonb_build_object(
    'subcategory_ids', to_jsonb(public.job_description_subcategory_ids(p_job_description_id))
  );
end $$;

create or replace function public.manager_update_job_description_v312(
  p_job_description_id uuid,
  p_company text,
  p_job_title text,
  p_category_id uuid,
  p_subcategory_id uuid,
  p_seniority text,
  p_location_text text,
  p_work_arrangement text,
  p_source_url text,
  p_normalized_source_url text,
  p_source_site text,
  p_description_text text,
  p_detected_skills text[],
  p_clearance_requirements text[],
  p_travel_required boolean,
  p_travel_details text,
  p_salary_min numeric,
  p_salary_max numeric,
  p_salary_currency text,
  p_salary_period text,
  p_salary_text text,
  p_subcategory_ids uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_job public.job_descriptions;
  v_company text := regexp_replace(btrim(coalesce(p_company,'')), '\s+', ' ', 'g');
  v_title text := regexp_replace(btrim(coalesce(p_job_title,'')), '\s+', ' ', 'g');
  v_subs uuid[];
begin
  if v_actor is null or not public.is_active_user(v_actor) or not public.application_actor_can_manage() then
    raise exception 'JOB_EDIT_FORBIDDEN: An active Applying Manager or Admin account is required.' using errcode='42501';
  end if;

  select * into v_job from public.job_descriptions
  where id=p_job_description_id for update;
  if not found then
    raise exception 'JOB_NOT_FOUND: The job description was not found or is no longer accessible.' using errcode='P0002';
  end if;
  if v_job.review_status not in ('NEEDS_REVIEW','NEEDS_CORRECTION') then
    raise exception 'JOB_EDIT_LOCKED: Approved and declined job descriptions are immutable.' using errcode='P0001';
  end if;

  if char_length(v_company) not between 1 and 200 or char_length(v_title) not between 1 and 200
     or char_length(coalesce(p_description_text,'')) not between 100 and 200000
     or char_length(coalesce(p_source_url,'')) not between 1 and 4000 then
    raise exception 'JOB_EDIT_INVALID: Required job-description fields are invalid.' using errcode='22023';
  end if;
  if p_salary_min is not null and p_salary_max is not null and p_salary_max < p_salary_min then
    raise exception 'JOB_EDIT_INVALID: Salary maximum must be at least the minimum.' using errcode='22023';
  end if;
  if not exists(select 1 from public.categories where id=p_category_id and parent_id is null and active) then
    raise exception 'JOB_EDIT_INVALID: Select an active primary category.' using errcode='22023';
  end if;

  if p_subcategory_ids is not null then
    v_subs := p_subcategory_ids;
  elsif p_subcategory_id is not null then
    v_subs := array[p_subcategory_id];
  else
    v_subs := array[]::uuid[];
  end if;

  if exists(select 1 from public.job_descriptions
    where user_id=v_job.user_id and id<>p_job_description_id
      and normalized_source_url=p_normalized_source_url and coalesce(p_normalized_source_url,'')<>'')
    or exists(select 1 from public.job_descriptions
      where user_id=v_job.user_id and id<>p_job_description_id
        and lower(regexp_replace(btrim(company),'\s+',' ','g'))=lower(v_company)
        and lower(regexp_replace(btrim(job_title),'\s+',' ','g'))=lower(v_title)) then
    raise exception 'JOB_DUPLICATE: Another capture has this URL or company and title.' using errcode='23505';
  end if;

  update public.job_descriptions set
    company=v_company,
    job_title=v_title,
    category_id=p_category_id,
    seniority=coalesce(p_seniority,'UNSPECIFIED'),
    location_text=nullif(btrim(coalesce(p_location_text,'')),''),
    work_arrangement=coalesce(p_work_arrangement,'UNSPECIFIED'),
    source_url=btrim(p_source_url),
    normalized_source_url=btrim(p_normalized_source_url),
    source_site=btrim(p_source_site),
    description_text=btrim(p_description_text),
    detected_skills=coalesce(p_detected_skills,'{}'::text[]),
    clearance_requirements=coalesce(p_clearance_requirements,'{}'::text[]),
    travel_required=p_travel_required,
    travel_details=nullif(btrim(coalesce(p_travel_details,'')),''),
    salary_min=p_salary_min,
    salary_max=p_salary_max,
    salary_currency=nullif(upper(btrim(coalesce(p_salary_currency,''))),''),
    salary_period=nullif(upper(btrim(coalesce(p_salary_period,''))),''),
    salary_text=nullif(btrim(coalesce(p_salary_text,'')),''),
    updated_at=clock_timestamp()
  where id=p_job_description_id
  returning * into v_job;

  perform public.replace_job_description_subcategories(p_job_description_id, p_category_id, v_subs, true);

  select * into v_job from public.job_descriptions where id = p_job_description_id;
  return to_jsonb(v_job) || jsonb_build_object(
    'subcategory_ids', to_jsonb(public.job_description_subcategory_ids(p_job_description_id))
  );
end $$;

revoke all on function public.update_my_job_description_v31(uuid,text,text,uuid,uuid,text,text,text,text,text,text,text,text[],text[],boolean,text,numeric,numeric,text,text,text,uuid[]) from public,anon;
grant execute on function public.update_my_job_description_v31(uuid,text,text,uuid,uuid,text,text,text,text,text,text,text,text[],text[],boolean,text,numeric,numeric,text,text,text,uuid[]) to authenticated;
revoke all on function public.manager_update_job_description_v312(uuid,text,text,uuid,uuid,text,text,text,text,text,text,text,text[],text[],boolean,text,numeric,numeric,text,text,text,uuid[]) from public,anon;
grant execute on function public.manager_update_job_description_v312(uuid,text,text,uuid,uuid,text,text,text,text,text,text,text,text[],text[],boolean,text,numeric,numeric,text,text,text,uuid[]) to authenticated;

-- Capture: accept subcategory_ids array; sync junction (SE not enforced at capture).
create or replace function public.capture_job_description_v353(p_record jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_job public.job_descriptions;
  v_normalized_url text := btrim(coalesce(p_record->>'normalized_source_url', ''));
  v_company text := regexp_replace(btrim(coalesce(p_record->>'company', '')), '\s+', ' ', 'g');
  v_job_title text := regexp_replace(btrim(coalesce(p_record->>'job_title', '')), '\s+', ' ', 'g');
  v_clearances text[];
  v_skills text[];
  v_category_id uuid := (p_record->>'category_id')::uuid;
  v_subs uuid[];
  v_first_sub uuid;
begin
  if v_actor is null
     or not public.is_active_user(v_actor)
     or not public.has_any_role(array['APPLYING_MANAGER', 'JD_FINDER', 'ADMIN']) then
    raise exception 'JOB_CAPTURE_ACCESS_DENIED: Active capture access is required.' using errcode = '42501';
  end if;

  if jsonb_typeof(coalesce(p_record, '{}'::jsonb)) <> 'object'
     or v_company = ''
     or v_job_title = ''
     or v_normalized_url !~* '^https?://'
     or btrim(coalesce(p_record->>'source_url', '')) !~* '^https?://' then
    raise exception 'JOB_CAPTURE_INVALID: The captured Job Description is invalid.' using errcode = '22023';
  end if;

  if jsonb_typeof(p_record->'subcategory_ids') = 'array' then
    select coalesce(array_agg(id order by ord), array[]::uuid[])
    into v_subs
    from (
      select id, min(ord) ord
      from (
        select nullif(btrim(value), '')::uuid id, ordinality::integer ord
        from jsonb_array_elements_text(p_record->'subcategory_ids') with ordinality item(value, ordinality)
        where nullif(btrim(value), '') is not null
      ) raw
      where id is not null
      group by id
    ) ordered;
  elsif nullif(p_record->>'subcategory_id', '') is not null then
    v_subs := array[(p_record->>'subcategory_id')::uuid];
  else
    v_subs := array[]::uuid[];
  end if;
  v_first_sub := case when cardinality(v_subs) > 0 then v_subs[1] else null end;

  select coalesce(array_agg(value order by first_ordinal), '{}'::text[])
  into v_clearances
  from (
    select btrim(value) value, min(ordinality) first_ordinal
    from jsonb_array_elements_text(
      case when jsonb_typeof(p_record->'clearance_requirements') = 'array'
        then p_record->'clearance_requirements' else '[]'::jsonb end
    ) with ordinality item(value, ordinality)
    where btrim(value) <> ''
    group by btrim(value)
  ) cleaned;

  select coalesce(array_agg(value order by first_ordinal), '{}'::text[])
  into v_skills
  from (
    select btrim(value) value, min(ordinality) first_ordinal
    from jsonb_array_elements_text(
      case when jsonb_typeof(p_record->'detected_skills') = 'array'
        then p_record->'detected_skills' else '[]'::jsonb end
    ) with ordinality item(value, ordinality)
    where btrim(value) <> ''
    group by btrim(value)
  ) cleaned;

  perform pg_advisory_xact_lock(hashtextextended('jd:url:' || v_actor::text || ':' || v_normalized_url, 0));
  perform pg_advisory_xact_lock(hashtextextended('jd:identity:' || v_actor::text || ':' || lower(v_company) || ':' || lower(v_job_title), 0));

  select * into v_job
  from public.job_descriptions
  where user_id = v_actor and normalized_source_url = v_normalized_url
  order by created_at, id
  limit 1;

  if found then
    return jsonb_build_object('row', to_jsonb(v_job), 'duplicate', true, 'duplicateReason', 'SOURCE_URL');
  end if;

  select * into v_job
  from public.job_descriptions
  where user_id = v_actor
    and lower(btrim(company)) = lower(v_company)
    and lower(btrim(job_title)) = lower(v_job_title)
  order by created_at, id
  limit 1;

  if found then
    return jsonb_build_object('row', to_jsonb(v_job), 'duplicate', true, 'duplicateReason', 'COMPANY_JOB_TITLE');
  end if;

  insert into public.job_descriptions (
    user_id, company, job_title, category_id, subcategory_id,
    industry_domain_category_id, seniority, location_text, work_arrangement,
    clearance_requirements, travel_required, travel_details, salary_min,
    salary_max, salary_currency, salary_period, salary_text, source_site,
    source_url, normalized_source_url, captured_at_client, description_text,
    detected_skills, capture_method, extraction_confidence
  ) values (
    v_actor,
    v_company,
    v_job_title,
    v_category_id,
    v_first_sub,
    nullif(p_record->>'industry_domain_category_id', '')::uuid,
    coalesce(nullif(p_record->>'seniority', ''), 'UNSPECIFIED'),
    nullif(btrim(coalesce(p_record->>'location_text', '')), ''),
    coalesce(nullif(p_record->>'work_arrangement', ''), 'UNSPECIFIED'),
    v_clearances,
    nullif(p_record->>'travel_required', '')::boolean,
    nullif(btrim(coalesce(p_record->>'travel_details', '')), ''),
    nullif(p_record->>'salary_min', '')::numeric,
    nullif(p_record->>'salary_max', '')::numeric,
    nullif(btrim(coalesce(p_record->>'salary_currency', '')), ''),
    nullif(btrim(coalesce(p_record->>'salary_period', '')), ''),
    nullif(btrim(coalesce(p_record->>'salary_text', '')), ''),
    btrim(coalesce(p_record->>'source_site', '')),
    btrim(p_record->>'source_url'),
    v_normalized_url,
    nullif(p_record->>'captured_at_client', '')::timestamptz,
    p_record->>'description_text',
    v_skills,
    coalesce(nullif(p_record->>'capture_method', ''), 'manual'),
    coalesce(nullif(p_record->>'extraction_confidence', ''), 'low')
  )
  returning * into v_job;

  perform public.replace_job_description_subcategories(v_job.id, v_category_id, v_subs, false);
  select * into v_job from public.job_descriptions where id = v_job.id;

  return jsonb_build_object(
    'row', to_jsonb(v_job) || jsonb_build_object(
      'subcategory_ids', to_jsonb(public.job_description_subcategory_ids(v_job.id))
    ),
    'duplicate', false,
    'duplicateReason', null
  );
exception
  when unique_violation then
    select * into v_job
    from public.job_descriptions
    where user_id = v_actor and normalized_source_url = v_normalized_url
    order by created_at, id
    limit 1;
    if found then
      return jsonb_build_object('row', to_jsonb(v_job), 'duplicate', true, 'duplicateReason', 'SOURCE_URL');
    end if;
    raise;
end;
$$;

alter table public.job_description_subcategories enable row level security;
drop policy if exists "role scoped read job description subcategories" on public.job_description_subcategories;
create policy "role scoped read job description subcategories" on public.job_description_subcategories
for select to authenticated
using ((select public.job_description_actor_can_view(job_description_id)));

comment on table public.job_description_subcategories is
  'Optional many subcategories for one job description; legacy job_descriptions.subcategory_id mirrors the first row.';
