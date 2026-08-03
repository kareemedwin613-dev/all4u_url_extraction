-- v1.0.1: one public Application lifecycle status.
-- The two legacy columns remain synchronized during this compatibility release
-- because deployed bulk-assignment RPCs still use them internally.

create or replace function public.canonical_application_status(p_work_status text,p_application_status text)
returns text language sql immutable set search_path=public,pg_temp as $$
  select case
    when p_application_status in ('APPLIED','SCREENING','INTERVIEW_SCHEDULED','OFFER_RECEIVED','REJECTED','WITHDRAWN','CLOSED') then p_application_status
    when p_work_status='COMPLETED' then 'CLOSED'
    else p_work_status
  end
$$;

alter table public.applications add column status text;
update public.applications
set status=public.canonical_application_status(work_status,application_status);
alter table public.applications alter column status set default 'UNASSIGNED';
alter table public.applications alter column status set not null;
alter table public.applications add constraint applications_status_check check(status in(
  'UNASSIGNED','ASSIGNED','IN_PROGRESS','BLOCKED','APPLIED','SCREENING',
  'INTERVIEW_SCHEDULED','OFFER_RECEIVED','REJECTED','WITHDRAWN','CLOSED','CANCELLED'
));
create index applications_status_idx on public.applications(status);

alter table public.application_status_history drop constraint if exists application_status_history_status_type_check;
alter table public.application_status_history add constraint application_status_history_status_type_check
  check(status_type in('WORK_STATUS','APPLICATION_STATUS','STATUS'));

create or replace function public.sync_application_status_compatibility()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if tg_op='UPDATE' and new.status is distinct from old.status then
    null;
  else
    new.status:=public.canonical_application_status(new.work_status,new.application_status);
  end if;
  -- Keep old workload/reporting RPCs semantically aligned with the canonical state.
  new.work_status:=case
    when new.status in('UNASSIGNED','ASSIGNED','IN_PROGRESS','BLOCKED','CANCELLED') then new.status
    else 'COMPLETED'
  end;
  new.application_status:=case
    when new.status in('APPLIED','SCREENING','INTERVIEW_SCHEDULED','OFFER_RECEIVED','REJECTED','WITHDRAWN','CLOSED') then new.status
    else 'NOT_APPLIED'
  end;
  return new;
end$$;

create trigger applications_status_compatibility before insert or update on public.applications
for each row execute function public.sync_application_status_compatibility();
revoke all on function public.sync_application_status_compatibility() from public,anon,authenticated;

create or replace function public.update_application_status_v101(
  p_application_id uuid,p_status text,p_application_url text,p_applied_at timestamptz,
  p_notes text,p_priority text,p_due_at timestamptz
)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_actor uuid:=auth.uid();v_current public.applications;v_updated public.applications;
  v_manager boolean;v_status text:=upper(trim(coalesce(p_status,'')));
  v_priority text:=upper(trim(coalesce(p_priority,'')));v_applied_at timestamptz:=p_applied_at;
begin
  select * into v_current from public.applications where id=p_application_id for update;
  if not found then raise exception 'APPLICATION_NOT_FOUND: The Application was not found.' using errcode='P0001';end if;
  v_manager:=public.application_actor_can_manage();
  if not v_manager and not(public.is_active_user(v_actor) and public.has_role('APPLIER',v_actor) and v_current.assigned_to=v_actor) then
    raise exception 'APPLICATION_ACCESS_DENIED: You cannot update this Application.' using errcode='42501';
  end if;
  if v_status not in('UNASSIGNED','ASSIGNED','IN_PROGRESS','BLOCKED','APPLIED','SCREENING','INTERVIEW_SCHEDULED','OFFER_RECEIVED','REJECTED','WITHDRAWN','CLOSED','CANCELLED') then
    raise exception 'APPLICATION_INVALID_STATUS: Select a valid status.' using errcode='22023';
  end if;
  if v_current.assigned_to is null and v_status not in('UNASSIGNED','CANCELLED') then
    raise exception 'APPLICATION_UNASSIGNED: Assign an Applier before changing status.' using errcode='P0001';
  end if;
  if v_current.assigned_to is not null and v_status='UNASSIGNED' then
    raise exception 'APPLICATION_ASSIGNED: Unassign the Application instead of selecting Unassigned.' using errcode='P0001';
  end if;
  if not v_manager and v_status in('UNASSIGNED','CANCELLED') then
    raise exception 'APPLICATION_PROTECTED_FIELDS: Appliers cannot cancel or unassign Applications.' using errcode='42501';
  end if;
  if char_length(coalesce(p_application_url,''))>4000 or(nullif(trim(coalesce(p_application_url,'')),'') is not null and p_application_url!~*'^https?://') then
    raise exception 'APPLICATION_INVALID_URL: Enter a valid HTTP or HTTPS URL.' using errcode='22023';
  end if;
  if v_manager and v_priority not in('LOW','NORMAL','HIGH','URGENT') then
    raise exception 'APPLICATION_INVALID_PRIORITY: Select a valid priority.' using errcode='22023';
  end if;
  if v_manager and char_length(coalesce(p_notes,''))>10000 then
    raise exception 'APPLICATION_INVALID_NOTES: Notes cannot exceed 10000 characters.' using errcode='22023';
  end if;
  if v_status='APPLIED' and v_applied_at is null then v_applied_at:=coalesce(v_current.applied_at,now());end if;
  if not v_manager and v_status='APPLIED' and v_current.status is distinct from v_status then
    if coalesce(nullif(trim(coalesce(p_application_url,'')),''),v_current.application_url) is null then
      raise exception 'APPLICATION_APPLIED_REQUIRES_URL: Add an Application URL before marking this Application Applied.' using errcode='22023';
    end if;
    if not exists(select 1 from public.application_screenshots where application_id=p_application_id) then
      raise exception 'APPLICATION_APPLIED_REQUIRES_SCREENSHOT: Attach at least one confirmation screenshot before marking this Application Applied.' using errcode='22023';
    end if;
  end if;
  update public.applications set
    status=v_status,
    application_url=nullif(trim(coalesce(p_application_url,'')),''),
    applied_at=case when v_manager then v_applied_at when v_status='APPLIED' then coalesce(v_current.applied_at,now()) else v_current.applied_at end,
    notes=case when v_manager then nullif(trim(coalesce(p_notes,'')),'') else notes end,
    priority=case when v_manager then v_priority else priority end,
    due_at=case when v_manager then p_due_at else due_at end
  where id=p_application_id returning * into v_updated;
  if v_current.status is distinct from v_updated.status then
    insert into public.application_status_history(application_id,status_type,previous_status,new_status,changed_by,notes)
    values(v_updated.id,'STATUS',v_current.status,v_updated.status,v_actor,case when v_manager then nullif(left(coalesce(p_notes,''),2000),'') else null end);
  end if;
  return to_jsonb(v_updated);
end$$;

revoke all on function public.canonical_application_status(text,text) from public,anon;
grant execute on function public.canonical_application_status(text,text) to authenticated;
revoke all on function public.update_application_status_v101(uuid,text,text,timestamptz,text,text,timestamptz) from public,anon;
grant execute on function public.update_application_status_v101(uuid,text,text,timestamptz,text,text,timestamptz) to authenticated;

comment on column public.applications.status is 'Canonical Application lifecycle status exposed by API and UI.';
comment on column public.applications.work_status is 'Deprecated compatibility column; remove after legacy assignment RPCs are migrated.';
comment on column public.applications.application_status is 'Deprecated compatibility column; remove after legacy reporting RPCs are migrated.';
