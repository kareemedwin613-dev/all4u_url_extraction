create table public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.user_profiles is 'Application-visible identity metadata linked one-to-one with Supabase Auth. Credentials remain in auth.users.';
comment on column public.job_descriptions.user_id is 'Supabase Auth user who found and saved this job description.';
comment on column public.job_descriptions.created_at is 'Server timestamp when this job description was first saved.';

insert into public.user_profiles (id, email, display_name, created_at, updated_at)
select id, coalesce(email, ''), coalesce(raw_user_meta_data ->> 'display_name', ''), created_at, now()
from auth.users
on conflict (id) do update
set email = excluded.email,
    display_name = excluded.display_name,
    updated_at = now();

create or replace function public.sync_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_profiles (id, email, display_name, created_at, updated_at)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'display_name', ''),
    coalesce(new.created_at, now()),
    now()
  )
  on conflict (id) do update
  set email = excluded.email,
      display_name = case
        when excluded.display_name <> '' then excluded.display_name
        else public.user_profiles.display_name
      end,
      updated_at = now();
  return new;
end;
$$;

create trigger sync_auth_user_profile_after_insert_or_update
after insert or update of email, raw_user_meta_data on auth.users
for each row execute function public.sync_auth_user_profile();

alter table public.job_descriptions
  add constraint job_descriptions_user_profile_fkey
  foreign key (user_id) references public.user_profiles(id) on delete cascade;

alter table public.user_profiles enable row level security;

create policy "users read own profile"
on public.user_profiles for select to authenticated
using ((select auth.uid()) = id);

create policy "users update own profile"
on public.user_profiles for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

revoke all on public.user_profiles from anon;
grant select on public.user_profiles to authenticated;
grant update (display_name) on public.user_profiles to authenticated;

create trigger user_profiles_updated
before update on public.user_profiles
for each row execute function public.set_updated_at();
