-- v2.3: traceable soft archival for original Resumes.

alter table public.resumes
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'resumes_archived_by_profile_fkey'
      and conrelid = 'public.resumes'::regclass
  ) then
    alter table public.resumes
      add constraint resumes_archived_by_profile_fkey
      foreign key (archived_by) references public.profiles(id) on delete restrict;
  end if;
end;
$$;

update public.resumes
set archived_at = coalesce(archived_at, updated_at, created_at)
where status = 'ARCHIVED'
  and archived_at is null;

update public.resumes
set archived_at = null, archived_by = null
where status <> 'ARCHIVED'
  and (archived_at is not null or archived_by is not null);

alter table public.resumes
  drop constraint if exists resumes_archive_audit_consistent;
alter table public.resumes
  add constraint resumes_archive_audit_consistent check (
    (status = 'ARCHIVED' and archived_at is not null)
    or
    (status <> 'ARCHIVED' and archived_at is null and archived_by is null)
  );

create or replace function public.maintain_resume_archive_audit_v23()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'ARCHIVED' then
    if old.status is distinct from 'ARCHIVED' then
      new.archived_at := clock_timestamp();
      new.archived_by := auth.uid();
    else
      new.archived_at := old.archived_at;
      new.archived_by := old.archived_by;
    end if;
  else
    new.archived_at := null;
    new.archived_by := null;
  end if;
  return new;
end;
$$;

revoke all on function public.maintain_resume_archive_audit_v23() from public, anon, authenticated;

drop trigger if exists resumes_maintain_archive_audit_v23 on public.resumes;
create trigger resumes_maintain_archive_audit_v23
before update of status, archived_at, archived_by on public.resumes
for each row execute function public.maintain_resume_archive_audit_v23();

create or replace function public.set_resume_archived_state_v23(
  p_resume_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text := upper(btrim(coalesce(p_status, '')));
  v_resume public.resumes;
begin
  perform public.assert_application_manager();

  if p_resume_id is null or v_status not in ('ACTIVE', 'ARCHIVED') then
    raise exception 'RESUME_ARCHIVE_INVALID: Select an original Resume and a valid status.' using errcode = '22023';
  end if;

  select * into v_resume
  from public.resumes
  where id = p_resume_id
  for update;

  if not found then
    raise exception 'RESUME_NOT_FOUND: The Resume was not found.' using errcode = 'P0002';
  end if;
  if v_resume.resume_type <> 'ORIGINAL' then
    raise exception 'RESUME_ARCHIVE_ORIGINAL_ONLY: Only original Resumes can be archived or restored.' using errcode = '22023';
  end if;

  if v_resume.status is distinct from v_status then
    update public.resumes
    set status = v_status
    where id = v_resume.id
    returning * into v_resume;
  end if;

  return jsonb_build_object(
    'id', v_resume.id,
    'resume_number', v_resume.resume_number,
    'status', v_resume.status,
    'archived_at', v_resume.archived_at,
    'archived_by', v_resume.archived_by,
    'updated_at', v_resume.updated_at
  );
end;
$$;

revoke all on function public.set_resume_archived_state_v23(uuid, text) from public, anon;
grant execute on function public.set_resume_archived_state_v23(uuid, text) to authenticated;

create index if not exists resumes_original_archive_history_idx
  on public.resumes(archived_at desc, id)
  where resume_type = 'ORIGINAL' and status = 'ARCHIVED';

comment on column public.resumes.archived_at is 'Time the Resume was most recently soft archived; null while active.';
comment on column public.resumes.archived_by is 'Active Applying Manager or Admin who most recently soft archived the Resume; null only for legacy history created before audit tracking.';
