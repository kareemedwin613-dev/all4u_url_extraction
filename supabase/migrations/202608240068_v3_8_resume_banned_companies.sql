-- Per-ORIGINAL-resume banned companies + hard-block on Application create/bulk.

create or replace function public.normalize_company_name(p_company text)
returns text
language sql
immutable
as $$
  select lower(btrim(regexp_replace(coalesce(p_company, ''), '\s+', ' ', 'g')));
$$;

create table if not exists public.resume_banned_companies (
  id uuid primary key default gen_random_uuid(),
  resume_id uuid not null references public.resumes(id) on delete cascade,
  company_name text not null check (char_length(company_name) between 1 and 200),
  normalized_company text not null check (char_length(normalized_company) between 1 and 200),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  constraint resume_banned_companies_resume_normalized_unique unique (resume_id, normalized_company)
);

create index if not exists resume_banned_companies_resume_idx
  on public.resume_banned_companies(resume_id, normalized_company);

alter table public.resume_banned_companies enable row level security;

drop policy if exists "resume scoped read banned companies" on public.resume_banned_companies;
create policy "resume scoped read banned companies" on public.resume_banned_companies
for select to authenticated
using ((select public.resume_actor_can_view(resume_id)));

drop policy if exists "managers insert banned companies" on public.resume_banned_companies;
create policy "managers insert banned companies" on public.resume_banned_companies
for insert to authenticated
with check ((select public.application_actor_can_manage()));

drop policy if exists "managers delete banned companies" on public.resume_banned_companies;
create policy "managers delete banned companies" on public.resume_banned_companies
for delete to authenticated
using ((select public.application_actor_can_manage()));

comment on table public.resume_banned_companies is
  'Manual per-ORIGINAL-resume employer ban list. Matching JD companies cannot form Applications.';

create or replace function public.list_resume_banned_companies_v38(p_resume_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_result jsonb;
begin
  if not public.resume_actor_can_view(p_resume_id) then
    raise exception 'FORBIDDEN: You do not have access to this Resume.' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id,
    'resumeId', b.resume_id,
    'companyName', b.company_name,
    'normalizedCompany', b.normalized_company,
    'createdBy', b.created_by,
    'createdAt', b.created_at
  ) order by b.company_name, b.created_at), '[]'::jsonb)
  into v_result
  from public.resume_banned_companies b
  where b.resume_id = p_resume_id;
  return v_result;
end;
$$;

create or replace function public.add_resume_banned_company_v38(p_resume_id uuid, p_company_name text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_resume public.resumes;
  v_name text := btrim(coalesce(p_company_name, ''));
  v_normalized text;
  v_row public.resume_banned_companies;
begin
  if not public.application_actor_can_manage() then
    raise exception 'FORBIDDEN: Only Applying Managers and Admins can manage banned companies.' using errcode = '42501';
  end if;
  select * into v_resume from public.resumes where id = p_resume_id for update;
  if not found then
    raise exception 'RESUME_NOT_FOUND: The Resume was not found.' using errcode = 'P0001';
  end if;
  if v_resume.resume_type <> 'ORIGINAL' then
    raise exception 'RESUME_TYPE_INVALID: Banned companies can only be managed on original Resumes.' using errcode = '22023';
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 200 then
    raise exception 'VALIDATION_ERROR: Enter a company name between 1 and 200 characters.' using errcode = '22023';
  end if;
  v_normalized := public.normalize_company_name(v_name);
  if v_normalized = '' then
    raise exception 'VALIDATION_ERROR: Enter a company name between 1 and 200 characters.' using errcode = '22023';
  end if;
  insert into public.resume_banned_companies(resume_id, company_name, normalized_company, created_by)
  values (p_resume_id, v_name, v_normalized, auth.uid())
  on conflict (resume_id, normalized_company) do nothing
  returning * into v_row;
  if v_row.id is null then
    raise exception 'BANNED_COMPANY_DUPLICATE: That company is already on this Resume ban list.' using errcode = '23505';
  end if;
  return jsonb_build_object(
    'id', v_row.id,
    'resumeId', v_row.resume_id,
    'companyName', v_row.company_name,
    'normalizedCompany', v_row.normalized_company,
    'createdBy', v_row.created_by,
    'createdAt', v_row.created_at
  );
end;
$$;

create or replace function public.remove_resume_banned_company_v38(p_resume_id uuid, p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row public.resume_banned_companies;
begin
  if not public.application_actor_can_manage() then
    raise exception 'FORBIDDEN: Only Applying Managers and Admins can manage banned companies.' using errcode = '42501';
  end if;
  delete from public.resume_banned_companies
  where id = p_id and resume_id = p_resume_id
  returning * into v_row;
  if not found then
    raise exception 'BANNED_COMPANY_NOT_FOUND: The banned company entry was not found.' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'id', v_row.id,
    'resumeId', v_row.resume_id,
    'companyName', v_row.company_name,
    'normalizedCompany', v_row.normalized_company
  );
end;
$$;

revoke all on function public.normalize_company_name(text) from public, anon;
grant execute on function public.normalize_company_name(text) to authenticated;
revoke all on function public.list_resume_banned_companies_v38(uuid) from public, anon;
revoke all on function public.add_resume_banned_company_v38(uuid, text) from public, anon;
revoke all on function public.remove_resume_banned_company_v38(uuid, uuid) from public, anon;
grant execute on function public.list_resume_banned_companies_v38(uuid) to authenticated;
grant execute on function public.add_resume_banned_company_v38(uuid, text) to authenticated;
grant execute on function public.remove_resume_banned_company_v38(uuid, uuid) to authenticated;

-- Hard-block Application create when JD company matches the Resume ban list.
create or replace function public.require_resume_company_not_banned_v38()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company text;
  v_banned text;
begin
  select public.normalize_company_name(company) into v_company
  from public.job_descriptions
  where id = new.job_description_id;
  if v_company is null or v_company = '' then
    return new;
  end if;
  select b.company_name into v_banned
  from public.resume_banned_companies b
  where b.resume_id = new.resume_id
    and b.normalized_company = v_company
  limit 1;
  if v_banned is not null then
    raise exception 'APPLICATION_BANNED_COMPANY: This Resume cannot be paired with % because that company is on the Resume ban list.', v_banned
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists applications_require_resume_company_not_banned_v38 on public.applications;
create trigger applications_require_resume_company_not_banned_v38
before insert or update of job_description_id, resume_id on public.applications
for each row execute function public.require_resume_company_not_banned_v38();

-- Bulk preview: mark banned pairs ineligible.
create or replace function public.preview_bulk_applications(p_selected_jd_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_ids uuid[];v_limit constant integer:=100;v_result jsonb;
begin
  perform public.assert_application_manager();
  select coalesce(array_agg(id order by id),array[]::uuid[]) into v_ids from(select distinct id from unnest(coalesce(p_selected_jd_ids,array[]::uuid[])) ids(id) where id is not null)x;
  if cardinality(v_ids)=0 then raise exception 'BULK_NO_JDS: Select at least one job description.' using errcode='22023';end if;
  if cardinality(v_ids)>v_limit then raise exception 'BULK_JD_LIMIT: You can select up to 100 job descriptions in one bulk operation.' using errcode='22023';end if;
  with requested as(select id from unnest(v_ids) requested_ids(id)),loaded as(
    select requested.id requested_id,jobs.id,jobs.company,jobs.job_title,jobs.category_id,jobs.status,jobs.review_status,categories.name category_name
    from requested left join public.job_descriptions jobs on jobs.id=requested.id
    left join public.categories categories on categories.id=jobs.category_id and categories.active
  ),combinations as(
    select concat(loaded.id,':',resumes.id) key,loaded.id job_description_id,resumes.id resume_id,loaded.company,loaded.job_title,
      loaded.category_id job_category_id,loaded.category_name job_category_name,resumes.resume_number,resumes.resume_type,
      resumes.candidate_name,resumes.resume_name,resumes.primary_category_id resume_category_id,resume_categories.name resume_category_name,
      applications.id existing_application_id,
      exists(
        select 1 from public.resume_banned_companies banned
        where banned.resume_id = resumes.id
          and banned.normalized_company = public.normalize_company_name(loaded.company)
      ) as banned_company,
      applications.id is null
        and not exists(
          select 1 from public.resume_banned_companies banned
          where banned.resume_id = resumes.id
            and banned.normalized_company = public.normalize_company_name(loaded.company)
        ) as eligible,
      case
        when applications.id is not null then 'EXISTING_APPLICATION'
        when exists(
          select 1 from public.resume_banned_companies banned
          where banned.resume_id = resumes.id
            and banned.normalized_company = public.normalize_company_name(loaded.company)
        ) then 'BANNED_COMPANY'
      end as exclusion_code,
      case
        when applications.id is not null then 'Application already exists'
        when exists(
          select 1 from public.resume_banned_companies banned
          where banned.resume_id = resumes.id
            and banned.normalized_company = public.normalize_company_name(loaded.company)
        ) then 'This Resume bans applications to this company'
      end as exclusion_reason
    from loaded join public.resumes resumes on resumes.primary_category_id=loaded.category_id and resumes.status='ACTIVE' and resumes.resume_type='ORIGINAL'
    left join public.categories resume_categories on resume_categories.id=resumes.primary_category_id
    left join public.applications applications on applications.job_description_id=loaded.id
      and coalesce((select parent_resume_id from public.resumes where id=applications.resume_id),applications.resume_id)=resumes.id
    where loaded.id is not null and loaded.status='ACTIVE' and loaded.review_status='APPROVED'
      and loaded.category_id is not null and loaded.category_name is not null
  ),invalid_jds as(
    select loaded.requested_id job_description_id,coalesce(loaded.company,'Unavailable job description') company,coalesce(loaded.job_title,'Unavailable') job_title,
      case when loaded.id is null then 'MISSING_JD' when loaded.status<>'ACTIVE' then 'INACTIVE_JD'
        when loaded.review_status<>'APPROVED' then 'UNAPPROVED_JD'
        when loaded.category_id is null or loaded.category_name is null then 'MISSING_CATEGORY' else 'NO_MATCHING_ACTIVE_RESUMES' end code,
      case when loaded.id is null then 'The job description does not exist or is unavailable.' when loaded.status<>'ACTIVE' then 'The job description is archived.'
        when loaded.review_status<>'APPROVED' then 'The job description has not been approved.'
        when loaded.category_id is null or loaded.category_name is null then 'The job description has no valid primary category.' else 'No active original Resumes have the same primary category.' end reason
    from loaded where loaded.id is null or loaded.status<>'ACTIVE' or loaded.review_status<>'APPROVED' or loaded.category_id is null or loaded.category_name is null
      or not exists(select 1 from combinations where combinations.job_description_id=loaded.id)
  ) select jsonb_build_object('selectedJdCount',cardinality(v_ids),'validJdCount',cardinality(v_ids)-(select count(*) from invalid_jds),
    'invalidJdCount',(select count(*) from invalid_jds),'activeResumeCount',(select count(distinct resume_id) from combinations),
    'proposedCount',(select count(*) from combinations),'eligibleCount',(select count(*) from combinations where eligible),
    'duplicateCount',(select count(*) from combinations where not eligible and exclusion_code='EXISTING_APPLICATION'),
    'excludedCount',(select count(*) from combinations where not eligible)+(select count(*) from invalid_jds),
    'combinations',coalesce((select jsonb_agg(jsonb_build_object('key',key,'jobDescriptionId',job_description_id,'resumeId',resume_id,'resumeNumber',resume_number,'resumeType',resume_type,
      'company',company,'jobTitle',job_title,'jobCategoryId',job_category_id,'jobCategoryName',job_category_name,'candidateName',candidate_name,'resumeName',resume_name,
      'resumeCategoryId',resume_category_id,'resumeCategoryName',resume_category_name,'eligible',eligible,'existingApplicationId',existing_application_id,
      'exclusionCode',exclusion_code,'exclusionReason',exclusion_reason)order by company,job_title,candidate_name,resume_name)from combinations),'[]'::jsonb),
    'invalidJds',coalesce((select jsonb_agg(jsonb_build_object('jobDescriptionId',job_description_id,'company',company,'jobTitle',job_title,'code',code,'reason',reason)order by company,job_title)from invalid_jds),'[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;

-- Bulk create: soft-skip banned pairs before insert (trigger remains the hard backstop).
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
