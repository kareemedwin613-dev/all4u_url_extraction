-- v3.103: managers/admins can reassign job_descriptions.user_id (Captured By).

create table if not exists public.job_description_capturer_history (
  id uuid primary key default gen_random_uuid(),
  job_description_id uuid not null references public.job_descriptions(id) on delete cascade,
  previous_user_id uuid references public.profiles(id) on delete set null,
  new_user_id uuid not null references public.profiles(id) on delete restrict,
  changed_by uuid not null references public.profiles(id) on delete restrict,
  reason text,
  created_at timestamptz not null default clock_timestamp(),
  constraint job_description_capturer_history_reason_len
    check (reason is null or char_length(reason) <= 1000)
);

create index if not exists job_description_capturer_history_jd_idx
  on public.job_description_capturer_history (job_description_id, created_at desc);

create index if not exists job_description_capturer_history_new_user_idx
  on public.job_description_capturer_history (new_user_id, created_at desc);

alter table public.job_description_capturer_history enable row level security;

drop policy if exists job_description_capturer_history_select on public.job_description_capturer_history;
create policy job_description_capturer_history_select
  on public.job_description_capturer_history
  for select
  to authenticated
  using (public.application_actor_can_manage());

revoke insert, update, delete on public.job_description_capturer_history from authenticated;
grant select on public.job_description_capturer_history to authenticated;

create or replace function public.list_job_capturer_candidates_v3103(
  p_search text default '',
  p_limit integer default 200
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 500);
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
begin
  perform public.assert_application_manager();

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', x.id,
        'email', x.email,
        'displayName', x.display_name,
        'roles', x.roles
      )
      order by x.display_name, x.email
    ),
    '[]'::jsonb
  )
  into v_result
  from (
    select
      p.id,
      p.email,
      coalesce(nullif(p.full_name, ''), p.email) as display_name,
      coalesce(
        (
          select array_agg(r.code order by r.code)
          from public.user_roles ur
          join public.roles r on r.id = ur.role_id and r.active
          where ur.user_id = p.id
            and r.code in ('JD_FINDER', 'APPLYING_MANAGER', 'ADMIN')
        ),
        array[]::text[]
      ) as roles
    from public.profiles p
    where p.status = 'ACTIVE'
      and exists (
        select 1
        from public.user_roles ur
        join public.roles r on r.id = ur.role_id and r.active
        where ur.user_id = p.id
          and r.code in ('JD_FINDER', 'APPLYING_MANAGER', 'ADMIN')
      )
      and (
        v_search is null
        or p.email ilike '%' || v_search || '%'
        or p.full_name ilike '%' || v_search || '%'
      )
    order by coalesce(nullif(p.full_name, ''), p.email), p.email
    limit v_limit
  ) x;

  return v_result;
end;
$$;

revoke all on function public.list_job_capturer_candidates_v3103(text, integer) from public, anon;
grant execute on function public.list_job_capturer_candidates_v3103(text, integer) to authenticated;

comment on function public.list_job_capturer_candidates_v3103(text, integer) is
  'Active users who may own captured Job Descriptions (JD Finder / Applying Manager / Admin).';

create or replace function public.bulk_reassign_job_description_capturers_v3103(
  p_job_description_ids uuid[],
  p_new_user_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_ids uuid[];
  v_results jsonb := '[]'::jsonb;
  v_succeeded integer := 0;
  v_id uuid;
  v_job public.job_descriptions;
  v_previous_user_id uuid;
  v_target record;
  v_duplicate_id uuid;
begin
  perform public.assert_application_manager();

  if p_job_description_ids is null then
    raise exception 'JOB_CAPTURER_INVALID: Select at least one Job Description.' using errcode = '22023';
  end if;

  select array_agg(x order by x)
    into v_ids
  from (
    select distinct t.x
    from unnest(p_job_description_ids) as t(x)
    where t.x is not null
  ) d;

  if v_ids is null or cardinality(v_ids) < 1 then
    raise exception 'JOB_CAPTURER_INVALID: Select at least one Job Description.' using errcode = '22023';
  end if;
  if cardinality(v_ids) > 1000 then
    raise exception 'JOB_CAPTURER_INVALID: Select no more than 1000 Job Descriptions.' using errcode = '22023';
  end if;
  if p_new_user_id is null then
    raise exception 'JOB_CAPTURER_TARGET_REQUIRED: Select a new Captured By user.' using errcode = '22023';
  end if;
  if char_length(coalesce(v_reason, '')) > 1000 then
    raise exception 'JOB_CAPTURER_REASON_INVALID: Reason may contain at most 1000 characters.' using errcode = '22023';
  end if;

  select
    p.id,
    p.status,
    exists (
      select 1
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id and r.active
      where ur.user_id = p.id
        and r.code in ('JD_FINDER', 'APPLYING_MANAGER', 'ADMIN')
    ) as eligible
  into v_target
  from public.profiles p
  where p.id = p_new_user_id;

  if not found then
    raise exception 'JOB_CAPTURER_TARGET_NOT_FOUND: The selected user was not found.' using errcode = 'P0001';
  end if;
  if v_target.status <> 'ACTIVE' then
    raise exception 'JOB_CAPTURER_TARGET_INACTIVE: The selected user is inactive.' using errcode = '22023';
  end if;
  if not v_target.eligible then
    raise exception 'JOB_CAPTURER_TARGET_ROLE: Select an active JD Finder, Applying Manager, or Admin.' using errcode = '22023';
  end if;

  foreach v_id in array v_ids loop
    select * into v_job from public.job_descriptions where id = v_id for update;

    if not found then
      v_results := v_results || jsonb_build_array(
        jsonb_build_object(
          'id', v_id,
          'ok', false,
          'code', 'JOB_NOT_FOUND',
          'message', 'The job description was not found or is not accessible.'
        )
      );
      continue;
    end if;

    if v_job.user_id is not distinct from p_new_user_id then
      v_succeeded := v_succeeded + 1;
      v_results := v_results || jsonb_build_array(
        jsonb_build_object(
          'id', v_id,
          'ok', true,
          'data', jsonb_build_object(
            'id', v_job.id,
            'user_id', v_job.user_id,
            'updated_at', v_job.updated_at,
            'unchanged', true
          )
        )
      );
      continue;
    end if;

    if coalesce(v_job.normalized_source_url, '') <> '' then
      select j.id
        into v_duplicate_id
      from public.job_descriptions j
      where j.user_id = p_new_user_id
        and j.normalized_source_url = v_job.normalized_source_url
        and j.id is distinct from v_job.id
      limit 1;

      if v_duplicate_id is not null then
        v_results := v_results || jsonb_build_array(
          jsonb_build_object(
            'id', v_id,
            'ok', false,
            'code', 'JOB_DUPLICATE',
            'message', 'The selected user already has a Job Description with this URL.',
            'duplicateId', v_duplicate_id
          )
        );
        continue;
      end if;
    end if;

    v_previous_user_id := v_job.user_id;

    update public.job_descriptions
    set
      user_id = p_new_user_id,
      updated_at = clock_timestamp()
    where id = v_job.id
    returning * into v_job;

    insert into public.job_description_capturer_history (
      job_description_id,
      previous_user_id,
      new_user_id,
      changed_by,
      reason
    ) values (
      v_job.id,
      v_previous_user_id,
      p_new_user_id,
      v_actor,
      v_reason
    );

    v_succeeded := v_succeeded + 1;
    v_results := v_results || jsonb_build_array(
      jsonb_build_object(
        'id', v_id,
        'ok', true,
        'data', jsonb_build_object(
          'id', v_job.id,
          'user_id', v_job.user_id,
          'previous_user_id', v_previous_user_id,
          'updated_at', v_job.updated_at,
          'unchanged', false
        )
      )
    );
  end loop;

  return jsonb_build_object(
    'total', cardinality(v_ids),
    'succeeded', v_succeeded,
    'failed', cardinality(v_ids) - v_succeeded,
    'newUserId', p_new_user_id,
    'results', v_results
  );
end;
$$;

revoke all on function public.bulk_reassign_job_description_capturers_v3103(uuid[], uuid, text) from public, anon;
grant execute on function public.bulk_reassign_job_description_capturers_v3103(uuid[], uuid, text) to authenticated;

comment on function public.bulk_reassign_job_description_capturers_v3103(uuid[], uuid, text) is
  'Reassign Captured By (user_id) on selected Job Descriptions. Managers/Admins only.';
