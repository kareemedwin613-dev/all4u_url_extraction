-- v3.36: expose avatar metadata on admin user list rows.

drop function if exists public.admin_list_users_v2(text, text, text, text, integer, integer);

create or replace function public.admin_list_users_v2(
  p_search text default '',
  p_status text default null,
  p_role_code text default null,
  p_sort text default 'created_desc',
  p_limit integer default 25,
  p_offset integer default 0
)
returns table(
  id uuid,
  email text,
  full_name text,
  status text,
  role_codes text[],
  created_at timestamptz,
  has_avatar boolean,
  avatar_updated_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_search text := left(trim(coalesce(p_search, '')), 100);
  v_status text := nullif(upper(trim(coalesce(p_status, ''))), '');
  v_role_code text := nullif(upper(trim(coalesce(p_role_code, ''))), '');
  v_sort text := lower(coalesce(p_sort, 'created_desc'));
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  perform public.assert_active_admin();
  if v_status is not null and v_status not in ('ACTIVE', 'INACTIVE') then
    raise exception 'VALIDATION_ERROR: Invalid status.' using errcode = '22023';
  end if;
  if v_role_code is not null
     and v_role_code <> 'NONE'
     and not exists (select 1 from public.roles where code = v_role_code and active) then
    raise exception 'ROLE_NOT_FOUND' using errcode = '22023';
  end if;
  if v_sort not in (
    'name_asc', 'name_desc', 'email_asc', 'email_desc',
    'status_asc', 'status_desc', 'roles_asc', 'roles_desc',
    'created_asc', 'created_desc'
  ) then
    raise exception 'VALIDATION_ERROR: Invalid user sort.' using errcode = '22023';
  end if;

  return query
  with users as (
    select
      profiles.id,
      profiles.email,
      profiles.full_name,
      profiles.status,
      profiles.created_at,
      profiles.avatar_storage_path is not null as has_avatar,
      profiles.avatar_updated_at,
      coalesce(
        array_agg(distinct roles.code order by roles.code) filter (where roles.active),
        array[]::text[]
      ) as role_codes
    from public.profiles profiles
    left join public.user_roles assignments on assignments.user_id = profiles.id
    left join public.roles roles on roles.id = assignments.role_id
    group by
      profiles.id,
      profiles.email,
      profiles.full_name,
      profiles.status,
      profiles.created_at,
      profiles.avatar_storage_path,
      profiles.avatar_updated_at
  ),
  filtered as (
    select users.*
    from users
    where (v_search = '' or users.email ilike '%' || v_search || '%' or users.full_name ilike '%' || v_search || '%')
      and (v_status is null or users.status = v_status)
      and (
        v_role_code is null
        or (v_role_code = 'NONE' and coalesce(cardinality(users.role_codes), 0) = 0)
        or v_role_code = any(users.role_codes)
      )
  )
  select
    filtered.id,
    filtered.email,
    filtered.full_name,
    filtered.status,
    filtered.role_codes,
    filtered.created_at,
    filtered.has_avatar,
    filtered.avatar_updated_at,
    count(*) over()
  from filtered
  order by
    case when v_sort = 'name_asc' then filtered.full_name end asc nulls last,
    case when v_sort = 'name_desc' then filtered.full_name end desc nulls last,
    case when v_sort = 'email_asc' then filtered.email end asc,
    case when v_sort = 'email_desc' then filtered.email end desc,
    case when v_sort = 'status_asc' then filtered.status end asc,
    case when v_sort = 'status_desc' then filtered.status end desc,
    case when v_sort = 'roles_asc' then array_to_string(filtered.role_codes, ',') end asc,
    case when v_sort = 'roles_desc' then array_to_string(filtered.role_codes, ',') end desc,
    case when v_sort = 'created_asc' then filtered.created_at end asc,
    case when v_sort = 'created_desc' then filtered.created_at end desc,
    filtered.id
  limit v_limit offset v_offset;
end;
$$;

revoke all on function public.admin_list_users_v2(text, text, text, text, integer, integer) from public, anon;
grant execute on function public.admin_list_users_v2(text, text, text, text, integer, integer) to authenticated;

comment on function public.admin_list_users_v2(text, text, text, text, integer, integer) is
  'Admin user directory with avatar metadata for list rendering.';
