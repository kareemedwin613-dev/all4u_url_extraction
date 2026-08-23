-- Admin can update any user's full name (mirrors update_my_profile sync rules).
create or replace function public.admin_update_user_profile(p_user_id uuid, p_full_name text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_full_name text := trim(coalesce(p_full_name, ''));
  v_profile public.profiles%rowtype;
  v_roles text[];
begin
  perform public.assert_active_admin();
  if p_user_id is null then
    raise exception 'VALIDATION_ERROR: User ID is required.' using errcode = '22023';
  end if;
  if char_length(v_full_name) > 200 then
    raise exception 'VALIDATION_ERROR: Full name must be at most 200 characters.' using errcode = '22023';
  end if;
  update public.profiles
  set full_name = v_full_name
  where id = p_user_id
  returning * into v_profile;
  if not found then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0002';
  end if;
  update public.user_profiles
  set display_name = v_full_name
  where id = p_user_id;
  select coalesce(array_agg(distinct roles.code order by roles.code) filter (where roles.active), array[]::text[])
  into v_roles
  from public.user_roles as assignments
  join public.roles as roles on roles.id = assignments.role_id
  where assignments.user_id = p_user_id;
  return jsonb_build_object(
    'id', v_profile.id,
    'email', v_profile.email,
    'fullName', v_profile.full_name,
    'status', v_profile.status,
    'roles', to_jsonb(v_roles),
    'createdAt', v_profile.created_at,
    'updatedAt', v_profile.updated_at
  );
end;
$$;

revoke all on function public.admin_update_user_profile(uuid, text) from public, anon;
grant execute on function public.admin_update_user_profile(uuid, text) to authenticated;

comment on function public.admin_update_user_profile(uuid, text) is
  'Admin-only update of profiles.full_name and matching user_profiles.display_name.';
