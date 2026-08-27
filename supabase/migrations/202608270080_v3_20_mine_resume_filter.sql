-- Extension My Applications: resume options from the full status-scoped set,
-- and optional resume_id filter applied before the page limit.
create or replace function public.list_my_applications_v19(
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
  if v_status <> '' and v_status not in (
    'UNASSIGNED', 'ASSIGNED', 'IN_PROGRESS', 'BLOCKED', 'APPLIED', 'SCREENING',
    'INTERVIEW_SCHEDULED', 'OFFER_RECEIVED', 'REJECTED', 'WITHDRAWN', 'CLOSED', 'CANCELLED'
  ) then
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
      a.status,
      a.priority,
      a.due_at,
      a.application_url,
      a.notes,
      a.created_at,
      a.updated_at,
      j.company,
      j.job_title,
      j.source_url,
      j.created_at captured_at,
      c.name category_name,
      r.resume_name,
      r.candidate_name,
      r.resume_number,
      r.resume_type,
      r.original_filename,
      r.mime_type,
      (
        select count(*)
        from public.application_screenshots s
        where s.application_id = a.id
      )::integer screenshot_count
    from public.applications a
    join public.job_descriptions j on j.id = a.job_description_id
    join public.resumes r on r.id = a.resume_id
    left join public.categories c on c.id = j.category_id
    where a.assigned_to = auth.uid()
      and (v_status = '' or a.status = v_status)
  ),
  resume_options as (
    select resume_id, resume_name, resume_number
    from (
      select distinct on (resume_id)
        resume_id,
        resume_name,
        resume_number
      from visible
      where resume_id is not null
        and nullif(btrim(resume_name), '') is not null
      order by resume_id, resume_name, resume_number
    ) distinct_resumes
    order by resume_name, resume_number, resume_id
  ),
  filtered as (
    select *
    from visible
    where p_resume_id is null or resume_id = p_resume_id
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
          'resumeNumber', resume_number
        )
        order by resume_name, resume_number, resume_id
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

revoke all on function public.list_my_applications_v19(text, text, integer, uuid) from public, anon;
grant execute on function public.list_my_applications_v19(text, text, integer, uuid) to authenticated;

comment on function public.list_my_applications_v19(text, text, integer, uuid) is
  'Applier My Applications list with status/resume filters and status-scoped resume options.';
