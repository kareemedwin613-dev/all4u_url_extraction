-- Date-windowed Overview counts. Dates are supplied by the client as local
-- calendar boundaries converted to UTC, so reporting follows the user's day.

create or replace function public.get_application_counts_v29(p_from timestamptz,p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_manager boolean;v_result jsonb;
begin
  if p_from is null or p_to is null or p_from>=p_to or p_to-p_from>interval '370 days' then
    raise exception 'OVERVIEW_DATE_RANGE_INVALID: Select a valid reporting period of 370 days or less.' using errcode='22023';
  end if;
  v_manager:=public.application_actor_can_manage();
  if not v_manager and not(public.is_active_user(auth.uid()) and public.has_role('APPLIER',auth.uid())) then
    raise exception 'APPLICATION_ACCESS_DENIED: Application access is required.' using errcode='42501';
  end if;
  with visible as(
    select * from public.applications
    where(v_manager or assigned_to=auth.uid()) and created_at>=p_from and created_at<p_to
  ),applied as(
    select count(*)::integer value from public.applications
    where(v_manager or assigned_to=auth.uid()) and applied_at>=p_from and applied_at<p_to
  )
  select jsonb_build_object(
    case when v_manager then 'total' else 'my_assigned' end,count(*),
    'unassigned',count(*)filter(where status='UNASSIGNED'),
    'due_today',count(*)filter(where due_at>=date_trunc('day',now()) and due_at<date_trunc('day',now())+interval '1 day' and status not in('CLOSED','CANCELLED')),
    'in_progress',count(*)filter(where status='IN_PROGRESS'),
    'blocked',count(*)filter(where status='BLOCKED'),
    'overdue',count(*)filter(where due_at<now() and status not in('CLOSED','CANCELLED')),
    'applied_today',(select value from applied),
    'interviews',count(*)filter(where status='INTERVIEW_SCHEDULED')
  )into v_result from visible;
  return v_result;
end$$;

create or replace function public.get_business_overview_v29(p_from timestamptz,p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_result jsonb;v_jobs jsonb;v_resumes jsonb;
begin
  if p_from is null or p_to is null or p_from>=p_to or p_to-p_from>interval '370 days' then
    raise exception 'OVERVIEW_DATE_RANGE_INVALID: Select a valid reporting period of 370 days or less.' using errcode='22023';
  end if;
  -- Reuse the existing role checks and privacy-minimized secondary sections.
  v_result:=public.get_business_overview();
  select jsonb_build_object('total',count(*),'active',count(*)filter(where status='ACTIVE'))into v_jobs
  from public.job_descriptions where created_at>=p_from and created_at<p_to;
  select jsonb_build_object('total',count(*),'active',count(*)filter(where status='ACTIVE'))into v_resumes
  from public.resumes where resume_type='ORIGINAL' and created_at>=p_from and created_at<p_to;
  return jsonb_set(jsonb_set(v_result,'{jobCounts}',v_jobs,true),'{resumeCounts}',v_resumes,true);
end$$;

revoke all on function public.get_application_counts_v29(timestamptz,timestamptz) from public,anon;
revoke all on function public.get_business_overview_v29(timestamptz,timestamptz) from public,anon;
grant execute on function public.get_application_counts_v29(timestamptz,timestamptz) to authenticated;
grant execute on function public.get_business_overview_v29(timestamptz,timestamptz) to authenticated;

comment on function public.get_application_counts_v29(timestamptz,timestamptz) is 'RLS-compatible Application summary for a bounded reporting window.';
comment on function public.get_business_overview_v29(timestamptz,timestamptz) is 'Business record counts for a bounded reporting window; preserves existing role-gated secondary data.';
