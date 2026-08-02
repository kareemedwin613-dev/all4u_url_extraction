-- v0.9.0: Resume-owned, explicitly reviewed application-answer library.
-- Values are never inferred and are never stored in a Candidate table.

create or replace function public.resume_answer_patterns_valid_v090(p_patterns text[])
returns boolean language sql immutable security invoker set search_path='' as $$
  select coalesce(cardinality(p_patterns),0)<=20
    and not exists(select 1 from unnest(coalesce(p_patterns,'{}'::text[])) p where char_length(btrim(p)) not between 3 and 300);
$$;

create or replace function public.resume_answer_prohibited_v090(p_key text,p_patterns text[])
returns boolean language sql immutable security invoker set search_path='' as $$
  select lower(coalesce(p_key,'')||' '||array_to_string(coalesce(p_patterns,'{}'::text[]),' '))
    ~ '\m(race|racial|ethnicity|ethnic|gender|sex|sexual|orientation|religion|religious|disability|disabled|medical|veteran|military status|criminal|conviction|arrest|marital|pregnan|genetic)\M';
$$;

create or replace function public.resume_answer_value_valid_v090(p_type text,p_value jsonb)
returns boolean language sql immutable security invoker set search_path='' as $$
  select case upper(coalesce(p_type,''))
    when 'BOOLEAN' then jsonb_typeof(p_value)='boolean'
    when 'NUMBER' then jsonb_typeof(p_value)='number' and (p_value#>>'{}')::numeric between 0 and 100
    when 'DATE' then jsonb_typeof(p_value)='string' and (p_value#>>'{}') ~ '^[0-9]{4}-(0[1-9]|1[0-2])-([0-2][0-9]|3[01])$'
    when 'TEXT' then jsonb_typeof(p_value)='string' and char_length(btrim(p_value#>>'{}')) between 1 and 500
    when 'SINGLE_SELECT' then jsonb_typeof(p_value)='string' and upper(p_value#>>'{}') in ('REMOTE','HYBRID','ONSITE','FLEXIBLE','NO_PREFERENCE')
    else false end;
$$;

create table public.resume_application_answers (
  id uuid primary key default gen_random_uuid(),
  resume_id uuid not null references public.resumes(id) on delete cascade,
  answer_key text not null check(answer_key in('authorized_to_work','requires_sponsorship','willing_to_relocate','available_start_date','desired_salary','years_of_experience','remote_work_preference')),
  question_patterns text[] not null default '{}',
  answer_type text not null check(answer_type in('BOOLEAN','NUMBER','DATE','TEXT','SINGLE_SELECT')),
  answer_value jsonb not null,
  review_status text not null default 'NEEDS_REVIEW' check(review_status in('NEEDS_REVIEW','VERIFIED')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  active boolean not null default true,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(resume_id,answer_key),
  check(public.resume_answer_patterns_valid_v090(question_patterns)),
  check(not public.resume_answer_prohibited_v090(answer_key,question_patterns)),
  check(public.resume_answer_value_valid_v090(answer_type,answer_value)),
  check((answer_key in('authorized_to_work','requires_sponsorship','willing_to_relocate') and answer_type='BOOLEAN')
     or (answer_key='available_start_date' and answer_type='DATE')
     or (answer_key='desired_salary' and answer_type='TEXT')
     or (answer_key='years_of_experience' and answer_type='NUMBER')
     or (answer_key='remote_work_preference' and answer_type='SINGLE_SELECT')),
  check((review_status='NEEDS_REVIEW' and reviewed_by is null and reviewed_at is null)
     or (review_status='VERIFIED' and reviewed_by is not null and reviewed_at is not null))
);

create index resume_application_answers_resume_active_idx on public.resume_application_answers(resume_id,active,review_status,answer_key);
create index resume_application_answers_reviewed_by_idx on public.resume_application_answers(reviewed_by) where reviewed_by is not null;
create index resume_application_answers_created_by_idx on public.resume_application_answers(created_by);
create trigger resume_application_answers_updated before update on public.resume_application_answers for each row execute function public.set_updated_at();

alter table public.resume_application_answers enable row level security;
create policy "application managers read Resume answer library" on public.resume_application_answers for select to authenticated
using((select public.application_actor_can_manage()));

revoke all on table public.resume_application_answers from public,anon,authenticated;
grant select on table public.resume_application_answers to authenticated;

create or replace function public.list_resume_application_answers_v090(p_resume_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_items jsonb;
begin
  perform public.assert_application_manager();
  if not exists(select 1 from public.resumes where id=p_resume_id) then
    raise exception 'RESUME_NOT_FOUND: The Resume was not found.' using errcode='P0001';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',a.id,'resumeId',a.resume_id,'answerKey',a.answer_key,'questionPatterns',a.question_patterns,
    'answerType',a.answer_type,'answerValue',a.answer_value,'reviewStatus',a.review_status,
    'reviewedBy',a.reviewed_by,'reviewerName',coalesce(nullif(rp.full_name,''),rp.email),
    'reviewedAt',a.reviewed_at,'active',a.active,'createdBy',a.created_by,
    'creatorName',coalesce(nullif(cp.full_name,''),cp.email),'createdAt',a.created_at,'updatedAt',a.updated_at
  ) order by a.answer_key),'[]'::jsonb) into v_items
  from public.resume_application_answers a
  left join public.profiles rp on rp.id=a.reviewed_by
  left join public.profiles cp on cp.id=a.created_by
  where a.resume_id=p_resume_id;
  return v_items;
end;
$$;

create or replace function public.save_resume_application_answer_v090(
  p_resume_id uuid,p_answer_id uuid,p_answer_key text,p_question_patterns text[],p_answer_type text,
  p_answer_value jsonb,p_review_status text default 'NEEDS_REVIEW',p_active boolean default true
)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_actor uuid:=auth.uid(); v_key text:=lower(btrim(coalesce(p_answer_key,'')));
  v_type text:=upper(btrim(coalesce(p_answer_type,''))); v_review text:=upper(btrim(coalesce(p_review_status,'')));
  v_patterns text[]; v_id uuid;
begin
  perform public.assert_application_manager();
  if not exists(select 1 from public.resumes where id=p_resume_id and status='ACTIVE') then
    raise exception 'RESUME_ANSWER_RESUME_UNAVAILABLE: The active Resume was not found.' using errcode='P0001';
  end if;
  select coalesce(array_agg(distinct btrim(p) order by btrim(p)) filter(where btrim(p)<>''),'{}'::text[]) into v_patterns
  from unnest(coalesce(p_question_patterns,'{}'::text[])) p;
  if v_key not in('authorized_to_work','requires_sponsorship','willing_to_relocate','available_start_date','desired_salary','years_of_experience','remote_work_preference')
     or v_review not in('NEEDS_REVIEW','VERIFIED')
     or not public.resume_answer_patterns_valid_v090(v_patterns)
     or public.resume_answer_prohibited_v090(v_key,v_patterns)
     or not public.resume_answer_value_valid_v090(v_type,p_answer_value)
     or (v_key in('authorized_to_work','requires_sponsorship','willing_to_relocate') and v_type<>'BOOLEAN')
     or (v_key='available_start_date' and v_type<>'DATE')
     or (v_key='desired_salary' and v_type<>'TEXT')
     or (v_key='years_of_experience' and v_type<>'NUMBER')
     or (v_key='remote_work_preference' and v_type<>'SINGLE_SELECT') then
    raise exception 'RESUME_ANSWER_INVALID: Review the answer key, type, value, patterns, and prohibited categories.' using errcode='P0001';
  end if;
  if v_type='DATE' then perform (p_answer_value#>>'{}')::date; end if;

  if p_answer_id is null then
    insert into public.resume_application_answers(resume_id,answer_key,question_patterns,answer_type,answer_value,review_status,reviewed_by,reviewed_at,active,created_by)
    values(p_resume_id,v_key,v_patterns,v_type,p_answer_value,v_review,case when v_review='VERIFIED' then v_actor end,case when v_review='VERIFIED' then now() end,coalesce(p_active,true),v_actor)
    returning id into v_id;
  else
    update public.resume_application_answers set answer_key=v_key,question_patterns=v_patterns,answer_type=v_type,answer_value=p_answer_value,
      review_status=v_review,reviewed_by=case when v_review='VERIFIED' then v_actor end,reviewed_at=case when v_review='VERIFIED' then now() end,active=coalesce(p_active,true)
    where id=p_answer_id and resume_id=p_resume_id returning id into v_id;
    if v_id is null then raise exception 'RESUME_ANSWER_NOT_FOUND: The Resume answer was not found.' using errcode='P0001'; end if;
  end if;
  return jsonb_build_object('id',v_id,'answers',public.list_resume_application_answers_v090(p_resume_id));
exception
  when unique_violation then raise exception 'RESUME_ANSWER_DUPLICATE: This Resume already has an answer for that key.' using errcode='P0001';
  when check_violation or invalid_datetime_format or datetime_field_overflow then raise exception 'RESUME_ANSWER_INVALID: The answer value is invalid for its type.' using errcode='P0001';
end;
$$;

create or replace function public.archive_resume_application_answer_v090(p_resume_id uuid,p_answer_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform public.assert_application_manager();
  update public.resume_application_answers set active=false where id=p_answer_id and resume_id=p_resume_id;
  if not found then raise exception 'RESUME_ANSWER_NOT_FOUND: The Resume answer was not found.' using errcode='P0001'; end if;
  return jsonb_build_object('id',p_answer_id,'active',false,'answers',public.list_resume_application_answers_v090(p_resume_id));
end;
$$;

revoke all on function public.resume_answer_patterns_valid_v090(text[]) from public,anon,authenticated;
revoke all on function public.resume_answer_prohibited_v090(text,text[]) from public,anon,authenticated;
revoke all on function public.resume_answer_value_valid_v090(text,jsonb) from public,anon,authenticated;
revoke all on function public.list_resume_application_answers_v090(uuid) from public,anon;
revoke all on function public.save_resume_application_answer_v090(uuid,uuid,text,text[],text,jsonb,text,boolean) from public,anon;
revoke all on function public.archive_resume_application_answer_v090(uuid,uuid) from public,anon;
grant execute on function public.list_resume_application_answers_v090(uuid) to authenticated;
grant execute on function public.save_resume_application_answer_v090(uuid,uuid,text,text[],text,jsonb,text,boolean) to authenticated;
grant execute on function public.archive_resume_application_answer_v090(uuid,uuid) to authenticated;

-- Extend the verified, Application-scoped snapshot. Appliers cannot list the
-- table directly; they receive only active VERIFIED answers for their exact
-- authorized Application and Resume.
create or replace function public.get_application_autofill_context_v089(
  p_application_id uuid,p_session_id uuid,p_expected_resume_updated_at timestamptz default null
)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_result jsonb;v_resume_updated_at timestamptz;v_review_status text;
begin
  if auth.uid() is null or not public.is_active_user(auth.uid()) then raise exception 'AUTOFILL_ACCESS_DENIED: An active authenticated user is required.' using errcode='42501'; end if;
  select r.updated_at,r.profile_review_status,jsonb_build_object(
    'applicationId',a.id,'sessionId',s.id,'job',jsonb_build_object('company',j.company,'jobTitle',j.job_title,'sourceUrl',j.source_url),
    'resumeId',r.id,'resumeUpdatedAt',r.updated_at,'profileSchemaVersion',r.profile_schema_version,'reviewedAt',r.profile_reviewed_at,
    'values',jsonb_strip_nulls(jsonb_build_object(
      'candidate.firstName',coalesce(nullif(btrim(r.candidate_first_name),''),nullif(split_part(btrim(r.candidate_name),' ',1),'')),
      'candidate.middleName',r.candidate_middle_name,
      'candidate.lastName',coalesce(nullif(btrim(r.candidate_last_name),''),case when btrim(r.candidate_name) like '% %' then nullif(regexp_replace(btrim(r.candidate_name),'^.*[[:space:]]+',''),'') end),
      'candidate.fullName',r.candidate_name,'candidate.email',r.candidate_email,'candidate.phone',r.candidate_phone,
      'candidate.addressLine1',r.address_line_1,'candidate.addressLine2',r.address_line_2,'candidate.city',r.address_city,
      'candidate.state',r.address_state_region,'candidate.postalCode',r.address_postal_code,'candidate.country',r.address_country,
      'candidate.linkedInUrl',r.linkedin_url,'candidate.githubUrl',r.github_url,'candidate.portfolioUrl',r.portfolio_url,
      'candidate.summary',nullif(btrim(coalesce(r.structured_content->>'summary','')),'')
    )),
    'applicationAnswers',coalesce((select jsonb_agg(jsonb_build_object('answerKey',x.answer_key,'questionPatterns',x.question_patterns,'answerType',x.answer_type,'answerValue',x.answer_value,'reviewedAt',x.reviewed_at) order by x.answer_key) from public.resume_application_answers x where x.resume_id=r.id and x.active and x.review_status='VERIFIED'),'[]'::jsonb)
  ) into v_resume_updated_at,v_review_status,v_result
  from public.application_extension_sessions s join public.applications a on a.id=s.application_id join public.job_descriptions j on j.id=a.job_description_id join public.resumes r on r.id=a.resume_id
  where s.id=p_session_id and s.application_id=p_application_id and s.user_id=auth.uid() and s.action='AUTOFILL'
    and s.status in('CREATED','RECEIVED','TARGET_READY') and s.expires_at>now() and public.application_actor_can_view(a.assigned_to)
    and r.status='ACTIVE' and j.source_url~*'^https?://';
  if v_result is null then raise exception 'AUTOFILL_CONTEXT_NOT_FOUND: The Autofill session or Application is unavailable.' using errcode='P0001'; end if;
  if v_review_status<>'VERIFIED' then raise exception 'PROFILE_REVIEW_REQUIRED: Verify the Resume autofill metadata before using Autofill.' using errcode='P0001'; end if;
  if p_expected_resume_updated_at is not null and v_resume_updated_at<>p_expected_resume_updated_at then raise exception 'AUTOFILL_CONTEXT_STALE: Resume metadata changed after preview. Generate a new preview.' using errcode='P0001'; end if;
  return v_result;
end;
$$;

revoke all on function public.get_application_autofill_context_v089(uuid,uuid,timestamptz) from public,anon;
grant execute on function public.get_application_autofill_context_v089(uuid,uuid,timestamptz) to authenticated;
