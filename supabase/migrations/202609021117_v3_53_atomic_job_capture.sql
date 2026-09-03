-- v3.53: one round-trip, concurrency-safe Chrome-extension JD capture.

create index if not exists job_descriptions_user_identity_ci_idx
  on public.job_descriptions (
    user_id,
    lower(btrim(company)),
    lower(btrim(job_title)),
    created_at
  );

create or replace function public.capture_job_description_v353(p_record jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_job public.job_descriptions;
  v_normalized_url text := btrim(coalesce(p_record->>'normalized_source_url', ''));
  v_company text := regexp_replace(btrim(coalesce(p_record->>'company', '')), '\s+', ' ', 'g');
  v_job_title text := regexp_replace(btrim(coalesce(p_record->>'job_title', '')), '\s+', ' ', 'g');
  v_clearances text[];
  v_skills text[];
begin
  if v_actor is null
     or not public.is_active_user(v_actor)
     or not public.has_any_role(array['APPLYING_MANAGER', 'JD_FINDER', 'ADMIN']) then
    raise exception 'JOB_CAPTURE_ACCESS_DENIED: Active capture access is required.' using errcode = '42501';
  end if;

  if jsonb_typeof(coalesce(p_record, '{}'::jsonb)) <> 'object'
     or v_company = ''
     or v_job_title = ''
     or v_normalized_url !~* '^https?://'
     or btrim(coalesce(p_record->>'source_url', '')) !~* '^https?://' then
    raise exception 'JOB_CAPTURE_INVALID: The captured Job Description is invalid.' using errcode = '22023';
  end if;

  select coalesce(array_agg(value order by first_ordinal), '{}'::text[])
  into v_clearances
  from (
    select btrim(value) value, min(ordinality) first_ordinal
    from jsonb_array_elements_text(
      case when jsonb_typeof(p_record->'clearance_requirements') = 'array'
        then p_record->'clearance_requirements' else '[]'::jsonb end
    ) with ordinality item(value, ordinality)
    where btrim(value) <> ''
    group by btrim(value)
  ) cleaned;

  select coalesce(array_agg(value order by first_ordinal), '{}'::text[])
  into v_skills
  from (
    select btrim(value) value, min(ordinality) first_ordinal
    from jsonb_array_elements_text(
      case when jsonb_typeof(p_record->'detected_skills') = 'array'
        then p_record->'detected_skills' else '[]'::jsonb end
    ) with ordinality item(value, ordinality)
    where btrim(value) <> ''
    group by btrim(value)
  ) cleaned;

  -- Serialize both duplicate keys so concurrent captures cannot create competing
  -- company/title rows with different URLs.
  perform pg_advisory_xact_lock(hashtextextended('jd:url:' || v_actor::text || ':' || v_normalized_url, 0));
  perform pg_advisory_xact_lock(hashtextextended('jd:identity:' || v_actor::text || ':' || lower(v_company) || ':' || lower(v_job_title), 0));

  select * into v_job
  from public.job_descriptions
  where user_id = v_actor and normalized_source_url = v_normalized_url
  order by created_at, id
  limit 1;

  if found then
    return jsonb_build_object('row', to_jsonb(v_job), 'duplicate', true, 'duplicateReason', 'SOURCE_URL');
  end if;

  select * into v_job
  from public.job_descriptions
  where user_id = v_actor
    and lower(btrim(company)) = lower(v_company)
    and lower(btrim(job_title)) = lower(v_job_title)
  order by created_at, id
  limit 1;

  if found then
    return jsonb_build_object('row', to_jsonb(v_job), 'duplicate', true, 'duplicateReason', 'COMPANY_JOB_TITLE');
  end if;

  insert into public.job_descriptions (
    user_id, company, job_title, category_id, subcategory_id,
    industry_domain_category_id, seniority, location_text, work_arrangement,
    clearance_requirements, travel_required, travel_details, salary_min,
    salary_max, salary_currency, salary_period, salary_text, source_site,
    source_url, normalized_source_url, captured_at_client, description_text,
    detected_skills, capture_method, extraction_confidence
  ) values (
    v_actor,
    v_company,
    v_job_title,
    (p_record->>'category_id')::uuid,
    nullif(p_record->>'subcategory_id', '')::uuid,
    nullif(p_record->>'industry_domain_category_id', '')::uuid,
    coalesce(nullif(p_record->>'seniority', ''), 'UNSPECIFIED'),
    nullif(btrim(coalesce(p_record->>'location_text', '')), ''),
    coalesce(nullif(p_record->>'work_arrangement', ''), 'UNSPECIFIED'),
    v_clearances,
    nullif(p_record->>'travel_required', '')::boolean,
    nullif(btrim(coalesce(p_record->>'travel_details', '')), ''),
    nullif(p_record->>'salary_min', '')::numeric,
    nullif(p_record->>'salary_max', '')::numeric,
    nullif(btrim(coalesce(p_record->>'salary_currency', '')), ''),
    nullif(btrim(coalesce(p_record->>'salary_period', '')), ''),
    nullif(btrim(coalesce(p_record->>'salary_text', '')), ''),
    btrim(coalesce(p_record->>'source_site', '')),
    btrim(p_record->>'source_url'),
    v_normalized_url,
    nullif(p_record->>'captured_at_client', '')::timestamptz,
    p_record->>'description_text',
    v_skills,
    coalesce(nullif(p_record->>'capture_method', ''), 'manual'),
    coalesce(nullif(p_record->>'extraction_confidence', ''), 'low')
  )
  returning * into v_job;

  return jsonb_build_object('row', to_jsonb(v_job), 'duplicate', false, 'duplicateReason', null);
exception
  when unique_violation then
    select * into v_job
    from public.job_descriptions
    where user_id = v_actor and normalized_source_url = v_normalized_url
    order by created_at, id
    limit 1;
    if found then
      return jsonb_build_object('row', to_jsonb(v_job), 'duplicate', true, 'duplicateReason', 'SOURCE_URL');
    end if;
    raise;
end;
$$;

revoke all on function public.capture_job_description_v353(jsonb) from public, anon;
grant execute on function public.capture_job_description_v353(jsonb) to authenticated;

comment on function public.capture_job_description_v353(jsonb) is
  'Atomically deduplicates and captures one caller-owned Job Description in a single database round trip.';
