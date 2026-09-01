-- Activity Overview: expose Screening separately and keep Applied as a status bucket for the chart.

create or replace function public.get_application_counts_v29(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_manager boolean;
  v_activity_scoped boolean := (p_to - p_from) <= interval '7 days';
  v_result jsonb;
begin
  if p_from is null or p_to is null or p_from >= p_to or p_to - p_from > interval '370 days' then
    raise exception 'OVERVIEW_DATE_RANGE_INVALID: Select a valid reporting period of 370 days or less.'
      using errcode = '22023';
  end if;
  v_manager := public.application_actor_can_manage();
  if not v_manager
    and not (public.is_active_user(auth.uid()) and public.has_role('APPLIER', auth.uid())) then
    raise exception 'APPLICATION_ACCESS_DENIED: Application access is required.'
      using errcode = '42501';
  end if;
  with visible as (
    select *
    from public.applications
    where (v_manager or assigned_to = auth.uid())
      and (
        (created_at >= p_from and created_at < p_to)
        or (
          v_activity_scoped
          and (
            (applied_at >= p_from and applied_at < p_to)
            or (updated_at >= p_from and updated_at < p_to and updated_at is distinct from created_at)
            or exists (
              select 1
              from public.application_status_history h
              where h.application_id = applications.id
                and h.created_at >= p_from
                and h.created_at < p_to
            )
          )
        )
      )
  ),
  applied as (
    select count(*)::integer as value
    from public.applications
    where (v_manager or assigned_to = auth.uid())
      and applied_at >= p_from
      and applied_at < p_to
  )
  select jsonb_build_object(
    'assigned', count(*),
    case when v_manager then 'total' else 'my_assigned' end, count(*),
    'unassigned', count(*) filter (where status = 'UNASSIGNED'),
    'pending', count(*) filter (where status in ('ASSIGNED', 'IN_PROGRESS')),
    'applied', case
      when v_activity_scoped then (select value from applied)
      else count(*) filter (where status = 'APPLIED')
    end,
    'applied_count', count(*) filter (where status = 'APPLIED'),
    'applied_status', count(*) filter (where status in ('APPLIED', 'SCREENING')),
    'screening', count(*) filter (where status = 'SCREENING'),
    'blocked', count(*) filter (where status = 'BLOCKED'),
    'interviews', count(*) filter (where status = 'INTERVIEW_SCHEDULED'),
    'closed_status', count(*) filter (
      where status in ('CLOSED', 'WITHDRAWN', 'REJECTED', 'OFFER_RECEIVED')
    ),
    'cancelled_status', count(*) filter (where status = 'CANCELLED'),
    'due_today', count(*) filter (
      where due_at >= date_trunc('day', now())
        and due_at < date_trunc('day', now()) + interval '1 day'
        and status not in ('CLOSED', 'CANCELLED')
    ),
    'in_progress', count(*) filter (where status = 'IN_PROGRESS'),
    'overdue', count(*) filter (
      where due_at < now() and status not in ('CLOSED', 'CANCELLED')
    ),
    'applied_today', (select value from applied)
  )
  into v_result
  from visible;

  return v_result;
end;
$$;

revoke all on function public.get_application_counts_v29(timestamptz, timestamptz)
  from public, anon;
grant execute on function public.get_application_counts_v29(timestamptz, timestamptz)
  to authenticated;

comment on function public.get_application_counts_v29(timestamptz, timestamptz) is
  'RLS-compatible Application summary for a bounded reporting window. Activity Overview uses mutually exclusive status buckets.';
