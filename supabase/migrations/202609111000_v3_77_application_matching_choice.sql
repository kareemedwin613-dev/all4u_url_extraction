-- Per-creation choice, never a global bypass. Existing score callers stay SCORE.
-- Historical rows remain unchanged; new rows record the selected method.
set local lock_timeout = '3s';
alter table public.applications add column matching_mode text check (matching_mode in ('SCORE','CATEGORY'));
alter table public.applications alter column matching_mode set default 'SCORE';
alter table public.application_creation_batches add column matching_mode text check (matching_mode in ('SCORE','CATEGORY'));
alter table public.application_creation_batches alter column matching_mode set default 'SCORE';

create function public.application_category_candidate_v377(p_job_id uuid,p_resume_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists (
    select 1 from public.job_descriptions j
    join public.categories c on c.id=j.category_id and c.active and c.parent_id is null
    join public.resume_tech_stacks s on s.primary_category_id=c.id and s.resume_id=p_resume_id
    where j.id=p_job_id and (coalesce(c.slug,'')<>'software-engineering' or j.subcategory_id is null or s.subcategory_id=j.subcategory_id)
  )
$$;

-- Restores v3.68: any shared primary, plus the JD's subcategory for Software Engineering.
-- Does not read assessments, require a configured model or invent a passing score.
create function public.application_category_eligibility_v377(p_job_id uuid,p_resume_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare j public.job_descriptions; r public.resumes; existing_id uuid; code text; reason text;
begin
  select * into j from public.job_descriptions where id=p_job_id;
  select * into r from public.resumes where id=p_resume_id;
  select a.id into existing_id from public.applications a join public.resumes ar on ar.id=a.resume_id
    where a.job_description_id=p_job_id and coalesce(ar.parent_resume_id,ar.id)=coalesce(r.parent_resume_id,r.id) limit 1;
  if j.id is null then code:='MISSING_JD'; reason:='The job description is unavailable.';
  elsif r.id is null then code:='MISSING_RESUME'; reason:='The Resume is unavailable.';
  elsif existing_id is not null then code:='EXISTING_APPLICATION'; reason:='Application already exists for this original Resume family.';
  elsif j.status<>'ACTIVE' then code:='INACTIVE_JD'; reason:='The job description is archived.';
  elsif j.review_status<>'APPROVED' then code:='UNAPPROVED_JD'; reason:='The job description must be approved.';
  elsif r.status<>'ACTIVE' then code:='INACTIVE_RESUME'; reason:='The original Resume is archived.';
  elsif r.resume_type<>'ORIGINAL' then code:='ORIGINAL_RESUME_REQUIRED'; reason:='Select an original Resume.';
  elsif not exists(select 1 from public.categories c where c.id=j.category_id and c.active and c.parent_id is null)
    then code:='MISSING_CATEGORY'; reason:='Assign an active primary category to the JD before matching.';
  elsif not public.application_category_candidate_v377(j.id,r.id)
    then code:='CATEGORY_MISMATCH'; reason:='A shared primary category is required; Software Engineering also requires the JD subcategory when set.';
  elsif exists(select 1 from public.resume_banned_companies b where b.resume_id=r.id
      and b.normalized_company=public.normalize_company_name(j.company))
    then code:='BANNED_COMPANY'; reason:='This Resume bans applications to this company.';
  end if;
  return jsonb_build_object('eligible',code is null,'exclusionCode',code,'exclusionReason',reason,
    'existingApplicationId',existing_id,'matchingMode','CATEGORY','assessmentId',null,'matchStatus','NOT_REQUIRED',
    'matchScore',null,'matchThreshold',null,'matchDetails',null,'matchErrorCode',null);
end $$;

create or replace function public.enforce_application_match()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare gate jsonb; old_family uuid; new_family uuid;
begin
  if tg_op='UPDATE' then
    select coalesce(parent_resume_id,id) into old_family from public.resumes where id=old.resume_id;
    select coalesce(parent_resume_id,id) into new_family from public.resumes where id=new.resume_id;
    if old.job_description_id=new.job_description_id and old_family=new_family then
      new.matching_mode:=old.matching_mode;
      new.match_assessment_id:=old.match_assessment_id; new.match_score:=old.match_score; new.match_threshold:=old.match_threshold;
      return new; -- Replacing an original with its tailored child preserves creation history.
    end if;
  end if;
  new.matching_mode:=coalesce(new.matching_mode,'SCORE');
  if new.matching_mode not in('SCORE','CATEGORY') then raise exception 'MATCH_INVALID_REQUEST: Select a matching method.'; end if;
  if new.matching_mode='SCORE' then perform 1 from public.application_match_settings where singleton for share; end if;
  perform 1 from public.job_descriptions where id=new.job_description_id for update;
  perform 1 from public.resumes where id=new.resume_id for share;
  if new.matching_mode='CATEGORY' then
    perform public.assert_application_manager();
    gate:=public.application_category_eligibility_v377(new.job_description_id,new.resume_id);
  else
    gate:=public.application_match_eligibility(new.job_description_id,new.resume_id);
  end if;
  if not (gate->>'eligible')::boolean then
    raise exception '%: %',gate->>'exclusionCode',gate->>'exclusionReason' using errcode='P0001';
  end if;
  new.match_assessment_id:=(gate->>'assessmentId')::uuid;
  new.match_score:=(gate->>'matchScore')::integer;
  new.match_threshold:=(gate->>'matchThreshold')::integer;
  return new;
end $$;
drop trigger applications_00_match_gate on public.applications;
create trigger applications_00_match_gate before insert or update of job_description_id,resume_id,matching_mode,match_assessment_id,match_score,match_threshold
  on public.applications for each row execute function public.enforce_application_match();

-- Category-only entry points below preserve existing assignment, duplicate,
-- batch-outcome and idempotency behavior. Existing RPC signatures are untouched.
create or replace function public.preview_category_application_matches_v377(p_selected_jd_ids uuid[],p_resume_ids uuid[] default null)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare ids uuid[]; result jsonb;
begin
  perform public.assert_application_manager();
  select array_agg(distinct id) into ids from unnest(p_selected_jd_ids) x(id) where id is not null;
  if coalesce(cardinality(ids),0) not between 1 and 1000 then raise exception 'MATCH_INVALID_REQUEST: Select 1 to 1000 JDs.' using errcode='22023'; end if;
  with jobs as materialized (
    select j.*,c.slug as category_slug from public.job_descriptions j
    join public.categories c on c.id=j.category_id and c.active and c.parent_id is null
    where j.id=any(ids) and j.status='ACTIVE' and j.review_status='APPROVED'
  ), candidate_ids as materialized (
    -- Joining the existing category/resume index avoids evaluating every JDxResume
    -- combination. DISTINCT prevents duplicate pairs from multiple subcategories.
    select distinct j.id jid,r.id rid from jobs j
    join public.resume_tech_stacks s on s.primary_category_id=j.category_id
      and (coalesce(j.category_slug,'')<>'software-engineering' or j.subcategory_id is null or s.subcategory_id=j.subcategory_id)
    join public.resumes r on r.id=s.resume_id and r.status='ACTIVE' and r.resume_type='ORIGINAL'
  ), scoped_ids as materialized (
    select * from candidate_ids where p_resume_ids is null or rid=any(p_resume_ids)
  ), pairs as materialized (
    select j.id jid,r.id rid,j.company,j.job_title,j.category_id,r.primary_category_id,r.candidate_name,r.resume_name,r.resume_number
    from scoped_ids p join jobs j on j.id=p.jid join public.resumes r on r.id=p.rid
    order by j.company,j.job_title,j.id,r.candidate_name,r.id limit 5000
  ), evaluated as materialized (
    select p.*,public.application_category_eligibility_v377(p.jid,p.rid) gate from pairs p
  ), rows as (
    select jsonb_build_object('key',jid::text||':'||rid::text,'jobDescriptionId',jid,'resumeId',rid,
      'resumeType','ORIGINAL','resumeNumber',resume_number,'company',company,'jobTitle',job_title,
      'candidateName',candidate_name,'resumeName',resume_name,'jobCategoryId',category_id,
      'resumeCategoryId',primary_category_id,'jobCategoryName',(select name from public.categories where id=category_id),
      'resumeCategoryName',array_to_string(public.resume_primary_category_names(rid),', '),
      'matchSummary',gate->'matchDetails'->>'summary',
      'matchBreakdown',(select jsonb_object_agg(key,value->'rating') from jsonb_each(coalesce(gate->'matchDetails'->'components','{}'::jsonb))),
      'missingRequirements',gate->'matchDetails'->'missingRequirements') || (gate-'matchDetails') row
    from evaluated
  ), invalid as (
    select id from unnest(ids) x(id) where not exists(select 1 from jobs j where j.id=x.id)
  ) select jsonb_build_object(
    'selectedJdCount',cardinality(ids),'validJdCount',(select count(*) from jobs),'invalidJdCount',(select count(*) from invalid),
    'activeResumeCount',(select count(distinct rid) from scoped_ids),'proposedCount',(select count(*) from pairs),
    'totalCombinationCount',(select count(*) from scoped_ids),'truncated',(select count(*)>5000 from scoped_ids),
    'matchingMode','CATEGORY','matchThreshold',null,
    'matchingConfigured',true,
    'eligibleCount',(select count(*) from evaluated where (gate->>'eligible')::boolean),
    'duplicateCount',(select count(*) from evaluated where gate->>'exclusionCode'='EXISTING_APPLICATION'),
    'belowThresholdCount',(select count(*) from evaluated where gate->>'exclusionCode'='BELOW_THRESHOLD'),
    'pendingCount',(select count(*) from evaluated where gate->>'matchStatus' in('PENDING','PROCESSING')),
    'excludedCount',(select count(*) from evaluated where not (gate->>'eligible')::boolean)+(select count(*) from invalid),
    'resumeOptions',(select coalesce(jsonb_agg(jsonb_build_object('resumeId',r.id,'resumeNumber',r.resume_number,'candidateName',r.candidate_name,'resumeName',r.resume_name) order by r.candidate_name,r.id),'[]'::jsonb)
      from public.resumes r where r.id in(select rid from candidate_ids)),
    'combinations',coalesce((select jsonb_agg(row) from rows),'[]'::jsonb),
    'invalidJds',coalesce((select jsonb_agg(jsonb_build_object('jobDescriptionId',i.id,'company',j.company,'jobTitle',j.job_title,
      'code',case when j.id is null then 'MISSING_JD' when j.status<>'ACTIVE' then 'INACTIVE_JD' when j.review_status<>'APPROVED' then 'UNAPPROVED_JD' else 'MISSING_CATEGORY' end,
      'reason',case when j.id is not null and j.status='ACTIVE' and j.review_status='APPROVED'
        then 'Assign an active primary category to the JD before matching.' else 'JD is missing, archived, or not approved.' end))
      from invalid i left join public.job_descriptions j on j.id=i.id),'[]'::jsonb)
  ) into result;
  return result;
end $$;

create or replace function public.list_category_application_resumes_v377(p_job_description_id uuid,p_search text default '',p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_result jsonb;
begin
  perform public.assert_application_manager();
  select coalesce(jsonb_agg(to_jsonb(x) order by x.candidate_name,x.resume_name),'[]'::jsonb) into v_result
  from(
    select r.id,r.resume_number,r.resume_type,r.candidate_name,r.resume_name,r.primary_category_id,r.seniority,true same_category
    from public.resumes r
    where r.status='ACTIVE' and r.resume_type='ORIGINAL'
      and public.application_category_candidate_v377(p_job_description_id,r.id)
      and exists(select 1 from public.job_descriptions j where j.id=p_job_description_id and j.status='ACTIVE' and j.review_status='APPROVED')
      and(coalesce(trim(p_search),'')='' or r.search_vector@@websearch_to_tsquery('english',trim(p_search))
        or(regexp_replace(upper(trim(p_search)),'^(RESUME[- ]?|#)','')~'^[0-9]+$' and r.resume_number::text=regexp_replace(upper(trim(p_search)),'^(RESUME[- ]?|#)','')))
    order by r.candidate_name,r.resume_name limit least(greatest(coalesce(p_limit,100),1),200)
  )x;
  return v_result;
end $$;

create or replace function public.create_category_application_v377(
  p_job_description_id uuid,
  p_resume_id uuid,
  p_assigned_to uuid,
  p_priority text,
  p_due_at timestamptz,
  p_notes text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_application public.applications;
  v_priority text := upper(coalesce(nullif(trim(p_priority), ''), 'NORMAL'));
begin
  perform public.assert_application_manager();
  if not exists (select 1 from public.job_descriptions where id = p_job_description_id) then
    raise exception 'APPLICATION_INVALID_JOB: The selected job description does not exist.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.resumes where id = p_resume_id and status = 'ACTIVE') then
    raise exception 'APPLICATION_INVALID_RESUME: Select an active resume.' using errcode = 'P0001';
  end if;
  if v_priority not in ('LOW', 'NORMAL', 'HIGH', 'URGENT') then
    raise exception 'APPLICATION_INVALID_PRIORITY: Select a valid priority.' using errcode = 'P0001';
  end if;
  if char_length(coalesce(p_notes, '')) > 10000 then
    raise exception 'APPLICATION_INVALID_NOTES: Notes cannot exceed 10000 characters.' using errcode = 'P0001';
  end if;
  perform public.assert_active_applier(p_assigned_to);
  perform public.assert_applier_may_use_resume(p_assigned_to, p_resume_id);

  insert into public.applications (
    job_description_id, resume_id, assigned_to, assigned_by, work_status,
    priority, due_at, notes, created_by, matching_mode
  ) values (
    p_job_description_id, p_resume_id, p_assigned_to,
    case when p_assigned_to is null then null else v_actor end,
    case when p_assigned_to is null then 'UNASSIGNED' else 'ASSIGNED' end,
    v_priority, p_due_at, nullif(trim(coalesce(p_notes, '')), ''), v_actor, 'CATEGORY'
  ) returning * into v_application;

  if p_assigned_to is not null then
    insert into public.application_assignment_history (
      application_id, previous_assignee_id, new_assignee_id, assigned_by, reason
    ) values (v_application.id, null, p_assigned_to, v_actor, 'Initial assignment');
  end if;
  return to_jsonb(v_application);
exception
  when unique_violation then
    raise exception 'APPLICATION_DUPLICATE: An Application already exists for this job description and resume.' using errcode = 'P0001';
end;
$$;

-- Preserve bulk outcomes/idempotency while using the same eligibility rule as single creation.
create or replace function public.create_category_applications_bulk_v377(
  p_combinations jsonb,
  p_batch_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_batch public.application_creation_batches;
  v_name text := nullif(btrim(coalesce(p_batch_name, '')), '');
  v_raw_count integer;
  v_created integer;
  v_duplicates integer;
  v_skipped integer;
  v_failed integer;
  v_requested integer;
  v_selected_jds integer;
  v_status text;
  v_results jsonb;
  v_uuid_pattern constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  perform public.assert_application_manager();

  if p_combinations is null or jsonb_typeof(p_combinations) <> 'array' then
    raise exception 'BULK_INVALID_REQUEST: Application combinations must be an array.' using errcode = '22023';
  end if;
  v_raw_count := jsonb_array_length(p_combinations);
  if v_raw_count = 0 then
    raise exception 'BULK_NO_COMBINATIONS: Select at least one eligible combination.' using errcode = '22023';
  end if;
  if v_raw_count > 5000 then
    raise exception 'BULK_COMBINATION_LIMIT: You can create up to 5,000 Applications in one bulk operation.' using errcode = '22023';
  end if;
  if v_name is not null and char_length(v_name) > 120 then
    raise exception 'BULK_BATCH_NAME_INVALID: Batch name cannot exceed 120 characters.' using errcode = '22023';
  end if;
  v_name := coalesce(v_name, 'Bulk Applications - ' || to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC');

  -- Cast only validated IDs so malformed pairs remain per-row SKIPPED outcomes.
  perform 1 from public.job_descriptions where id in (select case when value->>'job_description_id' ~* v_uuid_pattern
    then (value->>'job_description_id')::uuid end from jsonb_array_elements(p_combinations)) order by id for update;
  perform 1 from public.resumes where id in (select case when value->>'resume_id' ~* v_uuid_pattern
    then (value->>'resume_id')::uuid end from jsonb_array_elements(p_combinations)) order by id for share;

  insert into public.application_creation_batches(name, created_by, matching_mode)
  values (v_name, v_actor, 'CATEGORY')
  returning * into v_batch;

  begin
    with raw as (
      select value, ordinality
      from jsonb_array_elements(p_combinations) with ordinality as input(value, ordinality)
    ), parsed as (
      select ordinality,
        value ->> 'job_description_id' as job_text,
        value ->> 'resume_id' as resume_text,
        case when coalesce(value ->> 'job_description_id', '') ~* v_uuid_pattern then (value ->> 'job_description_id')::uuid end as job_id,
        case when coalesce(value ->> 'resume_id', '') ~* v_uuid_pattern then (value ->> 'resume_id')::uuid end as resume_id
      from raw
    ), deduplicated as (
      select distinct on (coalesce(job_text, ''), coalesce(resume_text, '')) *
      from parsed
      order by coalesce(job_text, ''), coalesce(resume_text, ''), ordinality
    ), validated as (
      select deduplicated.*,
        jobs.id as actual_job_id,
        resumes.id as actual_resume_id,
        jobs.company,
        jobs.job_title,
        jobs.category_id as job_category_id,
        resumes.candidate_name,
        resumes.resume_name,
        resumes.primary_category_id as resume_category_id,
        resumes.status as resume_status,
        existing.id as existing_application_id,
        case
          when deduplicated.job_id is null or deduplicated.resume_id is null then 'INVALID_IDENTIFIER'
          when jobs.id is null then 'MISSING_JD'
          when resumes.id is null then 'MISSING_RESUME'
          else public.application_category_eligibility_v377(deduplicated.job_id, deduplicated.resume_id)->>'exclusionCode'
        end as exclusion_code
      from deduplicated
      left join public.job_descriptions jobs on jobs.id = deduplicated.job_id
      left join public.resumes resumes on resumes.id = deduplicated.resume_id
      left join public.applications existing
        on existing.job_description_id = deduplicated.job_id
       and coalesce((select parent_resume_id from public.resumes where id=existing.resume_id),existing.resume_id) = deduplicated.resume_id
    ), created as (
      insert into public.applications(
        job_description_id, resume_id, assigned_to, assigned_by,
        work_status, application_status, priority, created_by, creation_batch_id, matching_mode
      )
      select job_id, resume_id, null, null, 'UNASSIGNED', 'NOT_APPLIED', 'NORMAL', v_actor, v_batch.id, 'CATEGORY'
      from validated
      where exclusion_code is null
      on conflict (job_description_id, resume_id) do nothing
      returning id, job_description_id, resume_id
    )
    insert into public.application_creation_batch_results(
      batch_id, pair_key, requested_job_description_id, requested_resume_id,
      job_description_id, resume_id, application_id,
      company, job_title, candidate_name, resume_name, outcome, code, message
    )
    select v_batch.id,
      case when validated.job_id is not null and validated.resume_id is not null
        then concat(validated.job_id, ':', validated.resume_id)
        else concat('invalid:', validated.ordinality)
      end,
      validated.job_text,
      validated.resume_text,
      validated.actual_job_id,
      validated.actual_resume_id,
      coalesce(created.id, validated.existing_application_id),
      validated.company,
      validated.job_title,
      validated.candidate_name,
      validated.resume_name,
      case
        when validated.exclusion_code = 'EXISTING_APPLICATION' then 'DUPLICATE'
        when validated.exclusion_code is not null then 'SKIPPED'
        when created.id is not null then 'CREATED'
        else 'DUPLICATE'
      end,
      case
        when validated.exclusion_code = 'EXISTING_APPLICATION' then 'EXISTING_APPLICATION'
        when validated.exclusion_code is not null then validated.exclusion_code
        when created.id is null then 'CONCURRENT_DUPLICATE'
      end,
      case
        when validated.exclusion_code = 'INVALID_IDENTIFIER' then 'The JD or Resume identifier is invalid.'
        when validated.exclusion_code = 'MISSING_JD' then 'The job description no longer exists.'
        when validated.exclusion_code = 'MISSING_RESUME' then 'The Resume no longer exists.'
        when validated.exclusion_code = 'MISSING_CATEGORY' then 'The job description has no valid primary category.'
        when validated.exclusion_code = 'INACTIVE_RESUME' then 'The Resume is no longer active.'
        when validated.exclusion_code = 'BANNED_COMPANY' then 'This Resume bans applications to this company.'
        when validated.exclusion_code = 'EXISTING_APPLICATION' then 'Application already exists.'
        when validated.exclusion_code is not null then public.application_category_eligibility_v377(validated.job_id,validated.resume_id)->>'exclusionReason'
        when created.id is null then 'Application was created by another request first.'
        else 'Application created.'
      end
    from validated
    left join created
      on created.job_description_id = validated.job_id
     and created.resume_id = validated.resume_id;
  exception when others then
    insert into public.application_creation_batch_results(
      batch_id, pair_key, requested_job_description_id, requested_resume_id,
      job_description_id, resume_id, outcome, code, message
    )
    select v_batch.id,
      concat('failed:', ordinality),
      value ->> 'job_description_id',
      value ->> 'resume_id',
      null,
      null,
      'FAILED',
      'BULK_CREATE_FAILED',
      'The server could not create this Application.'
    from jsonb_array_elements(p_combinations) with ordinality as input(value, ordinality);
  end;

  select count(*),
    count(distinct requested_job_description_id),
    count(*) filter (where outcome = 'CREATED'),
    count(*) filter (where outcome = 'DUPLICATE'),
    count(*) filter (where outcome = 'SKIPPED'),
    count(*) filter (where outcome = 'FAILED')
  into v_requested, v_selected_jds, v_created, v_duplicates, v_skipped, v_failed
  from public.application_creation_batch_results
  where batch_id = v_batch.id;

  v_status := case
    when v_created = 0 and v_failed > 0 then 'FAILED'
    when v_duplicates > 0 or v_skipped > 0 or v_failed > 0 then 'COMPLETED_WITH_WARNINGS'
    else 'COMPLETED'
  end;

  update public.application_creation_batches set
    selected_jd_count = coalesce(v_selected_jds, 0),
    requested_combination_count = coalesce(v_requested, 0),
    created_application_count = coalesce(v_created, 0),
    duplicate_count = coalesce(v_duplicates, 0),
    skipped_count = coalesce(v_skipped, 0),
    failed_count = coalesce(v_failed, 0),
    status = v_status,
    completed_at = clock_timestamp()
  where id = v_batch.id
  returning * into v_batch;

  select coalesce(jsonb_agg(jsonb_build_object(
    'key', pair_key,
    'jobDescriptionId', coalesce(job_description_id::text, requested_job_description_id),
    'resumeId', coalesce(resume_id::text, requested_resume_id),
    'applicationId', application_id,
    'company', company,
    'jobTitle', job_title,
    'candidateName', candidate_name,
    'resumeName', resume_name,
    'outcome', outcome,
    'code', code,
    'message', message
  ) order by created_at, id), '[]'::jsonb)
  into v_results
  from public.application_creation_batch_results
  where batch_id = v_batch.id;

  return jsonb_build_object(
    'batchId', v_batch.id,
    'matchingMode', 'CATEGORY',
    'batchName', v_batch.name,
    'status', v_batch.status,
    'selectedJdCount', v_batch.selected_jd_count,
    'requestedCount', v_batch.requested_combination_count,
    'createdCount', v_batch.created_application_count,
    'duplicateCount', v_batch.duplicate_count,
    'skippedCount', v_batch.skipped_count,
    'failedCount', v_batch.failed_count,
    'results', v_results
  );
end;
$$;


create or replace function public.create_applications_bulk_api(
  p_combinations jsonb,
  p_batch_name text,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_existing public.application_creation_batches;
  v_result jsonb;
begin
  perform public.assert_application_manager();
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9._:-]{8,200}$' then
    raise exception 'VALIDATION_ERROR: A valid Idempotency-Key is required.' using errcode = '22023';
  end if;
  if p_request_hash is null or p_request_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'VALIDATION_ERROR: A valid request hash is required.' using errcode = '22023';
  end if;

  -- Serializes only retries for this actor/key; unrelated bulk requests remain concurrent.
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text || ':' || p_idempotency_key, 0));
  select * into v_existing
  from public.application_creation_batches
  where created_by = v_actor and idempotency_key = p_idempotency_key;

  if found then
    if v_existing.request_hash <> p_request_hash or coalesce(v_existing.matching_mode,'SCORE')<>'SCORE' then
      raise exception 'IDEMPOTENCY_CONFLICT: This idempotency key was already used with a different request.' using errcode = '23505';
    end if;
    select jsonb_build_object(
      'batchId', v_existing.id, 'batchName', v_existing.name, 'status', v_existing.status,
      'selectedJdCount', v_existing.selected_jd_count,
      'requestedCount', v_existing.requested_combination_count,
      'createdCount', v_existing.created_application_count,
      'duplicateCount', v_existing.duplicate_count,
      'skippedCount', v_existing.skipped_count,
      'failedCount', v_existing.failed_count,
      'replayed', true,
      'results', coalesce((select jsonb_agg(jsonb_build_object(
        'key', r.pair_key,
        'jobDescriptionId', coalesce(r.job_description_id::text, r.requested_job_description_id),
        'resumeId', coalesce(r.resume_id::text, r.requested_resume_id),
        'applicationId', r.application_id, 'company', r.company, 'jobTitle', r.job_title,
        'candidateName', r.candidate_name, 'resumeName', r.resume_name,
        'outcome', r.outcome, 'code', r.code, 'message', r.message
      ) order by r.created_at, r.id)
      from public.application_creation_batch_results r where r.batch_id = v_existing.id), '[]'::jsonb)
    ) into v_result;
    return v_result;
  end if;

  v_result := public.create_applications_bulk(p_combinations, p_batch_name);
  update public.application_creation_batches
  set idempotency_key = p_idempotency_key, request_hash = p_request_hash
  where id = (v_result ->> 'batchId')::uuid and created_by = v_actor;
  return v_result || jsonb_build_object('replayed', false);
end;
$$;

create or replace function public.create_category_applications_bulk_api_v377(
  p_combinations jsonb,
  p_batch_name text,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_existing public.application_creation_batches;
  v_result jsonb;
begin
  perform public.assert_application_manager();
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9._:-]{8,200}$' then
    raise exception 'VALIDATION_ERROR: A valid Idempotency-Key is required.' using errcode = '22023';
  end if;
  if p_request_hash is null or p_request_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'VALIDATION_ERROR: A valid request hash is required.' using errcode = '22023';
  end if;

  -- Serializes only retries for this actor/key; unrelated bulk requests remain concurrent.
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text || ':' || p_idempotency_key, 0));
  select * into v_existing
  from public.application_creation_batches
  where created_by = v_actor and idempotency_key = p_idempotency_key;

  if found then
    if v_existing.request_hash <> p_request_hash or v_existing.matching_mode is distinct from 'CATEGORY' then
      raise exception 'IDEMPOTENCY_CONFLICT: This idempotency key was already used with a different request.' using errcode = '23505';
    end if;
    select jsonb_build_object(
      'batchId', v_existing.id, 'batchName', v_existing.name, 'status', v_existing.status,
      'selectedJdCount', v_existing.selected_jd_count,
      'requestedCount', v_existing.requested_combination_count,
      'createdCount', v_existing.created_application_count,
      'duplicateCount', v_existing.duplicate_count,
      'skippedCount', v_existing.skipped_count,
      'failedCount', v_existing.failed_count,
      'matchingMode','CATEGORY','replayed', true,
      'results', coalesce((select jsonb_agg(jsonb_build_object(
        'key', r.pair_key,
        'jobDescriptionId', coalesce(r.job_description_id::text, r.requested_job_description_id),
        'resumeId', coalesce(r.resume_id::text, r.requested_resume_id),
        'applicationId', r.application_id, 'company', r.company, 'jobTitle', r.job_title,
        'candidateName', r.candidate_name, 'resumeName', r.resume_name,
        'outcome', r.outcome, 'code', r.code, 'message', r.message
      ) order by r.created_at, r.id)
      from public.application_creation_batch_results r where r.batch_id = v_existing.id), '[]'::jsonb)
    ) into v_result;
    return v_result;
  end if;

  v_result := public.create_category_applications_bulk_v377(p_combinations, p_batch_name);
  update public.application_creation_batches
  set idempotency_key = p_idempotency_key, request_hash = p_request_hash
  where id = (v_result ->> 'batchId')::uuid and created_by = v_actor;
  return v_result || jsonb_build_object('replayed', false);
end;
$$;


revoke all on function public.application_category_candidate_v377(uuid,uuid),
  public.application_category_eligibility_v377(uuid,uuid),public.enforce_application_match(),
  public.create_category_applications_bulk_v377(jsonb,text) from public,anon,authenticated;
revoke all on function public.preview_category_application_matches_v377(uuid[],uuid[]),
  public.list_category_application_resumes_v377(uuid,text,integer),
  public.create_category_application_v377(uuid,uuid,uuid,text,timestamptz,text),
  public.create_category_applications_bulk_api_v377(jsonb,text,text,text) from public,anon;
grant execute on function public.preview_category_application_matches_v377(uuid[],uuid[]),
  public.list_category_application_resumes_v377(uuid,text,integer),
  public.create_category_application_v377(uuid,uuid,uuid,text,timestamptz,text),
  public.create_category_applications_bulk_api_v377(jsonb,text,text,text) to authenticated;
notify pgrst,'reload schema';
