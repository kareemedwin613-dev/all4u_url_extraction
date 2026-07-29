-- v0.8.8: Resume-scoped, reviewable Candidate Profiles for future autofill.
-- A profile is intentionally one-to-one with a Resume. This milestone does not
-- introduce a separate person/candidate identity table.

create table public.candidate_profiles (
  id uuid primary key default gen_random_uuid(),
  resume_id uuid not null unique references public.resumes(id) on delete cascade,
  full_name text not null check (char_length(btrim(full_name)) between 1 and 200),
  first_name text check (first_name is null or char_length(first_name) <= 100),
  middle_name text check (middle_name is null or char_length(middle_name) <= 100),
  last_name text check (last_name is null or char_length(last_name) <= 100),
  email text check (email is null or char_length(email) <= 320),
  phone text check (phone is null or char_length(phone) <= 60),
  review_status text not null default 'NEEDS_REVIEW' check (review_status in ('NEEDS_REVIEW','VERIFIED')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint candidate_profiles_review_check check (
    (review_status = 'NEEDS_REVIEW' and reviewed_by is null and reviewed_at is null)
    or (review_status = 'VERIFIED' and reviewed_by is not null and reviewed_at is not null)
  )
);

create table public.candidate_addresses (
  id uuid primary key default gen_random_uuid(),
  candidate_profile_id uuid not null references public.candidate_profiles(id) on delete cascade,
  address_type text not null default 'PRIMARY' check (address_type in ('PRIMARY','MAILING','OTHER')),
  address_line_1 text check (address_line_1 is null or char_length(address_line_1) <= 200),
  address_line_2 text check (address_line_2 is null or char_length(address_line_2) <= 200),
  city text check (city is null or char_length(city) <= 120),
  state_region text check (state_region is null or char_length(state_region) <= 120),
  postal_code text check (postal_code is null or char_length(postal_code) <= 40),
  country text check (country is null or char_length(country) <= 120),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.candidate_employment_history (
  id uuid primary key default gen_random_uuid(),
  candidate_profile_id uuid not null references public.candidate_profiles(id) on delete cascade,
  company text not null check (char_length(btrim(company)) between 1 and 200),
  job_title text not null check (char_length(btrim(job_title)) between 1 and 200),
  location text check (location is null or char_length(location) <= 200),
  start_date date,
  end_date date,
  is_current boolean not null default false,
  experience_details text check (experience_details is null or char_length(experience_details) <= 30000),
  display_order integer not null default 0 check (display_order between 0 and 1000),
  source text not null default 'MANUAL' check (source in ('MANUAL','RESUME_IMPORTED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint candidate_employment_dates_check check (
    (is_current and end_date is null) or (not is_current and (end_date is null or start_date is null or end_date >= start_date))
  )
);

create table public.candidate_education (
  id uuid primary key default gen_random_uuid(),
  candidate_profile_id uuid not null references public.candidate_profiles(id) on delete cascade,
  institution text not null check (char_length(btrim(institution)) between 1 and 240),
  degree text check (degree is null or char_length(degree) <= 200),
  field_of_study text check (field_of_study is null or char_length(field_of_study) <= 200),
  location text check (location is null or char_length(location) <= 200),
  start_date date,
  end_date date,
  gpa text check (gpa is null or char_length(gpa) <= 40),
  details text check (details is null or char_length(details) <= 10000),
  display_order integer not null default 0 check (display_order between 0 and 1000),
  source text not null default 'MANUAL' check (source in ('MANUAL','RESUME_IMPORTED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint candidate_education_dates_check check (end_date is null or start_date is null or end_date >= start_date)
);

create table public.candidate_certifications (
  id uuid primary key default gen_random_uuid(),
  candidate_profile_id uuid not null references public.candidate_profiles(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 240),
  issuer text check (issuer is null or char_length(issuer) <= 200),
  issued_date date,
  expiration_date date,
  credential_id text check (credential_id is null or char_length(credential_id) <= 200),
  credential_url text check (credential_url is null or char_length(credential_url) <= 2000),
  source text not null default 'MANUAL' check (source in ('MANUAL','RESUME_IMPORTED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint candidate_certification_dates_check check (expiration_date is null or issued_date is null or expiration_date >= issued_date)
);

create table public.candidate_links (
  id uuid primary key default gen_random_uuid(),
  candidate_profile_id uuid not null references public.candidate_profiles(id) on delete cascade,
  link_type text not null check (link_type in ('LINKEDIN','GITHUB','PORTFOLIO','OTHER')),
  label text check (label is null or char_length(label) <= 120),
  url text not null check (url ~* '^https://[^[:space:]]+$' and char_length(url) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (candidate_profile_id, link_type, url)
);

create unique index candidate_addresses_one_primary_idx on public.candidate_addresses(candidate_profile_id) where is_primary;
create index candidate_employment_profile_order_idx on public.candidate_employment_history(candidate_profile_id, display_order, start_date desc);
create index candidate_education_profile_order_idx on public.candidate_education(candidate_profile_id, display_order, end_date desc);
create index candidate_certifications_profile_idx on public.candidate_certifications(candidate_profile_id, issued_date desc);
create index candidate_links_profile_idx on public.candidate_links(candidate_profile_id, link_type);

create trigger candidate_profiles_updated before update on public.candidate_profiles for each row execute function public.set_updated_at();
create trigger candidate_addresses_updated before update on public.candidate_addresses for each row execute function public.set_updated_at();
create trigger candidate_employment_history_updated before update on public.candidate_employment_history for each row execute function public.set_updated_at();
create trigger candidate_education_updated before update on public.candidate_education for each row execute function public.set_updated_at();
create trigger candidate_certifications_updated before update on public.candidate_certifications for each row execute function public.set_updated_at();
create trigger candidate_links_updated before update on public.candidate_links for each row execute function public.set_updated_at();

-- Existing Resume text is useful seed data, but is explicitly not verified truth.
insert into public.candidate_profiles(resume_id, full_name, email, phone, review_status, created_by)
select r.id, r.candidate_name, nullif(btrim(r.candidate_email),''), nullif(btrim(r.candidate_phone),''), 'NEEDS_REVIEW', r.user_id
from public.resumes r
on conflict (resume_id) do nothing;

create or replace function public.candidate_partial_date_v088(p_value jsonb)
returns date language plpgsql immutable security invoker set search_path='' as $$
declare v_year integer; v_month integer;
begin
  if p_value is null or jsonb_typeof(p_value)<>'object' or coalesce(p_value->>'year','')!~ '^[0-9]{4}$' then return null; end if;
  v_year:=(p_value->>'year')::integer;
  v_month:=case when coalesce(p_value->>'month','')~ '^[0-9]{1,2}$' then (p_value->>'month')::integer else 1 end;
  if v_year not between 1900 and 2100 or v_month not between 1 and 12 then return null; end if;
  return make_date(v_year,v_month,1);
exception when others then return null;
end;
$$;

-- Preserve already structured experience as editable imported data. The parent
-- profile remains NEEDS_REVIEW, so imported history cannot enable autofill.
insert into public.candidate_employment_history(candidate_profile_id,company,job_title,location,start_date,end_date,is_current,experience_details,display_order,source)
select cp.id,btrim(item.value->>'company'),btrim(item.value->>'job_title'),nullif(btrim(item.value->>'location'),''),public.candidate_partial_date_v088(item.value->'start_date'),case when lower(coalesce(item.value->>'is_current','false')) in ('true','t','1','yes') then null else public.candidate_partial_date_v088(item.value->'end_date') end,lower(coalesce(item.value->>'is_current','false')) in ('true','t','1','yes'),nullif(btrim(item.value->>'experience_details'),''),(item.ordinality-1)::integer,'RESUME_IMPORTED'
from public.resumes r join public.candidate_profiles cp on cp.resume_id=r.id
cross join lateral jsonb_array_elements(case when jsonb_typeof(r.structured_content->'professional_experience')='array' then r.structured_content->'professional_experience' else '[]'::jsonb end) with ordinality as item(value,ordinality)
where btrim(coalesce(item.value->>'company',''))<>'' and btrim(coalesce(item.value->>'job_title',''))<>'';

create or replace function public.ensure_candidate_profile_for_resume_v088()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_profile_id uuid; v_item record;
begin
  insert into public.candidate_profiles(resume_id,full_name,email,phone,review_status,created_by)
  values(new.id,new.candidate_name,nullif(btrim(new.candidate_email),''),nullif(btrim(new.candidate_phone),''),'NEEDS_REVIEW',new.user_id)
  on conflict (resume_id) do update set resume_id=excluded.resume_id returning id into v_profile_id;
  for v_item in select value,ordinality from jsonb_array_elements(case when jsonb_typeof(new.structured_content->'professional_experience')='array' then new.structured_content->'professional_experience' else '[]'::jsonb end) with ordinality loop
    if btrim(coalesce(v_item.value->>'company',''))<>'' and btrim(coalesce(v_item.value->>'job_title',''))<>'' then
      insert into public.candidate_employment_history(candidate_profile_id,company,job_title,location,start_date,end_date,is_current,experience_details,display_order,source)
      values(v_profile_id,btrim(v_item.value->>'company'),btrim(v_item.value->>'job_title'),nullif(btrim(v_item.value->>'location'),''),public.candidate_partial_date_v088(v_item.value->'start_date'),case when lower(coalesce(v_item.value->>'is_current','false')) in ('true','t','1','yes') then null else public.candidate_partial_date_v088(v_item.value->'end_date') end,lower(coalesce(v_item.value->>'is_current','false')) in ('true','t','1','yes'),nullif(btrim(v_item.value->>'experience_details'),''),(v_item.ordinality-1)::integer,'RESUME_IMPORTED');
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.candidate_partial_date_v088(jsonb) from public, anon, authenticated;
revoke all on function public.ensure_candidate_profile_for_resume_v088() from public, anon, authenticated;
create trigger resumes_create_candidate_profile_v088 after insert on public.resumes for each row execute function public.ensure_candidate_profile_for_resume_v088();

create or replace function public.candidate_profile_actor_can_view(p_profile_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.application_actor_can_manage()
    or exists (
      select 1
      from public.candidate_profiles cp
      join public.applications a on a.resume_id = cp.resume_id
      where cp.id = p_profile_id
        and a.assigned_to = auth.uid()
        and public.is_active_user(auth.uid())
        and public.has_role('APPLIER', auth.uid())
    );
$$;

alter table public.candidate_profiles enable row level security;
alter table public.candidate_addresses enable row level security;
alter table public.candidate_employment_history enable row level security;
alter table public.candidate_education enable row level security;
alter table public.candidate_certifications enable row level security;
alter table public.candidate_links enable row level security;

create policy "authorized users read Resume candidate profiles" on public.candidate_profiles for select to authenticated using (public.candidate_profile_actor_can_view(id));
create policy "authorized users read candidate addresses" on public.candidate_addresses for select to authenticated using (public.candidate_profile_actor_can_view(candidate_profile_id));
create policy "authorized users read candidate employment" on public.candidate_employment_history for select to authenticated using (public.candidate_profile_actor_can_view(candidate_profile_id));
create policy "authorized users read candidate education" on public.candidate_education for select to authenticated using (public.candidate_profile_actor_can_view(candidate_profile_id));
create policy "authorized users read candidate certifications" on public.candidate_certifications for select to authenticated using (public.candidate_profile_actor_can_view(candidate_profile_id));
create policy "authorized users read candidate links" on public.candidate_links for select to authenticated using (public.candidate_profile_actor_can_view(candidate_profile_id));

revoke all on public.candidate_profiles, public.candidate_addresses, public.candidate_employment_history, public.candidate_education, public.candidate_certifications, public.candidate_links from public, anon;
revoke insert, update, delete on public.candidate_profiles, public.candidate_addresses, public.candidate_employment_history, public.candidate_education, public.candidate_certifications, public.candidate_links from authenticated;
grant select on public.candidate_profiles, public.candidate_addresses, public.candidate_employment_history, public.candidate_education, public.candidate_certifications, public.candidate_links to authenticated;

create or replace function public.get_candidate_autofill_profile_v088(p_profile_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_result jsonb;
begin
  if not public.candidate_profile_actor_can_view(p_profile_id) then
    raise exception 'CANDIDATE_PROFILE_NOT_FOUND: The Candidate Profile was not found or is not accessible.' using errcode='P0001';
  end if;
  select jsonb_build_object(
    'id',cp.id,'resumeId',cp.resume_id,'fullName',cp.full_name,'firstName',cp.first_name,'middleName',cp.middle_name,'lastName',cp.last_name,
    'email',cp.email,'phone',cp.phone,'reviewStatus',cp.review_status,'reviewedBy',cp.reviewed_by,'reviewedAt',cp.reviewed_at,
    'createdAt',cp.created_at,'updatedAt',cp.updated_at,
    'addresses',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'addressType',x.address_type,'addressLine1',x.address_line_1,'addressLine2',x.address_line_2,'city',x.city,'stateRegion',x.state_region,'postalCode',x.postal_code,'country',x.country,'isPrimary',x.is_primary) order by x.is_primary desc,x.created_at) from public.candidate_addresses x where x.candidate_profile_id=cp.id),'[]'::jsonb),
    'employment',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'company',x.company,'jobTitle',x.job_title,'location',x.location,'startDate',x.start_date,'endDate',x.end_date,'isCurrent',x.is_current,'experienceDetails',x.experience_details,'displayOrder',x.display_order,'source',x.source) order by x.display_order,x.start_date desc nulls last) from public.candidate_employment_history x where x.candidate_profile_id=cp.id),'[]'::jsonb),
    'education',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'institution',x.institution,'degree',x.degree,'fieldOfStudy',x.field_of_study,'location',x.location,'startDate',x.start_date,'endDate',x.end_date,'gpa',x.gpa,'details',x.details,'displayOrder',x.display_order,'source',x.source) order by x.display_order,x.end_date desc nulls last) from public.candidate_education x where x.candidate_profile_id=cp.id),'[]'::jsonb),
    'certifications',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,'issuer',x.issuer,'issuedDate',x.issued_date,'expirationDate',x.expiration_date,'credentialId',x.credential_id,'credentialUrl',x.credential_url,'source',x.source) order by x.issued_date desc nulls last) from public.candidate_certifications x where x.candidate_profile_id=cp.id),'[]'::jsonb),
    'links',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'linkType',x.link_type,'label',x.label,'url',x.url) order by x.link_type,x.created_at) from public.candidate_links x where x.candidate_profile_id=cp.id),'[]'::jsonb)
  ) into v_result from public.candidate_profiles cp where cp.id=p_profile_id;
  if v_result is null then raise exception 'CANDIDATE_PROFILE_NOT_FOUND: The Candidate Profile was not found.' using errcode='P0001'; end if;
  return v_result;
end;
$$;

create or replace function public.update_candidate_profile_v088(p_profile_id uuid,p_full_name text,p_first_name text default null,p_middle_name text default null,p_last_name text default null,p_email text default null,p_phone text default null,p_review_status text default 'NEEDS_REVIEW',p_primary_address jsonb default null,p_links jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_status text:=upper(btrim(coalesce(p_review_status,'')));
begin
  perform public.assert_application_manager();
  if char_length(btrim(coalesce(p_full_name,''))) not between 1 and 200 or v_status not in ('NEEDS_REVIEW','VERIFIED') then raise exception 'CANDIDATE_PROFILE_INVALID: Review the Candidate Profile fields.' using errcode='P0001'; end if;
  update public.candidate_profiles set full_name=btrim(p_full_name),first_name=nullif(btrim(coalesce(p_first_name,'')),''),middle_name=nullif(btrim(coalesce(p_middle_name,'')),''),last_name=nullif(btrim(coalesce(p_last_name,'')),''),email=nullif(lower(btrim(coalesce(p_email,''))),''),phone=nullif(btrim(coalesce(p_phone,'')),''),review_status=v_status,reviewed_by=case when v_status='VERIFIED' then auth.uid() else null end,reviewed_at=case when v_status='VERIFIED' then now() else null end where id=p_profile_id;
  if not found then raise exception 'CANDIDATE_PROFILE_NOT_FOUND: The Candidate Profile was not found.' using errcode='P0001'; end if;
  delete from public.candidate_addresses where candidate_profile_id=p_profile_id and is_primary;
  if p_primary_address is not null and exists(select 1 from jsonb_each_text(p_primary_address) where btrim(value)<>'') then
    insert into public.candidate_addresses(candidate_profile_id,address_type,address_line_1,address_line_2,city,state_region,postal_code,country,is_primary)
    values(p_profile_id,'PRIMARY',nullif(btrim(p_primary_address->>'addressLine1'),''),nullif(btrim(p_primary_address->>'addressLine2'),''),nullif(btrim(p_primary_address->>'city'),''),nullif(btrim(p_primary_address->>'stateRegion'),''),nullif(btrim(p_primary_address->>'postalCode'),''),nullif(btrim(p_primary_address->>'country'),''),true);
  end if;
  delete from public.candidate_links where candidate_profile_id=p_profile_id;
  insert into public.candidate_links(candidate_profile_id,link_type,label,url)
  select p_profile_id,link_type,label,url from (
    select distinct on (upper(btrim(value->>'linkType')),btrim(value->>'url')) upper(btrim(value->>'linkType')) as link_type,nullif(btrim(value->>'label'),'') as label,btrim(value->>'url') as url
    from jsonb_array_elements(coalesce(p_links,'[]'::jsonb))
    where upper(btrim(value->>'linkType')) in ('LINKEDIN','GITHUB','PORTFOLIO','OTHER') and btrim(value->>'url') ~* '^https://[^[:space:]]+$'
    order by upper(btrim(value->>'linkType')),btrim(value->>'url')
  ) deduplicated_links;
  return public.get_candidate_autofill_profile_v088(p_profile_id);
end;
$$;

create or replace function public.create_candidate_employment_v088(p_profile_id uuid,p_company text,p_job_title text,p_location text default null,p_start_date date default null,p_end_date date default null,p_is_current boolean default false,p_experience_details text default null,p_display_order integer default 0)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  perform public.assert_application_manager();
  insert into public.candidate_employment_history(candidate_profile_id,company,job_title,location,start_date,end_date,is_current,experience_details,display_order,source) values(p_profile_id,btrim(p_company),btrim(p_job_title),nullif(btrim(coalesce(p_location,'')),''),p_start_date,case when p_is_current then null else p_end_date end,p_is_current,nullif(btrim(coalesce(p_experience_details,'')),''),p_display_order,'MANUAL') returning id into v_id;
  return jsonb_build_object('id',v_id,'profile',public.get_candidate_autofill_profile_v088(p_profile_id));
end;
$$;

create or replace function public.update_candidate_employment_v088(p_profile_id uuid,p_employment_id uuid,p_company text,p_job_title text,p_location text default null,p_start_date date default null,p_end_date date default null,p_is_current boolean default false,p_experience_details text default null,p_display_order integer default 0)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_application_manager();
  update public.candidate_employment_history set company=btrim(p_company),job_title=btrim(p_job_title),location=nullif(btrim(coalesce(p_location,'')),''),start_date=p_start_date,end_date=case when p_is_current then null else p_end_date end,is_current=p_is_current,experience_details=nullif(btrim(coalesce(p_experience_details,'')),''),display_order=p_display_order,source='MANUAL' where id=p_employment_id and candidate_profile_id=p_profile_id;
  if not found then raise exception 'CANDIDATE_EMPLOYMENT_NOT_FOUND: The employment record was not found.' using errcode='P0001'; end if;
  return public.get_candidate_autofill_profile_v088(p_profile_id);
end;
$$;

create or replace function public.create_candidate_education_v088(p_profile_id uuid,p_institution text,p_degree text default null,p_field_of_study text default null,p_location text default null,p_start_date date default null,p_end_date date default null,p_gpa text default null,p_details text default null,p_display_order integer default 0)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  perform public.assert_application_manager();
  insert into public.candidate_education(candidate_profile_id,institution,degree,field_of_study,location,start_date,end_date,gpa,details,display_order,source) values(p_profile_id,btrim(p_institution),nullif(btrim(coalesce(p_degree,'')),''),nullif(btrim(coalesce(p_field_of_study,'')),''),nullif(btrim(coalesce(p_location,'')),''),p_start_date,p_end_date,nullif(btrim(coalesce(p_gpa,'')),''),nullif(btrim(coalesce(p_details,'')),''),p_display_order,'MANUAL') returning id into v_id;
  return jsonb_build_object('id',v_id,'profile',public.get_candidate_autofill_profile_v088(p_profile_id));
end;
$$;

create or replace function public.update_candidate_education_v088(p_profile_id uuid,p_education_id uuid,p_institution text,p_degree text default null,p_field_of_study text default null,p_location text default null,p_start_date date default null,p_end_date date default null,p_gpa text default null,p_details text default null,p_display_order integer default 0)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_application_manager();
  update public.candidate_education set institution=btrim(p_institution),degree=nullif(btrim(coalesce(p_degree,'')),''),field_of_study=nullif(btrim(coalesce(p_field_of_study,'')),''),location=nullif(btrim(coalesce(p_location,'')),''),start_date=p_start_date,end_date=p_end_date,gpa=nullif(btrim(coalesce(p_gpa,'')),''),details=nullif(btrim(coalesce(p_details,'')),''),display_order=p_display_order,source='MANUAL' where id=p_education_id and candidate_profile_id=p_profile_id;
  if not found then raise exception 'CANDIDATE_EDUCATION_NOT_FOUND: The education record was not found.' using errcode='P0001'; end if;
  return public.get_candidate_autofill_profile_v088(p_profile_id);
end;
$$;

-- Make the existing Application context advertise only reviewed profiles.
create or replace function public.get_application_extension_context_v085(p_application_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not public.is_active_user(auth.uid()) then raise exception 'APPLICATION_EXTENSION_ACCESS_DENIED: An active authenticated user is required.' using errcode='42501'; end if;
  select jsonb_build_object(
    'application',jsonb_build_object('id',a.id,'applicationNumber',a.application_number,'workStatus',a.work_status,'applicationStatus',a.application_status,'assignedTo',a.assigned_to),
    'job',jsonb_build_object('id',j.id,'company',j.company,'jobTitle',j.job_title,'sourceUrl',j.source_url),
    'candidate',jsonb_build_object('displayName',r.candidate_name,'profileId',cp.id,'profileAvailable',coalesce(cp.review_status='VERIFIED',false)),
    'resume',jsonb_build_object('id',r.id,'resumeName',r.resume_name,'originalFilename',r.original_filename,'mimeType',r.mime_type,'fileSizeBytes',r.file_size_bytes,'status',r.status),
    'permissions',jsonb_build_object('canLoadResume',r.status='ACTIVE','canAutofill',r.status='ACTIVE' and j.source_url ~* '^https?://' and cp.review_status='VERIFIED')
  ) into v_result from public.applications a join public.job_descriptions j on j.id=a.job_description_id join public.resumes r on r.id=a.resume_id left join public.candidate_profiles cp on cp.resume_id=r.id where a.id=p_application_id and public.application_actor_can_view(a.assigned_to);
  if v_result is null then raise exception 'APPLICATION_NOT_FOUND: The Application was not found or is not accessible.' using errcode='P0001'; end if;
  return v_result;
end;
$$;

revoke all on function public.candidate_profile_actor_can_view(uuid) from public, anon;
revoke all on function public.get_candidate_autofill_profile_v088(uuid) from public, anon;
revoke all on function public.update_candidate_profile_v088(uuid,text,text,text,text,text,text,text,jsonb,jsonb) from public, anon;
revoke all on function public.create_candidate_employment_v088(uuid,text,text,text,date,date,boolean,text,integer) from public, anon;
revoke all on function public.update_candidate_employment_v088(uuid,uuid,text,text,text,date,date,boolean,text,integer) from public, anon;
revoke all on function public.create_candidate_education_v088(uuid,text,text,text,text,date,date,text,text,integer) from public, anon;
revoke all on function public.update_candidate_education_v088(uuid,uuid,text,text,text,text,date,date,text,text,integer) from public, anon;
grant execute on function public.get_candidate_autofill_profile_v088(uuid) to authenticated;
grant execute on function public.candidate_profile_actor_can_view(uuid) to authenticated;
grant execute on function public.update_candidate_profile_v088(uuid,text,text,text,text,text,text,text,jsonb,jsonb) to authenticated;
grant execute on function public.create_candidate_employment_v088(uuid,text,text,text,date,date,boolean,text,integer) to authenticated;
grant execute on function public.update_candidate_employment_v088(uuid,uuid,text,text,text,date,date,boolean,text,integer) to authenticated;
grant execute on function public.create_candidate_education_v088(uuid,text,text,text,text,date,date,text,text,integer) to authenticated;
grant execute on function public.update_candidate_education_v088(uuid,uuid,text,text,text,text,date,date,text,text,integer) to authenticated;
