-- Add a stable, human-readable integer identifier while retaining UUIDs as
-- internal primary keys. Sequence gaps are expected and numbers are not reused.
create sequence if not exists public.application_number_seq
  as bigint
  increment by 1
  minvalue 1
  start with 1
  no cycle;

alter table public.applications
  add column if not exists application_number bigint;

alter table public.applications
  alter column application_number set default nextval('public.application_number_seq'::regclass);

update public.applications
set application_number = nextval('public.application_number_seq'::regclass)
where application_number is null;

select setval(
  'public.application_number_seq'::regclass,
  coalesce((select max(application_number) from public.applications), 1),
  exists(select 1 from public.applications)
);

alter sequence public.application_number_seq
  owned by public.applications.application_number;

alter table public.applications
  alter column application_number set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.applications'::regclass
      and conname = 'applications_application_number_positive'
  ) then
    alter table public.applications
      add constraint applications_application_number_positive check (application_number > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.applications'::regclass
      and conname = 'applications_application_number_key'
  ) then
    alter table public.applications
      add constraint applications_application_number_key unique (application_number);
  end if;
end;
$$;

revoke all on sequence public.application_number_seq from public, anon, authenticated;

-- Extend the existing protected list RPC so a decimal tracking number can be
-- used in the same search field as company and job title.
create or replace function public.list_applications(
  p_search text default '',
  p_assigned_to uuid default null,
  p_work_status text default '',
  p_application_status text default '',
  p_priority text default '',
  p_company text default '',
  p_category_id uuid default null,
  p_due_filter text default '',
  p_sort text default 'updated_desc',
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
  v_manager boolean;
  v_limit integer;
  v_offset integer;
  v_items jsonb;
  v_total bigint;
  v_number_search text := regexp_replace(upper(trim(coalesce(p_search, ''))), '^(APP[- ]?|#)', '');
begin
  v_manager := public.application_actor_can_manage();
  if not v_manager and not (public.is_active_user(auth.uid()) and public.has_role('APPLIER', auth.uid())) then
    raise exception 'APPLICATION_ACCESS_DENIED: Application access is required.' using errcode = '42501';
  end if;

  v_limit := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset := greatest(coalesce(p_offset, 0), 0);

  with filtered as (
    select
      a.*,
      j.company,
      j.job_title,
      j.category_id,
      j.source_url,
      j.created_at as captured_at,
      c.name as category_name,
      r.resume_name,
      r.candidate_name,
      coalesce(nullif(p.full_name, ''), p.email) as assignee_name,
      p.email as assignee_email
    from public.applications as a
    join public.job_descriptions as j on j.id = a.job_description_id
    join public.resumes as r on r.id = a.resume_id
    left join public.categories as c on c.id = j.category_id
    left join public.profiles as p on p.id = a.assigned_to
    where (v_manager or a.assigned_to = auth.uid())
      and (
        not v_manager
        or p_assigned_to is null
        or (p_assigned_to = '00000000-0000-4000-8000-000000000000'::uuid and a.assigned_to is null)
        or a.assigned_to = p_assigned_to
      )
      and (
        coalesce(trim(p_search), '') = ''
        or j.company ilike '%' || trim(p_search) || '%'
        or j.job_title ilike '%' || trim(p_search) || '%'
        or (v_number_search ~ '^[0-9]+$' and a.application_number::text = v_number_search)
      )
      and (coalesce(trim(p_work_status), '') = '' or a.work_status = upper(trim(p_work_status)))
      and (coalesce(trim(p_application_status), '') = '' or a.application_status = upper(trim(p_application_status)))
      and (coalesce(trim(p_priority), '') = '' or a.priority = upper(trim(p_priority)))
      and (coalesce(trim(p_company), '') = '' or j.company ilike '%' || trim(p_company) || '%')
      and (p_category_id is null or j.category_id = p_category_id)
      and (
        coalesce(trim(p_due_filter), '') = ''
        or (upper(trim(p_due_filter)) = 'OVERDUE' and a.due_at < now() and a.work_status not in ('COMPLETED', 'CANCELLED'))
        or (upper(trim(p_due_filter)) = 'DUE_TODAY' and a.due_at >= date_trunc('day', now()) and a.due_at < date_trunc('day', now()) + interval '1 day')
        or (upper(trim(p_due_filter)) = 'NO_DUE_DATE' and a.due_at is null)
      )
  ), counted as (
    select count(*) as total from filtered
  ), paged as (
    select *
    from filtered
    order by
      case when p_sort = 'created_asc' then created_at end asc,
      case when p_sort = 'created_desc' then created_at end desc,
      case when p_sort = 'updated_asc' then updated_at end asc,
      case when p_sort = 'due_asc' then due_at end asc nulls last,
      case when p_sort = 'priority_desc' then array_position(array['LOW', 'NORMAL', 'HIGH', 'URGENT'], priority) end desc,
      case when p_sort = 'company_asc' then company end asc,
      case when p_sort = 'title_asc' then job_title end asc,
      updated_at desc,
      id
    limit v_limit offset v_offset
  )
  select
    coalesce((select jsonb_agg(to_jsonb(paged)) from paged), '[]'::jsonb),
    coalesce((select total from counted), 0)
  into v_items, v_total;

  return jsonb_build_object(
    'items', v_items,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset
  );
end;
$$;

revoke all on function public.list_applications(text, uuid, text, text, text, text, uuid, text, text, integer, integer) from public, anon;
grant execute on function public.list_applications(text, uuid, text, text, text, text, uuid, text, text, integer, integer) to authenticated;
