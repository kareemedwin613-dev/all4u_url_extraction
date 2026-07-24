create or replace function public.update_application_progress(
  p_application_id uuid,
  p_work_status text,
  p_application_status text,
  p_application_url text,
  p_applied_at timestamptz,
  p_notes text,
  p_priority text,
  p_due_at timestamptz
)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_current public.applications;
  v_updated public.applications;
  v_manager boolean;
  v_work text := upper(trim(coalesce(p_work_status, '')));
  v_application_status text := upper(trim(coalesce(p_application_status, '')));
  v_priority text := upper(trim(coalesce(p_priority, '')));
  v_applied_at timestamptz := p_applied_at;
begin
  select * into v_current from public.applications where id = p_application_id for update;
  if not found then
    raise exception 'APPLICATION_NOT_FOUND: The Application was not found.' using errcode = 'P0001';
  end if;

  v_manager := public.application_actor_can_manage();
  if not v_manager and not (
    v_current.assigned_to = v_actor and public.is_active_user(v_actor) and public.has_role('APPLIER', v_actor)
  ) then
    raise exception 'APPLICATION_ACCESS_DENIED: You cannot update this Application.' using errcode = '42501';
  end if;

  if v_work not in ('UNASSIGNED','ASSIGNED','IN_PROGRESS','BLOCKED','COMPLETED','CANCELLED') then
    raise exception 'APPLICATION_INVALID_WORK_STATUS: Select a valid work status.' using errcode = 'P0001';
  end if;
  if v_application_status not in ('NOT_APPLIED','APPLIED','SCREENING','INTERVIEW_SCHEDULED','OFFER_RECEIVED','REJECTED','WITHDRAWN','CLOSED') then
    raise exception 'APPLICATION_INVALID_APPLICATION_STATUS: Select a valid application status.' using errcode = 'P0001';
  end if;
  if v_current.assigned_to is null and v_work not in ('UNASSIGNED','CANCELLED') then
    raise exception 'APPLICATION_UNASSIGNED: Assign an Applier before changing work status.' using errcode = 'P0001';
  end if;
  if v_current.assigned_to is not null and v_work = 'UNASSIGNED' then
    raise exception 'APPLICATION_PROTECTED_ASSIGNMENT: Use the reassignment action to unassign.' using errcode = 'P0001';
  end if;
  if p_application_url is not null and (char_length(p_application_url) > 4000 or p_application_url !~* '^https?://') then
    raise exception 'APPLICATION_INVALID_URL: Enter a valid http or https URL.' using errcode = 'P0001';
  end if;

  if not v_manager and (
    p_priority is not null or p_due_at is not null or p_applied_at is not null or p_notes is not null
  ) then
    raise exception 'APPLICATION_PROTECTED_FIELDS: Appliers can change only status and URL.' using errcode = '42501';
  end if;
  if not v_manager and v_work = 'CANCELLED' then
    raise exception 'APPLICATION_PROTECTED_FIELDS: Only Applying Managers and Admins can cancel Applications.' using errcode = '42501';
  end if;

  if v_manager and v_priority not in ('LOW','NORMAL','HIGH','URGENT') then
    raise exception 'APPLICATION_INVALID_PRIORITY: Select a valid priority.' using errcode = 'P0001';
  end if;
  if v_manager and char_length(coalesce(p_notes, '')) > 10000 then
    raise exception 'APPLICATION_INVALID_NOTES: Notes cannot exceed 10000 characters.' using errcode = 'P0001';
  end if;
  if v_application_status = 'APPLIED' and v_applied_at is null then
    v_applied_at := coalesce(v_current.applied_at, now());
  end if;

  update public.applications set
    work_status = v_work,
    application_status = v_application_status,
    application_url = nullif(trim(coalesce(p_application_url, '')), ''),
    applied_at = case when v_manager then v_applied_at
                      when v_application_status = 'APPLIED' then coalesce(v_current.applied_at, now())
                      else v_current.applied_at end,
    notes = case when v_manager then nullif(trim(coalesce(p_notes, '')), '') else notes end,
    priority = case when v_manager then v_priority else priority end,
    due_at = case when v_manager then p_due_at else due_at end
  where id = p_application_id returning * into v_updated;

  if v_current.work_status is distinct from v_updated.work_status then
    insert into public.application_status_history(application_id,status_type,previous_status,new_status,changed_by,notes)
    values(v_updated.id,'WORK_STATUS',v_current.work_status,v_updated.work_status,v_actor,
      case when v_manager then nullif(left(coalesce(p_notes,''),2000),'') else null end);
  end if;
  if v_current.application_status is distinct from v_updated.application_status then
    insert into public.application_status_history(application_id,status_type,previous_status,new_status,changed_by,notes)
    values(v_updated.id,'APPLICATION_STATUS',v_current.application_status,v_updated.application_status,v_actor,
      case when v_manager then nullif(left(coalesce(p_notes,''),2000),'') else null end);
  end if;
  return to_jsonb(v_updated);
end;
$$;

revoke all on function public.update_application_progress(uuid,text,text,text,timestamptz,text,text,timestamptz) from public, anon;
grant execute on function public.update_application_progress(uuid,text,text,text,timestamptz,text,text,timestamptz) to authenticated;

comment on function public.update_application_progress(uuid,text,text,text,timestamptz,text,text,timestamptz) is
  'Managers can update progress and managed fields. The assigned active Applier can update only work status, Application status, and Application URL by sending null for protected parameters.';
