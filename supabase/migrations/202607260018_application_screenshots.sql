-- Confirmation screenshots for Applications, plus enforcement that marking an Application "Applied"
-- (as an Applier) requires an Application URL and at least one screenshot already on file.

create table public.application_screenshots (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  storage_bucket text not null default 'application-screenshots' check (storage_bucket = 'application-screenshots'),
  storage_path text not null,
  original_filename text not null check (char_length(original_filename) between 1 and 300),
  mime_type text not null check (mime_type in ('image/png','image/jpeg','image/webp','application/pdf')),
  file_size_bytes bigint not null check (file_size_bytes between 1 and 5242880),
  created_at timestamptz not null default now(),
  constraint application_screenshots_path_unique unique (storage_bucket, storage_path)
);

create index application_screenshots_application_idx on public.application_screenshots (application_id, created_at desc);

alter table public.application_screenshots enable row level security;

create policy "role scoped read application screenshots" on public.application_screenshots for select to authenticated
using (exists(select 1 from public.applications a where a.id = application_screenshots.application_id and public.application_actor_can_view(a.assigned_to)));

revoke all on public.application_screenshots from anon;
revoke insert, update, delete on public.application_screenshots from authenticated;
grant select on public.application_screenshots to authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('application-screenshots', 'application-screenshots', false, 5242880,
  array['image/png','image/jpeg','image/webp','application/pdf'])
on conflict(id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "application scoped read application screenshots" on storage.objects for select to authenticated
using (
  bucket_id = 'application-screenshots' and public.is_active_user(auth.uid()) and (
    public.application_actor_can_manage() or exists(
      select 1 from public.application_screenshots s join public.applications a on a.id = s.application_id
      where s.storage_bucket = bucket_id and s.storage_path = name and a.assigned_to = auth.uid()
    )
  )
);
create policy "assigned applier or manager insert application screenshots" on storage.objects for insert to authenticated
with check (
  bucket_id = 'application-screenshots' and public.is_active_user(auth.uid()) and (
    public.application_actor_can_manage() or exists(
      select 1 from public.applications a where a.id::text = (storage.foldername(name))[1] and a.assigned_to = auth.uid()
    )
  )
);
create policy "assigned applier or manager delete application screenshots" on storage.objects for delete to authenticated
using (
  bucket_id = 'application-screenshots' and public.is_active_user(auth.uid()) and (
    public.application_actor_can_manage() or exists(
      select 1 from public.applications a where a.id::text = (storage.foldername(name))[1] and a.assigned_to = auth.uid()
    )
  )
);

create or replace function public.attach_application_screenshot(
  p_application_id uuid,
  p_storage_path text,
  p_original_filename text,
  p_mime_type text,
  p_file_size_bytes bigint
)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_application public.applications;
  v_screenshot public.application_screenshots;
begin
  select * into v_application from public.applications where id = p_application_id for update;
  if not found then
    raise exception 'APPLICATION_NOT_FOUND: The Application was not found.' using errcode = 'P0001';
  end if;
  if not (
    public.application_actor_can_manage()
    or (v_application.assigned_to = v_actor and public.is_active_user(v_actor) and public.has_role('APPLIER', v_actor))
  ) then
    raise exception 'APPLICATION_ACCESS_DENIED: You cannot attach files to this Application.' using errcode = '42501';
  end if;
  if coalesce(trim(p_storage_path), '') = '' or p_storage_path !~ ('^' || p_application_id::text || '/') then
    raise exception 'APPLICATION_SCREENSHOT_INVALID_PATH: The screenshot path is invalid.' using errcode = '22023';
  end if;
  if coalesce(trim(p_original_filename), '') = '' then
    raise exception 'APPLICATION_SCREENSHOT_INVALID_FILENAME: Enter a valid filename.' using errcode = '22023';
  end if;
  if lower(trim(coalesce(p_mime_type, ''))) not in ('image/png','image/jpeg','image/webp','application/pdf') then
    raise exception 'APPLICATION_SCREENSHOT_INVALID_TYPE: Upload a PNG, JPG, WEBP, or PDF file.' using errcode = '22023';
  end if;
  if p_file_size_bytes is null or p_file_size_bytes < 1 or p_file_size_bytes > 5242880 then
    raise exception 'APPLICATION_SCREENSHOT_INVALID_SIZE: The screenshot must be between 1 byte and 5 MiB.' using errcode = '22023';
  end if;

  insert into public.application_screenshots(
    application_id, uploaded_by, storage_path, original_filename, mime_type, file_size_bytes
  ) values (
    p_application_id, v_actor, p_storage_path, trim(p_original_filename), lower(trim(p_mime_type)), p_file_size_bytes
  ) returning * into v_screenshot;

  return to_jsonb(v_screenshot);
end;
$$;

create or replace function public.remove_application_screenshot(p_screenshot_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_screenshot public.application_screenshots;
  v_application public.applications;
begin
  select * into v_screenshot from public.application_screenshots where id = p_screenshot_id;
  if not found then
    raise exception 'APPLICATION_SCREENSHOT_NOT_FOUND: The screenshot was not found.' using errcode = 'P0001';
  end if;
  select * into v_application from public.applications where id = v_screenshot.application_id for update;
  if not (
    public.application_actor_can_manage()
    or (v_application.assigned_to = v_actor and public.is_active_user(v_actor) and public.has_role('APPLIER', v_actor))
  ) then
    raise exception 'APPLICATION_ACCESS_DENIED: You cannot remove files from this Application.' using errcode = '42501';
  end if;
  delete from public.application_screenshots where id = p_screenshot_id;
  return jsonb_build_object('id', p_screenshot_id, 'storageBucket', v_screenshot.storage_bucket, 'storagePath', v_screenshot.storage_path);
end;
$$;

-- Re-issued in full: adds the Applier-only "Applied requires URL + screenshot" gate. Signature and every
-- other behavior (manager fields, protected-field gating, applied_at auto-set) are unchanged from
-- 202607240012_fix_applier_progress_updates.sql.
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

  if not v_manager and v_application_status = 'APPLIED' and v_current.application_status is distinct from v_application_status then
    if coalesce(nullif(trim(coalesce(p_application_url, '')), ''), v_current.application_url) is null then
      raise exception 'APPLICATION_APPLIED_REQUIRES_URL: Add an Application URL before marking this Application Applied.' using errcode = '22023';
    end if;
    if not exists (select 1 from public.application_screenshots where application_id = p_application_id) then
      raise exception 'APPLICATION_APPLIED_REQUIRES_SCREENSHOT: Attach at least one confirmation screenshot before marking this Application Applied.' using errcode = '22023';
    end if;
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

-- Re-issued in full: adds a `screenshot_count` column to every row so callers can tell whether proof
-- already exists without a second round trip. Signature, filters, and sort allowlist are unchanged from
-- 202607240017_bulk_assignment_and_table_sorting.sql.
create or replace function public.list_applications_v07(
  p_search text default '', p_assigned_to uuid default null, p_work_status text default '',
  p_application_status text default '', p_priority text default '', p_company text default '',
  p_category_id uuid default null, p_due_filter text default '', p_sort text default 'updated_desc',
  p_creation_batch_id uuid default null, p_creation_mode text default '',
  p_limit integer default 25, p_offset integer default 0
)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp
as $$
declare v_manager boolean;v_limit integer;v_offset integer;v_items jsonb;v_total bigint;v_sort text:=lower(coalesce(p_sort,'updated_desc'));v_number_search text:=regexp_replace(upper(trim(coalesce(p_search,''))),'^(APP[- ]?|#)','');
begin
  v_manager:=public.application_actor_can_manage();
  if not v_manager and not(public.is_active_user(auth.uid()) and public.has_role('APPLIER',auth.uid())) then raise exception 'APPLICATION_ACCESS_DENIED: Application access is required.' using errcode='42501';end if;
  if coalesce(p_creation_mode,'')<>'' and upper(p_creation_mode) not in('BULK','INDIVIDUAL') then raise exception 'APPLICATION_INVALID_CREATION_MODE: Select a valid creation mode.' using errcode='22023';end if;
  if v_sort not in ('number_asc','number_desc','company_asc','company_desc','title_asc','title_desc','resume_asc','resume_desc','candidate_asc','candidate_desc','assignee_asc','assignee_desc','link_asc','link_desc','work_asc','work_desc','application_status_asc','application_status_desc','priority_asc','priority_desc','due_asc','due_desc','updated_asc','updated_desc','created_asc','created_desc','captured_asc','captured_desc','category_asc','category_desc','batch_asc','batch_desc') then raise exception 'APPLICATION_INVALID_SORT: Select a valid sort.' using errcode='22023';end if;
  v_limit:=least(greatest(coalesce(p_limit,25),1),100);v_offset:=greatest(coalesce(p_offset,0),0);
  with filtered as (
    select a.*,jobs.company,jobs.job_title,jobs.category_id,categories.name category_name,jobs.source_url,jobs.created_at captured_at,
      resumes.resume_name,resumes.candidate_name,coalesce(nullif(profiles.full_name,''),profiles.email) assignee_name,
      profiles.email assignee_email,batches.name creation_batch_name,
      (select count(*) from public.application_screenshots s where s.application_id=a.id)::integer screenshot_count
    from public.applications a join public.job_descriptions jobs on jobs.id=a.job_description_id join public.resumes resumes on resumes.id=a.resume_id
    left join public.categories categories on categories.id=jobs.category_id left join public.profiles profiles on profiles.id=a.assigned_to
    left join public.application_creation_batches batches on batches.id=a.creation_batch_id
    where (v_manager or a.assigned_to=auth.uid())
      and (not v_manager or p_assigned_to is null or(p_assigned_to='00000000-0000-4000-8000-000000000000'::uuid and a.assigned_to is null)or a.assigned_to=p_assigned_to)
      and(coalesce(trim(p_search),'')='' or jobs.company ilike '%'||trim(p_search)||'%' or jobs.job_title ilike '%'||trim(p_search)||'%' or(v_number_search~'^[0-9]+$' and a.application_number::text=v_number_search))
      and(coalesce(trim(p_work_status),'')='' or a.work_status=upper(trim(p_work_status))) and(coalesce(trim(p_application_status),'')='' or a.application_status=upper(trim(p_application_status)))
      and(coalesce(trim(p_priority),'')='' or a.priority=upper(trim(p_priority))) and(coalesce(trim(p_company),'')='' or jobs.company ilike '%'||trim(p_company)||'%')
      and(p_category_id is null or jobs.category_id=p_category_id) and(p_creation_batch_id is null or a.creation_batch_id=p_creation_batch_id)
      and(coalesce(p_creation_mode,'')='' or(upper(p_creation_mode)='BULK' and a.creation_batch_id is not null)or(upper(p_creation_mode)='INDIVIDUAL' and a.creation_batch_id is null))
      and(coalesce(trim(p_due_filter),'')='' or(upper(trim(p_due_filter))='OVERDUE' and a.due_at<now() and a.work_status not in('COMPLETED','CANCELLED'))or(upper(trim(p_due_filter))='DUE_TODAY' and a.due_at>=date_trunc('day',now()) and a.due_at<date_trunc('day',now())+interval'1 day')or(upper(trim(p_due_filter))='NO_DUE_DATE' and a.due_at is null))
  ), counted as(select count(*) total from filtered), paged as(
    select * from filtered order by
      case when v_sort='number_asc' then application_number end asc,case when v_sort='number_desc' then application_number end desc,
      case when v_sort='company_asc' then company end asc,case when v_sort='company_desc' then company end desc,
      case when v_sort='title_asc' then job_title end asc,case when v_sort='title_desc' then job_title end desc,
      case when v_sort='resume_asc' then resume_name end asc,case when v_sort='resume_desc' then resume_name end desc,
      case when v_sort='candidate_asc' then candidate_name end asc,case when v_sort='candidate_desc' then candidate_name end desc,
      case when v_sort='assignee_asc' then assignee_name end asc nulls last,case when v_sort='assignee_desc' then assignee_name end desc nulls last,
      case when v_sort='link_asc' then coalesce(application_url,source_url) end asc nulls last,case when v_sort='link_desc' then coalesce(application_url,source_url) end desc nulls last,
      case when v_sort='work_asc' then work_status end asc,case when v_sort='work_desc' then work_status end desc,
      case when v_sort='application_status_asc' then application_status end asc,case when v_sort='application_status_desc' then application_status end desc,
      case when v_sort='priority_asc' then array_position(array['LOW','NORMAL','HIGH','URGENT'],priority) end asc,case when v_sort='priority_desc' then array_position(array['LOW','NORMAL','HIGH','URGENT'],priority) end desc,
      case when v_sort='due_asc' then due_at end asc nulls last,case when v_sort='due_desc' then due_at end desc nulls last,
      case when v_sort='updated_asc' then updated_at end asc,case when v_sort='updated_desc' then updated_at end desc,
      case when v_sort='created_asc' then created_at end asc,case when v_sort='created_desc' then created_at end desc,
      case when v_sort='captured_asc' then captured_at end asc,case when v_sort='captured_desc' then captured_at end desc,
      case when v_sort='category_asc' then category_name end asc,case when v_sort='category_desc' then category_name end desc,
      case when v_sort='batch_asc' then creation_batch_name end asc nulls last,case when v_sort='batch_desc' then creation_batch_name end desc nulls last,id
    limit v_limit offset v_offset)
  select coalesce((select jsonb_agg(to_jsonb(paged))from paged),'[]'::jsonb),coalesce((select total from counted),0) into v_items,v_total;
  return jsonb_build_object('items',v_items,'total',v_total,'limit',v_limit,'offset',v_offset);
end;
$$;

revoke all on function public.attach_application_screenshot(uuid,text,text,text,bigint) from public,anon;
revoke all on function public.remove_application_screenshot(uuid) from public,anon;
revoke all on function public.update_application_progress(uuid,text,text,text,timestamptz,text,text,timestamptz) from public,anon;
revoke all on function public.list_applications_v07(text,uuid,text,text,text,text,uuid,text,text,uuid,text,integer,integer) from public,anon;

grant execute on function public.attach_application_screenshot(uuid,text,text,text,bigint) to authenticated;
grant execute on function public.remove_application_screenshot(uuid) to authenticated;
grant execute on function public.update_application_progress(uuid,text,text,text,timestamptz,text,text,timestamptz) to authenticated;
grant execute on function public.list_applications_v07(text,uuid,text,text,text,text,uuid,text,text,uuid,text,integer,integer) to authenticated;
