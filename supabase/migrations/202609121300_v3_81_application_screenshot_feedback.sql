-- Manager screenshot review feedback on Applications (one note for the whole screenshot set).

alter table public.applications
  add column if not exists screenshot_feedback text not null default '',
  add column if not exists screenshot_feedback_by uuid references auth.users(id),
  add column if not exists screenshot_feedback_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'applications_screenshot_feedback_length'
      and conrelid = 'public.applications'::regclass
  ) then
    alter table public.applications
      add constraint applications_screenshot_feedback_length
      check (char_length(screenshot_feedback) <= 2000);
  end if;
end $$;

comment on column public.applications.screenshot_feedback is
  'Manager feedback about confirmation screenshot mistakes; visible to Application viewers.';
comment on column public.applications.screenshot_feedback_by is
  'User who last set screenshot_feedback.';
comment on column public.applications.screenshot_feedback_at is
  'When screenshot_feedback was last set; null when cleared.';

create or replace function public.set_application_screenshot_feedback_v381(
  p_application_id uuid,
  p_feedback text
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
begin
  perform public.assert_application_manager();

  select * into v_current from public.applications where id = p_application_id for update;
  if not found then
    raise exception 'APPLICATION_NOT_FOUND: The Application was not found.' using errcode = 'P0001';
  end if;
  if not public.application_actor_can_view(v_current.assigned_to) then
    raise exception 'APPLICATION_NOT_FOUND: The Application was not found or is not accessible.' using errcode = 'P0001';
  end if;
  if char_length(v_feedback) > 2000 then
    raise exception 'APPLICATION_INVALID_SCREENSHOT_FEEDBACK: Screenshot feedback cannot exceed 2000 characters.' using errcode = '22023';
  end if;

  update public.applications set
    screenshot_feedback = v_feedback,
    screenshot_feedback_by = case when v_feedback = '' then null else v_actor end,
    screenshot_feedback_at = case when v_feedback = '' then null else now() end,
    updated_at = now()
  where id = p_application_id
  returning * into v_updated;

  return to_jsonb(v_updated);
end;
$$;

revoke all on function public.set_application_screenshot_feedback_v381(uuid, text) from public, anon;
grant execute on function public.set_application_screenshot_feedback_v381(uuid, text) to authenticated;

comment on function public.set_application_screenshot_feedback_v381(uuid, text) is
  'Managers set or clear confirmation-screenshot review feedback on an Application.';

-- Surface feedback on Applier My Applications so the extension can show it.
create or replace function public.list_my_applications_v20(
  p_status text default '',
  p_sort text default 'updated_desc',
  p_limit integer default 100,
  p_resume_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text := upper(btrim(coalesce(p_status, '')));
  v_sort text := lower(btrim(coalesce(p_sort, 'updated_desc')));
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_items jsonb;
  v_resumes jsonb;
  v_total bigint;
begin
  if not (public.is_active_user(auth.uid()) and public.has_role('APPLIER', auth.uid())) then
    raise exception 'APPLICATION_ACCESS_DENIED: Active Applier access is required.' using errcode = '42501';
  end if;
  if v_status <> '' and v_status not in ('ASSIGNED', 'APPLIED', 'BLOCKED') then
    raise exception 'APPLICATION_INVALID_STATUS: Select a valid Application status.' using errcode = '22023';
  end if;
  if v_sort not in (
    'updated_desc', 'updated_asc', 'company_asc', 'company_desc',
    'title_asc', 'title_desc', 'captured_asc', 'captured_desc'
  ) then
    raise exception 'APPLICATION_INVALID_SORT: Select a valid sort.' using errcode = '22023';
  end if;

  with visible as (
    select
      a.id,
      a.application_number,
      a.resume_id,
      coalesce(r.parent_resume_id, r.id) profile_resume_id,
      a.status,
      a.priority,
      a.due_at,
      a.application_url,
      a.notes,
      a.screenshot_feedback,
      a.screenshot_feedback_at,
      a.created_at,
      a.updated_at,
      j.company,
      j.job_title,
      j.source_url,
      j.created_at captured_at,
      c.name category_name,
      public.resume_primary_category_ids(r.id) resume_category_ids,
      public.resume_primary_category_names(r.id) resume_category_names,
      r.resume_name,
      r.candidate_name,
      r.resume_number,
      r.resume_type,
      r.original_filename,
      r.mime_type,
      profile_r.resume_name profile_resume_name,
      profile_r.candidate_name profile_candidate_name,
      profile_r.resume_number profile_resume_number,
      (
        select count(*)
        from public.application_screenshots s
        where s.application_id = a.id
      )::integer screenshot_count
    from public.applications a
    join public.job_descriptions j on j.id = a.job_description_id
    join public.resumes r on r.id = a.resume_id
    join public.resumes profile_r on profile_r.id = coalesce(r.parent_resume_id, r.id)
    left join public.categories c on c.id = j.category_id
    where a.assigned_to = auth.uid()
      and a.status in ('ASSIGNED', 'IN_PROGRESS', 'BLOCKED', 'APPLIED')
      and (
        v_status = ''
        or (v_status = 'ASSIGNED' and a.status in ('ASSIGNED', 'IN_PROGRESS'))
        or (v_status = 'APPLIED' and a.status = 'APPLIED')
        or (v_status = 'BLOCKED' and a.status = 'BLOCKED')
      )
  ),
  resume_options as (
    select
      profile_resume_id resume_id,
      profile_resume_name resume_name,
      profile_resume_number resume_number,
      profile_candidate_name candidate_name,
      count(*)::integer application_count
    from visible
    where profile_resume_id is not null
      and nullif(btrim(profile_resume_name), '') is not null
    group by profile_resume_id, profile_resume_name, profile_resume_number, profile_candidate_name
    order by profile_candidate_name, profile_resume_name, profile_resume_number, profile_resume_id
  ),
  filtered as (
    select *
    from visible
    where p_resume_id is null
      or profile_resume_id = p_resume_id
      or resume_id = p_resume_id
  ),
  counted as (
    select count(*)::bigint total from filtered
  ),
  paged as (
    select *
    from filtered
    order by
      case when v_sort = 'updated_desc' then updated_at end desc,
      case when v_sort = 'updated_asc' then updated_at end asc,
      case when v_sort = 'company_asc' then company end asc,
      case when v_sort = 'company_desc' then company end desc,
      case when v_sort = 'title_asc' then job_title end asc,
      case when v_sort = 'title_desc' then job_title end desc,
      case when v_sort = 'captured_asc' then captured_at end asc,
      case when v_sort = 'captured_desc' then captured_at end desc,
      id
    limit v_limit
  )
  select
    coalesce((select jsonb_agg(to_jsonb(paged)) from paged), '[]'::jsonb),
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', resume_id,
          'resumeName', resume_name,
          'resumeNumber', resume_number,
          'candidateName', candidate_name,
          'applicationCount', application_count
        )
        order by candidate_name, resume_name, resume_number, resume_id
      )
      from resume_options
    ), '[]'::jsonb),
    coalesce((select total from counted), 0)
  into v_items, v_resumes, v_total;

  return jsonb_build_object(
    'items', v_items,
    'resumes', v_resumes,
    'total', v_total,
    'limit', v_limit
  );
end;
$$;

revoke all on function public.list_my_applications_v20(text, text, integer, uuid) from public, anon;
grant execute on function public.list_my_applications_v20(text, text, integer, uuid) to authenticated;
