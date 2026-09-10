-- Bulk create: Software Engineering JDs with a subcategory require matching resume subcategory.
-- Other primary categories keep primary-only matching. SE JDs without subcategory stay primary-only.

create or replace function public.resume_matches_job_for_bulk(
  p_resume_id uuid,
  p_category_id uuid,
  p_subcategory_id uuid default null
)
returns boolean
language sql
stable
parallel safe
set search_path = public, pg_temp
as $$
  select p_category_id is not null
    and case
      when p_subcategory_id is not null
        and exists (
          select 1
          from public.categories c
          where c.id = p_category_id
            and c.parent_id is null
            and c.active
            and c.slug = 'software-engineering'
        )
      then exists (
        select 1
        from public.resume_tech_stacks s
        where s.resume_id = p_resume_id
          and s.primary_category_id = p_category_id
          and s.subcategory_id = p_subcategory_id
      )
      else public.resume_has_primary_category(p_resume_id, p_category_id)
    end;
$$;

revoke all on function public.resume_matches_job_for_bulk(uuid, uuid, uuid)
  from public, anon;
grant execute on function public.resume_matches_job_for_bulk(uuid, uuid, uuid)
  to authenticated;

comment on function public.resume_matches_job_for_bulk(uuid, uuid, uuid) is
  'Bulk JD↔Resume match: primary category by default; Software Engineering with a JD subcategory also requires that subcategory on a resume tech stack.';

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
     and public.resume_matches_job_for_bulk(resumes.id, loaded.category_id, loaded.subcategory_id)
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
        else 'No active original Resumes match this job category. Software Engineering jobs with a subcategory require that subcategory on the Resume.'
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
          when not public.resume_matches_job_for_bulk(resumes.id, jobs.category_id, jobs.subcategory_id) then 'CATEGORY_MISMATCH'
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
        when validated.exclusion_code = 'CATEGORY_MISMATCH' then 'The JD and Resume categories no longer match (Software Engineering also requires matching subcategory when set on the JD).'
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
  'Preview bulk Application combinations. Software Engineering JDs with subcategory require matching resume subcategory.';

comment on function public.create_applications_bulk(jsonb, text) is
  'Create bulk Applications. Software Engineering JDs with subcategory require matching resume subcategory.';
