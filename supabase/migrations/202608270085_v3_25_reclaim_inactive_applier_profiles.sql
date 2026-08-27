-- Allow managers to reassign Resume profiles held by inactive Appliers.
create or replace function public.list_applier_resume_profile_options_v313()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  perform public.assert_application_manager();
  select coalesce(jsonb_agg(jsonb_build_object(
    'resumeId', r.id,
    'resumeNumber', r.resume_number,
    'resumeName', r.resume_name,
    'candidateName', r.candidate_name,
    'status', r.status,
    'ownerApplierUserId', m.applier_user_id,
    'ownerActive', case when m.applier_user_id is null then null else (p.status = 'ACTIVE') end,
    'ownerDisplayName', case when m.applier_user_id is null then null else coalesce(nullif(p.full_name, ''), p.email) end,
    'ownerEmail', p.email
  ) order by r.candidate_name, r.resume_name, r.id), '[]'::jsonb)
  into v_result
  from public.resumes r
  left join public.applier_resume_profiles m on m.resume_id = r.id
  left join public.profiles p on p.id = m.applier_user_id
  where r.resume_type = 'ORIGINAL' and r.status = 'ACTIVE';
  return v_result;
end;
$$;

create or replace function public.set_applier_resume_profiles_v313(p_applier_user_id uuid, p_resume_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids uuid[];
  v_resume_id uuid;
  v_resume public.resumes;
  v_owner uuid;
  v_owner_name text;
  v_owner_status text;
begin
  perform public.assert_application_manager();
  if not exists (
    select 1 from public.profiles p
    where p.id = p_applier_user_id and p.status = 'ACTIVE'
      and exists (
        select 1 from public.user_roles ur
        join public.roles r on r.id = ur.role_id
        where ur.user_id = p.id and r.code = 'APPLIER' and r.active
      )
  ) then
    raise exception 'APPLIER_NOT_FOUND: Select an active user with the Applier role.' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(distinct x), array[]::uuid[])
  into v_ids
  from unnest(coalesce(p_resume_ids, array[]::uuid[])) x
  where x is not null;

  if cardinality(v_ids) > 200 then
    raise exception 'VALIDATION_ERROR: Assign no more than 200 Resume profiles to one Applier.' using errcode = '22023';
  end if;

  foreach v_resume_id in array v_ids loop
    select * into v_resume from public.resumes where id = v_resume_id;
    if not found then
      raise exception 'RESUME_NOT_FOUND: One or more selected Resumes were not found.' using errcode = 'P0001';
    end if;
    if v_resume.resume_type <> 'ORIGINAL' then
      raise exception 'RESUME_TYPE_INVALID: Only original Resumes can be assigned as Applier profiles.' using errcode = '22023';
    end if;
    if v_resume.status <> 'ACTIVE' then
      raise exception 'RESUME_INACTIVE: Only active Resumes can be assigned as Applier profiles.' using errcode = '22023';
    end if;
    select m.applier_user_id, coalesce(nullif(p.full_name, ''), p.email), p.status
    into v_owner, v_owner_name, v_owner_status
    from public.applier_resume_profiles m
    join public.profiles p on p.id = m.applier_user_id
    where m.resume_id = v_resume_id;
    if found and v_owner is distinct from p_applier_user_id and v_owner_status = 'ACTIVE' then
      raise exception 'RESUME_PROFILE_TAKEN: Resume "%" is already assigned to %.',
        coalesce(nullif(v_resume.resume_name, ''), v_resume.candidate_name, v_resume.id::text),
        coalesce(v_owner_name, 'another Applier')
        using errcode = '23505';
    end if;
  end loop;

  -- Transfer profiles still mapped to inactive Appliers onto the selected Applier.
  delete from public.applier_resume_profiles m
  using public.profiles p
  where m.resume_id = any (v_ids)
    and m.applier_user_id is distinct from p_applier_user_id
    and p.id = m.applier_user_id
    and p.status is distinct from 'ACTIVE';

  delete from public.applier_resume_profiles
  where applier_user_id = p_applier_user_id
    and not (resume_id = any (v_ids));

  insert into public.applier_resume_profiles (applier_user_id, resume_id, created_by)
  select p_applier_user_id, x, auth.uid()
  from unnest(v_ids) x
  on conflict (resume_id) do nothing;

  return public.list_applier_resume_profiles_v313(p_applier_user_id);
end;
$$;

comment on function public.list_applier_resume_profile_options_v313() is
  'Active original Resumes for Applier profile mapping, including owner activity for reclaim UI.';
comment on function public.set_applier_resume_profiles_v313(uuid, uuid[]) is
  'Replace Applier resume profiles; may reclaim mappings held by inactive Appliers.';
