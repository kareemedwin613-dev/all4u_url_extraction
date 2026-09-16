-- v3.96: Fast Job Description list for JD Finder / Applier / dual-role accounts.
-- PostgREST list embeds + exact count under RLS often exceeded the authenticated
-- 8s statement_timeout. Serve the dashboard page through one scoped RPC instead.
-- Also stop Appliers from aggregating every JD in list_job_description_capturers.

create index if not exists job_descriptions_status_created_idx
  on public.job_descriptions (status, created_at desc, id);

create or replace function public.list_job_descriptions_v396(
  p_search text default null,
  p_category_id uuid default null,
  p_seniority text default null,
  p_status text default 'ACTIVE',
  p_review_status text default null,
  p_captured_by uuid default null,
  p_captured_from timestamptz default null,
  p_captured_to timestamptz default null,
  p_sort text default 'created_desc',
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_limit integer := greatest(1, least(coalesce(p_limit, 25), 200));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_status text := upper(nullif(btrim(coalesce(p_status, 'ACTIVE')), ''));
  v_review text := upper(nullif(btrim(coalesce(p_review_status, '')), ''));
  v_seniority text := upper(nullif(btrim(coalesce(p_seniority, '')), ''));
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_sort text := lower(nullif(btrim(coalesce(p_sort, 'created_desc')), ''));
  v_manager boolean := public.has_any_role(array['APPLYING_MANAGER', 'ADMIN'], v_actor);
  v_finder boolean := public.has_role('JD_FINDER', v_actor);
  v_applier boolean := public.has_role('APPLIER', v_actor);
  v_total bigint := 0;
  v_items jsonb := '[]'::jsonb;
begin
  if v_actor is null or not public.is_active_user(v_actor) or not (v_manager or v_finder or v_applier) then
    raise exception 'JOB_LIST_FORBIDDEN: An active Job Description reader is required.' using errcode = '42501';
  end if;
  if v_status is not null and v_status not in ('ACTIVE', 'ARCHIVED', 'ALL') then
    raise exception 'JOB_LIST_INVALID: Unsupported status filter.' using errcode = '22023';
  end if;
  if p_captured_from is not null and p_captured_to is not null and p_captured_from >= p_captured_to then
    raise exception 'JOB_LIST_INVALID: The captured date range is invalid.' using errcode = '22023';
  end if;

  with visible as (
    select j.*
    from public.job_descriptions j
    where (
        v_manager
        or (v_finder and j.user_id = v_actor)
        or (
          v_applier
          and exists (
            select 1
            from public.applications a
            where a.assigned_to = v_actor
              and a.job_description_id = j.id
          )
        )
      )
      and (v_status is null or v_status = 'ALL' or j.status = v_status)
      and (v_review is null or v_review = 'ALL' or j.review_status = v_review)
      and (p_category_id is null or j.category_id = p_category_id)
      and (v_seniority is null or j.seniority = v_seniority)
      and (p_captured_by is null or j.user_id = p_captured_by)
      and (p_captured_from is null or j.created_at >= p_captured_from)
      and (p_captured_to is null or j.created_at < p_captured_to)
      and (
        v_search is null
        or j.search_vector @@ websearch_to_tsquery('english', v_search)
      )
  ),
  counted as (
    select count(*)::bigint as total from visible
  ),
  page as (
    select v.*
    from visible v
    order by
      case when v_sort = 'company_asc' then lower(v.company) end asc nulls last,
      case when v_sort = 'company_desc' then lower(v.company) end desc nulls last,
      case when v_sort = 'title_asc' then lower(v.job_title) end asc nulls last,
      case when v_sort = 'title_desc' then lower(v.job_title) end desc nulls last,
      case when v_sort = 'category_asc' then v.category_id::text end asc nulls last,
      case when v_sort = 'category_desc' then v.category_id::text end desc nulls last,
      case when v_sort = 'subcategory_asc' then v.subcategory_id::text end asc nulls last,
      case when v_sort = 'subcategory_desc' then v.subcategory_id::text end desc nulls last,
      case when v_sort = 'seniority_asc' then v.seniority end asc nulls last,
      case when v_sort = 'seniority_desc' then v.seniority end desc nulls last,
      case when v_sort = 'source_asc' then lower(coalesce(v.source_url, '')) end asc nulls last,
      case when v_sort = 'source_desc' then lower(coalesce(v.source_url, '')) end desc nulls last,
      case when v_sort = 'capturer_asc' then v.user_id::text end asc nulls last,
      case when v_sort = 'capturer_desc' then v.user_id::text end desc nulls last,
      case when v_sort = 'status_asc' then v.status end asc nulls last,
      case when v_sort = 'status_desc' then v.status end desc nulls last,
      case when v_sort = 'review_asc' then v.review_status end asc nulls last,
      case when v_sort = 'review_desc' then v.review_status end desc nulls last,
      case when v_sort = 'created_asc' then v.created_at end asc nulls last,
      case when coalesce(v_sort, 'created_desc') = 'created_desc' then v.created_at end desc nulls last,
      v.id desc
    limit v_limit offset v_offset
  ),
  shaped as (
    select
      p.id,
      p.user_id,
      p.company,
      p.job_title,
      p.category_id,
      p.subcategory_id,
      p.industry_domain_category_id,
      p.seniority,
      p.location_text,
      p.work_arrangement,
      p.source_site,
      p.source_url,
      p.status,
      p.review_status,
      p.review_comment,
      p.review_decline_reason,
      p.reviewed_by,
      p.reviewed_at,
      p.application_blocked_at,
      p.application_blocked_notes,
      p.application_blocked_from_application_id,
      p.created_at,
      p.updated_at,
      c.name as category_name,
      i.name as industry_domain,
      coalesce((
        select array_agg(s.subcategory_id order by s.sort_order, s.id)
        from public.job_description_subcategories s
        where s.job_description_id = p.id
      ), case when p.subcategory_id is null then '{}'::uuid[] else array[p.subcategory_id] end) as subcategory_ids
    from page p
    left join public.categories c on c.id = p.category_id
    left join public.industry_domain_categories i on i.id = p.industry_domain_category_id
  )
  select
    counted.total,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', s.id,
            'user_id', s.user_id,
            'company', s.company,
            'job_title', s.job_title,
            'category_id', s.category_id,
            'subcategory_id', coalesce(s.subcategory_ids[1], s.subcategory_id),
            'subcategory_ids', to_jsonb(s.subcategory_ids),
            'industry_domain_category_id', s.industry_domain_category_id,
            'seniority', s.seniority,
            'location_text', s.location_text,
            'work_arrangement', s.work_arrangement,
            'source_site', s.source_site,
            'source_url', s.source_url,
            'status', s.status,
            'review_status', s.review_status,
            'review_comment', s.review_comment,
            'review_decline_reason', s.review_decline_reason,
            'reviewed_by', s.reviewed_by,
            'reviewed_at', s.reviewed_at,
            'application_blocked_at', s.application_blocked_at,
            'application_blocked_notes', s.application_blocked_notes,
            'application_blocked_from_application_id', s.application_blocked_from_application_id,
            'created_at', s.created_at,
            'updated_at', s.updated_at,
            'category_name', s.category_name,
            'industry_domain', s.industry_domain
          )
          order by
            case when v_sort = 'company_asc' then lower(s.company) end asc nulls last,
            case when v_sort = 'company_desc' then lower(s.company) end desc nulls last,
            case when v_sort = 'title_asc' then lower(s.job_title) end asc nulls last,
            case when v_sort = 'title_desc' then lower(s.job_title) end desc nulls last,
            case when v_sort = 'created_asc' then s.created_at end asc nulls last,
            case when coalesce(v_sort, 'created_desc') = 'created_desc' then s.created_at end desc nulls last,
            s.id desc
        )
        from shaped s
      ),
      '[]'::jsonb
    )
  into v_total, v_items
  from counted;

  return jsonb_build_object('items', v_items, 'total', v_total);
end;
$$;

revoke all on function public.list_job_descriptions_v396(
  text, uuid, text, text, text, uuid, timestamptz, timestamptz, text, integer, integer
) from public, anon;
grant execute on function public.list_job_descriptions_v396(
  text, uuid, text, text, text, uuid, timestamptz, timestamptz, text, integer, integer
) to authenticated;

comment on function public.list_job_descriptions_v396(
  text, uuid, text, text, text, uuid, timestamptz, timestamptz, text, integer, integer
) is
  'Caller-scoped Job Description list page with total count; avoids PostgREST embed RLS timeouts.';

create or replace function public.list_job_description_capturers()
returns table(id uuid, display_name text, email text, captured_count bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_manager boolean := public.has_any_role(array['APPLYING_MANAGER', 'ADMIN'], v_actor);
  v_finder boolean := public.has_role('JD_FINDER', v_actor);
  v_applier boolean := public.has_role('APPLIER', v_actor);
begin
  if v_actor is null or not public.is_active_user(v_actor) or not (v_manager or v_finder or v_applier) then
    raise exception 'Only active job-description readers can list capturers.' using errcode = '42501';
  end if;

  return query
  select
    jobs.user_id,
    coalesce(
      nullif(btrim(profiles.full_name), ''),
      nullif(btrim(legacy.display_name), ''),
      profiles.email,
      legacy.email,
      jobs.user_id::text
    ),
    coalesce(nullif(profiles.email, ''), nullif(legacy.email, ''), ''),
    count(*)::bigint
  from public.job_descriptions jobs
  left join public.profiles profiles on profiles.id = jobs.user_id
  left join public.user_profiles legacy on legacy.id = jobs.user_id
  where
    v_manager
    or (v_finder and jobs.user_id = v_actor)
    or (
      v_applier
      and exists (
        select 1
        from public.applications a
        where a.assigned_to = v_actor
          and a.job_description_id = jobs.id
      )
    )
  group by jobs.user_id, profiles.full_name, profiles.email, legacy.display_name, legacy.email
  order by lower(
    coalesce(
      nullif(btrim(profiles.full_name), ''),
      nullif(btrim(legacy.display_name), ''),
      profiles.email,
      legacy.email,
      jobs.user_id::text
    )
  ), jobs.user_id;
end;
$$;

revoke all on function public.list_job_description_capturers() from public, anon;
grant execute on function public.list_job_description_capturers() to authenticated;

comment on function public.list_job_description_capturers() is
  'Managers see all capturers; JD Finders see self; Appliers see capturers for assigned Application JDs only.';
