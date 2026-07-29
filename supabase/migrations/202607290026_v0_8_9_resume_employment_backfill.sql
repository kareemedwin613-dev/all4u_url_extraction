-- v0.8.9 correction: convert legacy Resume-owned professional-experience text
-- into the versioned structured_content array once. Existing structured rows
-- always win and are never overwritten.

create or replace function public.import_candidate_employment_v089(
  p_resume_id uuid,
  p_items jsonb,
  p_legacy_text text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_content jsonb;
  v_items jsonb;
  v_count integer;
begin
  perform public.assert_application_manager();

  select coalesce(structured_content,'{}'::jsonb)
    into v_content
  from public.resumes
  where id=p_resume_id
  for update;

  if v_content is null then
    raise exception 'CANDIDATE_PROFILE_NOT_FOUND: The Resume was not found.' using errcode='P0001';
  end if;

  if jsonb_typeof(v_content->'professional_experience')='array'
     and jsonb_array_length(v_content->'professional_experience')>0 then
    return public.get_candidate_autofill_profile_v088(p_resume_id);
  end if;

  if jsonb_typeof(p_items)<>'array' then
    raise exception 'CANDIDATE_EMPLOYMENT_IMPORT_INVALID: Employment items must be an array.' using errcode='P0001';
  end if;
  v_count:=jsonb_array_length(p_items);
  if v_count not between 1 and 50 then
    raise exception 'CANDIDATE_EMPLOYMENT_IMPORT_INVALID: Import between 1 and 50 employment records.' using errcode='P0001';
  end if;

  if exists(
    select 1 from jsonb_array_elements(p_items) x
    where jsonb_typeof(x)<>'object'
       or btrim(coalesce(x->>'company',''))=''
       or char_length(x->>'company')>200
       or btrim(coalesce(x->>'job_title',''))=''
       or char_length(x->>'job_title')>200
       or char_length(coalesce(x->>'location',''))>200
       or char_length(coalesce(x->>'experience_details',''))>30000
  ) then
    raise exception 'CANDIDATE_EMPLOYMENT_IMPORT_INVALID: Review the imported company, title, location, and details.' using errcode='P0001';
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'id',case when coalesce(x.value->>'id','') ~* '^[0-9a-f-]{36}$' then x.value->>'id' else gen_random_uuid()::text end,
      'company',btrim(x.value->>'company'),
      'job_title',btrim(x.value->>'job_title'),
      'location',btrim(coalesce(x.value->>'location','')),
      'start_date',case when jsonb_typeof(x.value->'start_date')='object' then x.value->'start_date' else null end,
      'end_date',case when lower(coalesce(x.value->>'is_current','false')) in ('true','t','1','yes') then null when jsonb_typeof(x.value->'end_date')='object' then x.value->'end_date' else null end,
      'is_current',lower(coalesce(x.value->>'is_current','false')) in ('true','t','1','yes'),
      'experience_details',btrim(coalesce(x.value->>'experience_details',''))
    ) order by x.ordinality
  ) into v_items
  from jsonb_array_elements(p_items) with ordinality x(value,ordinality);

  update public.resumes
  set structured_content=jsonb_set(
        jsonb_set(v_content,'{professional_experience_legacy_text}',to_jsonb(coalesce(p_legacy_text,'')),true),
        '{professional_experience}',v_items,true
      ),
      structured_schema_version=greatest(structured_schema_version,3),
      profile_review_status='NEEDS_REVIEW',
      profile_reviewed_by=null,
      profile_reviewed_at=null
  where id=p_resume_id;

  return public.get_candidate_autofill_profile_v088(p_resume_id);
end;
$$;

revoke all on function public.import_candidate_employment_v089(uuid,jsonb,text) from public,anon;
grant execute on function public.import_candidate_employment_v089(uuid,jsonb,text) to authenticated;

comment on function public.import_candidate_employment_v089(uuid,jsonb,text) is
  'Atomically initializes an empty Resume professional_experience array from deterministic legacy parsing without overwriting existing structured employment.';
