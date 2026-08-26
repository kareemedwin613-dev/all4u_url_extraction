-- Raise bulk Application create combination limit from 2,000 to 5,000.

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
        when validated.exclusion_code = 'BANNED_COMPANY' then 'This Resume bans applications to this company.'
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
