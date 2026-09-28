-- Why a company is on the global ban list. Existing rows may omit it until edited.

alter table public.global_banned_companies
  add column if not exists description text;

alter table public.global_banned_companies
  drop constraint if exists global_banned_companies_description_length;

alter table public.global_banned_companies
  add constraint global_banned_companies_description_length
  check (description is null or char_length(description) between 1 and 500);

comment on column public.global_banned_companies.description is
  'Why this company is banned for every resume.';

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
    'description', b.description,
    'createdBy', b.created_by,
    'createdAt', b.created_at
  ) order by b.company_name, b.created_at), '[]'::jsonb)
  into v_result
  from public.global_banned_companies b;
  return v_result;
end;
$$;

create or replace function public.add_global_banned_company_v3130(p_company_name text, p_description text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text := btrim(regexp_replace(coalesce(p_company_name, ''), '\s+', ' ', 'g'));
  v_description text := btrim(regexp_replace(coalesce(p_description, ''), '\s+', ' ', 'g'));
  v_normalized text;
  v_row public.global_banned_companies;
begin
  if not public.application_actor_can_manage() then
    raise exception 'FORBIDDEN: Only Applying Managers and Admins can manage global banned companies.' using errcode = '42501';
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 200 then
    raise exception 'VALIDATION_ERROR: Enter a company name between 1 and 200 characters.' using errcode = '22023';
  end if;
  if char_length(v_description) < 1 or char_length(v_description) > 500 then
    raise exception 'VALIDATION_ERROR: Enter why this company is banned, using 1 to 500 characters.' using errcode = '22023';
  end if;
  v_normalized := public.normalize_company_name(v_name);
  if v_normalized = '' then
    raise exception 'VALIDATION_ERROR: Enter a company name between 1 and 200 characters.' using errcode = '22023';
  end if;
  insert into public.global_banned_companies(company_name, normalized_company, description, created_by)
  values (v_name, v_normalized, v_description, auth.uid())
  on conflict (normalized_company) do nothing
  returning * into v_row;
  if v_row.id is null then
    raise exception 'BANNED_COMPANY_DUPLICATE: That company is already on the global ban list.' using errcode = '23505';
  end if;
  return jsonb_build_object(
    'id', v_row.id,
    'companyName', v_row.company_name,
    'normalizedCompany', v_row.normalized_company,
    'description', v_row.description,
    'createdBy', v_row.created_by,
    'createdAt', v_row.created_at
  );
end;
$$;

create or replace function public.update_global_banned_company_v3130(p_id uuid, p_description text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_description text := btrim(regexp_replace(coalesce(p_description, ''), '\s+', ' ', 'g'));
  v_row public.global_banned_companies;
begin
  if not public.application_actor_can_manage() then
    raise exception 'FORBIDDEN: Only Applying Managers and Admins can manage global banned companies.' using errcode = '42501';
  end if;
  if char_length(v_description) < 1 or char_length(v_description) > 500 then
    raise exception 'VALIDATION_ERROR: Enter why this company is banned, using 1 to 500 characters.' using errcode = '22023';
  end if;
  update public.global_banned_companies
  set description = v_description
  where id = p_id
  returning * into v_row;
  if not found then
    raise exception 'BANNED_COMPANY_NOT_FOUND: The banned company entry was not found.' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'id', v_row.id,
    'companyName', v_row.company_name,
    'normalizedCompany', v_row.normalized_company,
    'description', v_row.description,
    'createdBy', v_row.created_by,
    'createdAt', v_row.created_at
  );
end;
$$;

revoke all on function public.add_global_banned_company_v3130(text, text) from public, anon;
revoke all on function public.update_global_banned_company_v3130(uuid, text) from public, anon;
grant execute on function public.add_global_banned_company_v3130(text, text) to authenticated;
grant execute on function public.update_global_banned_company_v3130(uuid, text) to authenticated;
