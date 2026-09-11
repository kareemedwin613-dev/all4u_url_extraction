-- One model call per pair. Keep score weights, hashes, historical scores and
-- ticket scope unchanged. facts-v1 remains the existing snapshot/cache namespace;
-- scoringMode negotiates the transport change without forcing mass rescoring.
set local lock_timeout = '3s';

create function public.application_match_direct_sources(a public.application_match_assessments)
returns jsonb language sql stable set search_path=public,pg_temp as $$
  select jsonb_build_object('scoringMode','direct-v1','jdSource',j.source,'resumeSource',r.source)
  from public.application_match_documents j,public.application_match_documents r
  where j.id=a.jd_document_id and r.id=a.resume_document_id
$$;

-- Only numeric integrity is a rejection condition. Optional explanation text is
-- normalized, not a reason to reject an otherwise valid score or call AI again.
create function public.normalize_application_match_score_result(p_result jsonb)
returns jsonb language plpgsql immutable set search_path=public,pg_temp as $$
declare k text; e jsonb; v jsonb; components jsonb:='{}'; n integer:=0;
begin
  if jsonb_typeof(p_result) is distinct from 'object'
    or jsonb_typeof(p_result->'sufficient') is distinct from 'boolean'
    or jsonb_typeof(p_result->'components') is distinct from 'object' then
    raise exception 'MATCH_INVALID_RESULT: A sufficiency flag and numeric components are required.';
  end if;
  for k in select unnest(array['requiredSkills','preferredSkills','responsibilities','seniority','domain']) loop
    e:=p_result->'components'->k; v:=e->'rating';
    if v is null then raise exception 'MATCH_INVALID_RESULT: Missing rating.'; end if;
    if v<>'null'::jsonb then
      if jsonb_typeof(v) is distinct from 'number' then raise exception 'MATCH_INVALID_RESULT: Ratings must be numbers.'; end if;
      if (v#>>'{}')::numeric not between 0 and 100 or (v#>>'{}')::numeric<>trunc((v#>>'{}')::numeric)
        or p_result->>'sufficient'='false' then raise exception 'MATCH_INVALID_RESULT: Invalid numeric rating.'; end if;
      n:=n+1;
    end if;
    components:=components||jsonb_build_object(k,jsonb_build_object('rating',v,'reason',
      case when jsonb_typeof(e->'reason')='string' then left(e->>'reason',500) else '' end));
  end loop;
  if p_result->>'sufficient'='true' and n=0 then raise exception 'MATCH_INVALID_RESULT: No assessed dimensions.'; end if;
  return jsonb_build_object('sufficient',p_result->'sufficient','components',components,'missingRequirements','[]'::jsonb,
    'summary',case when jsonb_typeof(p_result->'summary')='string' then left(p_result->>'summary',500) else '' end);
end $$;

create or replace function public.complete_application_match(p_id uuid,p_lease_token uuid,p_result jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.application_match_assessments; s public.application_match_settings; jh text; rh text; score_value integer; value jsonb;
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
  value:=public.normalize_application_match_score_result(p_result);
  score_value:=public.calculate_application_match_score(value);
  update public.application_match_assessments set status=case when score_value is null then 'INSUFFICIENT_DATA' else 'COMPLETED' end,
    score=score_value,result=value,completed_at=now(),lease_token=null,lease_expires_at=null where id=a.id;
  return jsonb_build_object('status',case when score_value is null then 'INSUFFICIENT_DATA' else 'COMPLETED' end,'score',score_value);
end $$;

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
    'jdDocumentId',a.jd_document_id,'resumeDocumentId',a.resume_document_id,'attempt',a.attempt_count,'asOf',current_date)
    ||public.application_match_direct_sources(a);
end $$;

create or replace function public.application_match_runner_call(p_ticket text,p_operation text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.application_match_runner_tickets; a public.application_match_assessments;
  item public.application_match_runner_items; value jsonb; pending integer; failed integer; retry_at timestamptz;
begin
  t:=public.assert_application_match_ticket(p_ticket,p_operation='claim');
  if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>170000 then
    raise exception 'MATCH_INVALID_REQUEST: Invalid runner payload.';
  end if;
  if p_operation='claim' then
    if t.status='ISSUED' then
      update public.application_match_runner_tickets set status='CLAIMED',run_expires_at=now()+interval '8 hours'
        where id=t.id returning * into t;
    end if;
    return jsonb_build_object('ticketId',t.id,'modelId',t.model_id,'rubricVersion',t.rubric_version,
      'extractorVersion',t.extractor_version,'runExpiresAt',t.run_expires_at,'scoringMode','direct-v1');
  elsif p_operation='next' then
    if p_payload->>'modelId' is distinct from t.model_id or p_payload->>'rubricVersion' is distinct from t.rubric_version
      or p_payload->>'extractorVersion' is distinct from t.extractor_version or p_payload->>'scoringMode' is distinct from 'direct-v1' then
      raise exception 'MATCH_WORKER_VERSION_MISMATCH: Update the local worker to single-pass scoring.';
    end if;
    if t.status='COMPLETED' then
      select count(*) into failed from public.application_match_runner_items i
        join public.application_match_assessments x on x.id=i.assessment_id
        where i.ticket_id=t.id and x.status in('FAILED','STALE');
      return jsonb_build_object('state','COMPLETED','pendingCount',0,'failedCount',failed);
    end if;
    update public.application_match_assessments x set status='FAILED',error_code='LEASE_EXPIRED',lease_token=null,lease_expires_at=null
      from public.application_match_runner_items i where i.ticket_id=t.id and x.id=i.assessment_id
        and x.status='PROCESSING' and x.lease_expires_at<=now() and x.attempt_count>=3;
    update public.application_match_assessments x set status='STALE',error_code='SOURCE_CHANGED',lease_token=null,lease_expires_at=null
      from public.application_match_runner_items i where i.ticket_id=t.id and x.id=i.assessment_id
        and (x.status='PENDING' or (x.status='PROCESSING' and x.lease_expires_at<=now()))
        and (not exists(select 1 from public.job_descriptions j where j.id=x.job_description_id and j.matching_hash=x.jd_hash)
          or not exists(select 1 from public.resumes r where r.id=x.resume_id and r.matching_hash=x.resume_hash)
          or public.application_match_eligibility(x.job_description_id,x.resume_id)->>'exclusionCode' not in('MATCH_PENDING','MATCH_PROCESSING'));
    select x.* into a from public.application_match_assessments x
      join public.application_match_runner_items i on i.assessment_id=x.id and i.ticket_id=t.id
      where x.attempt_count<3 and ((x.status='PENDING' and x.next_attempt_at<=now()) or (x.status='PROCESSING' and x.lease_expires_at<=now()))
      order by x.next_attempt_at,x.created_at,x.id for update of x skip locked limit 1;
    if not found then
      select count(*) filter(where x.status in('PENDING','PROCESSING')),count(*) filter(where x.status in('FAILED','STALE')),
        min(case when x.status='PENDING' then x.next_attempt_at when x.status='PROCESSING' then x.lease_expires_at end)
        into pending,failed,retry_at from public.application_match_runner_items i
        join public.application_match_assessments x on x.id=i.assessment_id where i.ticket_id=t.id;
      if pending=0 then update public.application_match_runner_tickets set status='COMPLETED' where id=t.id; end if;
      return jsonb_build_object('state',case when pending=0 then 'COMPLETED' else 'WAITING' end,'pendingCount',pending,'failedCount',failed,
        'retryAfterSeconds',greatest(5,least(60,coalesce(ceil(extract(epoch from retry_at-now()))::integer,5))));
    end if;
    update public.application_match_assessments set status='PROCESSING',attempt_count=attempt_count+1,
      lease_token=gen_random_uuid(),lease_expires_at=now()+interval '5 minutes',error_code=null where id=a.id returning * into a;
    update public.application_match_runner_items set lease_token=a.lease_token where ticket_id=t.id and assessment_id=a.id;
    return jsonb_build_object('state','JOB','id',a.id,'leaseToken',a.lease_token,'modelId',a.model_id,'rubricVersion',a.rubric_version,
      'extractorVersion',a.extractor_version,'jdDocumentId',a.jd_document_id,'resumeDocumentId',a.resume_document_id,'attempt',a.attempt_count,'asOf',current_date)
      ||public.application_match_direct_sources(a);
  end if;
  if p_operation in('document','document-result') then
    raise exception 'MATCH_WORKER_VERSION_MISMATCH: Separate extraction is retired. Update the local worker.';
  end if;
  if p_operation not in('result','failure') then raise exception 'MATCH_INVALID_REQUEST: Unknown runner operation.'; end if;
  select * into item from public.application_match_runner_items where ticket_id=t.id and assessment_id=(p_payload->>'jobId')::uuid;
  if not found or item.lease_token is null or item.lease_token is distinct from (p_payload->>'leaseToken')::uuid then
    raise exception 'MATCH_LEASE_EXPIRED: This ticket does not own the job lease.';
  end if;
  select * into a from public.application_match_assessments where id=item.assessment_id;
  if p_operation='result' and a.status in('COMPLETED','INSUFFICIENT_DATA') then
    value:=public.normalize_application_match_score_result(p_payload->'result');
    if a.result=value then return jsonb_build_object('status',a.status,'score',a.score); end if;
  end if;
  if a.status<>'PROCESSING' or a.lease_token is distinct from item.lease_token or a.lease_expires_at<=now() then
    raise exception 'MATCH_LEASE_EXPIRED: The job lease expired or changed.';
  end if;
  if p_operation='result' then
    return public.complete_application_match(a.id,a.lease_token,p_payload->'result');
  end if;
  if coalesce(p_payload->>'code','')!~'^[A-Z][A-Z0-9_]{0,79}$' or jsonb_typeof(p_payload->'retryable') is distinct from 'boolean' then
    raise exception 'MATCH_INVALID_REQUEST: Invalid failure report.';
  end if;
  return to_jsonb(public.fail_application_match(a.id,a.lease_token,p_payload->>'code',(p_payload->>'retryable')::boolean,
    coalesce((p_payload->>'retryAfterSeconds')::integer,30)));
end $$;

revoke all on function public.application_match_direct_sources(public.application_match_assessments),
  public.normalize_application_match_score_result(jsonb) from public,anon,authenticated;
revoke all on function public.application_match_runner_call(text,text,jsonb) from public,authenticated;
grant execute on function public.application_match_runner_call(text,text,jsonb) to anon;
notify pgrst,'reload schema';
