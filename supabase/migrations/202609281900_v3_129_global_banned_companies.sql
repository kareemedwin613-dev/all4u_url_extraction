-- Global banned companies, separate from per-resume bans.
-- JD Finders, Applying Managers, and Admins can read the list.
-- Applying Managers and Admins maintain it. New Job Descriptions cannot use a banned company.

create table if not exists public.global_banned_companies (
  id uuid primary key default gen_random_uuid(),
  company_name text not null check (char_length(company_name) between 1 and 200),
  normalized_company text not null check (char_length(normalized_company) between 1 and 200),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  constraint global_banned_companies_normalized_unique unique (normalized_company)
);

create index if not exists global_banned_companies_normalized_idx
  on public.global_banned_companies(normalized_company);

alter table public.global_banned_companies enable row level security;

revoke all on table public.global_banned_companies from public, anon, authenticated;

comment on table public.global_banned_companies is
  'Catalog-wide companies JD Finders must skip. Distinct from per-resume banned companies.';

create or replace function public.global_banned_company_reader()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_active_user(auth.uid())
    and public.has_any_role(array['JD_FINDER', 'APPLYING_MANAGER', 'ADMIN']);
$$;

revoke all on function public.global_banned_company_reader() from public, anon;
grant execute on function public.global_banned_company_reader() to authenticated;

create or replace function public.list_global_banned_companies_v3129()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if not public.global_banned_company_reader() then
    raise exception 'FORBIDDEN: You cannot view the global banned company list.' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id,
    'companyName', b.company_name,
    'normalizedCompany', b.normalized_company,
    'createdBy', b.created_by,
    'createdAt', b.created_at
  ) order by b.company_name, b.created_at), '[]'::jsonb)
  into v_result
  from public.global_banned_companies b;
  return v_result;
end;
$$;

create or replace function public.add_global_banned_company_v3129(p_company_name text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text := btrim(regexp_replace(coalesce(p_company_name, ''), '\s+', ' ', 'g'));
  v_normalized text;
  v_row public.global_banned_companies;
begin
  if not public.application_actor_can_manage() then
    raise exception 'FORBIDDEN: Only Applying Managers and Admins can manage global banned companies.' using errcode = '42501';
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 200 then
    raise exception 'VALIDATION_ERROR: Enter a company name between 1 and 200 characters.' using errcode = '22023';
  end if;
  v_normalized := public.normalize_company_name(v_name);
  if v_normalized = '' then
    raise exception 'VALIDATION_ERROR: Enter a company name between 1 and 200 characters.' using errcode = '22023';
  end if;
  insert into public.global_banned_companies(company_name, normalized_company, created_by)
  values (v_name, v_normalized, auth.uid())
  on conflict (normalized_company) do nothing
  returning * into v_row;
  if v_row.id is null then
    raise exception 'BANNED_COMPANY_DUPLICATE: That company is already on the global ban list.' using errcode = '23505';
  end if;
  return jsonb_build_object(
    'id', v_row.id,
    'companyName', v_row.company_name,
    'normalizedCompany', v_row.normalized_company,
    'createdBy', v_row.created_by,
    'createdAt', v_row.created_at
  );
end;
$$;

create or replace function public.remove_global_banned_company_v3129(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.global_banned_companies;
begin
  if not public.application_actor_can_manage() then
    raise exception 'FORBIDDEN: Only Applying Managers and Admins can manage global banned companies.' using errcode = '42501';
  end if;
  delete from public.global_banned_companies
  where id = p_id
  returning * into v_row;
  if not found then
    raise exception 'BANNED_COMPANY_NOT_FOUND: The banned company entry was not found.' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'id', v_row.id,
    'companyName', v_row.company_name,
    'normalizedCompany', v_row.normalized_company
  );
end;
$$;

revoke all on function public.list_global_banned_companies_v3129() from public, anon;
revoke all on function public.add_global_banned_company_v3129(text) from public, anon;
revoke all on function public.remove_global_banned_company_v3129(uuid) from public, anon;
grant execute on function public.list_global_banned_companies_v3129() to authenticated;
grant execute on function public.add_global_banned_company_v3129(text) to authenticated;
grant execute on function public.remove_global_banned_company_v3129(uuid) to authenticated;

create or replace function public.reject_globally_banned_job_company()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text;
begin
  select b.company_name into v_name
  from public.global_banned_companies b
  where b.normalized_company = public.normalize_company_name(new.company)
  limit 1;
  if found then
    raise exception 'GLOBAL_BANNED_COMPANY: % is on the global banned company list. Skip this job.', v_name
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists job_descriptions_reject_global_banned_company on public.job_descriptions;
create trigger job_descriptions_reject_global_banned_company
before insert or update of company on public.job_descriptions
for each row execute function public.reject_globally_banned_job_company();
