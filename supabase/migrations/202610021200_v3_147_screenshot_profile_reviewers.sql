-- Assign each original applicant profile to a primary and a secondary screenshot reviewer.
-- Screenshot files stay on their applications and follow the profile assignment.

alter table public.resumes
  add column if not exists screenshot_primary_reviewer_id uuid references public.profiles(id),
  add column if not exists screenshot_secondary_reviewer_id uuid references public.profiles(id);

alter table public.resumes
  drop constraint if exists resumes_screenshot_reviewers_distinct;

alter table public.resumes
  add constraint resumes_screenshot_reviewers_distinct
  check (
    screenshot_primary_reviewer_id is null
    or screenshot_secondary_reviewer_id is null
    or screenshot_primary_reviewer_id <> screenshot_secondary_reviewer_id
  );

comment on column public.resumes.screenshot_primary_reviewer_id is
  'Primary screenshot reviewer for this original applicant profile. Tailored copies inherit it through parent_resume_id.';
comment on column public.resumes.screenshot_secondary_reviewer_id is
  'Secondary screenshot reviewer for this original applicant profile.';

create index if not exists resumes_screenshot_primary_reviewer_idx
  on public.resumes (screenshot_primary_reviewer_id)
  where screenshot_primary_reviewer_id is not null;

create index if not exists resumes_screenshot_secondary_reviewer_idx
  on public.resumes (screenshot_secondary_reviewer_id)
  where screenshot_secondary_reviewer_id is not null;

create or replace function public.screenshot_reviewer_candidate(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_user_id is not null
    and exists (
      select 1
      from public.profiles
      where profiles.id = p_user_id
        and profiles.status = 'ACTIVE'
    );
$$;

create or replace function public.actor_reviews_application_screenshots(p_application_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.applications a
    join public.resumes r on r.id = a.resume_id
    join public.resumes original on original.id = coalesce(r.parent_resume_id, r.id)
    where a.id = p_application_id
      and public.is_active_user(auth.uid())
      and auth.uid() in (original.screenshot_primary_reviewer_id, original.screenshot_secondary_reviewer_id)
  );
$$;

create index if not exists applications_applied_at_idx
  on public.applications (applied_at, application_number)
  where applied_at is not null;

create index if not exists resumes_parent_resume_idx
  on public.resumes (parent_resume_id)
  where parent_resume_id is not null;

drop function if exists public.list_screenshot_review_assignments_v3147();

create or replace function public.list_screenshot_review_assignments_v3147(
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_manager boolean := public.application_actor_can_manage();
  v_admin boolean := public.has_role('ADMIN', v_actor);
begin
  if v_actor is null or not public.is_active_user(v_actor) then
    raise exception 'APPLICATION_ACCESS_DENIED: Sign in with an active account.' using errcode = '42501';
  end if;
  if not v_manager and not public.has_role('APPLIER', v_actor) then
    raise exception 'APPLICATION_ACCESS_DENIED: You cannot view screenshot reviewer assignments.' using errcode = '42501';
  end if;
  return coalesce((
    with ranged as (
      select
        coalesce(attached.parent_resume_id, attached.id) as original_id,
        a.assigned_to,
        a.applied_at,
        a.application_number,
        a.screenshot_review_status,
        count(*)::integer as screenshot_count
      from public.applications a
      join public.resumes attached on attached.id = a.resume_id
      join public.application_screenshots shots on shots.application_id = a.id
      where (p_from is null or a.applied_at >= p_from)
        and (p_to is null or a.applied_at < p_to)
      group by coalesce(attached.parent_resume_id, attached.id), a.id
    ),
    totals as (
      select
        original_id,
        sum(screenshot_count)::integer as screenshot_count,
        coalesce(sum(screenshot_count) filter (
          where screenshot_review_status in ('CORRECT', 'HAS_MISTAKES')
        ), 0)::integer as reviewed_screenshot_count,
        coalesce(sum(screenshot_count) filter (
          where coalesce(screenshot_review_status, '') not in ('CORRECT', 'HAS_MISTAKES')
        ), 0)::integer as unreviewed_screenshot_count,
        count(*)::integer as application_count
      from ranged
      group by original_id
    ),
    latest as (
      select distinct on (original_id)
        original_id,
        assigned_to
      from ranged
      order by original_id, applied_at desc, application_number desc
    )
    select jsonb_agg(row_to_json(listed)::jsonb order by case when listed.resume_status = 'ACTIVE' then 0 else 1 end, listed.candidate_name, listed.candidate_email)
    from (
      select
        original.id as resume_id,
        original.candidate_name,
        original.candidate_email,
        original.resume_name,
        original.status as resume_status,
        case when v_admin then applier.full_name end as current_applier_name,
        totals.screenshot_count,
        totals.reviewed_screenshot_count,
        totals.unreviewed_screenshot_count,
        totals.application_count,
        original.screenshot_primary_reviewer_id as primary_reviewer_id,
        primary_reviewer.full_name as primary_reviewer_name,
        primary_reviewer.email as primary_reviewer_email,
        original.screenshot_secondary_reviewer_id as secondary_reviewer_id,
        secondary_reviewer.full_name as secondary_reviewer_name,
        secondary_reviewer.email as secondary_reviewer_email
      from totals
      join public.resumes original on original.id = totals.original_id
      left join latest on latest.original_id = original.id
      left join public.profiles applier on applier.id = latest.assigned_to
      left join public.profiles primary_reviewer on primary_reviewer.id = original.screenshot_primary_reviewer_id
      left join public.profiles secondary_reviewer on secondary_reviewer.id = original.screenshot_secondary_reviewer_id
      where original.resume_type = 'ORIGINAL'
        and (
          v_manager
          or original.screenshot_primary_reviewer_id = v_actor
          or original.screenshot_secondary_reviewer_id = v_actor
        )
    ) listed
  ), '[]'::jsonb);
end;
$$;

create or replace function public.list_screenshot_reviewer_candidates_v3147()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_application_manager();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', people.id,
      'fullName', people.full_name,
      'email', people.email
    ) order by people.full_name, people.email)
    from (
      select distinct profiles.id, profiles.full_name, profiles.email
      from public.profiles
      where public.screenshot_reviewer_candidate(profiles.id)
    ) people
  ), '[]'::jsonb);
end;
$$;

create or replace function public.set_screenshot_profile_reviewers_v3147(
  p_resume_id uuid,
  p_primary_reviewer_id uuid,
  p_secondary_reviewer_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_resume public.resumes;
begin
  perform public.assert_application_manager();
  select * into v_resume
  from public.resumes
  where id = p_resume_id and resume_type = 'ORIGINAL'
  for update;
  if not found then
    raise exception 'SCREENSHOT_PROFILE_NOT_FOUND: Choose an original applicant profile.' using errcode = 'P0001';
  end if;
  if p_primary_reviewer_id is not null and p_primary_reviewer_id = p_secondary_reviewer_id then
    raise exception 'SCREENSHOT_REVIEWERS_SAME: Choose two different reviewers.' using errcode = '22023';
  end if;
  if p_primary_reviewer_id is not null and not public.screenshot_reviewer_candidate(p_primary_reviewer_id) then
    raise exception 'SCREENSHOT_REVIEWER_INVALID: Choose an active user.' using errcode = '22023';
  end if;
  if p_secondary_reviewer_id is not null and not public.screenshot_reviewer_candidate(p_secondary_reviewer_id) then
    raise exception 'SCREENSHOT_REVIEWER_INVALID: Choose an active user.' using errcode = '22023';
  end if;
  update public.resumes set
    screenshot_primary_reviewer_id = p_primary_reviewer_id,
    screenshot_secondary_reviewer_id = p_secondary_reviewer_id,
    updated_at = now()
  where id = p_resume_id
  returning * into v_resume;
  return jsonb_build_object(
    'resumeId', v_resume.id,
    'primaryReviewerId', v_resume.screenshot_primary_reviewer_id,
    'secondaryReviewerId', v_resume.screenshot_secondary_reviewer_id
  );
end;
$$;

drop function if exists public.list_profile_screenshot_applications_v3147(uuid, integer, integer);

create or replace function public.list_profile_screenshot_applications_v3147(
  p_resume_id uuid,
  p_page integer default 1,
  p_page_size integer default 25,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_size integer := least(greatest(coalesce(p_page_size, 25), 1), 100);
  v_total integer;
  v_allowed boolean;
begin
  if v_actor is null or not public.is_active_user(v_actor) then
    raise exception 'APPLICATION_ACCESS_DENIED: Sign in with an active account.' using errcode = '42501';
  end if;
  select
    public.application_actor_can_manage()
    or original.screenshot_primary_reviewer_id = v_actor
    or original.screenshot_secondary_reviewer_id = v_actor
  into v_allowed
  from public.resumes original
  where original.id = p_resume_id and original.resume_type = 'ORIGINAL';
  if not coalesce(v_allowed, false) then
    raise exception 'APPLICATION_ACCESS_DENIED: You are not a reviewer for this profile.' using errcode = '42501';
  end if;
  select count(*) into v_total
  from public.applications a
  join public.resumes r on r.id = a.resume_id
  where coalesce(r.parent_resume_id, r.id) = p_resume_id
    and (p_from is null or a.applied_at >= p_from)
    and (p_to is null or a.applied_at < p_to)
    and exists (select 1 from public.application_screenshots s where s.application_id = a.id);
  return jsonb_build_object(
    'page', v_page,
    'pageSize', v_size,
    'total', v_total,
    'pageCount', case when v_total = 0 then 0 else ceil(v_total::numeric / v_size)::integer end,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', listed.id,
        'application_number', listed.application_number,
        'company', listed.company,
        'screenshot_count', listed.screenshot_count,
        'screenshot_feedback', listed.screenshot_feedback,
        'screenshot_review_status', listed.screenshot_review_status
      ) order by listed.application_number desc)
      from (
        select
          a.id,
          a.application_number,
          j.company,
          a.screenshot_feedback,
          a.screenshot_review_status,
          (select count(*) from public.application_screenshots s where s.application_id = a.id)::integer as screenshot_count
        from public.applications a
        join public.resumes r on r.id = a.resume_id
        join public.job_descriptions j on j.id = a.job_description_id
        where coalesce(r.parent_resume_id, r.id) = p_resume_id
          and (p_from is null or a.applied_at >= p_from)
          and (p_to is null or a.applied_at < p_to)
          and exists (select 1 from public.application_screenshots s where s.application_id = a.id)
        order by a.application_number desc
        offset (v_page - 1) * v_size
        limit v_size
      ) listed
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.set_application_screenshot_feedback_v3147(
  p_application_id uuid,
  p_feedback text,
  p_review_status text default ''
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
  v_feedback text := btrim(coalesce(p_feedback, ''));
  v_status text := upper(btrim(coalesce(p_review_status, '')));
begin
  if v_actor is null or not public.is_active_user(v_actor) then
    raise exception 'APPLICATION_ACCESS_DENIED: Sign in with an active account.' using errcode = '42501';
  end if;
  if v_status = '' then
    v_status := case when v_feedback = '' then '' else 'HAS_MISTAKES' end;
  end if;
  if v_status not in ('', 'CORRECT', 'HAS_MISTAKES') then
    raise exception 'APPLICATION_INVALID_SCREENSHOT_REVIEW: Select Correct or Has mistakes.' using errcode = '22023';
  end if;
  if v_status = 'CORRECT' then
    v_feedback := '';
  elsif v_status = 'HAS_MISTAKES' and v_feedback = '' then
    raise exception 'APPLICATION_INVALID_SCREENSHOT_FEEDBACK: Describe the mistakes in the confirmation screenshot.' using errcode = '22023';
  elsif v_status = '' then
    v_feedback := '';
  end if;
  if char_length(v_feedback) > 2000 then
    raise exception 'APPLICATION_INVALID_SCREENSHOT_FEEDBACK: Screenshot feedback cannot exceed 2000 characters.' using errcode = '22023';
  end if;
  select * into v_current from public.applications where id = p_application_id for update;
  if not found then
    raise exception 'APPLICATION_NOT_FOUND: The Application was not found.' using errcode = 'P0001';
  end if;
  if not public.application_actor_can_view(v_current.assigned_to)
     and not public.actor_reviews_application_screenshots(p_application_id) then
    raise exception 'APPLICATION_ACCESS_DENIED: You are not a reviewer for this profile.' using errcode = '42501';
  end if;
  if not public.application_actor_can_manage()
     and not public.actor_reviews_application_screenshots(p_application_id) then
    raise exception 'APPLICATION_ACCESS_DENIED: You are not a reviewer for this profile.' using errcode = '42501';
  end if;
  update public.applications set
    screenshot_feedback = v_feedback,
    screenshot_review_status = v_status,
    screenshot_feedback_by = case when v_status = '' then null else v_actor end,
    screenshot_feedback_at = case when v_status = '' then null else now() end,
    updated_at = now()
  where id = p_application_id
  returning * into v_updated;
  return to_jsonb(v_updated);
end;
$$;

drop policy if exists "screenshot reviewer reads application screenshots" on public.application_screenshots;
create policy "screenshot reviewer reads application screenshots"
  on public.application_screenshots
  for select
  to authenticated
  using (public.actor_reviews_application_screenshots(application_id));

drop policy if exists "screenshot reviewer reads screenshot files" on storage.objects;
create policy "screenshot reviewer reads screenshot files"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'application-screenshots'
    and exists (
      select 1
      from public.application_screenshots shots
      where shots.storage_bucket = bucket_id
        and shots.storage_path = name
        and public.actor_reviews_application_screenshots(shots.application_id)
    )
  );

revoke all on function public.screenshot_reviewer_candidate(uuid) from public, anon;
revoke all on function public.actor_reviews_application_screenshots(uuid) from public, anon;
revoke all on function public.list_screenshot_review_assignments_v3147(timestamptz, timestamptz) from public, anon;
revoke all on function public.list_screenshot_reviewer_candidates_v3147() from public, anon;
revoke all on function public.set_screenshot_profile_reviewers_v3147(uuid, uuid, uuid) from public, anon;
revoke all on function public.list_profile_screenshot_applications_v3147(uuid, integer, integer, timestamptz, timestamptz) from public, anon;
revoke all on function public.set_application_screenshot_feedback_v3147(uuid, text, text) from public, anon;

grant execute on function public.screenshot_reviewer_candidate(uuid) to authenticated;
grant execute on function public.actor_reviews_application_screenshots(uuid) to authenticated;
grant execute on function public.list_screenshot_review_assignments_v3147(timestamptz, timestamptz) to authenticated;
grant execute on function public.list_screenshot_reviewer_candidates_v3147() to authenticated;
grant execute on function public.set_screenshot_profile_reviewers_v3147(uuid, uuid, uuid) to authenticated;
grant execute on function public.list_profile_screenshot_applications_v3147(uuid, integer, integer, timestamptz, timestamptz) to authenticated;
grant execute on function public.set_application_screenshot_feedback_v3147(uuid, text, text) to authenticated;
