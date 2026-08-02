-- v0.8.8: Resume-owned, reviewable autofill metadata.
-- No separate Candidate Profile or child entity tables are introduced. The
-- Resume remains the canonical record and structured_content keeps repeatable
-- employment, education, and certification metadata.

-- Migration 202607280023 was briefly deployed with separate candidate child
-- tables. Remove that abandoned model before installing the Resume-owned one.
drop trigger if exists resumes_create_candidate_profile_v088 on public.resumes;
drop function if exists public.ensure_candidate_profile_for_resume_v088() cascade;
drop function if exists public.candidate_profile_actor_can_view(uuid) cascade;
drop function if exists public.get_candidate_autofill_profile_v088(uuid);
drop function if exists public.update_candidate_profile_v088(uuid,text,text,text,text,text,text,text,jsonb,jsonb);
drop function if exists public.create_candidate_employment_v088(uuid,text,text,text,date,date,boolean,text,integer);
drop function if exists public.update_candidate_employment_v088(uuid,uuid,text,text,text,date,date,boolean,text,integer);
drop function if exists public.create_candidate_education_v088(uuid,text,text,text,text,date,date,text,text,integer);
drop function if exists public.update_candidate_education_v088(uuid,uuid,text,text,text,text,date,date,text,text,integer);

drop table if exists public.candidate_links cascade;
drop table if exists public.candidate_certifications cascade;
drop table if exists public.candidate_education cascade;
drop table if exists public.candidate_employment_history cascade;
drop table if exists public.candidate_addresses cascade;
drop table if exists public.candidate_profiles cascade;

alter table public.resumes
  add column if not exists candidate_first_name text check (candidate_first_name is null or char_length(candidate_first_name) <= 100),
  add column if not exists candidate_middle_name text check (candidate_middle_name is null or char_length(candidate_middle_name) <= 100),
  add column if not exists candidate_last_name text check (candidate_last_name is null or char_length(candidate_last_name) <= 100),
  add column if not exists address_line_1 text check (address_line_1 is null or char_length(address_line_1) <= 200),
  add column if not exists address_line_2 text check (address_line_2 is null or char_length(address_line_2) <= 200),
  add column if not exists address_city text check (address_city is null or char_length(address_city) <= 120),
  add column if not exists address_state_region text check (address_state_region is null or char_length(address_state_region) <= 120),
  add column if not exists address_postal_code text check (address_postal_code is null or char_length(address_postal_code) <= 40),
  add column if not exists address_country text check (address_country is null or char_length(address_country) <= 120),
  add column if not exists linkedin_url text check (linkedin_url is null or (linkedin_url ~* '^https://[^[:space:]]+$' and char_length(linkedin_url) <= 2000)),
  add column if not exists github_url text check (github_url is null or (github_url ~* '^https://[^[:space:]]+$' and char_length(github_url) <= 2000)),
  add column if not exists portfolio_url text check (portfolio_url is null or (portfolio_url ~* '^https://[^[:space:]]+$' and char_length(portfolio_url) <= 2000)),
  add column if not exists profile_review_status text not null default 'NEEDS_REVIEW' check (profile_review_status in ('NEEDS_REVIEW','VERIFIED')),
  add column if not exists profile_reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists profile_reviewed_at timestamptz,
  add column if not exists profile_schema_version integer not null default 1 check (profile_schema_version between 1 and 100);

alter table public.resumes drop constraint if exists resumes_profile_review_check;
alter table public.resumes add constraint resumes_profile_review_check check (
  (profile_review_status='NEEDS_REVIEW' and profile_reviewed_by is null and profile_reviewed_at is null)
  or (profile_review_status='VERIFIED' and profile_reviewed_by is not null and profile_reviewed_at is not null)
);

create index if not exists resumes_profile_review_status_idx on public.resumes(profile_review_status,updated_at desc);

comment on column public.resumes.profile_review_status is 'Human review state for Resume metadata used by autofill. Resume extraction never sets VERIFIED.';
comment on column public.resumes.structured_content is 'Versioned Resume metadata. Version 3 supports professional_experience, education, and certifications as ordered arrays; older versions remain readable.';

-- v0.4 limited this field to versions 1 and 2. The Resume-owned autofill
-- document is version 3, so widen the constraint before converting any rows.
alter table public.resumes
  drop constraint if exists resumes_structured_schema_version_check;
alter table public.resumes
  add constraint resumes_structured_schema_version_check
  check (structured_schema_version in (1,2,3));

-- Upgrade the structured document shape without attempting to infer schools or
-- certifications. Preserve the old free-text education for manual review.
update public.resumes set
  structured_content = coalesce(structured_content,'{}'::jsonb)
    || jsonb_build_object(
      'education_legacy_text',case when jsonb_typeof(structured_content->'education')='string' then structured_content->>'education' else coalesce(structured_content->>'education_legacy_text','') end,
      'education',case when jsonb_typeof(structured_content->'education')='array' then structured_content->'education' else '[]'::jsonb end,
      'certifications',case when jsonb_typeof(structured_content->'certifications')='array' then structured_content->'certifications' else '[]'::jsonb end
    ),
  structured_schema_version=greatest(structured_schema_version,3),
  profile_review_status='NEEDS_REVIEW',profile_reviewed_by=null,profile_reviewed_at=null,
  profile_schema_version=1;

create or replace function public.candidate_resume_actor_can_view_v088(p_resume_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.application_actor_can_manage()
    or exists(
      select 1 from public.applications a
      where a.resume_id=p_resume_id and a.assigned_to=auth.uid()
        and public.is_active_user(auth.uid()) and public.has_role('APPLIER',auth.uid())
    );
$$;

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

create or replace function public.candidate_date_json_v088(p_value date)
returns jsonb language sql immutable security invoker set search_path='' as $$
  select case when p_value is null then null else jsonb_build_object('year',extract(year from p_value)::integer,'month',extract(month from p_value)::integer) end;
$$;

create or replace function public.get_candidate_autofill_profile_v088(p_resume_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_result jsonb;
begin
  if not public.candidate_resume_actor_can_view_v088(p_resume_id) then raise exception 'CANDIDATE_PROFILE_NOT_FOUND: The Resume profile was not found or is not accessible.' using errcode='P0001'; end if;
  select jsonb_build_object(
    'id',r.id,'resumeId',r.id,'fullName',r.candidate_name,'firstName',r.candidate_first_name,'middleName',r.candidate_middle_name,'lastName',r.candidate_last_name,
    'email',r.candidate_email,'phone',r.candidate_phone,'reviewStatus',r.profile_review_status,'reviewedBy',r.profile_reviewed_by,'reviewedAt',r.profile_reviewed_at,
    'createdAt',r.created_at,'updatedAt',r.updated_at,
    'addresses',case when coalesce(r.address_line_1,r.address_line_2,r.address_city,r.address_state_region,r.address_postal_code,r.address_country) is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('id',r.id,'addressType','PRIMARY','addressLine1',r.address_line_1,'addressLine2',r.address_line_2,'city',r.address_city,'stateRegion',r.address_state_region,'postalCode',r.address_postal_code,'country',r.address_country,'isPrimary',true)) end,
    'links',(select coalesce(jsonb_agg(x.value),'[]'::jsonb) from jsonb_array_elements(jsonb_build_array(case when r.linkedin_url is null then null else jsonb_build_object('id',r.id::text||'-linkedin','linkType','LINKEDIN','label',null,'url',r.linkedin_url) end,case when r.github_url is null then null else jsonb_build_object('id',r.id::text||'-github','linkType','GITHUB','label',null,'url',r.github_url) end,case when r.portfolio_url is null then null else jsonb_build_object('id',r.id::text||'-portfolio','linkType','PORTFOLIO','label',null,'url',r.portfolio_url) end)) x(value) where x.value<>'null'::jsonb),
    'employment',coalesce((select jsonb_agg(jsonb_build_object('id',x.value->>'id','company',x.value->>'company','jobTitle',x.value->>'job_title','location',nullif(x.value->>'location',''),'startDate',public.candidate_partial_date_v088(x.value->'start_date'),'endDate',public.candidate_partial_date_v088(x.value->'end_date'),'isCurrent',lower(coalesce(x.value->>'is_current','false')) in ('true','t','1','yes'),'experienceDetails',nullif(x.value->>'experience_details',''),'displayOrder',(x.ordinality-1)::integer,'source','RESUME_METADATA') order by x.ordinality) from jsonb_array_elements(case when jsonb_typeof(r.structured_content->'professional_experience')='array' then r.structured_content->'professional_experience' else '[]'::jsonb end) with ordinality x(value,ordinality)),'[]'::jsonb),
    'education',coalesce((select jsonb_agg(jsonb_build_object('id',x.value->>'id','institution',x.value->>'institution','degree',nullif(x.value->>'degree',''),'fieldOfStudy',nullif(x.value->>'field_of_study',''),'location',nullif(x.value->>'location',''),'startDate',public.candidate_partial_date_v088(x.value->'start_date'),'endDate',public.candidate_partial_date_v088(x.value->'end_date'),'gpa',nullif(x.value->>'gpa',''),'details',nullif(x.value->>'details',''),'displayOrder',(x.ordinality-1)::integer,'source','RESUME_METADATA') order by x.ordinality) from jsonb_array_elements(case when jsonb_typeof(r.structured_content->'education')='array' then r.structured_content->'education' else '[]'::jsonb end) with ordinality x(value,ordinality)),'[]'::jsonb),
    'educationLegacyText',coalesce(r.structured_content->>'education_legacy_text',''),
    'certifications',case when jsonb_typeof(r.structured_content->'certifications')='array' then r.structured_content->'certifications' else '[]'::jsonb end
  ) into v_result from public.resumes r where r.id=p_resume_id;
  if v_result is null then raise exception 'CANDIDATE_PROFILE_NOT_FOUND: The Resume was not found.' using errcode='P0001'; end if;
  return v_result;
end;
$$;

create or replace function public.update_candidate_profile_v088(p_resume_id uuid,p_full_name text,p_first_name text default null,p_middle_name text default null,p_last_name text default null,p_email text default null,p_phone text default null,p_review_status text default 'NEEDS_REVIEW',p_primary_address jsonb default null,p_links jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_status text:=upper(btrim(coalesce(p_review_status,''))); v_link jsonb;
begin
  perform public.assert_application_manager();
  if char_length(btrim(coalesce(p_full_name,''))) not between 1 and 200 or v_status not in ('NEEDS_REVIEW','VERIFIED') then raise exception 'CANDIDATE_PROFILE_INVALID: Review the Resume profile fields.' using errcode='P0001'; end if;
  select coalesce(jsonb_object_agg(upper(value->>'linkType'),value->>'url'),'{}'::jsonb) into v_link from jsonb_array_elements(coalesce(p_links,'[]'::jsonb)) where upper(value->>'linkType') in ('LINKEDIN','GITHUB','PORTFOLIO') and value->>'url' ~* '^https://[^[:space:]]+$';
  update public.resumes set candidate_name=btrim(p_full_name),candidate_first_name=nullif(btrim(coalesce(p_first_name,'')),''),candidate_middle_name=nullif(btrim(coalesce(p_middle_name,'')),''),candidate_last_name=nullif(btrim(coalesce(p_last_name,'')),''),candidate_email=nullif(lower(btrim(coalesce(p_email,''))),''),candidate_phone=nullif(btrim(coalesce(p_phone,'')),''),address_line_1=nullif(btrim(coalesce(p_primary_address->>'addressLine1','')),''),address_line_2=nullif(btrim(coalesce(p_primary_address->>'addressLine2','')),''),address_city=nullif(btrim(coalesce(p_primary_address->>'city','')),''),address_state_region=nullif(btrim(coalesce(p_primary_address->>'stateRegion','')),''),address_postal_code=nullif(btrim(coalesce(p_primary_address->>'postalCode','')),''),address_country=nullif(btrim(coalesce(p_primary_address->>'country','')),''),linkedin_url=nullif(v_link->>'LINKEDIN',''),github_url=nullif(v_link->>'GITHUB',''),portfolio_url=nullif(v_link->>'PORTFOLIO',''),profile_review_status=v_status,profile_reviewed_by=case when v_status='VERIFIED' then auth.uid() else null end,profile_reviewed_at=case when v_status='VERIFIED' then now() else null end where id=p_resume_id;
  if not found then raise exception 'CANDIDATE_PROFILE_NOT_FOUND: The Resume was not found.' using errcode='P0001'; end if;
  return public.get_candidate_autofill_profile_v088(p_resume_id);
end;
$$;

create or replace function public.save_candidate_employment_v088(p_resume_id uuid,p_employment_id text,p_company text,p_job_title text,p_location text default null,p_start_date date default null,p_end_date date default null,p_is_current boolean default false,p_experience_details text default null,p_display_order integer default 0)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_items jsonb; v_id text:=coalesce(nullif(btrim(p_employment_id),''),gen_random_uuid()::text); v_item jsonb; v_found boolean:=false;
begin
  perform public.assert_application_manager();
  if btrim(coalesce(p_company,''))='' or btrim(coalesce(p_job_title,''))='' then raise exception 'CANDIDATE_EMPLOYMENT_INVALID: Company and job title are required.' using errcode='P0001'; end if;
  select case when jsonb_typeof(structured_content->'professional_experience')='array' then structured_content->'professional_experience' else '[]'::jsonb end into v_items from public.resumes where id=p_resume_id for update;
  if v_items is null then raise exception 'CANDIDATE_PROFILE_NOT_FOUND: The Resume was not found.' using errcode='P0001'; end if;
  v_item:=jsonb_build_object('id',v_id,'company',btrim(p_company),'job_title',btrim(p_job_title),'location',coalesce(btrim(p_location),''),'start_date',public.candidate_date_json_v088(p_start_date),'end_date',case when p_is_current then null else public.candidate_date_json_v088(p_end_date) end,'is_current',p_is_current,'experience_details',coalesce(btrim(p_experience_details),''));
  if p_employment_id is not null then select exists(select 1 from jsonb_array_elements(v_items) x where x->>'id'=p_employment_id) into v_found; if not v_found then raise exception 'CANDIDATE_EMPLOYMENT_NOT_FOUND: The employment record was not found.' using errcode='P0001'; end if; end if;
  select coalesce(jsonb_agg(case when x.value->>'id'=p_employment_id then v_item else x.value end order by x.ordinality),'[]'::jsonb) into v_items from jsonb_array_elements(v_items) with ordinality x(value,ordinality);
  if p_employment_id is null then v_items:=v_items||jsonb_build_array(v_item); end if;
  update public.resumes set structured_content=jsonb_set(coalesce(structured_content,'{}'::jsonb),'{professional_experience}',v_items,true),structured_schema_version=greatest(structured_schema_version,3),profile_review_status='NEEDS_REVIEW',profile_reviewed_by=null,profile_reviewed_at=null where id=p_resume_id;
  return jsonb_build_object('id',v_id,'profile',public.get_candidate_autofill_profile_v088(p_resume_id));
end;
$$;

create or replace function public.save_candidate_education_v088(p_resume_id uuid,p_education_id text,p_institution text,p_degree text default null,p_field_of_study text default null,p_location text default null,p_start_date date default null,p_end_date date default null,p_gpa text default null,p_details text default null,p_display_order integer default 0)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_items jsonb; v_id text:=coalesce(nullif(btrim(p_education_id),''),gen_random_uuid()::text); v_item jsonb; v_found boolean:=false;
begin
  perform public.assert_application_manager();
  if btrim(coalesce(p_institution,''))='' then raise exception 'CANDIDATE_EDUCATION_INVALID: Institution is required.' using errcode='P0001'; end if;
  select case when jsonb_typeof(structured_content->'education')='array' then structured_content->'education' else '[]'::jsonb end into v_items from public.resumes where id=p_resume_id for update;
  if v_items is null then raise exception 'CANDIDATE_PROFILE_NOT_FOUND: The Resume was not found.' using errcode='P0001'; end if;
  v_item:=jsonb_build_object('id',v_id,'institution',btrim(p_institution),'degree',coalesce(btrim(p_degree),''),'field_of_study',coalesce(btrim(p_field_of_study),''),'location',coalesce(btrim(p_location),''),'start_date',public.candidate_date_json_v088(p_start_date),'end_date',public.candidate_date_json_v088(p_end_date),'gpa',coalesce(btrim(p_gpa),''),'details',coalesce(btrim(p_details),''));
  if p_education_id is not null then select exists(select 1 from jsonb_array_elements(v_items) x where x->>'id'=p_education_id) into v_found; if not v_found then raise exception 'CANDIDATE_EDUCATION_NOT_FOUND: The education record was not found.' using errcode='P0001'; end if; end if;
  select coalesce(jsonb_agg(case when x.value->>'id'=p_education_id then v_item else x.value end order by x.ordinality),'[]'::jsonb) into v_items from jsonb_array_elements(v_items) with ordinality x(value,ordinality);
  if p_education_id is null then v_items:=v_items||jsonb_build_array(v_item); end if;
  update public.resumes set structured_content=jsonb_set(jsonb_set(coalesce(structured_content,'{}'::jsonb),'{education}',v_items,true),'{certifications}',case when jsonb_typeof(structured_content->'certifications')='array' then structured_content->'certifications' else '[]'::jsonb end,true),structured_schema_version=greatest(structured_schema_version,3),profile_review_status='NEEDS_REVIEW',profile_reviewed_by=null,profile_reviewed_at=null where id=p_resume_id;
  return jsonb_build_object('id',v_id,'profile',public.get_candidate_autofill_profile_v088(p_resume_id));
end;
$$;

create or replace function public.get_application_extension_context_v085(p_application_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not public.is_active_user(auth.uid()) then raise exception 'APPLICATION_EXTENSION_ACCESS_DENIED: An active authenticated user is required.' using errcode='42501'; end if;
  select jsonb_build_object('application',jsonb_build_object('id',a.id,'applicationNumber',a.application_number,'workStatus',a.work_status,'applicationStatus',a.application_status,'assignedTo',a.assigned_to),'job',jsonb_build_object('id',j.id,'company',j.company,'jobTitle',j.job_title,'sourceUrl',j.source_url),'candidate',jsonb_build_object('displayName',r.candidate_name,'profileId',r.id,'profileAvailable',r.profile_review_status='VERIFIED'),'resume',jsonb_build_object('id',r.id,'resumeName',r.resume_name,'originalFilename',r.original_filename,'mimeType',r.mime_type,'fileSizeBytes',r.file_size_bytes,'status',r.status),'permissions',jsonb_build_object('canLoadResume',r.status='ACTIVE','canAutofill',r.status='ACTIVE' and j.source_url ~* '^https?://' and r.profile_review_status='VERIFIED')) into v_result from public.applications a join public.job_descriptions j on j.id=a.job_description_id join public.resumes r on r.id=a.resume_id where a.id=p_application_id and public.application_actor_can_view(a.assigned_to);
  if v_result is null then raise exception 'APPLICATION_NOT_FOUND: The Application was not found or is not accessible.' using errcode='P0001'; end if;
  return v_result;
end;
$$;

revoke all on function public.candidate_resume_actor_can_view_v088(uuid) from public,anon;
revoke all on function public.candidate_partial_date_v088(jsonb) from public,anon,authenticated;
revoke all on function public.candidate_date_json_v088(date) from public,anon,authenticated;
revoke all on function public.get_candidate_autofill_profile_v088(uuid) from public,anon;
revoke all on function public.update_candidate_profile_v088(uuid,text,text,text,text,text,text,text,jsonb,jsonb) from public,anon;
revoke all on function public.save_candidate_employment_v088(uuid,text,text,text,text,date,date,boolean,text,integer) from public,anon;
revoke all on function public.save_candidate_education_v088(uuid,text,text,text,text,text,date,date,text,text,integer) from public,anon;
grant execute on function public.get_candidate_autofill_profile_v088(uuid) to authenticated;
grant execute on function public.update_candidate_profile_v088(uuid,text,text,text,text,text,text,text,jsonb,jsonb) to authenticated;
grant execute on function public.save_candidate_employment_v088(uuid,text,text,text,text,date,date,boolean,text,integer) to authenticated;
grant execute on function public.save_candidate_education_v088(uuid,text,text,text,text,text,date,date,text,text,integer) to authenticated;
