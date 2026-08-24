-- Allow assigned Appliers to update Application notes (e.g. why Blocked)
-- and return notes on the Applier My Applications list.

create or replace function public.update_application_status_v101(
  p_application_id uuid,p_status text,p_application_url text,p_applied_at timestamptz,
  p_notes text,p_priority text,p_due_at timestamptz
)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_actor uuid:=auth.uid();v_current public.applications;v_updated public.applications;
  v_manager boolean;v_status text:=upper(trim(coalesce(p_status,'')));
  v_priority text:=upper(trim(coalesce(p_priority,'')));v_applied_at timestamptz:=p_applied_at;
  v_notes text:=nullif(trim(coalesce(p_notes,'')),'');
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
  if char_length(coalesce(p_notes,''))>10000 then
    raise exception 'APPLICATION_INVALID_NOTES: Notes cannot exceed 10000 characters.' using errcode='22023';
  end if;
  if not v_manager and v_status='BLOCKED' and v_notes is null then
    raise exception 'APPLICATION_NOTES_REQUIRED: Add a note explaining why this Application is blocked.' using errcode='22023';
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
    notes=case when p_notes is null and not v_manager then notes else v_notes end,
    priority=case when v_manager then v_priority else priority end,
    due_at=case when v_manager then p_due_at else due_at end
  where id=p_application_id returning * into v_updated;
  if v_current.status is distinct from v_updated.status then
    insert into public.application_status_history(application_id,status_type,previous_status,new_status,changed_by,notes)
    values(v_updated.id,'STATUS',v_current.status,v_updated.status,v_actor,nullif(left(coalesce(v_notes,''),2000),''));
  end if;
  return to_jsonb(v_updated);
end$$;

create or replace function public.list_my_applications_v17(
  p_status text default '',
  p_sort text default 'updated_desc',
  p_limit integer default 100
)
returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp
as $$
declare
  v_status text:=upper(btrim(coalesce(p_status,'')));
  v_sort text:=lower(btrim(coalesce(p_sort,'updated_desc')));
  v_limit integer:=least(greatest(coalesce(p_limit,100),1),100);
  v_items jsonb;
  v_total bigint;
begin
  if not(public.is_active_user(auth.uid()) and public.has_role('APPLIER',auth.uid())) then
    raise exception 'APPLICATION_ACCESS_DENIED: Active Applier access is required.' using errcode='42501';
  end if;
  if v_status<>'' and v_status not in('UNASSIGNED','ASSIGNED','IN_PROGRESS','BLOCKED','APPLIED','SCREENING','INTERVIEW_SCHEDULED','OFFER_RECEIVED','REJECTED','WITHDRAWN','CLOSED','CANCELLED') then
    raise exception 'APPLICATION_INVALID_STATUS: Select a valid Application status.' using errcode='22023';
  end if;
  if v_sort not in('updated_desc','updated_asc','company_asc','company_desc','title_asc','title_desc','captured_asc','captured_desc') then
    raise exception 'APPLICATION_INVALID_SORT: Select a valid sort.' using errcode='22023';
  end if;

  with visible as(
    select a.id,a.application_number,a.resume_id,a.status,a.priority,a.due_at,a.application_url,a.notes,a.created_at,a.updated_at,
      j.company,j.job_title,j.source_url,j.created_at captured_at,c.name category_name,
      r.resume_name,r.candidate_name,r.resume_number,r.resume_type,r.original_filename,r.mime_type,
      (select count(*) from public.application_screenshots s where s.application_id=a.id)::integer screenshot_count
    from public.applications a
    join public.job_descriptions j on j.id=a.job_description_id
    join public.resumes r on r.id=a.resume_id
    left join public.categories c on c.id=j.category_id
    where a.assigned_to=auth.uid() and(v_status='' or a.status=v_status)
  ), counted as(select count(*) total from visible), paged as(
    select * from visible order by
      case when v_sort='updated_desc' then updated_at end desc,
      case when v_sort='updated_asc' then updated_at end asc,
      case when v_sort='company_asc' then company end asc,
      case when v_sort='company_desc' then company end desc,
      case when v_sort='title_asc' then job_title end asc,
      case when v_sort='title_desc' then job_title end desc,
      case when v_sort='captured_asc' then captured_at end asc,
      case when v_sort='captured_desc' then captured_at end desc,
      id
    limit v_limit
  )
  select coalesce((select jsonb_agg(to_jsonb(paged)) from paged),'[]'::jsonb),coalesce((select total from counted),0)
  into v_items,v_total;
  return jsonb_build_object('items',v_items,'total',v_total,'limit',v_limit);
end;
$$;
