-- Temporary migration bridge: Supabase remains authoritative while each JD
-- capture can be mirrored to Google Sheets through the backend and Apps Script.

create table public.job_description_workspace_syncs(
  id uuid primary key default gen_random_uuid(),
  job_description_id uuid not null unique references public.job_descriptions(id) on delete cascade,
  provider text not null default 'GOOGLE_SHEETS' check(provider='GOOGLE_SHEETS'),
  status text not null default 'PENDING' check(status in('PENDING','SYNCING','SUCCEEDED','FAILED')),
  attempt_count integer not null default 0 check(attempt_count between 0 and 1000000),
  last_attempt_at timestamptz,
  synced_at timestamptz,
  last_error_code text check(last_error_code is null or last_error_code~'^[A-Z0-9_]{1,80}$'),
  created_by uuid not null references auth.users(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index job_description_workspace_syncs_status_attempt_idx
  on public.job_description_workspace_syncs(status,last_attempt_at,id);
create trigger job_description_workspace_syncs_updated before update on public.job_description_workspace_syncs
for each row execute function public.set_updated_at();

alter table public.job_description_workspace_syncs enable row level security;
create policy "actors read own workspace JD syncs" on public.job_description_workspace_syncs
for select to authenticated using(
  (select public.is_active_user(auth.uid()))
  and(created_by=(select auth.uid()) or (select public.has_role('ADMIN')))
);

create or replace function public.begin_google_workspace_jd_sync(p_job_description_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid:=auth.uid();v_job public.job_descriptions;v_sync public.job_description_workspace_syncs;
begin
  if v_actor is null or not public.is_active_user(v_actor) or not public.has_any_role(array['JD_FINDER','APPLYING_MANAGER','ADMIN'],v_actor) then
    raise exception 'WORKSPACE_SYNC_FORBIDDEN: JD mirroring is not allowed.' using errcode='42501';
  end if;
  select * into v_job from public.job_descriptions where id=p_job_description_id for share;
  if not found or v_job.user_id is distinct from v_actor then
    raise exception 'WORKSPACE_SYNC_JOB_NOT_FOUND: The owned JD was not found.' using errcode='P0001';
  end if;
  insert into public.job_description_workspace_syncs(job_description_id,created_by)
  values(v_job.id,v_actor) on conflict(job_description_id) do nothing;
  select * into v_sync from public.job_description_workspace_syncs where job_description_id=v_job.id for update;
  if v_sync.status='SUCCEEDED' then
    return jsonb_build_object('syncId',v_sync.id,'status','SUCCEEDED','alreadySynced',true,'attemptCount',v_sync.attempt_count);
  end if;
  if v_sync.status='SYNCING' and v_sync.last_attempt_at>now()-interval '2 minutes' then
    return jsonb_build_object('syncId',v_sync.id,'status','SYNCING','alreadySynced',false,'attemptCount',v_sync.attempt_count);
  end if;
  update public.job_description_workspace_syncs set status='SYNCING',attempt_count=attempt_count+1,last_attempt_at=now(),synced_at=null,last_error_code=null
  where id=v_sync.id returning * into v_sync;
  return jsonb_build_object('syncId',v_sync.id,'status','SYNCING','alreadySynced',false,'attemptCount',v_sync.attempt_count);
end$$;

create or replace function public.finish_google_workspace_jd_sync(p_sync_id uuid,p_succeeded boolean,p_error_code text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid:=auth.uid();v_sync public.job_description_workspace_syncs;v_code text:=upper(btrim(coalesce(p_error_code,'')));
begin
  if v_actor is null or not public.is_active_user(v_actor) then raise exception 'WORKSPACE_SYNC_FORBIDDEN: JD mirroring is not allowed.' using errcode='42501';end if;
  select * into v_sync from public.job_description_workspace_syncs where id=p_sync_id for update;
  if not found or v_sync.created_by is distinct from v_actor or v_sync.status<>'SYNCING' then
    raise exception 'WORKSPACE_SYNC_CONFLICT: The sync attempt is no longer active.' using errcode='P0001';
  end if;
  if p_succeeded then
    update public.job_description_workspace_syncs set status='SUCCEEDED',synced_at=now(),last_error_code=null where id=v_sync.id returning * into v_sync;
  else
    if v_code='' or v_code!~'^[A-Z0-9_]{1,80}$' then v_code:='WORKSPACE_REQUEST_FAILED';end if;
    update public.job_description_workspace_syncs set status='FAILED',synced_at=null,last_error_code=v_code where id=v_sync.id returning * into v_sync;
  end if;
  return jsonb_build_object('syncId',v_sync.id,'status',v_sync.status,'attemptCount',v_sync.attempt_count,'syncedAt',v_sync.synced_at,'errorCode',v_sync.last_error_code);
end$$;

revoke all on public.job_description_workspace_syncs from anon;
revoke insert,update,delete on public.job_description_workspace_syncs from authenticated;
grant select on public.job_description_workspace_syncs to authenticated;
revoke all on function public.begin_google_workspace_jd_sync(uuid) from public,anon;
revoke all on function public.finish_google_workspace_jd_sync(uuid,boolean,text) from public,anon;
grant execute on function public.begin_google_workspace_jd_sync(uuid) to authenticated;
grant execute on function public.finish_google_workspace_jd_sync(uuid,boolean,text) to authenticated;

comment on table public.job_description_workspace_syncs is
  'Durable, non-authoritative delivery state for the temporary Google Sheets JD mirror.';
