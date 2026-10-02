-- Notion imports have no CRM Interviewee yet. A blank interviewee stays blank.

alter table public.interviews alter column interviewee_name drop not null;
alter table public.interviews drop constraint if exists interviews_interviewee_length;
alter table public.interviews add constraint interviews_interviewee_length
  check (interviewee_name is null or char_length(interviewee_name) between 1 and 200);

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
  v_round_ends timestamptz;
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
  v_name := null;
  if v_interviewee_id is not null then
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
  if v_status not in ('UPCOMING', 'COMPLETED', 'REJECTED', 'NOT_JOINED', 'RESCHEDULED', 'NEEDS_FOLLOW_UP') then
    raise exception 'VALIDATION_ERROR: Select a status: Upcoming, Completed, Rejected, Not Joined, Rescheduled, or Needs Follow Up.' using errcode = '22023';
  end if;
  if v_type not in ('TEAMS', 'GOOGLE_MEET', 'ZOOM', 'VIDEO', 'PHONE', 'AI_INTERVIEW', 'OTHER') then
    raise exception 'VALIDATION_ERROR: Select an interview type: Microsoft Teams, Google Meet, Zoom, Video Call, Phone, or AI Interview.' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_payload->>'jobType', '')), '') is not null
     and upper(btrim(p_payload->>'jobType')) not in ('FULL_TIME', 'PART_TIME', 'CONTRACT') then
    raise exception 'VALIDATION_ERROR: Select a job type: Full-Time, Part-Time, or Contract.' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_payload->>'location', '')), '') is not null
     and upper(btrim(p_payload->>'location')) not in ('REMOTE', 'ONSITE', 'HYBRID') then
    raise exception 'VALIDATION_ERROR: Select a location: Remote, On-Site, or Hybrid.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_payload->>'interviewerPosition', ''))) > 200
     or char_length(btrim(coalesce(p_payload->>'interviewerLocation', ''))) > 200 then
    raise exception 'VALIDATION_ERROR: Interviewer position and location cannot exceed 200 characters.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_payload->>'detailedInformation', ''))) > 4000 then
    raise exception 'VALIDATION_ERROR: Detailed information cannot exceed 4000 characters.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_payload->>'profileName', ''))) > 200 then
    raise exception 'VALIDATION_ERROR: Profile Name cannot exceed 200 characters.' using errcode = '22023';
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
      profile_name = nullif(left(btrim(coalesce(p_payload->>'profileName', '')), 200), ''),
      profile_email = nullif(btrim(coalesce(p_payload->>'profileEmail', '')), ''),
      profile_phone = nullif(btrim(coalesce(p_payload->>'profilePhone', '')), ''),
      professional_stack = nullif(btrim(coalesce(p_payload->>'professionalStack', '')), ''),
      company_name = v_company,
      company_website = nullif(btrim(coalesce(p_payload->>'companyWebsite', '')), ''),
      job_link = nullif(btrim(coalesce(p_payload->>'jobLink', '')), ''),
      role_title = nullif(btrim(coalesce(p_payload->>'roleTitle', '')), ''),
      job_type = nullif(upper(btrim(coalesce(p_payload->>'jobType', ''))), ''),
      location = nullif(upper(btrim(coalesce(p_payload->>'location', ''))), ''),
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
      interviewer_position = nullif(btrim(coalesce(p_payload->>'interviewerPosition', '')), ''),
      interviewer_location = nullif(btrim(coalesce(p_payload->>'interviewerLocation', '')), ''),
      detailed_information = nullif(btrim(coalesce(p_payload->>'detailedInformation', '')), ''),
      linkedin_url = nullif(btrim(coalesce(p_payload->>'linkedinUrl', '')), ''),
      resume_link = nullif(btrim(coalesce(p_payload->>'resumeLink', '')), ''),
      place = nullif(btrim(coalesce(p_payload->>'place', '')), ''),
      applied_date = v_applied,
      notes = v_notes
    where id = v_id
    returning * into v_row;
  else
    insert into public.interviews (
      application_id, interviewee_user_id, starts_at, ends_at, interviewee_name, profile_name, profile_email, profile_phone,
      professional_stack, company_name, company_website, job_link, role_title, job_type,
      location, salary_range, stage, status, interview_type, meeting_url, meeting_id, passcode,
      recruiter_name, recruiter_email, recruiter_phone, interviewers, interviewer_position, interviewer_location, detailed_information, linkedin_url, resume_link,
      place, applied_date, notes, created_by
    ) values (
      v_application_id, v_interviewee_id, v_starts, v_ends, v_name,
      nullif(left(btrim(coalesce(p_payload->>'profileName', '')), 200), ''),
      nullif(btrim(coalesce(p_payload->>'profileEmail', '')), ''),
      nullif(btrim(coalesce(p_payload->>'profilePhone', '')), ''),
      nullif(btrim(coalesce(p_payload->>'professionalStack', '')), ''),
      v_company,
      nullif(btrim(coalesce(p_payload->>'companyWebsite', '')), ''),
      nullif(btrim(coalesce(p_payload->>'jobLink', '')), ''),
      nullif(btrim(coalesce(p_payload->>'roleTitle', '')), ''),
      nullif(upper(btrim(coalesce(p_payload->>'jobType', ''))), ''),
      nullif(upper(btrim(coalesce(p_payload->>'location', ''))), ''),
      nullif(btrim(coalesce(p_payload->>'salaryRange', '')), ''),
      v_stage, v_status, v_type,
      nullif(btrim(coalesce(p_payload->>'meetingUrl', '')), ''),
      nullif(btrim(coalesce(p_payload->>'meetingId', '')), ''),
      nullif(btrim(coalesce(p_payload->>'passcode', '')), ''),
      nullif(btrim(coalesce(p_payload->>'recruiterName', '')), ''),
      nullif(btrim(coalesce(p_payload->>'recruiterEmail', '')), ''),
      nullif(btrim(coalesce(p_payload->>'recruiterPhone', '')), ''),
      nullif(btrim(coalesce(p_payload->>'interviewers', '')), ''),
      nullif(btrim(coalesce(p_payload->>'interviewerPosition', '')), ''),
      nullif(btrim(coalesce(p_payload->>'interviewerLocation', '')), ''),
      nullif(btrim(coalesce(p_payload->>'detailedInformation', '')), ''),
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
    v_round_ends := null;
    if nullif(v_round.value->>'startsAt', '') is not null then
      begin
        v_round_starts := (v_round.value->>'startsAt')::timestamptz;
      exception when others then
        raise exception 'VALIDATION_ERROR: Enter a valid start time for each round.' using errcode = '22023';
      end;
    end if;
    if nullif(v_round.value->>'endsAt', '') is not null then
      begin
        v_round_ends := (v_round.value->>'endsAt')::timestamptz;
      exception when others then
        raise exception 'VALIDATION_ERROR: Enter a valid end time for each round.' using errcode = '22023';
      end;
    end if;
    if (v_round_starts is null) <> (v_round_ends is null) then
      raise exception 'VALIDATION_ERROR: Enter both a start and an end time for each round.' using errcode = '22023';
    end if;
    if v_round_ends is not null and v_round_ends <= v_round_starts then
      raise exception 'VALIDATION_ERROR: A round must end after it starts.' using errcode = '22023';
    end if;
    if char_length(coalesce(v_round.value->>'notes', '')) > 2000 then
      raise exception 'VALIDATION_ERROR: Round notes cannot exceed 2000 characters.' using errcode = '22023';
    end if;
    insert into public.interview_rounds (interview_id, sort_order, round_name, starts_at, ends_at, interviewer, status, notes)
    values (
      v_row.id,
      v_round.ordinality::integer,
      v_round_name,
      v_round_starts,
      v_round_ends,
      nullif(btrim(coalesce(v_round.value->>'interviewer', '')), ''),
      v_round_status,
      nullif(btrim(coalesce(v_round.value->>'notes', '')), '')
    );
  end loop;
  return public.interview_json(v_row);
end;
$$;

