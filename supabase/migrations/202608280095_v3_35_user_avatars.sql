-- v3.35: User profile avatars stored in private Supabase Storage.

alter table public.profiles
  add column if not exists avatar_storage_bucket text
    check (avatar_storage_bucket is null or avatar_storage_bucket = 'user-avatars'),
  add column if not exists avatar_storage_path text,
  add column if not exists avatar_original_filename text
    check (avatar_original_filename is null or char_length(avatar_original_filename) between 1 and 300),
  add column if not exists avatar_mime_type text,
  add column if not exists avatar_file_size_bytes bigint
    check (avatar_file_size_bytes is null or avatar_file_size_bytes between 1 and 2097152),
  add column if not exists avatar_updated_at timestamptz;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'user-avatars',
  'user-avatars',
  false,
  2097152,
  array[
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
    'image/gif',
    'image/bmp',
    'image/svg+xml',
    'image/avif',
    'image/tiff',
    'image/x-icon',
    'image/heic',
    'image/heif'
  ]
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "active users read user avatars" on storage.objects
for select to authenticated
using (
  bucket_id = 'user-avatars'
  and public.is_active_user(auth.uid())
);

create policy "self or admin insert user avatars" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'user-avatars'
  and public.is_active_user(auth.uid())
  and (
    public.has_role('ADMIN', auth.uid())
    or (storage.foldername(name))[1] = auth.uid()::text
  )
);

create policy "self or admin update user avatars" on storage.objects
for update to authenticated
using (
  bucket_id = 'user-avatars'
  and public.is_active_user(auth.uid())
  and (
    public.has_role('ADMIN', auth.uid())
    or (storage.foldername(name))[1] = auth.uid()::text
  )
)
with check (
  bucket_id = 'user-avatars'
  and public.is_active_user(auth.uid())
  and (
    public.has_role('ADMIN', auth.uid())
    or (storage.foldername(name))[1] = auth.uid()::text
  )
);

create policy "self or admin delete user avatars" on storage.objects
for delete to authenticated
using (
  bucket_id = 'user-avatars'
  and public.is_active_user(auth.uid())
  and (
    public.has_role('ADMIN', auth.uid())
    or (storage.foldername(name))[1] = auth.uid()::text
  )
);

create or replace function public.set_user_avatar_v35(
  p_user_id uuid,
  p_storage_path text,
  p_original_filename text,
  p_mime_type text,
  p_file_size_bytes bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_previous_path text;
  v_previous_bucket text;
begin
  if not public.is_active_user(v_actor) then
    raise exception 'ACCOUNT_INACTIVE' using errcode = '42501';
  end if;
  if p_user_id is null then
    raise exception 'VALIDATION_ERROR: User ID is required.' using errcode = '22023';
  end if;
  if p_user_id is distinct from v_actor and not public.has_role('ADMIN', v_actor) then
    raise exception 'ACCESS_DENIED: You cannot update this user avatar.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'USER_NOT_FOUND: User was not found.' using errcode = 'P0001';
  end if;
  if coalesce(trim(p_storage_path), '') = ''
     or p_storage_path !~ ('^' || p_user_id::text || '/') then
    raise exception 'USER_AVATAR_INVALID_PATH: The avatar path is invalid.' using errcode = '22023';
  end if;
  if coalesce(trim(p_original_filename), '') = '' then
    raise exception 'USER_AVATAR_INVALID_FILENAME: Enter a valid filename.' using errcode = '22023';
  end if;
  if lower(trim(coalesce(p_mime_type, ''))) !~ '^image/' then
    raise exception 'USER_AVATAR_INVALID_TYPE: Upload an image file.' using errcode = '22023';
  end if;
  if p_file_size_bytes is null or p_file_size_bytes < 1 or p_file_size_bytes > 2097152 then
    raise exception 'USER_AVATAR_INVALID_SIZE: The avatar must be between 1 byte and 2 MiB.' using errcode = '22023';
  end if;

  select avatar_storage_bucket, avatar_storage_path
  into v_previous_bucket, v_previous_path
  from public.profiles
  where id = p_user_id
  for update;

  update public.profiles
  set
    avatar_storage_bucket = 'user-avatars',
    avatar_storage_path = p_storage_path,
    avatar_original_filename = trim(p_original_filename),
    avatar_mime_type = lower(trim(p_mime_type)),
    avatar_file_size_bytes = p_file_size_bytes,
    avatar_updated_at = now(),
    updated_at = now()
  where id = p_user_id
  returning * into v_profile;

  return jsonb_build_object(
    'userId', v_profile.id,
    'hasAvatar', true,
    'avatarUpdatedAt', v_profile.avatar_updated_at,
    'avatarMimeType', v_profile.avatar_mime_type,
    'avatarFileSizeBytes', v_profile.avatar_file_size_bytes,
    'avatarOriginalFilename', v_profile.avatar_original_filename,
    'previousStorageBucket', v_previous_bucket,
    'previousStoragePath', v_previous_path
  );
end;
$$;

create or replace function public.remove_user_avatar_v35(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_previous_bucket text;
  v_previous_path text;
begin
  if not public.is_active_user(v_actor) then
    raise exception 'ACCOUNT_INACTIVE' using errcode = '42501';
  end if;
  if p_user_id is null then
    raise exception 'VALIDATION_ERROR: User ID is required.' using errcode = '22023';
  end if;
  if p_user_id is distinct from v_actor and not public.has_role('ADMIN', v_actor) then
    raise exception 'ACCESS_DENIED: You cannot remove this user avatar.' using errcode = '42501';
  end if;

  select * into v_profile
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    raise exception 'USER_NOT_FOUND: User was not found.' using errcode = 'P0001';
  end if;
  if v_profile.avatar_storage_path is null then
    raise exception 'USER_AVATAR_NOT_FOUND: This user does not have an avatar.' using errcode = 'P0001';
  end if;

  v_previous_bucket := v_profile.avatar_storage_bucket;
  v_previous_path := v_profile.avatar_storage_path;

  update public.profiles
  set
    avatar_storage_bucket = null,
    avatar_storage_path = null,
    avatar_original_filename = null,
    avatar_mime_type = null,
    avatar_file_size_bytes = null,
    avatar_updated_at = null,
    updated_at = now()
  where id = p_user_id
  returning * into v_profile;

  return jsonb_build_object(
    'userId', v_profile.id,
    'hasAvatar', false,
    'previousStorageBucket', v_previous_bucket,
    'previousStoragePath', v_previous_path
  );
end;
$$;

create or replace function public.get_user_avatar_v35(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles%rowtype;
begin
  if not public.is_active_user(auth.uid()) then
    raise exception 'ACCOUNT_INACTIVE' using errcode = '42501';
  end if;
  if p_user_id is null then
    raise exception 'VALIDATION_ERROR: User ID is required.' using errcode = '22023';
  end if;

  select * into v_profile from public.profiles where id = p_user_id;
  if not found then
    raise exception 'USER_NOT_FOUND: User was not found.' using errcode = 'P0001';
  end if;
  if v_profile.avatar_storage_path is null then
    raise exception 'USER_AVATAR_NOT_FOUND: This user does not have an avatar.' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'userId', v_profile.id,
    'storageBucket', v_profile.avatar_storage_bucket,
    'storagePath', v_profile.avatar_storage_path,
    'originalFilename', v_profile.avatar_original_filename,
    'mimeType', v_profile.avatar_mime_type,
    'fileSizeBytes', v_profile.avatar_file_size_bytes,
    'updatedAt', v_profile.avatar_updated_at
  );
end;
$$;

create or replace function public.get_my_access_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_roles text[];
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select * into v_profile from public.profiles where id = v_user_id;
  if not found then
    raise exception 'ACCESS_CONTEXT_FAILED: Profile is missing.' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(distinct roles.code order by roles.code), array[]::text[])
  into v_roles
  from public.user_roles as assignments
  join public.roles as roles on roles.id = assignments.role_id and roles.active = true
  where assignments.user_id = v_user_id;

  return jsonb_build_object(
    'userId', v_profile.id,
    'email', v_profile.email,
    'fullName', v_profile.full_name,
    'status', v_profile.status,
    'roles', to_jsonb(v_roles),
    'createdAt', v_profile.created_at,
    'hasAvatar', v_profile.avatar_storage_path is not null,
    'avatarUpdatedAt', v_profile.avatar_updated_at
  );
end;
$$;

create or replace function public.admin_get_user(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles%rowtype;
  v_roles text[];
begin
  perform public.assert_active_admin();
  if p_user_id is null then
    raise exception 'VALIDATION_ERROR: User ID is required.' using errcode = '22023';
  end if;
  select * into v_profile from public.profiles where id = p_user_id;
  if not found then raise exception 'USER_NOT_FOUND' using errcode = 'P0002'; end if;
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
    'updatedAt', v_profile.updated_at,
    'hasAvatar', v_profile.avatar_storage_path is not null,
    'avatarUpdatedAt', v_profile.avatar_updated_at
  );
end;
$$;

revoke all on function public.set_user_avatar_v35(uuid, text, text, text, bigint) from public, anon;
revoke all on function public.remove_user_avatar_v35(uuid) from public, anon;
revoke all on function public.get_user_avatar_v35(uuid) from public, anon;
grant execute on function public.set_user_avatar_v35(uuid, text, text, text, bigint) to authenticated;
grant execute on function public.remove_user_avatar_v35(uuid) to authenticated;
grant execute on function public.get_user_avatar_v35(uuid) to authenticated;

comment on function public.set_user_avatar_v35(uuid, text, text, text, bigint) is
  'Attach or replace one user avatar. Self-service or Admin for another user.';
comment on function public.remove_user_avatar_v35(uuid) is
  'Remove one user avatar. Self-service or Admin for another user.';
comment on function public.get_user_avatar_v35(uuid) is
  'Read avatar metadata for any active authenticated user.';
