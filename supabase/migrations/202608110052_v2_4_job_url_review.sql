-- v2.4: manager review and traceable soft archival for captured job URLs.

alter table public.job_descriptions
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid,
  add column if not exists archive_reason text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'job_descriptions_archived_by_profile_fkey'
      and conrelid = 'public.job_descriptions'::regclass
  ) then
    alter table public.job_descriptions
      add constraint job_descriptions_archived_by_profile_fkey
      foreign key (archived_by) references public.profiles(id) on delete restrict;
  end if;
end;
$$;

update public.job_descriptions
set archived_at = coalesce(archived_at, updated_at, created_at),
    archive_reason = coalesce(archive_reason, 'LEGACY')
where status = 'ARCHIVED';

update public.job_descriptions
set archived_at = null, archived_by = null, archive_reason = null
where status <> 'ARCHIVED';

alter table public.job_descriptions drop constraint if exists job_descriptions_archive_reason_valid;
alter table public.job_descriptions add constraint job_descriptions_archive_reason_valid
  check (archive_reason is null or archive_reason in ('NOT_APPLICABLE','EXPIRED','DUPLICATE','OTHER','LEGACY'));
alter table public.job_descriptions drop constraint if exists job_descriptions_archive_audit_consistent;
alter table public.job_descriptions add constraint job_descriptions_archive_audit_consistent check (
  (status = 'ARCHIVED' and archived_at is not null and archive_reason is not null)
  or
  (status <> 'ARCHIVED' and archived_at is null and archived_by is null and archive_reason is null)
);

create or replace function public.maintain_job_description_archive_audit_v24()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.status is distinct from new.status and not public.application_actor_can_manage() then
    raise exception 'JOB_REVIEW_FORBIDDEN: Only an Applying Manager or Admin can review captured URLs.' using errcode = '42501';
  end if;
  if new.status = 'ARCHIVED' then
    if old.status is distinct from 'ARCHIVED' then
      new.archived_at := clock_timestamp();
      new.archived_by := auth.uid();
      new.archive_reason := case when new.archive_reason in ('NOT_APPLICABLE','EXPIRED','DUPLICATE','OTHER') then new.archive_reason else 'NOT_APPLICABLE' end;
    else
      new.archived_at := old.archived_at;
      new.archived_by := old.archived_by;
      new.archive_reason := old.archive_reason;
    end if;
  else
    new.archived_at := null;
    new.archived_by := null;
    new.archive_reason := null;
  end if;
  return new;
end;
$$;
revoke all on function public.maintain_job_description_archive_audit_v24() from public, anon, authenticated;

drop trigger if exists job_descriptions_maintain_archive_audit_v24 on public.job_descriptions;
create trigger job_descriptions_maintain_archive_audit_v24
before update of status, archived_at, archived_by, archive_reason on public.job_descriptions
for each row execute function public.maintain_job_description_archive_audit_v24();

create or replace function public.set_job_description_archived_state_v24(
  p_job_description_id uuid,
  p_status text,
  p_reason text default null
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_status text := upper(btrim(coalesce(p_status, '')));
  v_reason text := upper(btrim(coalesce(p_reason, 'NOT_APPLICABLE')));
  v_job public.job_descriptions;
begin
  perform public.assert_application_manager();
  if p_job_description_id is null or v_status not in ('ACTIVE','ARCHIVED') then
    raise exception 'JOB_REVIEW_INVALID: Select a job URL and valid review status.' using errcode = '22023';
  end if;
  if v_status = 'ARCHIVED' and v_reason not in ('NOT_APPLICABLE','EXPIRED','DUPLICATE','OTHER') then
    raise exception 'JOB_REVIEW_REASON_INVALID: Select a valid decline reason.' using errcode = '22023';
  end if;
  select * into v_job from public.job_descriptions where id = p_job_description_id for update;
  if not found then raise exception 'JOB_NOT_FOUND: The job description was not found.' using errcode = 'P0002'; end if;
  if v_job.status is distinct from v_status then
    update public.job_descriptions
    set status = v_status,
        archive_reason = case when v_status = 'ARCHIVED' then v_reason else null end
    where id = v_job.id returning * into v_job;
  end if;
  return jsonb_build_object(
    'id',v_job.id,'status',v_job.status,'archived_at',v_job.archived_at,
    'archived_by',v_job.archived_by,'archive_reason',v_job.archive_reason,'updated_at',v_job.updated_at
  );
end;
$$;
revoke all on function public.set_job_description_archived_state_v24(uuid,text,text) from public, anon;
grant execute on function public.set_job_description_archived_state_v24(uuid,text,text) to authenticated;

-- Existing Applications remain valid history, but archived URLs cannot create new ones.
create or replace function public.require_active_job_description_for_application_v24()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from public.job_descriptions where id = new.job_description_id and status = 'ACTIVE') then
    raise exception 'APPLICATION_INACTIVE_JOB: Restore the archived job URL before creating an Application.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.require_active_job_description_for_application_v24() from public, anon, authenticated;
drop trigger if exists applications_require_active_job_description_v24 on public.applications;
create trigger applications_require_active_job_description_v24
before insert or update of job_description_id on public.applications
for each row execute function public.require_active_job_description_for_application_v24();

create index if not exists job_descriptions_archive_history_idx
  on public.job_descriptions(archived_at desc, id) where status = 'ARCHIVED';

comment on column public.job_descriptions.archived_at is 'Time an Applying Manager or Admin declined/archived this captured URL.';
comment on column public.job_descriptions.archived_by is 'Applying Manager or Admin who most recently declined/archived this captured URL.';
comment on column public.job_descriptions.archive_reason is 'Reason the captured job URL is excluded from active review and new Applications.';
