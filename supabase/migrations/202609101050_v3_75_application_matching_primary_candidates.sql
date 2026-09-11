-- Primary category selects the candidate pool; AI scores only those pairs.
-- Use ANY primary on the original Resume's tech stacks. Subcategories never
-- filter candidates. Preserve historical Applications, scores and source hashes.
create function public.application_match_category_matches(p_job_id uuid,p_resume_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists (
    select 1 from public.job_descriptions j
    join public.categories c on c.id=j.category_id and c.active and c.parent_id is null
    join public.resume_tech_stacks s on s.primary_category_id=c.id and s.resume_id=p_resume_id
    where j.id=p_job_id
  )
$$;
revoke all on function public.application_match_category_matches(uuid,uuid) from public,anon,authenticated;

create or replace function public.application_match_eligibility(p_job_id uuid,p_resume_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare j public.job_descriptions; r public.resumes; s public.application_match_settings;
  a public.application_match_assessments; existing_id uuid; code text; reason text; state text;
begin
  select * into s from public.application_match_settings where singleton;
  select * into j from public.job_descriptions where id=p_job_id;
  select * into r from public.resumes where id=p_resume_id;
  select x.id into existing_id from public.applications x join public.resumes xr on xr.id=x.resume_id
    where x.job_description_id=p_job_id and coalesce(xr.parent_resume_id,xr.id)=coalesce(r.parent_resume_id,r.id) limit 1;
  select * into a from public.application_match_assessments x where x.job_description_id=p_job_id and x.resume_id=p_resume_id
    and x.jd_hash=j.matching_hash and x.resume_hash=r.matching_hash and x.rubric_version=s.rubric_version
    and x.extractor_version=s.extractor_version and x.model_id=s.model_id;
  state:=coalesce(a.status,case when exists(select 1 from public.application_match_assessments x
    where x.job_description_id=p_job_id and x.resume_id=p_resume_id) then 'STALE' else 'NOT_ASSESSED' end);
  if j.id is null then code:='MISSING_JD'; reason:='The job description is unavailable.';
  elsif r.id is null then code:='MISSING_RESUME'; reason:='The Resume is unavailable.';
  elsif existing_id is not null then code:='EXISTING_APPLICATION'; reason:='Application already exists for this original Resume family.';
  elsif j.status<>'ACTIVE' then code:='INACTIVE_JD'; reason:='The job description is archived.';
  elsif j.review_status<>'APPROVED' then code:='UNAPPROVED_JD'; reason:='The job description must be approved.';
  elsif r.status<>'ACTIVE' then code:='INACTIVE_RESUME'; reason:='The original Resume is archived.';
  elsif r.resume_type<>'ORIGINAL' then code:='ORIGINAL_RESUME_REQUIRED'; reason:='Select an original Resume.';
  elsif not exists(select 1 from public.categories c where c.id=j.category_id and c.active and c.parent_id is null)
    then code:='MISSING_CATEGORY'; reason:='Assign an active primary category to the JD before matching.';
  elsif not public.application_match_category_matches(j.id,r.id)
    then code:='PRIMARY_CATEGORY_MISMATCH'; reason:='The JD must share a primary category with the original Resume; subcategories are ignored.';
  elsif exists(select 1 from public.resume_banned_companies b where b.resume_id=r.id
      and b.normalized_company=public.normalize_company_name(j.company)) then code:='BANNED_COMPANY'; reason:='This Resume bans applications to this company.';
  elsif s.model_id='UNCONFIGURED' then code:='MATCHING_NOT_CONFIGURED'; reason:='Configure the scoring worker and model before scoring.';
  elsif state<>'COMPLETED' then code:='MATCH_'||state; reason:=case state
    when 'NOT_ASSESSED' then 'Request a match score.' when 'STALE' then 'Source or scoring configuration changed; rescore this pair.'
    when 'FAILED' then 'Scoring failed; retry this pair.' when 'INSUFFICIENT_DATA' then 'Add substantive JD requirements and original Resume experience, then rescore.'
    else 'Scoring is pending or in progress.' end;
  elsif a.score<s.threshold then code:='BELOW_THRESHOLD'; reason:='Match score is below the current threshold.';
  end if;
  return jsonb_build_object('eligible',code is null,'exclusionCode',code,'exclusionReason',reason,
    'existingApplicationId',existing_id,'assessmentId',a.id,'matchStatus',state,'matchScore',a.score,
    'matchThreshold',s.threshold,'matchDetails',a.result,'matchErrorCode',a.error_code);
end $$;

create or replace function public.preview_application_matches(p_selected_jd_ids uuid[],p_resume_ids uuid[] default null)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare ids uuid[]; result jsonb;
begin
  perform public.assert_application_manager();
  select array_agg(distinct id) into ids from unnest(p_selected_jd_ids) x(id) where id is not null;
  if coalesce(cardinality(ids),0) not between 1 and 1000 then raise exception 'MATCH_INVALID_REQUEST: Select 1 to 1000 JDs.' using errcode='22023'; end if;
  with jobs as materialized (
    select j.* from public.job_descriptions j
    join public.categories c on c.id=j.category_id and c.active and c.parent_id is null
    where j.id=any(ids) and j.status='ACTIVE' and j.review_status='APPROVED'
  ), candidate_ids as materialized (
    -- Joining the existing category/resume index avoids evaluating every JDxResume
    -- combination. DISTINCT prevents duplicate pairs from multiple subcategories.
    select distinct j.id jid,r.id rid from jobs j
    join public.resume_tech_stacks s on s.primary_category_id=j.category_id
    join public.resumes r on r.id=s.resume_id and r.status='ACTIVE' and r.resume_type='ORIGINAL'
  ), scoped_ids as materialized (
    select * from candidate_ids where p_resume_ids is null or rid=any(p_resume_ids)
  ), pairs as materialized (
    select j.id jid,r.id rid,j.company,j.job_title,j.category_id,r.primary_category_id,r.candidate_name,r.resume_name,r.resume_number
    from scoped_ids p join jobs j on j.id=p.jid join public.resumes r on r.id=p.rid
    order by j.company,j.job_title,j.id,r.candidate_name,r.id limit 5000
  ), evaluated as materialized (
    select p.*,public.application_match_eligibility(p.jid,p.rid) gate from pairs p
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
    'matchThreshold',(select threshold from public.application_match_settings where singleton),
    'matchingConfigured',(select model_id<>'UNCONFIGURED' from public.application_match_settings where singleton),
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
comment on function public.preview_bulk_applications(uuid[]) is
  'Primary-category candidate pool, cached AI scores and threshold eligibility; subcategories do not filter candidates.';

create or replace function public.request_application_matches(p_combinations jsonb,p_retry_failed boolean default false)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.application_match_settings; requested integer; accepted integer;
begin
  perform public.assert_application_manager();
  if jsonb_typeof(p_combinations) is distinct from 'array' or jsonb_array_length(p_combinations) not between 1 and 5000 then
    raise exception 'MATCH_INVALID_REQUEST: Select between 1 and 5000 pairs.' using errcode='22023';
  end if;
  select * into s from public.application_match_settings where singleton for share;
  if s.model_id='UNCONFIGURED' then raise exception 'MATCHING_NOT_CONFIGURED: Configure the scoring worker and model first.' using errcode='22023'; end if;
  perform 1 from public.job_descriptions j where j.id in(select x.job_description_id from jsonb_to_recordset(p_combinations) x(job_description_id uuid)) order by j.id for share;
  perform 1 from public.resumes r where r.id in(select x.resume_id from jsonb_to_recordset(p_combinations) x(resume_id uuid)) order by r.id for share;
  with pairs as (select distinct x.job_description_id,x.resume_id from jsonb_to_recordset(p_combinations) x(job_description_id uuid,resume_id uuid)),
  candidates as (select p.* from pairs p join public.job_descriptions j on j.id=p.job_description_id join public.resumes r on r.id=p.resume_id
    where j.status='ACTIVE' and j.review_status='APPROVED' and r.status='ACTIVE' and r.resume_type='ORIGINAL'
      and public.application_match_category_matches(j.id,r.id)
      and not exists(select 1 from public.resume_banned_companies b where b.resume_id=r.id and b.normalized_company=public.normalize_company_name(j.company))
      and not exists(select 1 from public.applications a join public.resumes ar on ar.id=a.resume_id where a.job_description_id=j.id and coalesce(ar.parent_resume_id,ar.id)=r.id)),
  sources as (
    select distinct 'JD' as kind,j.id,j.matching_hash as hash,public.application_match_job_source(j) as source from candidates c join public.job_descriptions j on j.id=c.job_description_id
    union all
    select distinct 'RESUME',r.id,r.matching_hash,public.application_match_resume_source(r) from candidates c join public.resumes r on r.id=c.resume_id
  ) insert into public.application_match_documents(source_kind,source_id,source_hash,extractor_version,model_id,source)
    select kind,id,hash,s.extractor_version,s.model_id,source from sources
    on conflict(source_kind,source_id,source_hash,extractor_version,model_id) do nothing;
  with pairs as (select distinct x.job_description_id,x.resume_id from jsonb_to_recordset(p_combinations) x(job_description_id uuid,resume_id uuid))
  insert into public.application_match_assessments(job_description_id,resume_id,jd_hash,resume_hash,jd_document_id,resume_document_id,rubric_version,extractor_version,model_id,requested_by)
  select j.id,r.id,j.matching_hash,r.matching_hash,jd.id,rd.id,s.rubric_version,s.extractor_version,s.model_id,auth.uid()
    from pairs p join public.job_descriptions j on j.id=p.job_description_id join public.resumes r on r.id=p.resume_id
    join public.application_match_documents jd on jd.source_kind='JD' and jd.source_id=j.id and jd.source_hash=j.matching_hash and jd.extractor_version=s.extractor_version and jd.model_id=s.model_id
    join public.application_match_documents rd on rd.source_kind='RESUME' and rd.source_id=r.id and rd.source_hash=r.matching_hash and rd.extractor_version=s.extractor_version and rd.model_id=s.model_id
    where (public.application_match_eligibility(j.id,r.id)->>'exclusionCode') in('MATCH_NOT_ASSESSED','MATCH_STALE','MATCH_FAILED','MATCH_PENDING','MATCH_PROCESSING')
  on conflict(job_description_id,resume_id,jd_hash,resume_hash,rubric_version,extractor_version,model_id) do update
    set status='PENDING',attempt_count=0,next_attempt_at=now(),error_code=null,lease_token=null,lease_expires_at=null
    where application_match_assessments.status='STALE'
      or (p_retry_failed and application_match_assessments.status='FAILED');
  get diagnostics accepted=row_count;
  select count(*) into requested from (select distinct x.job_description_id,x.resume_id from jsonb_to_recordset(p_combinations) x(job_description_id uuid,resume_id uuid)) p;
  return jsonb_build_object('requestedCount',requested,'queuedCount',accepted,'reusedOrSkippedCount',requested-accepted,'threshold',s.threshold);
end $$;

-- Ticket claims already recheck application_match_eligibility before taking a
-- queued pair. Keep the service-only legacy worker equally category-scoped.
create or replace function public.claim_application_match(p_model_id text,p_rubric_version text default 'match-v1',p_extractor_version text default 'facts-v1')
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.application_match_assessments; s public.application_match_settings;
begin
  select * into s from public.application_match_settings where singleton;
  if p_model_id is distinct from s.model_id then raise exception 'MATCH_MODEL_MISMATCH: Worker model differs from scoring configuration.'; end if;
  if p_rubric_version is distinct from s.rubric_version or p_extractor_version is distinct from s.extractor_version then
    raise exception 'MATCH_WORKER_VERSION_MISMATCH: Deploy the matching worker version before queuing new work.';
  end if;
  update public.application_match_assessments set status='FAILED',error_code='LEASE_EXPIRED',lease_token=null,lease_expires_at=null
    where status='PROCESSING' and lease_expires_at<now() and attempt_count>=3;
  update public.application_match_assessments queued set status='STALE',error_code='SOURCE_CHANGED',lease_token=null,lease_expires_at=null
    where (queued.status='PENDING' or (queued.status='PROCESSING' and queued.lease_expires_at<now()))
      and (queued.model_id<>s.model_id or queued.rubric_version<>s.rubric_version or queued.extractor_version<>s.extractor_version
        or not exists(select 1 from public.job_descriptions j where j.id=queued.job_description_id and j.matching_hash=queued.jd_hash)
        or not exists(select 1 from public.resumes r where r.id=queued.resume_id and r.matching_hash=queued.resume_hash)
        or not public.application_match_category_matches(queued.job_description_id,queued.resume_id));
  select * into a from public.application_match_assessments x
    where x.model_id=s.model_id and x.rubric_version=s.rubric_version and x.extractor_version=s.extractor_version
      and public.application_match_category_matches(x.job_description_id,x.resume_id)
      and x.attempt_count<3 and ((x.status='PENDING' and x.next_attempt_at<=now()) or (x.status='PROCESSING' and x.lease_expires_at<now()))
    order by x.next_attempt_at,x.created_at,x.id for update skip locked limit 1;
  if not found then return null; end if;
  update public.application_match_assessments set status='PROCESSING',attempt_count=attempt_count+1,
    lease_token=gen_random_uuid(),lease_expires_at=now()+interval '5 minutes',error_code=null where id=a.id returning * into a;
  return jsonb_build_object('id',a.id,'leaseToken',a.lease_token,'modelId',a.model_id,'rubricVersion',a.rubric_version,'extractorVersion',a.extractor_version,
    'jdDocumentId',a.jd_document_id,'resumeDocumentId',a.resume_document_id,'attempt',a.attempt_count,'asOf',current_date);
end $$;

create or replace function public.complete_application_match(p_id uuid,p_lease_token uuid,p_result jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.application_match_assessments; s public.application_match_settings; jh text; rh text; score_value integer;
begin
  select * into s from public.application_match_settings where singleton for share;
  select * into a from public.application_match_assessments where id=p_id;
  select matching_hash into jh from public.job_descriptions where id=a.job_description_id for share;
  select matching_hash into rh from public.resumes where id=a.resume_id for share;
  select * into a from public.application_match_assessments where id=p_id for update;
  if not found or a.status<>'PROCESSING' or a.lease_token is distinct from p_lease_token or a.lease_expires_at<=now() then
    raise exception 'MATCH_LEASE_EXPIRED: This result no longer owns its lease.';
  end if;
  if jh is distinct from a.jd_hash or rh is distinct from a.resume_hash or s.model_id<>a.model_id
    or s.rubric_version<>a.rubric_version or s.extractor_version<>a.extractor_version
    or not public.application_match_category_matches(a.job_description_id,a.resume_id) then
    update public.application_match_assessments set status='STALE',lease_token=null,lease_expires_at=null,error_code='SOURCE_CHANGED' where id=a.id;
    return jsonb_build_object('status','STALE');
  end if;
  if jsonb_typeof(p_result->'sufficient') is distinct from 'boolean' then raise exception 'MATCH_INVALID_RESULT: Missing sufficiency flag.'; end if;
  score_value:=public.calculate_application_match_score(p_result);
  update public.application_match_assessments set status=case when score_value is null then 'INSUFFICIENT_DATA' else 'COMPLETED' end,
    score=score_value,result=p_result,completed_at=now(),lease_token=null,lease_expires_at=null where id=a.id;
  return jsonb_build_object('status',case when score_value is null then 'INSUFFICIENT_DATA' else 'COMPLETED' end,'score',score_value);
end $$;

create or replace function public.list_application_resumes(p_job_description_id uuid,p_search text default '',p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_result jsonb;
begin
  perform public.assert_application_manager();
  select coalesce(jsonb_agg(to_jsonb(x) order by x.candidate_name,x.resume_name),'[]'::jsonb) into v_result
  from(
    select r.id,r.resume_number,r.resume_type,r.candidate_name,r.resume_name,r.primary_category_id,r.seniority,true same_category
    from public.resumes r
    where r.status='ACTIVE' and r.resume_type='ORIGINAL'
      and public.application_match_category_matches(p_job_description_id,r.id)
      and exists(select 1 from public.job_descriptions j where j.id=p_job_description_id and j.status='ACTIVE' and j.review_status='APPROVED')
      and(coalesce(trim(p_search),'')='' or r.search_vector@@websearch_to_tsquery('english',trim(p_search))
        or(regexp_replace(upper(trim(p_search)),'^(RESUME[- ]?|#)','')~'^[0-9]+$' and r.resume_number::text=regexp_replace(upper(trim(p_search)),'^(RESUME[- ]?|#)','')))
    order by r.candidate_name,r.resume_name limit least(greatest(coalesce(p_limit,100),1),200)
  )x;
  return v_result;
end $$;

-- Preserve both deployed legacy argument-name variants, defaults and dependents.
do $primary_candidate_signature$
declare legacy_arguments text;
begin
  select pg_get_function_arguments(p.oid) into legacy_arguments
    from pg_proc p where p.oid='public.resume_matches_job_for_bulk(uuid,uuid,uuid)'::regprocedure;
  execute format($definition$
    create or replace function public.resume_matches_job_for_bulk(%s)
    returns boolean language sql stable set search_path=public,pg_temp as $body$
      select exists(select 1 from public.resumes r
        join public.categories c on c.id=$2 and c.active and c.parent_id is null
        where r.id=$1 and r.resume_type='ORIGINAL' and r.status='ACTIVE'
          and public.resume_has_primary_category(r.id,c.id))
    $body$;
  $definition$,legacy_arguments);
end
$primary_candidate_signature$;
comment on function public.resume_matches_job_for_bulk(uuid,uuid,uuid) is
  'Active original Resume with any matching active primary category. Third argument is ignored; AI score still gates creation.';

-- Explicitly retain the existing access boundaries after function replacement.
revoke all on function public.application_match_eligibility(uuid,uuid),public.claim_application_match(text,text,text),
  public.complete_application_match(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.claim_application_match(text,text,text),public.complete_application_match(uuid,uuid,jsonb) to service_role;
revoke all on function public.preview_application_matches(uuid[],uuid[]),public.request_application_matches(jsonb,boolean),
  public.list_application_resumes(uuid,text,integer),public.resume_matches_job_for_bulk(uuid,uuid,uuid) from public,anon;
grant execute on function public.preview_application_matches(uuid[],uuid[]),public.request_application_matches(jsonb,boolean),
  public.list_application_resumes(uuid,text,integer),public.resume_matches_job_for_bulk(uuid,uuid,uuid) to authenticated;
