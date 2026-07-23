-- v0.5: application profiles, fixed roles, role-aware business RLS, and private Storage access.
-- The earlier public.user_profiles table remains for backward-compatible capture attribution.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z][A-Z0-9_]*$'),
  name text not null,
  description text not null default '',
  active boolean not null default true,
  is_system boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_roles (
  user_id uuid not null references public.profiles(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete restrict,
  assigned_by uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (user_id, role_id)
);

insert into public.roles (code, name, description, active, is_system)
values
  ('APPLIER', 'Applier', 'Performs assigned job-application work.', true, true),
  ('APPLYING_MANAGER', 'Applying Manager', 'Oversees job-application operations and creates work in later milestones.', true, true),
  ('DEVELOPER', 'Developer', 'Technical platform contributor without automatic business-data access.', true, true),
  ('DEVELOPMENT_MANAGER', 'Development Manager', 'Technical manager without automatic business-data access.', true, true),
  ('ADMIN', 'Admin', 'Manages platform users, roles, and all v0.5 data access.', true, true)
on conflict (code) do update
set name = excluded.name,
    description = excluded.description,
    active = true,
    is_system = true;

insert into public.profiles (id, email, full_name, status, created_at, updated_at)
select
  users.id,
  lower(coalesce(users.email, '')),
  coalesce(nullif(users.raw_user_meta_data ->> 'full_name', ''), nullif(users.raw_user_meta_data ->> 'display_name', ''), legacy.display_name, ''),
  'ACTIVE',
  users.created_at,
  now()
from auth.users as users
left join public.user_profiles as legacy on legacy.id = users.id
on conflict (id) do nothing;

create index if not exists profiles_status_created_idx on public.profiles (status, created_at desc);
create index if not exists roles_active_code_idx on public.roles (active, code);
create index if not exists user_roles_user_id_idx on public.user_roles (user_id);
create index if not exists user_roles_role_id_idx on public.user_roles (role_id);
create index if not exists user_roles_assigned_by_idx on public.user_roles (assigned_by);

drop trigger if exists profiles_updated on public.profiles;
create trigger profiles_updated
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists roles_updated on public.roles;
create trigger roles_updated
before update on public.roles
for each row execute function public.set_updated_at();

create or replace function public.sync_auth_user_access_profile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_full_name text;
begin
  v_full_name := coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'display_name', '');
  insert into public.profiles (id, email, full_name, status, created_at, updated_at)
  values (new.id, lower(coalesce(new.email, '')), v_full_name, 'ACTIVE', coalesce(new.created_at, now()), now())
  on conflict (id) do update
  set email = excluded.email,
      full_name = case when v_full_name <> '' then v_full_name else public.profiles.full_name end,
      updated_at = now();
  insert into public.user_profiles (id, email, display_name, created_at, updated_at)
  values (new.id, lower(coalesce(new.email, '')), v_full_name, coalesce(new.created_at, now()), now())
  on conflict (id) do update
  set email = excluded.email,
      display_name = case when v_full_name <> '' then v_full_name else public.user_profiles.display_name end,
      updated_at = now();
  return new;
end;
$$;

revoke all on function public.sync_auth_user_access_profile() from public, anon, authenticated;

drop trigger if exists sync_auth_user_access_profile_after_insert_or_update on auth.users;
create trigger sync_auth_user_access_profile_after_insert_or_update
after insert or update of email, raw_user_meta_data on auth.users
for each row execute function public.sync_auth_user_access_profile();

create or replace function public.is_active_user(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and p_user_id = auth.uid()
    and exists (
      select 1 from public.profiles as profiles
      where profiles.id = p_user_id and profiles.status = 'ACTIVE'
    );
$$;

create or replace function public.has_role(p_role_code text, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_active_user(p_user_id)
    and exists (
      select 1
      from public.user_roles as assignments
      join public.roles as roles on roles.id = assignments.role_id
      where assignments.user_id = p_user_id
        and roles.active = true
        and roles.code = upper(trim(coalesce(p_role_code, '')))
    );
$$;

create or replace function public.has_any_role(p_role_codes text[], p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_active_user(p_user_id)
    and exists (
      select 1
      from public.user_roles as assignments
      join public.roles as roles on roles.id = assignments.role_id
      where assignments.user_id = p_user_id
        and roles.active = true
        and roles.code = any (
          coalesce(
            (select array_agg(upper(trim(value))) from unnest(p_role_codes) as requested(value)),
            array[]::text[]
          )
        )
    );
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
    'createdAt', v_profile.created_at
  );
end;
$$;

create or replace function public.assert_active_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if not public.has_role('ADMIN', v_caller) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;
  return v_caller;
end;
$$;

create or replace function public.admin_list_users(
  p_search text default '',
  p_status text default null,
  p_role_code text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  id uuid,
  email text,
  full_name text,
  status text,
  role_codes text[],
  created_at timestamptz,
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
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  perform public.assert_active_admin();
  if v_status is not null and v_status not in ('ACTIVE', 'INACTIVE') then
    raise exception 'VALIDATION_ERROR: Invalid status.' using errcode = '22023';
  end if;
  if v_role_code is not null and not exists (select 1 from public.roles where code = v_role_code and active) then
    raise exception 'ROLE_NOT_FOUND' using errcode = '22023';
  end if;

  return query
  with users as (
    select
      profiles.id,
      profiles.email,
      profiles.full_name,
      profiles.status,
      profiles.created_at,
      coalesce(array_agg(distinct roles.code order by roles.code) filter (where roles.active), array[]::text[]) as role_codes
    from public.profiles as profiles
    left join public.user_roles as assignments on assignments.user_id = profiles.id
    left join public.roles as roles on roles.id = assignments.role_id
    group by profiles.id, profiles.email, profiles.full_name, profiles.status, profiles.created_at
  ), filtered as (
    select users.* from users
    where (v_search = '' or users.email ilike '%' || v_search || '%' or users.full_name ilike '%' || v_search || '%')
      and (v_status is null or users.status = v_status)
      and (v_role_code is null or v_role_code = any(users.role_codes))
  )
  select filtered.id, filtered.email, filtered.full_name, filtered.status, filtered.role_codes,
         filtered.created_at, count(*) over() as total_count
  from filtered
  order by filtered.created_at desc, filtered.id
  limit v_limit offset v_offset;
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
    'updatedAt', v_profile.updated_at
  );
end;
$$;

create or replace function public.admin_assign_role(p_user_id uuid, p_role_code text)
returns text[]
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid;
  v_role_id uuid;
  v_role_code text := upper(trim(coalesce(p_role_code, '')));
  v_roles text[];
begin
  v_caller := public.assert_active_admin();
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0002';
  end if;
  select id into v_role_id from public.roles where code = v_role_code and active;
  if not found then raise exception 'ROLE_NOT_FOUND' using errcode = '22023'; end if;
  insert into public.user_roles (user_id, role_id, assigned_by)
  values (p_user_id, v_role_id, v_caller)
  on conflict (user_id, role_id) do nothing;
  select coalesce(array_agg(distinct roles.code order by roles.code) filter (where roles.active), array[]::text[])
  into v_roles
  from public.user_roles as assignments join public.roles as roles on roles.id = assignments.role_id
  where assignments.user_id = p_user_id;
  return v_roles;
end;
$$;

create or replace function public.admin_remove_role(p_user_id uuid, p_role_code text)
returns text[]
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role_id uuid;
  v_role_code text := upper(trim(coalesce(p_role_code, '')));
  v_target_is_active_admin boolean;
  v_active_admin_count bigint;
  v_roles text[];
begin
  perform public.assert_active_admin();
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0002';
  end if;
  select id into v_role_id from public.roles where code = v_role_code and active;
  if not found then raise exception 'ROLE_NOT_FOUND' using errcode = '22023'; end if;

  if v_role_code = 'ADMIN' then
    perform pg_advisory_xact_lock(hashtextextended('public.active-admin-guard', 0));
    select exists (
      select 1 from public.profiles as profiles
      join public.user_roles as assignments on assignments.user_id = profiles.id
      join public.roles as roles on roles.id = assignments.role_id
      where profiles.id = p_user_id and profiles.status = 'ACTIVE' and roles.code = 'ADMIN' and roles.active
    ) into v_target_is_active_admin;
    select count(*) into v_active_admin_count
    from public.profiles as profiles
    join public.user_roles as assignments on assignments.user_id = profiles.id
    join public.roles as roles on roles.id = assignments.role_id
    where profiles.status = 'ACTIVE' and roles.code = 'ADMIN' and roles.active;
    if v_target_is_active_admin and v_active_admin_count <= 1 then
      raise exception 'LAST_ACTIVE_ADMIN_REQUIRED: At least one active Admin must remain.' using errcode = 'P0001';
    end if;
  end if;

  delete from public.user_roles where user_id = p_user_id and role_id = v_role_id;
  select coalesce(array_agg(distinct roles.code order by roles.code) filter (where roles.active), array[]::text[])
  into v_roles
  from public.user_roles as assignments join public.roles as roles on roles.id = assignments.role_id
  where assignments.user_id = p_user_id;
  return v_roles;
end;
$$;

create or replace function public.admin_set_user_status(p_user_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text := upper(trim(coalesce(p_status, '')));
  v_target_is_active_admin boolean;
  v_active_admin_count bigint;
  v_profile public.profiles%rowtype;
begin
  perform public.assert_active_admin();
  if v_status not in ('ACTIVE', 'INACTIVE') then
    raise exception 'VALIDATION_ERROR: Invalid status.' using errcode = '22023';
  end if;
  select * into v_profile from public.profiles where id = p_user_id;
  if not found then raise exception 'USER_NOT_FOUND' using errcode = 'P0002'; end if;

  if v_profile.status = 'ACTIVE' and v_status = 'INACTIVE' then
    perform pg_advisory_xact_lock(hashtextextended('public.active-admin-guard', 0));
    select exists (
      select 1 from public.user_roles as assignments
      join public.roles as roles on roles.id = assignments.role_id
      where assignments.user_id = p_user_id and roles.code = 'ADMIN' and roles.active
    ) into v_target_is_active_admin;
    select count(*) into v_active_admin_count
    from public.profiles as profiles
    join public.user_roles as assignments on assignments.user_id = profiles.id
    join public.roles as roles on roles.id = assignments.role_id
    where profiles.status = 'ACTIVE' and roles.code = 'ADMIN' and roles.active;
    if v_target_is_active_admin and v_active_admin_count <= 1 then
      raise exception 'LAST_ACTIVE_ADMIN_REQUIRED: At least one active Admin must remain.' using errcode = 'P0001';
    end if;
  end if;

  update public.profiles set status = v_status where id = p_user_id returning * into v_profile;
  return jsonb_build_object(
    'id', v_profile.id,
    'email', v_profile.email,
    'fullName', v_profile.full_name,
    'status', v_profile.status,
    'createdAt', v_profile.created_at,
    'updatedAt', v_profile.updated_at
  );
end;
$$;

create or replace function public.update_my_profile(p_full_name text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_full_name text := trim(coalesce(p_full_name, ''));
  v_profile public.profiles%rowtype;
begin
  if not public.is_active_user(v_user_id) then
    raise exception 'ACCOUNT_INACTIVE' using errcode = '42501';
  end if;
  if char_length(v_full_name) > 200 then
    raise exception 'VALIDATION_ERROR: Full name must be at most 200 characters.' using errcode = '22023';
  end if;
  update public.profiles set full_name = v_full_name where id = v_user_id returning * into v_profile;
  update public.user_profiles set display_name = v_full_name where id = v_user_id;
  return jsonb_build_object(
    'id', v_profile.id,
    'email', v_profile.email,
    'fullName', v_profile.full_name,
    'status', v_profile.status,
    'createdAt', v_profile.created_at,
    'updatedAt', v_profile.updated_at
  );
end;
$$;

comment on table public.profiles is 'Authoritative application identity and activation state for each Supabase Auth user.';
comment on table public.roles is 'Fixed v0.5 system-role catalog; browser clients cannot mutate it.';
comment on table public.user_roles is 'Many-to-many system-role assignments changed only through Admin RPCs.';
comment on function public.assert_active_admin() is 'Internal security-definer guard used by Admin RPCs; not browser executable.';

alter table public.profiles enable row level security;
alter table public.roles enable row level security;
alter table public.user_roles enable row level security;

drop policy if exists "users read own access profile" on public.profiles;
drop policy if exists "admins read all access profiles" on public.profiles;
create policy "users read own access profile" on public.profiles
for select to authenticated using ((select auth.uid()) = id);
create policy "admins read all access profiles" on public.profiles
for select to authenticated using (public.has_role('ADMIN'));

drop policy if exists "active users read system roles" on public.roles;
create policy "active users read system roles" on public.roles
for select to authenticated using (active = true and public.is_active_user());

drop policy if exists "users read own role assignments" on public.user_roles;
drop policy if exists "admins read all role assignments" on public.user_roles;
create policy "users read own role assignments" on public.user_roles
for select to authenticated using ((select auth.uid()) = user_id);
create policy "admins read all role assignments" on public.user_roles
for select to authenticated using (public.has_role('ADMIN'));

-- Preserve the legacy capture-attribution relation while letting an Admin resolve all capturers.
drop policy if exists "active admins read all legacy profiles" on public.user_profiles;
create policy "active admins read all legacy profiles" on public.user_profiles
for select to authenticated using (public.has_role('ADMIN'));

drop policy if exists "authenticated read active categories" on public.categories;
create policy "active users read active categories" on public.categories
for select to authenticated using (active = true and public.is_active_user());

drop policy if exists "authenticated read active industry domains" on public.industry_domain_categories;
create policy "active users read active industry domains" on public.industry_domain_categories
for select to authenticated using (active = true and public.is_active_user());

drop policy if exists "owners read jobs" on public.job_descriptions;
drop policy if exists "owners insert jobs" on public.job_descriptions;
drop policy if exists "owners update jobs" on public.job_descriptions;
drop policy if exists "owners delete jobs" on public.job_descriptions;
create policy "business roles read shared jobs" on public.job_descriptions
for select to authenticated using (public.has_any_role(array['APPLIER','APPLYING_MANAGER','ADMIN']));
create policy "managers and admins insert jobs" on public.job_descriptions
for insert to authenticated with check (
  public.has_role('ADMIN') or (public.has_role('APPLYING_MANAGER') and (select auth.uid()) = user_id)
);
create policy "managers own or admins update jobs" on public.job_descriptions
for update to authenticated using (
  public.has_role('ADMIN') or (public.has_role('APPLYING_MANAGER') and (select auth.uid()) = user_id)
) with check (
  public.has_role('ADMIN') or (public.has_role('APPLYING_MANAGER') and (select auth.uid()) = user_id)
);
create policy "managers own or admins delete jobs" on public.job_descriptions
for delete to authenticated using (
  public.has_role('ADMIN') or (public.has_role('APPLYING_MANAGER') and (select auth.uid()) = user_id)
);

drop policy if exists "owners read resumes" on public.resumes;
drop policy if exists "owners insert resumes" on public.resumes;
drop policy if exists "owners update resumes" on public.resumes;
drop policy if exists "owners delete resumes" on public.resumes;
create policy "business roles read shared resumes" on public.resumes
for select to authenticated using (public.has_any_role(array['APPLIER','APPLYING_MANAGER','ADMIN']));
create policy "managers and admins insert resumes" on public.resumes
for insert to authenticated with check (
  public.has_role('ADMIN') or (public.has_role('APPLYING_MANAGER') and (select auth.uid()) = user_id)
);
create policy "managers own or admins update resumes" on public.resumes
for update to authenticated using (
  public.has_role('ADMIN') or (public.has_role('APPLYING_MANAGER') and (select auth.uid()) = user_id)
) with check (
  public.has_role('ADMIN') or (public.has_role('APPLYING_MANAGER') and (select auth.uid()) = user_id)
);
create policy "managers own or admins delete resumes" on public.resumes
for delete to authenticated using (
  public.has_role('ADMIN') or (public.has_role('APPLYING_MANAGER') and (select auth.uid()) = user_id)
);

drop policy if exists "owners read queue" on public.tailoring_jobs;
drop policy if exists "owners insert queue" on public.tailoring_jobs;
drop policy if exists "owners update queue" on public.tailoring_jobs;
drop policy if exists "owners delete queue" on public.tailoring_jobs;
create policy "business roles read shared queue" on public.tailoring_jobs
for select to authenticated using (public.has_any_role(array['APPLIER','APPLYING_MANAGER','ADMIN']));
create policy "managers and admins insert queue" on public.tailoring_jobs
for insert to authenticated with check (
  public.has_role('ADMIN') or (public.has_role('APPLYING_MANAGER') and (select auth.uid()) = user_id)
);
create policy "managers own or admins update queue" on public.tailoring_jobs
for update to authenticated using (
  public.has_role('ADMIN') or (public.has_role('APPLYING_MANAGER') and (select auth.uid()) = user_id)
) with check (
  public.has_role('ADMIN') or (public.has_role('APPLYING_MANAGER') and (select auth.uid()) = user_id)
);
create policy "managers own or admins delete queue" on public.tailoring_jobs
for delete to authenticated using (
  public.has_role('ADMIN') or (public.has_role('APPLYING_MANAGER') and (select auth.uid()) = user_id)
);

drop policy if exists "owners select resume objects" on storage.objects;
drop policy if exists "owners insert resume objects" on storage.objects;
drop policy if exists "owners update resume objects" on storage.objects;
drop policy if exists "owners delete resume objects" on storage.objects;

create policy "business roles read original resumes" on storage.objects
for select to authenticated using (
  bucket_id = 'original-resumes'
  and public.has_any_role(array['APPLIER','APPLYING_MANAGER','ADMIN'])
);
create policy "managers own or admins insert original resumes" on storage.objects
for insert to authenticated with check (
  bucket_id = 'original-resumes'
  and (public.has_role('ADMIN') or (public.has_role('APPLYING_MANAGER') and (storage.foldername(name))[1] = (select auth.uid()::text)))
);
create policy "managers own or admins update original resumes" on storage.objects
for update to authenticated using (
  bucket_id = 'original-resumes'
  and (public.has_role('ADMIN') or (public.has_role('APPLYING_MANAGER') and (storage.foldername(name))[1] = (select auth.uid()::text)))
) with check (
  bucket_id = 'original-resumes'
  and (public.has_role('ADMIN') or (public.has_role('APPLYING_MANAGER') and (storage.foldername(name))[1] = (select auth.uid()::text)))
);
create policy "managers own or admins delete original resumes" on storage.objects
for delete to authenticated using (
  bucket_id = 'original-resumes'
  and (public.has_role('ADMIN') or (public.has_role('APPLYING_MANAGER') and (storage.foldername(name))[1] = (select auth.uid()::text)))
);

create policy "managers own or admins read tailored resumes" on storage.objects
for select to authenticated using (
  bucket_id = 'tailored-resumes'
  and (public.has_role('ADMIN') or (public.has_role('APPLYING_MANAGER') and (storage.foldername(name))[1] = (select auth.uid()::text)))
);
create policy "managers own or admins insert tailored resumes" on storage.objects
for insert to authenticated with check (
  bucket_id = 'tailored-resumes'
  and (public.has_role('ADMIN') or (public.has_role('APPLYING_MANAGER') and (storage.foldername(name))[1] = (select auth.uid()::text)))
);
create policy "managers own or admins update tailored resumes" on storage.objects
for update to authenticated using (
  bucket_id = 'tailored-resumes'
  and (public.has_role('ADMIN') or (public.has_role('APPLYING_MANAGER') and (storage.foldername(name))[1] = (select auth.uid()::text)))
) with check (
  bucket_id = 'tailored-resumes'
  and (public.has_role('ADMIN') or (public.has_role('APPLYING_MANAGER') and (storage.foldername(name))[1] = (select auth.uid()::text)))
);
create policy "managers own or admins delete tailored resumes" on storage.objects
for delete to authenticated using (
  bucket_id = 'tailored-resumes'
  and (public.has_role('ADMIN') or (public.has_role('APPLYING_MANAGER') and (storage.foldername(name))[1] = (select auth.uid()::text)))
);

revoke all on public.profiles, public.roles, public.user_roles from anon;
revoke insert, update, delete on public.profiles, public.roles, public.user_roles from authenticated;
grant select on public.profiles, public.roles, public.user_roles to authenticated;

revoke all on function public.is_active_user(uuid) from public, anon;
revoke all on function public.has_role(text, uuid) from public, anon;
revoke all on function public.has_any_role(text[], uuid) from public, anon;
revoke all on function public.get_my_access_context() from public, anon;
revoke all on function public.assert_active_admin() from public, anon, authenticated;
revoke all on function public.admin_list_users(text, text, text, integer, integer) from public, anon;
revoke all on function public.admin_get_user(uuid) from public, anon;
revoke all on function public.admin_assign_role(uuid, text) from public, anon;
revoke all on function public.admin_remove_role(uuid, text) from public, anon;
revoke all on function public.admin_set_user_status(uuid, text) from public, anon;
revoke all on function public.update_my_profile(text) from public, anon;

grant execute on function public.is_active_user(uuid) to authenticated;
grant execute on function public.has_role(text, uuid) to authenticated;
grant execute on function public.has_any_role(text[], uuid) to authenticated;
grant execute on function public.get_my_access_context() to authenticated;
grant execute on function public.admin_list_users(text, text, text, integer, integer) to authenticated;
grant execute on function public.admin_get_user(uuid) to authenticated;
grant execute on function public.admin_assign_role(uuid, text) to authenticated;
grant execute on function public.admin_remove_role(uuid, text) to authenticated;
grant execute on function public.admin_set_user_status(uuid, text) to authenticated;
grant execute on function public.update_my_profile(text) to authenticated;

update storage.buckets set public = false where id in ('original-resumes', 'tailored-resumes');
