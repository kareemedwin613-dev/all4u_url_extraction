-- Interviewee is the person who attends a scheduled interview.
-- Admins assign the role. The Calendar shows that person only their own interviews.

insert into public.roles (code, name, description, active, is_system)
values (
  'INTERVIEWEE',
  'Interviewee',
  'Attends scheduled interviews and can view those interviews on the Calendar.',
  true,
  true
)
on conflict (code) do update
set name = excluded.name,
    description = excluded.description,
    active = true,
    is_system = true;

alter table public.interviews
  add column if not exists interviewee_user_id uuid references public.profiles(id) on delete set null;

create index if not exists interviews_interviewee_user_idx
  on public.interviews (interviewee_user_id);

create or replace function public.interview_row_editable(
  p_application_id uuid,
  p_assigned_to uuid,
  p_created_by uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_active_user(auth.uid())
    and (
      public.application_actor_can_manage()
      or (
        public.has_role('APPLIER', auth.uid())
        and (
          p_assigned_to = auth.uid()
          or (p_application_id is null and p_created_by = auth.uid())
        )
      )
    );
$$;

create or replace function public.interview_row_visible(
  p_application_id uuid,
  p_assigned_to uuid,
  p_created_by uuid,
  p_interviewee_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.interview_row_editable(p_application_id, p_assigned_to, p_created_by)
    or (
      public.is_active_user(auth.uid())
      and public.has_role('INTERVIEWEE', auth.uid())
      and p_interviewee_user_id = auth.uid()
    );
$$;

revoke all on function public.interview_row_editable(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.interview_row_visible(uuid, uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public.interview_json(p_row public.interviews)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', p_row.id,
    'applicationId', p_row.application_id,
    'applicationNumber', (
      select a.application_number from public.applications a where a.id = p_row.application_id
    ),
    'intervieweeUserId', p_row.interviewee_user_id,
    'startsAt', p_row.starts_at,
    'endsAt', p_row.ends_at,
    'intervieweeName', p_row.interviewee_name,
    'profileEmail', p_row.profile_email,
    'profilePhone', p_row.profile_phone,
    'professionalStack', p_row.professional_stack,
    'companyName', p_row.company_name,
    'companyWebsite', p_row.company_website,
    'jobLink', p_row.job_link,
    'roleTitle', p_row.role_title,
    'jobType', p_row.job_type,
    'location', p_row.location,
    'salaryRange', p_row.salary_range,
    'stage', p_row.stage,
    'status', p_row.status,
    'interviewType', p_row.interview_type,
    'meetingUrl', p_row.meeting_url,
    'meetingId', p_row.meeting_id,
    'passcode', p_row.passcode,
    'recruiterName', p_row.recruiter_name,
    'recruiterEmail', p_row.recruiter_email,
    'recruiterPhone', p_row.recruiter_phone,
    'interviewers', p_row.interviewers,
    'linkedinUrl', p_row.linkedin_url,
    'resumeLink', p_row.resume_link,
    'place', p_row.place,
    'appliedDate', p_row.applied_date,
    'notes', p_row.notes,
    'createdBy', p_row.created_by,
    'createdAt', p_row.created_at,
    'updatedAt', p_row.updated_at,
    'rounds', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'roundName', r.round_name,
        'startsAt', r.starts_at,
        'interviewer', r.interviewer,
        'status', r.status,
        'notes', r.notes
      ) order by r.sort_order)
      from public.interview_rounds r
      where r.interview_id = p_row.id
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.interview_json(public.interviews) from public, anon, authenticated;

create or replace function public.list_interviewee_users_v140()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_items jsonb;
begin
  if not public.is_active_user(auth.uid())
    or not (
      public.application_actor_can_manage()
      or public.has_role('APPLIER', auth.uid())
    ) then
    raise exception 'FORBIDDEN: You cannot choose an interviewee.' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'fullName', coalesce(nullif(btrim(p.full_name), ''), p.email),
    'email', p.email
  ) order by coalesce(nullif(btrim(p.full_name), ''), p.email), p.email), '[]'::jsonb)
  into v_items
  from public.profiles p
  where p.status = 'ACTIVE'
    and exists (
      select 1
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id
      where ur.user_id = p.id and r.code = 'INTERVIEWEE' and r.active
    );
  return v_items;
end;
$$;

create or replace function public.list_interviews_v139(
  p_from timestamptz,
  p_to timestamptz,
  p_application_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_assigned uuid;
  v_items jsonb;
begin
  if not public.is_active_user(auth.uid())
    or not (
      public.application_actor_can_manage()
      or public.has_role('APPLIER', auth.uid())
      or public.has_role('INTERVIEWEE', auth.uid())
    ) then
    raise exception 'FORBIDDEN: You cannot view interviews.' using errcode = '42501';
  end if;
  if p_application_id is not null then
    select a.assigned_to into v_assigned from public.applications a where a.id = p_application_id;
    if not found or not public.application_actor_can_view(v_assigned) then
      raise exception 'INTERVIEW_APPLICATION_NOT_FOUND: The Application was not found or is not accessible.' using errcode = 'P0001';
    end if;
  elsif p_from is null or p_to is null or p_from >= p_to or p_to - p_from > interval '120 days' then
    raise exception 'VALIDATION_ERROR: Select an interview range of 120 days or less.' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(public.interview_json(i) order by i.starts_at), '[]'::jsonb)
  into v_items
  from public.interviews i
  left join public.applications a on a.id = i.application_id
  where public.interview_row_visible(i.application_id, a.assigned_to, i.created_by, i.interviewee_user_id)
    and (
      (p_application_id is not null and i.application_id = p_application_id)
      or (
        p_application_id is null
        and i.starts_at < p_to
        and i.ends_at > p_from
      )
    );
  return jsonb_build_object('items', v_items);
end;
$$;

create or replace function public.get_interview_v139(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.interviews;
  v_assigned uuid;
begin
  select * into v_row from public.interviews where id = p_id;
  if not found then
    raise exception 'INTERVIEW_NOT_FOUND: The interview was not found.' using errcode = 'P0001';
  end if;
  select a.assigned_to into v_assigned from public.applications a where a.id = v_row.application_id;
  if not public.interview_row_visible(v_row.application_id, v_assigned, v_row.created_by, v_row.interviewee_user_id) then
    raise exception 'INTERVIEW_NOT_FOUND: The interview was not found.' using errcode = 'P0001';
  end if;
  return public.interview_json(v_row);
end;
$$;

create or replace function public.save_interview_v139(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_application_id uuid;
  v_interviewee_id uuid;
  v_app public.applications;
  v_existing public.interviews;
  v_assigned uuid;
  v_starts timestamptz;
  v_ends timestamptz;
  v_stage text;
  v_status text;
  v_type text;
  v_name text;
  v_company text;
  v_notes text;
  v_applied date;
  v_row public.interviews;
  v_round record;
  v_round_name text;
  v_round_status text;
  v_round_starts timestamptz;
begin
  if not public.is_active_user(auth.uid())
    or not (
      public.application_actor_can_manage()
      or public.has_role('APPLIER', auth.uid())
    ) then
    raise exception 'FORBIDDEN: You cannot record interviews.' using errcode = '42501';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'VALIDATION_ERROR: Interview details are required.' using errcode = '22023';
  end if;
  begin
    v_id := nullif(p_payload->>'id', '')::uuid;
    v_application_id := nullif(p_payload->>'applicationId', '')::uuid;
    v_interviewee_id := nullif(p_payload->>'intervieweeUserId', '')::uuid;
  exception when others then
    raise exception 'VALIDATION_ERROR: The interview, Application, or interviewee id is not valid.' using errcode = '22023';
  end;
  select left(coalesce(nullif(btrim(p.full_name), ''), p.email), 200)
  into v_name
  from public.profiles p
  where p.id = v_interviewee_id
    and p.status = 'ACTIVE'
    and exists (
      select 1
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id
      where ur.user_id = p.id and r.code = 'INTERVIEWEE' and r.active
    );
  if v_name is null then
    raise exception 'INTERVIEWEE_REQUIRED: Select an active user with the Interviewee role.' using errcode = 'P0001';
  end if;
  begin
    v_starts := nullif(p_payload->>'startsAt', '')::timestamptz;
    v_ends := nullif(p_payload->>'endsAt', '')::timestamptz;
  exception when others then
    raise exception 'VALIDATION_ERROR: Enter a valid interview start and end time.' using errcode = '22023';
  end;
  if v_starts is null or v_ends is null or v_ends <= v_starts or v_ends > v_starts + interval '24 hours' then
    raise exception 'VALIDATION_ERROR: The interview must end after it starts and last 24 hours or less.' using errcode = '22023';
  end if;
  v_company := nullif(btrim(regexp_replace(coalesce(p_payload->>'companyName', ''), '\s+', ' ', 'g')), '');
  if v_company is null or char_length(v_company) > 200 then
    raise exception 'VALIDATION_ERROR: Enter the company name, using 1 to 200 characters.' using errcode = '22023';
  end if;
  v_stage := upper(btrim(coalesce(p_payload->>'stage', '')));
  v_status := upper(btrim(coalesce(p_payload->>'status', '')));
  v_type := upper(btrim(coalesce(p_payload->>'interviewType', '')));
  if v_stage not in ('RECRUITER', 'HIRING_MANAGER', 'TECH', 'FINAL') then
    raise exception 'VALIDATION_ERROR: Select a stage: Recruiter, Hiring Manager, Tech, or Final.' using errcode = '22023';
  end if;
  if v_status not in ('UPCOMING', 'COMPLETED', 'RESCHEDULED', 'NEEDS_FOLLOW_UP') then
    raise exception 'VALIDATION_ERROR: Select a status: Upcoming, Completed, Rescheduled, or Needs Follow Up.' using errcode = '22023';
  end if;
  if v_type not in ('TEAMS', 'ZOOM', 'PHONE', 'VIDEO', 'OTHER') then
    raise exception 'VALIDATION_ERROR: Select an interview type.' using errcode = '22023';
  end if;
  v_notes := nullif(btrim(coalesce(p_payload->>'notes', '')), '');
  if v_notes is not null and char_length(v_notes) > 10000 then
    raise exception 'VALIDATION_ERROR: Notes cannot exceed 10000 characters.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from (values
      ('meetingUrl'), ('companyWebsite'), ('jobLink'), ('linkedinUrl'), ('resumeLink')
    ) as fields(key)
    where nullif(btrim(coalesce(p_payload->>fields.key, '')), '') is not null
      and (
        char_length(btrim(p_payload->>fields.key)) > 4000
        or btrim(p_payload->>fields.key) !~* '^https?://[^[:space:]]+$'
      )
  ) then
    raise exception 'VALIDATION_ERROR: Meeting, job, and profile links must be http or https links of 4000 characters or less.' using errcode = '22023';
  end if;
  if nullif(p_payload->>'appliedDate', '') is not null then
    begin
      v_applied := (p_payload->>'appliedDate')::date;
    exception when others then
      raise exception 'VALIDATION_ERROR: Enter a valid applied date.' using errcode = '22023';
    end;
  end if;
  if p_payload ? 'rounds' and jsonb_typeof(p_payload->'rounds') is distinct from 'array' then
    raise exception 'VALIDATION_ERROR: Interview rounds must be a list.' using errcode = '22023';
  end if;
  if coalesce(jsonb_array_length(p_payload->'rounds'), 0) > 8 then
    raise exception 'VALIDATION_ERROR: An interview can have at most 8 rounds.' using errcode = '22023';
  end if;
  if v_application_id is not null then
    select * into v_app from public.applications where id = v_application_id;
    if not found or not public.application_actor_can_view(v_app.assigned_to) then
      raise exception 'INTERVIEW_APPLICATION_NOT_FOUND: The Application was not found or is not accessible.' using errcode = 'P0001';
    end if;
  elsif not public.application_actor_can_manage() then
    raise exception 'INTERVIEW_APPLICATION_REQUIRED: Link this interview to an Application assigned to you.' using errcode = 'P0001';
  end if;
  if v_id is not null then
    select * into v_existing from public.interviews where id = v_id;
    if not found then
      raise exception 'INTERVIEW_NOT_FOUND: The interview was not found.' using errcode = 'P0001';
    end if;
    select a.assigned_to into v_assigned from public.applications a where a.id = v_existing.application_id;
    if not public.interview_row_editable(v_existing.application_id, v_assigned, v_existing.created_by) then
      raise exception 'INTERVIEW_NOT_FOUND: The interview was not found.' using errcode = 'P0001';
    end if;
    update public.interviews set
      application_id = v_application_id,
      interviewee_user_id = v_interviewee_id,
      starts_at = v_starts,
      ends_at = v_ends,
      interviewee_name = v_name,
      profile_email = nullif(btrim(coalesce(p_payload->>'profileEmail', '')), ''),
      profile_phone = nullif(btrim(coalesce(p_payload->>'profilePhone', '')), ''),
      professional_stack = nullif(btrim(coalesce(p_payload->>'professionalStack', '')), ''),
      company_name = v_company,
      company_website = nullif(btrim(coalesce(p_payload->>'companyWebsite', '')), ''),
      job_link = nullif(btrim(coalesce(p_payload->>'jobLink', '')), ''),
      role_title = nullif(btrim(coalesce(p_payload->>'roleTitle', '')), ''),
      job_type = nullif(btrim(coalesce(p_payload->>'jobType', '')), ''),
      location = nullif(btrim(coalesce(p_payload->>'location', '')), ''),
      salary_range = nullif(btrim(coalesce(p_payload->>'salaryRange', '')), ''),
      stage = v_stage,
      status = v_status,
      interview_type = v_type,
      meeting_url = nullif(btrim(coalesce(p_payload->>'meetingUrl', '')), ''),
      meeting_id = nullif(btrim(coalesce(p_payload->>'meetingId', '')), ''),
      passcode = nullif(btrim(coalesce(p_payload->>'passcode', '')), ''),
      recruiter_name = nullif(btrim(coalesce(p_payload->>'recruiterName', '')), ''),
      recruiter_email = nullif(btrim(coalesce(p_payload->>'recruiterEmail', '')), ''),
      recruiter_phone = nullif(btrim(coalesce(p_payload->>'recruiterPhone', '')), ''),
      interviewers = nullif(btrim(coalesce(p_payload->>'interviewers', '')), ''),
      linkedin_url = nullif(btrim(coalesce(p_payload->>'linkedinUrl', '')), ''),
      resume_link = nullif(btrim(coalesce(p_payload->>'resumeLink', '')), ''),
      place = nullif(btrim(coalesce(p_payload->>'place', '')), ''),
      applied_date = v_applied,
      notes = v_notes
    where id = v_id
    returning * into v_row;
  else
    insert into public.interviews (
      application_id, interviewee_user_id, starts_at, ends_at, interviewee_name, profile_email, profile_phone,
      professional_stack, company_name, company_website, job_link, role_title, job_type,
      location, salary_range, stage, status, interview_type, meeting_url, meeting_id, passcode,
      recruiter_name, recruiter_email, recruiter_phone, interviewers, linkedin_url, resume_link,
      place, applied_date, notes, created_by
    ) values (
      v_application_id, v_interviewee_id, v_starts, v_ends, v_name,
      nullif(btrim(coalesce(p_payload->>'profileEmail', '')), ''),
      nullif(btrim(coalesce(p_payload->>'profilePhone', '')), ''),
      nullif(btrim(coalesce(p_payload->>'professionalStack', '')), ''),
      v_company,
      nullif(btrim(coalesce(p_payload->>'companyWebsite', '')), ''),
      nullif(btrim(coalesce(p_payload->>'jobLink', '')), ''),
      nullif(btrim(coalesce(p_payload->>'roleTitle', '')), ''),
      nullif(btrim(coalesce(p_payload->>'jobType', '')), ''),
      nullif(btrim(coalesce(p_payload->>'location', '')), ''),
      nullif(btrim(coalesce(p_payload->>'salaryRange', '')), ''),
      v_stage, v_status, v_type,
      nullif(btrim(coalesce(p_payload->>'meetingUrl', '')), ''),
      nullif(btrim(coalesce(p_payload->>'meetingId', '')), ''),
      nullif(btrim(coalesce(p_payload->>'passcode', '')), ''),
      nullif(btrim(coalesce(p_payload->>'recruiterName', '')), ''),
      nullif(btrim(coalesce(p_payload->>'recruiterEmail', '')), ''),
      nullif(btrim(coalesce(p_payload->>'recruiterPhone', '')), ''),
      nullif(btrim(coalesce(p_payload->>'interviewers', '')), ''),
      nullif(btrim(coalesce(p_payload->>'linkedinUrl', '')), ''),
      nullif(btrim(coalesce(p_payload->>'resumeLink', '')), ''),
      nullif(btrim(coalesce(p_payload->>'place', '')), ''),
      v_applied, v_notes, auth.uid()
    )
    returning * into v_row;
  end if;
  delete from public.interview_rounds where interview_id = v_row.id;
  for v_round in
    select value, ordinality
    from jsonb_array_elements(coalesce(p_payload->'rounds', '[]'::jsonb)) with ordinality
  loop
    v_round_name := nullif(btrim(regexp_replace(coalesce(v_round.value->>'roundName', ''), '\s+', ' ', 'g')), '');
    if v_round_name is null or char_length(v_round_name) > 120 then
      raise exception 'VALIDATION_ERROR: Each round needs a name of 1 to 120 characters.' using errcode = '22023';
    end if;
    v_round_status := upper(btrim(coalesce(v_round.value->>'status', '')));
    if v_round_status not in ('', 'PASSED', 'UPCOMING', 'FAILED') then
      raise exception 'VALIDATION_ERROR: A round status must be Passed, Upcoming, or Failed.' using errcode = '22023';
    end if;
    v_round_starts := null;
    if nullif(v_round.value->>'startsAt', '') is not null then
      begin
        v_round_starts := (v_round.value->>'startsAt')::timestamptz;
      exception when others then
        raise exception 'VALIDATION_ERROR: Enter a valid date for each round.' using errcode = '22023';
      end;
    end if;
    if char_length(coalesce(v_round.value->>'notes', '')) > 2000 then
      raise exception 'VALIDATION_ERROR: Round notes cannot exceed 2000 characters.' using errcode = '22023';
    end if;
    insert into public.interview_rounds (interview_id, sort_order, round_name, starts_at, interviewer, status, notes)
    values (
      v_row.id,
      v_round.ordinality::integer,
      v_round_name,
      v_round_starts,
      nullif(btrim(coalesce(v_round.value->>'interviewer', '')), ''),
      v_round_status,
      nullif(btrim(coalesce(v_round.value->>'notes', '')), '')
    );
  end loop;
  return public.interview_json(v_row);
end;
$$;

create or replace function public.delete_interview_v139(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.interviews;
  v_assigned uuid;
begin
  if not public.is_active_user(auth.uid())
    or not (
      public.application_actor_can_manage()
      or public.has_role('APPLIER', auth.uid())
    ) then
    raise exception 'FORBIDDEN: You cannot delete interviews.' using errcode = '42501';
  end if;
  select * into v_row from public.interviews where id = p_id;
  if not found then
    raise exception 'INTERVIEW_NOT_FOUND: The interview was not found.' using errcode = 'P0001';
  end if;
  select a.assigned_to into v_assigned from public.applications a where a.id = v_row.application_id;
  if not public.interview_row_editable(v_row.application_id, v_assigned, v_row.created_by) then
    raise exception 'INTERVIEW_NOT_FOUND: The interview was not found.' using errcode = 'P0001';
  end if;
  delete from public.interviews where id = p_id;
  return jsonb_build_object('id', p_id);
end;
$$;

drop function if exists public.interview_row_visible(uuid, uuid, uuid);

revoke all on function public.list_interviewee_users_v140() from public, anon;
grant execute on function public.list_interviewee_users_v140() to authenticated;
