-- When any Application is marked BLOCKED, block that Job Description for all profiles:
-- cancel other open Applications on the same JD and prevent new Applications/matching.

alter table public.job_descriptions
  add column if not exists application_blocked_at timestamptz,
  add column if not exists application_blocked_by uuid references auth.users(id),
  add column if not exists application_blocked_notes text not null default '',
  add column if not exists application_blocked_from_application_id uuid references public.applications(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'job_descriptions_application_blocked_notes_length'
      and conrelid = 'public.job_descriptions'::regclass
  ) then
    alter table public.job_descriptions
      add constraint job_descriptions_application_blocked_notes_length
      check (char_length(application_blocked_notes) <= 2000);
  end if;
end $$;

create index if not exists job_descriptions_application_blocked_at_idx
  on public.job_descriptions(application_blocked_at)
  where application_blocked_at is not null;

comment on column public.job_descriptions.application_blocked_at is
  'When set, this JD is blocked for Applications across all profiles (from a BLOCKED Application).';
comment on column public.job_descriptions.application_blocked_notes is
  'Why the JD was blocked for applications (usually the Application block notes).';

create or replace function public.job_description_open_for_applications(p_job_description_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists(
    select 1
    from public.job_descriptions j
    where j.id = p_job_description_id
      and j.status = 'ACTIVE'
      and j.review_status = 'APPROVED'
      and j.application_blocked_at is null
  );
$$;

revoke all on function public.job_description_open_for_applications(uuid) from public, anon;
grant execute on function public.job_description_open_for_applications(uuid) to authenticated;

create or replace function public.require_active_job_description_for_application_v24()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.job_descriptions;
begin
  select * into v_job from public.job_descriptions where id = new.job_description_id;
  if not found or v_job.status <> 'ACTIVE' or v_job.review_status <> 'APPROVED' then
    raise exception 'APPLICATION_UNAPPROVED_JOB: Approve the job description before creating an Application.' using errcode = 'P0001';
  end if;
  if v_job.application_blocked_at is not null then
    raise exception 'APPLICATION_JOB_BLOCKED: This job was blocked for all profiles (%).',
      coalesce(nullif(btrim(v_job.application_blocked_notes), ''), 'see Application notes')
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create or replace function public.cancel_sibling_applications_for_blocked_job_v385(
  p_job_description_id uuid,
  p_source_application_id uuid,
  p_actor uuid,
  p_notes text
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sibling public.applications;
  v_updated public.applications;
  v_count integer := 0;
  v_notes text := left(coalesce(nullif(btrim(p_notes), ''), 'Blocked for all profiles.'), 2000);
  v_cancel_notes text := left('Cancelled because this job was blocked for all profiles: ' || v_notes, 2000);
begin
  for v_sibling in
    select *
    from public.applications
    where job_description_id = p_job_description_id
      and id <> p_source_application_id
      and status in ('UNASSIGNED', 'ASSIGNED', 'IN_PROGRESS', 'BLOCKED')
    order by id
    for update
  loop
    update public.applications
    set
      status = 'CANCELLED',
      notes = case
        when nullif(btrim(coalesce(notes, '')), '') is null then v_cancel_notes
        else left(btrim(notes) || E'\n' || v_cancel_notes, 10000)
      end,
      updated_at = now()
    where id = v_sibling.id
    returning * into v_updated;

    insert into public.application_status_history(
      application_id, status_type, previous_status, new_status, changed_by, notes
    ) values (
      v_updated.id, 'STATUS', v_sibling.status, 'CANCELLED', p_actor, v_cancel_notes
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.cancel_sibling_applications_for_blocked_job_v385(uuid, uuid, uuid, text) from public, anon, authenticated;

create or replace function public.update_application_status_v101(
  p_application_id uuid,
  p_status text,
  p_application_url text,
  p_applied_at timestamptz,
  p_notes text,
  p_priority text,
  p_due_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_current public.applications;
  v_updated public.applications;
  v_manager boolean;
  v_status text := upper(trim(coalesce(p_status, '')));
  v_priority text := upper(trim(coalesce(p_priority, '')));
  v_applied_at timestamptz := p_applied_at;
  v_notes text := nullif(trim(coalesce(p_notes, '')), '');
  v_siblings_cancelled integer := 0;
  v_block_notes text;
begin
  select * into v_current from public.applications where id = p_application_id for update;
  if not found then
    raise exception 'APPLICATION_NOT_FOUND: The Application was not found.' using errcode = 'P0001';
  end if;
  v_manager := public.application_actor_can_manage();
  if not v_manager and not (
    public.is_active_user(v_actor)
    and public.has_role('APPLIER', v_actor)
    and v_current.assigned_to = v_actor
  ) then
    raise exception 'APPLICATION_ACCESS_DENIED: You cannot update this Application.' using errcode = '42501';
  end if;
  if v_status not in (
    'UNASSIGNED', 'ASSIGNED', 'IN_PROGRESS', 'BLOCKED', 'APPLIED', 'SCREENING',
    'INTERVIEW_SCHEDULED', 'OFFER_RECEIVED', 'REJECTED', 'WITHDRAWN', 'CLOSED', 'CANCELLED'
  ) then
    raise exception 'APPLICATION_INVALID_STATUS: Select a valid status.' using errcode = '22023';
  end if;
  if v_current.assigned_to is null and v_status not in ('UNASSIGNED', 'CANCELLED') then
    raise exception 'APPLICATION_UNASSIGNED: Assign an Applier before changing status.' using errcode = 'P0001';
  end if;
  if v_current.assigned_to is not null and v_status = 'UNASSIGNED' then
    raise exception 'APPLICATION_ASSIGNED: Unassign the Application instead of selecting Unassigned.' using errcode = 'P0001';
  end if;
  if not v_manager and v_status in ('UNASSIGNED', 'CANCELLED') then
    raise exception 'APPLICATION_PROTECTED_FIELDS: Appliers cannot cancel or unassign Applications.' using errcode = '42501';
  end if;
  if char_length(coalesce(p_application_url, '')) > 4000
    or (
      nullif(trim(coalesce(p_application_url, '')), '') is not null
      and p_application_url !~* '^https?://'
    )
  then
    raise exception 'APPLICATION_INVALID_URL: Enter a valid HTTP or HTTPS URL.' using errcode = '22023';
  end if;
  if v_manager and v_priority not in ('LOW', 'NORMAL', 'HIGH', 'URGENT') then
    raise exception 'APPLICATION_INVALID_PRIORITY: Select a valid priority.' using errcode = '22023';
  end if;
  if char_length(coalesce(p_notes, '')) > 10000 then
    raise exception 'APPLICATION_INVALID_NOTES: Notes cannot exceed 10000 characters.' using errcode = '22023';
  end if;
  if v_status = 'BLOCKED' and v_notes is null then
    raise exception 'APPLICATION_NOTES_REQUIRED: Add a note explaining why this Application is blocked.' using errcode = '22023';
  end if;
  if v_status = 'APPLIED' and v_applied_at is null then
    v_applied_at := coalesce(v_current.applied_at, now());
  end if;
  if not v_manager and v_status = 'APPLIED' and v_current.status is distinct from v_status then
    if coalesce(nullif(trim(coalesce(p_application_url, '')), ''), v_current.application_url) is null then
      raise exception 'APPLICATION_APPLIED_REQUIRES_URL: Add an Application URL before marking this Application Applied.' using errcode = '22023';
    end if;
    if not exists(select 1 from public.application_screenshots where application_id = p_application_id) then
      raise exception 'APPLICATION_APPLIED_REQUIRES_SCREENSHOT: Attach at least one confirmation screenshot before marking this Application Applied.' using errcode = '22023';
    end if;
  end if;

  update public.applications set
    status = v_status,
    application_url = nullif(trim(coalesce(p_application_url, '')), ''),
    applied_at = case
      when v_manager then v_applied_at
      when v_status = 'APPLIED' then coalesce(v_current.applied_at, now())
      else v_current.applied_at
    end,
    notes = case when p_notes is null and not v_manager then notes else v_notes end,
    priority = case when v_manager then v_priority else priority end,
    due_at = case when v_manager then p_due_at else due_at end,
    updated_at = now()
  where id = p_application_id
  returning * into v_updated;

  if v_current.status is distinct from v_updated.status then
    insert into public.application_status_history(
      application_id, status_type, previous_status, new_status, changed_by, notes
    ) values (
      v_updated.id, 'STATUS', v_current.status, v_updated.status, v_actor,
      nullif(left(coalesce(v_notes, ''), 2000), '')
    );
  end if;

  if v_updated.status = 'BLOCKED' and v_current.status is distinct from 'BLOCKED' then
    v_block_notes := left(coalesce(v_notes, 'Blocked for all profiles.'), 2000);
    update public.job_descriptions set
      application_blocked_at = coalesce(application_blocked_at, now()),
      application_blocked_by = coalesce(application_blocked_by, v_actor),
      application_blocked_notes = case
        when nullif(btrim(application_blocked_notes), '') is null then v_block_notes
        else application_blocked_notes
      end,
      application_blocked_from_application_id = coalesce(application_blocked_from_application_id, v_updated.id),
      updated_at = now()
    where id = v_updated.job_description_id;

    v_siblings_cancelled := public.cancel_sibling_applications_for_blocked_job_v385(
      v_updated.job_description_id,
      v_updated.id,
      v_actor,
      v_block_notes
    );
  end if;

  return to_jsonb(v_updated) || jsonb_build_object(
    'job_application_blocked', exists(
      select 1 from public.job_descriptions j
      where j.id = v_updated.job_description_id and j.application_blocked_at is not null
    ),
    'siblings_cancelled', v_siblings_cancelled
  );
end;
$$;

create or replace function public.unblock_job_description_applications_v385(
  p_job_description_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.job_descriptions;
  v_reason text := left(btrim(coalesce(p_reason, '')), 2000);
begin
  perform public.assert_application_manager();
  select * into v_job from public.job_descriptions where id = p_job_description_id for update;
  if not found then
    raise exception 'JOB_NOT_FOUND: The job description was not found.' using errcode = 'P0001';
  end if;
  update public.job_descriptions set
    application_blocked_at = null,
    application_blocked_by = null,
    application_blocked_notes = '',
    application_blocked_from_application_id = null,
    updated_at = now()
  where id = p_job_description_id
  returning * into v_job;
  return jsonb_build_object(
    'id', v_job.id,
    'company', v_job.company,
    'jobTitle', v_job.job_title,
    'applicationBlockedAt', v_job.application_blocked_at,
    'unblockedReason', nullif(v_reason, '')
  );
end;
$$;

revoke all on function public.unblock_job_description_applications_v385(uuid, text) from public, anon;
grant execute on function public.unblock_job_description_applications_v385(uuid, text) to authenticated;

create or replace function public.list_application_jobs(p_search text default '', p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  perform public.assert_application_manager();
  select coalesce(jsonb_agg(to_jsonb(x) order by x.company, x.job_title), '[]'::jsonb)
  into v_result
  from (
    select j.id, j.company, j.job_title, j.category_id, j.status
    from public.job_descriptions j
    where j.status = 'ACTIVE'
      and j.review_status = 'APPROVED'
      and j.application_blocked_at is null
      and (
        coalesce(trim(p_search), '') = ''
        or j.search_vector @@ websearch_to_tsquery('english', trim(p_search))
      )
    order by j.company, j.job_title
    limit least(greatest(coalesce(p_limit, 100), 1), 200)
  ) x;
  return v_result;
end;
$$;

-- Matching / category create: exclude application-blocked JDs.
create or replace function public.list_category_application_resumes_v377(
  p_job_description_id uuid,
  p_search text default '',
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  perform public.assert_application_manager();
  if not public.job_description_open_for_applications(p_job_description_id) then
    raise exception 'APPLICATION_JOB_BLOCKED: This job was blocked for all profiles.' using errcode = 'P0001';
  end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.candidate_name, x.resume_name), '[]'::jsonb)
  into v_result
  from (
    select r.id, r.resume_number, r.resume_type, r.candidate_name, r.resume_name, r.primary_category_id, r.seniority, true same_category
    from public.resumes r
    where r.status = 'ACTIVE'
      and r.resume_type = 'ORIGINAL'
      and public.application_category_candidate_v377(p_job_description_id, r.id)
      and exists(
        select 1 from public.job_descriptions j
        where j.id = p_job_description_id
          and j.status = 'ACTIVE'
          and j.review_status = 'APPROVED'
          and j.application_blocked_at is null
      )
      and (
        coalesce(trim(p_search), '') = ''
        or r.search_vector @@ websearch_to_tsquery('english', trim(p_search))
        or (
          regexp_replace(upper(trim(p_search)), '^(RESUME[- ]?|#)', '') ~ '^[0-9]+$'
          and r.resume_number::text = regexp_replace(upper(trim(p_search)), '^(RESUME[- ]?|#)', '')
        )
      )
    order by r.candidate_name, r.resume_name
    limit least(greatest(coalesce(p_limit, 100), 1), 200)
  ) x;
  return v_result;
end;
$$;

create or replace function public.list_application_resumes(
  p_job_description_id uuid,
  p_search text default '',
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  perform public.assert_application_manager();
  if not public.job_description_open_for_applications(p_job_description_id) then
    raise exception 'APPLICATION_JOB_BLOCKED: This job was blocked for all profiles.' using errcode = 'P0001';
  end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.candidate_name, x.resume_name), '[]'::jsonb)
  into v_result
  from (
    select r.id, r.resume_number, r.resume_type, r.candidate_name, r.resume_name, r.primary_category_id, r.seniority, true same_category
    from public.resumes r
    where r.status = 'ACTIVE'
      and r.resume_type = 'ORIGINAL'
      and public.application_match_category_matches(p_job_description_id, r.id)
      and exists(
        select 1 from public.job_descriptions j
        where j.id = p_job_description_id
          and j.status = 'ACTIVE'
          and j.review_status = 'APPROVED'
          and j.application_blocked_at is null
      )
      and (
        coalesce(trim(p_search), '') = ''
        or r.search_vector @@ websearch_to_tsquery('english', trim(p_search))
        or (
          regexp_replace(upper(trim(p_search)), '^(RESUME[- ]?|#)', '') ~ '^[0-9]+$'
          and r.resume_number::text = regexp_replace(upper(trim(p_search)), '^(RESUME[- ]?|#)', '')
        )
      )
    order by r.candidate_name, r.resume_name
    limit least(greatest(coalesce(p_limit, 100), 1), 200)
  ) x;
  return v_result;
end;
$$;

-- Matching / bulk eligibility: treat application-blocked JDs as ineligible.
create or replace function public.application_match_eligibility(p_job_id uuid, p_resume_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  j public.job_descriptions;
  r public.resumes;
  s public.application_match_settings;
  a public.application_match_assessments;
  existing_id uuid;
  code text;
  reason text;
  state text;
begin
  select * into s from public.application_match_settings where singleton;
  select * into j from public.job_descriptions where id = p_job_id;
  select * into r from public.resumes where id = p_resume_id;
  select x.id into existing_id
  from public.applications x
  join public.resumes xr on xr.id = x.resume_id
  where x.job_description_id = p_job_id
    and coalesce(xr.parent_resume_id, xr.id) = coalesce(r.parent_resume_id, r.id)
  limit 1;
  select * into a
  from public.application_match_assessments x
  where x.job_description_id = p_job_id
    and x.resume_id = p_resume_id
    and x.jd_hash = j.matching_hash
    and x.resume_hash = r.matching_hash
    and x.rubric_version = s.rubric_version
    and x.extractor_version = s.extractor_version
    and x.model_id = s.model_id;
  state := coalesce(a.status, case
    when exists(
      select 1 from public.application_match_assessments x
      where x.job_description_id = p_job_id and x.resume_id = p_resume_id
    ) then 'STALE'
    else 'NOT_ASSESSED'
  end);
  if j.id is null then
    code := 'MISSING_JD'; reason := 'The job description is unavailable.';
  elsif r.id is null then
    code := 'MISSING_RESUME'; reason := 'The Resume is unavailable.';
  elsif existing_id is not null then
    code := 'EXISTING_APPLICATION'; reason := 'Application already exists for this original Resume family.';
  elsif j.status <> 'ACTIVE' then
    code := 'INACTIVE_JD'; reason := 'The job description is archived.';
  elsif j.review_status <> 'APPROVED' then
    code := 'UNAPPROVED_JD'; reason := 'The job description must be approved.';
  elsif j.application_blocked_at is not null then
    code := 'APPLICATION_JOB_BLOCKED';
    reason := coalesce(nullif(btrim(j.application_blocked_notes), ''), 'This job was blocked for all profiles.');
  elsif r.status <> 'ACTIVE' then
    code := 'INACTIVE_RESUME'; reason := 'The original Resume is archived.';
  elsif r.resume_type <> 'ORIGINAL' then
    code := 'ORIGINAL_RESUME_REQUIRED'; reason := 'Select an original Resume.';
  elsif not exists(
    select 1 from public.categories c
    where c.id = j.category_id and c.active and c.parent_id is null
  ) then
    code := 'MISSING_CATEGORY'; reason := 'Assign an active primary category to the JD before matching.';
  elsif not public.application_match_category_matches(j.id, r.id) then
    code := 'PRIMARY_CATEGORY_MISMATCH';
    reason := 'The JD must share a primary category with the original Resume; subcategories are ignored.';
  elsif exists(
    select 1 from public.resume_banned_companies b
    where b.resume_id = r.id
      and b.normalized_company = public.normalize_company_name(j.company)
  ) then
    code := 'BANNED_COMPANY'; reason := 'This Resume bans applications to this company.';
  elsif s.model_id = 'UNCONFIGURED' then
    code := 'MATCHING_NOT_CONFIGURED'; reason := 'Configure the scoring worker and model before scoring.';
  elsif state <> 'COMPLETED' then
    code := 'MATCH_' || state;
    reason := case state
      when 'NOT_ASSESSED' then 'Request a match score.'
      when 'STALE' then 'Source or scoring configuration changed; rescore this pair.'
      when 'FAILED' then 'Scoring failed; retry this pair.'
      when 'INSUFFICIENT_DATA' then 'Add substantive JD requirements and original Resume experience, then rescore.'
      else 'Scoring is pending or in progress.'
    end;
  elsif a.score < s.threshold then
    code := 'BELOW_THRESHOLD'; reason := 'Match score is below the current threshold.';
  end if;
  return jsonb_build_object(
    'eligible', code is null,
    'exclusionCode', code,
    'exclusionReason', reason,
    'existingApplicationId', existing_id,
    'assessmentId', a.id,
    'matchStatus', state,
    'matchScore', a.score,
    'matchThreshold', s.threshold,
    'matchDetails', a.result,
    'matchErrorCode', a.error_code
  );
end;
$$;

create or replace function public.application_category_eligibility_v377(p_job_id uuid, p_resume_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  j public.job_descriptions;
  r public.resumes;
  existing_id uuid;
  code text;
  reason text;
begin
  select * into j from public.job_descriptions where id = p_job_id;
  select * into r from public.resumes where id = p_resume_id;
  select a.id into existing_id
  from public.applications a
  join public.resumes ar on ar.id = a.resume_id
  where a.job_description_id = p_job_id
    and coalesce(ar.parent_resume_id, ar.id) = coalesce(r.parent_resume_id, r.id)
  limit 1;
  if j.id is null then
    code := 'MISSING_JD'; reason := 'The job description is unavailable.';
  elsif r.id is null then
    code := 'MISSING_RESUME'; reason := 'The Resume is unavailable.';
  elsif existing_id is not null then
    code := 'EXISTING_APPLICATION'; reason := 'Application already exists for this original Resume family.';
  elsif j.status <> 'ACTIVE' then
    code := 'INACTIVE_JD'; reason := 'The job description is archived.';
  elsif j.review_status <> 'APPROVED' then
    code := 'UNAPPROVED_JD'; reason := 'The job description must be approved.';
  elsif j.application_blocked_at is not null then
    code := 'APPLICATION_JOB_BLOCKED';
    reason := coalesce(nullif(btrim(j.application_blocked_notes), ''), 'This job was blocked for all profiles.');
  elsif r.status <> 'ACTIVE' then
    code := 'INACTIVE_RESUME'; reason := 'The original Resume is archived.';
  elsif r.resume_type <> 'ORIGINAL' then
    code := 'ORIGINAL_RESUME_REQUIRED'; reason := 'Select an original Resume.';
  elsif not exists(
    select 1 from public.categories c
    where c.id = j.category_id and c.active and c.parent_id is null
  ) then
    code := 'MISSING_CATEGORY'; reason := 'Assign an active primary category to the JD before matching.';
  elsif not public.application_category_candidate_v377(j.id, r.id) then
    code := 'CATEGORY_MISMATCH';
    reason := 'A shared primary category is required; Software Engineering also requires the JD subcategory when set.';
  elsif exists(
    select 1 from public.resume_banned_companies b
    where b.resume_id = r.id
      and b.normalized_company = public.normalize_company_name(j.company)
  ) then
    code := 'BANNED_COMPANY'; reason := 'This Resume bans applications to this company.';
  end if;
  return jsonb_build_object(
    'eligible', code is null,
    'exclusionCode', code,
    'exclusionReason', reason,
    'existingApplicationId', existing_id,
    'matchingMode', 'CATEGORY',
    'assessmentId', null,
    'matchStatus', 'NOT_REQUIRED',
    'matchScore', null,
    'matchThreshold', null,
    'matchDetails', null,
    'matchErrorCode', null
  );
end;
$$;

-- Surface JD application-block state on Application detail.
create or replace function public.get_application_detail(p_application_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_app public.applications;
  v_result jsonb;
begin
  select * into v_app from public.applications where id = p_application_id;
  if not found or not public.application_actor_can_view(v_app.assigned_to) then
    raise exception 'APPLICATION_NOT_FOUND: The Application was not found or is not accessible.' using errcode = 'P0001';
  end if;
  select jsonb_build_object(
    'application', to_jsonb(v_app),
    'job', jsonb_build_object(
      'id', j.id,
      'company', j.company,
      'job_title', j.job_title,
      'category_id', j.category_id,
      'description_text', j.description_text,
      'source_url', j.source_url,
      'location_text', j.location_text,
      'work_arrangement', j.work_arrangement,
      'application_blocked_at', j.application_blocked_at,
      'application_blocked_notes', j.application_blocked_notes,
      'application_blocked_from_application_id', j.application_blocked_from_application_id
    ),
    'resume', jsonb_build_object(
      'id', r.id,
      'candidate_name', r.candidate_name,
      'resume_name', r.resume_name,
      'primary_category_id', r.primary_category_id,
      'seniority', r.seniority,
      'skills', r.skills,
      'original_filename', r.original_filename
    ),
    'assignee', case
      when ap.id is null then null
      else jsonb_build_object(
        'id', ap.id,
        'email', ap.email,
        'display_name', coalesce(nullif(ap.full_name, ''), ap.email)
      )
    end,
    'creator', jsonb_build_object(
      'id', cp.id,
      'email', cp.email,
      'display_name', coalesce(nullif(cp.full_name, ''), cp.email)
    ),
    'assignment_history', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', h.id,
        'previous_assignee_id', h.previous_assignee_id,
        'previous_assignee', coalesce(nullif(pp.full_name, ''), pp.email),
        'new_assignee_id', h.new_assignee_id,
        'new_assignee', coalesce(nullif(np.full_name, ''), np.email),
        'assigned_by', coalesce(nullif(bp.full_name, ''), bp.email),
        'reason', h.reason,
        'created_at', h.created_at
      ) order by h.created_at desc), '[]'::jsonb)
      from public.application_assignment_history h
      left join public.profiles pp on pp.id = h.previous_assignee_id
      left join public.profiles np on np.id = h.new_assignee_id
      left join public.profiles bp on bp.id = h.assigned_by
      where h.application_id = v_app.id
    ),
    'status_history', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', h.id,
        'status_type', h.status_type,
        'previous_status', h.previous_status,
        'new_status', h.new_status,
        'changed_by', coalesce(nullif(p.full_name, ''), p.email),
        'notes', h.notes,
        'created_at', h.created_at
      ) order by h.created_at desc), '[]'::jsonb)
      from public.application_status_history h
      left join public.profiles p on p.id = h.changed_by
      where h.application_id = v_app.id
    )
  ) into v_result
  from public.job_descriptions j
  join public.resumes r on r.id = v_app.resume_id
  left join public.profiles ap on ap.id = v_app.assigned_to
  join public.profiles cp on cp.id = v_app.created_by
  where j.id = v_app.job_description_id;
  return v_result;
end;
$$;

-- Backfill: any existing BLOCKED Application blocks its JD for all profiles.
with first_blocked as (
  select distinct on (job_description_id)
    id,
    job_description_id,
    assigned_to,
    created_by,
    notes,
    updated_at
  from public.applications
  where status = 'BLOCKED'
  order by job_description_id, updated_at asc nulls last, id
)
update public.job_descriptions j
set
  application_blocked_at = coalesce(j.application_blocked_at, coalesce(fb.updated_at, now())),
  application_blocked_by = coalesce(j.application_blocked_by, fb.assigned_to, fb.created_by),
  application_blocked_notes = case
    when nullif(btrim(j.application_blocked_notes), '') is null
      then left(coalesce(nullif(btrim(fb.notes), ''), 'Blocked for all profiles.'), 2000)
    else j.application_blocked_notes
  end,
  application_blocked_from_application_id = coalesce(j.application_blocked_from_application_id, fb.id),
  updated_at = now()
from first_blocked fb
where j.id = fb.job_description_id
  and j.application_blocked_at is null;

with to_cancel as (
  select
    a.id,
    a.status as previous_status,
    a.notes,
    coalesce(j.application_blocked_by, a.assigned_to, a.created_by) as actor_id,
    left(
      'Cancelled because this job was blocked for all profiles: '
        || coalesce(nullif(btrim(j.application_blocked_notes), ''), 'Blocked for all profiles.'),
      2000
    ) as cancel_notes
  from public.applications a
  join public.job_descriptions j on j.id = a.job_description_id
  where j.application_blocked_at is not null
    and a.id is distinct from j.application_blocked_from_application_id
    and a.status in ('UNASSIGNED', 'ASSIGNED', 'IN_PROGRESS', 'BLOCKED')
),
updated as (
  update public.applications a
  set
    status = 'CANCELLED',
    notes = case
      when nullif(btrim(coalesce(a.notes, '')), '') is null then t.cancel_notes
      else left(btrim(a.notes) || E'\n' || t.cancel_notes, 10000)
    end,
    updated_at = now()
  from to_cancel t
  where a.id = t.id
  returning a.id, t.previous_status, t.actor_id, t.cancel_notes
)
insert into public.application_status_history(
  application_id, status_type, previous_status, new_status, changed_by, notes
)
select id, 'STATUS', previous_status, 'CANCELLED', actor_id, cancel_notes
from updated;
