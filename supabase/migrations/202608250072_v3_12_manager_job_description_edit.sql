-- v3.12: allow Applying Managers / Admins to fix capture fields while reviewing.
-- Same field rules as update_my_job_description_v31, but not limited to the caller's own captures.
-- Manager review audit fields stay untouched; approved/declined JDs remain locked.

create or replace function public.manager_update_job_description_v312(
  p_job_description_id uuid,
  p_company text,
  p_job_title text,
  p_category_id uuid,
  p_subcategory_id uuid,
  p_seniority text,
  p_location_text text,
  p_work_arrangement text,
  p_source_url text,
  p_normalized_source_url text,
  p_source_site text,
  p_description_text text,
  p_detected_skills text[],
  p_clearance_requirements text[],
  p_travel_required boolean,
  p_travel_details text,
  p_salary_min numeric,
  p_salary_max numeric,
  p_salary_currency text,
  p_salary_period text,
  p_salary_text text
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_job public.job_descriptions;
  v_company text := regexp_replace(btrim(coalesce(p_company,'')), '\s+', ' ', 'g');
  v_title text := regexp_replace(btrim(coalesce(p_job_title,'')), '\s+', ' ', 'g');
begin
  if v_actor is null or not public.is_active_user(v_actor) or not public.application_actor_can_manage() then
    raise exception 'JOB_EDIT_FORBIDDEN: An active Applying Manager or Admin account is required.' using errcode='42501';
  end if;

  select * into v_job from public.job_descriptions
  where id=p_job_description_id for update;
  if not found then
    raise exception 'JOB_NOT_FOUND: The job description was not found or is no longer accessible.' using errcode='P0002';
  end if;
  if v_job.review_status not in ('NEEDS_REVIEW','NEEDS_CORRECTION') then
    raise exception 'JOB_EDIT_LOCKED: Approved and declined job descriptions are immutable.' using errcode='P0001';
  end if;

  if char_length(v_company) not between 1 and 200 or char_length(v_title) not between 1 and 200
     or char_length(coalesce(p_description_text,'')) not between 100 and 200000
     or char_length(coalesce(p_source_url,'')) not between 1 and 4000 then
    raise exception 'JOB_EDIT_INVALID: Required job-description fields are invalid.' using errcode='22023';
  end if;
  if p_salary_min is not null and p_salary_max is not null and p_salary_max < p_salary_min then
    raise exception 'JOB_EDIT_INVALID: Salary maximum must be at least the minimum.' using errcode='22023';
  end if;
  if not exists(select 1 from public.categories where id=p_category_id and parent_id is null and active) then
    raise exception 'JOB_EDIT_INVALID: Select an active primary category.' using errcode='22023';
  end if;
  if p_subcategory_id is not null and not exists(select 1 from public.categories where id=p_subcategory_id and parent_id=p_category_id and active) then
    raise exception 'JOB_EDIT_INVALID: The subcategory does not belong to the primary category.' using errcode='22023';
  end if;

  -- Duplicate checks stay scoped to the original capturer, not the reviewing manager.
  if exists(select 1 from public.job_descriptions
    where user_id=v_job.user_id and id<>p_job_description_id
      and normalized_source_url=p_normalized_source_url and coalesce(p_normalized_source_url,'')<>'')
    or exists(select 1 from public.job_descriptions
      where user_id=v_job.user_id and id<>p_job_description_id
        and lower(regexp_replace(btrim(company),'\s+',' ','g'))=lower(v_company)
        and lower(regexp_replace(btrim(job_title),'\s+',' ','g'))=lower(v_title)) then
    raise exception 'JOB_DUPLICATE: Another capture has this URL or company and title.' using errcode='23505';
  end if;

  update public.job_descriptions set
    company=v_company,
    job_title=v_title,
    category_id=p_category_id,
    subcategory_id=p_subcategory_id,
    seniority=coalesce(p_seniority,'UNSPECIFIED'),
    location_text=nullif(btrim(coalesce(p_location_text,'')),''),
    work_arrangement=coalesce(p_work_arrangement,'UNSPECIFIED'),
    source_url=btrim(p_source_url),
    normalized_source_url=btrim(p_normalized_source_url),
    source_site=btrim(p_source_site),
    description_text=btrim(p_description_text),
    detected_skills=coalesce(p_detected_skills,'{}'::text[]),
    clearance_requirements=coalesce(p_clearance_requirements,'{}'::text[]),
    travel_required=p_travel_required,
    travel_details=nullif(btrim(coalesce(p_travel_details,'')),''),
    salary_min=p_salary_min,
    salary_max=p_salary_max,
    salary_currency=nullif(upper(btrim(coalesce(p_salary_currency,''))),''),
    salary_period=nullif(upper(btrim(coalesce(p_salary_period,''))),''),
    salary_text=nullif(btrim(coalesce(p_salary_text,'')),''),
    updated_at=clock_timestamp()
  where id=p_job_description_id
  returning * into v_job;

  return to_jsonb(v_job);
end $$;

revoke all on function public.manager_update_job_description_v312(uuid,text,text,uuid,uuid,text,text,text,text,text,text,text,text[],text[],boolean,text,numeric,numeric,text,text,text) from public,anon;
grant execute on function public.manager_update_job_description_v312(uuid,text,text,uuid,uuid,text,text,text,text,text,text,text,text[],text[],boolean,text,numeric,numeric,text,text,text) to authenticated;

comment on function public.manager_update_job_description_v312(uuid,text,text,uuid,uuid,text,text,text,text,text,text,text,text[],text[],boolean,text,numeric,numeric,text,text,text)
is 'Manager/Admin correction of any JD while NEEDS_REVIEW or NEEDS_CORRECTION; review audit fields stay untouched.';
