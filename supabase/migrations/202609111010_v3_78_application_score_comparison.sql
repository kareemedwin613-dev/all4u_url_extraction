-- Comparison scoring is explicitly requested for an existing Application. It
-- never replaces its original eligibility score or permits duplicate creation.
set local lock_timeout = '3s';
create table public.application_match_comparison_pairs (
  assessment_id uuid primary key references public.application_match_assessments(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade
);
create index application_match_comparison_app_idx on public.application_match_comparison_pairs(application_id);
alter table public.application_match_comparison_pairs enable row level security;
revoke all on public.application_match_comparison_pairs from public,anon,authenticated;
grant all on public.application_match_comparison_pairs to service_role;

create function public.application_comparison_is_current_v378(a public.application_match_assessments)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.application_match_comparison_pairs c
    join public.applications app on app.id=c.application_id
    join public.resumes attached on attached.id=app.resume_id
    join public.resumes r on r.id=a.resume_id
    join public.job_descriptions j on j.id=app.job_description_id
    where c.assessment_id=a.id and j.id=a.job_description_id and j.matching_hash=a.jd_hash
      and r.matching_hash=a.resume_hash and r.status='ACTIVE'
      and j.status='ACTIVE' and j.review_status='APPROVED'
      and (r.id=coalesce(attached.parent_resume_id,attached.id) and r.resume_type='ORIGINAL'
        or r.id=attached.id and r.resume_type='TAILORED'))
$$;

create function public.application_resume_match_view_v378(p_job_id uuid,p_resume_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare a public.application_match_assessments; r public.resumes; j public.job_descriptions; s public.application_match_settings; current_score boolean;
begin
  select * into r from public.resumes where id=p_resume_id;
  if not found then return null; end if;
  select * into j from public.job_descriptions where id=p_job_id;
  select * into s from public.application_match_settings where singleton;
  select * into a from public.application_match_assessments x where x.job_description_id=p_job_id and x.resume_id=p_resume_id
    order by (x.jd_hash=j.matching_hash and x.resume_hash=r.matching_hash and x.model_id=s.model_id
      and x.rubric_version=s.rubric_version and x.extractor_version=s.extractor_version) desc,x.created_at desc,x.id desc limit 1;
  current_score:=a.id is not null and a.jd_hash=j.matching_hash and a.resume_hash=r.matching_hash and a.model_id=s.model_id
    and a.rubric_version=s.rubric_version and a.extractor_version=s.extractor_version;
  return jsonb_build_object('resumeId',r.id,'resumeName',r.resume_name,'resumeNumber',r.resume_number,
    'assessmentId',a.id,'status',case when a.id is null then 'NOT_ASSESSED' when not current_score then 'STALE' else a.status end,
    'score',a.score,'reason',coalesce(a.result->>'summary',''),'components',coalesce(a.result->'components','{}'::jsonb),
    'scoredAt',a.completed_at,'modelId',a.model_id,'rubricVersion',a.rubric_version,'extractorVersion',a.extractor_version,
    'isCurrent',current_score,'errorCode',a.error_code);
end $$;

create function public.get_application_match_comparison_v378(p_application_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare app public.applications; r public.resumes; original jsonb; tailored jsonb; comparable boolean; s public.application_match_settings;
begin
  select * into app from public.applications where id=p_application_id;
  if not found or not public.application_actor_can_view(app.assigned_to) then
    raise exception 'APPLICATION_NOT_FOUND: The Application was not found or is not accessible.';
  end if;
  select * into r from public.resumes where id=app.resume_id;
  select * into s from public.application_match_settings where singleton;
  original:=public.application_resume_match_view_v378(app.job_description_id,coalesce(r.parent_resume_id,r.id));
  if r.resume_type='TAILORED' then tailored:=public.application_resume_match_view_v378(app.job_description_id,r.id); end if;
  comparable:=coalesce(original->>'status'='COMPLETED' and tailored->>'status'='COMPLETED'
    and (original->>'isCurrent')::boolean and (tailored->>'isCurrent')::boolean,false);
  return jsonb_build_object('applicationId',app.id,'matchingMode',app.matching_mode,
    'creationScore',app.match_score,'creationThreshold',app.match_threshold,
    'creationReason',(select result->>'summary' from public.application_match_assessments where id=app.match_assessment_id),
    'original',original,'tailored',tailored,'comparable',comparable,
    'difference',case when comparable then (tailored->>'score')::integer-(original->>'score')::integer else null end,
    'matchingConfigured',s.model_id<>'UNCONFIGURED');
end $$;

create function public.request_application_match_comparison_v378(p_application_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare app public.applications; attached public.resumes; r public.resumes; j public.job_descriptions; s public.application_match_settings;
  a public.application_match_assessments; jd_doc uuid; resume_doc uuid; ids uuid[]:='{}'; token text; ticket_id uuid;
  expiry timestamptz:=now()+interval '15 minutes';
begin
  perform public.assert_application_manager();
  select * into s from public.application_match_settings where singleton for share;
  if s.model_id='UNCONFIGURED' then raise exception 'MATCHING_NOT_CONFIGURED: Configure the scoring model first.'; end if;
  select * into app from public.applications where id=p_application_id;
  if not found then raise exception 'APPLICATION_NOT_FOUND: The Application was not found.'; end if;
  select * into j from public.job_descriptions where id=app.job_description_id for share;
  select * into attached from public.resumes where id=app.resume_id;
  perform 1 from public.resumes where id in(attached.id,coalesce(attached.parent_resume_id,attached.id)) order by id for share;
  if j.status<>'ACTIVE' or j.review_status<>'APPROVED' or attached.status<>'ACTIVE' then
    raise exception 'MATCH_COMPARISON_UNAVAILABLE: The JD must be active and approved and the attached Resume active.';
  end if;
  insert into public.application_match_documents(source_kind,source_id,source_hash,extractor_version,model_id,source)
    values('JD',j.id,j.matching_hash,s.extractor_version,s.model_id,public.application_match_job_source(j))
    on conflict(source_kind,source_id,source_hash,extractor_version,model_id) do nothing;
  select id into jd_doc from public.application_match_documents where source_kind='JD' and source_id=j.id
    and source_hash=j.matching_hash and extractor_version=s.extractor_version and model_id=s.model_id;
  for r in select * from public.resumes where id in(attached.id,coalesce(attached.parent_resume_id,attached.id)) and status='ACTIVE' order by id loop
    insert into public.application_match_documents(source_kind,source_id,source_hash,extractor_version,model_id,source)
      values('RESUME',r.id,r.matching_hash,s.extractor_version,s.model_id,public.application_match_resume_source(r))
      on conflict(source_kind,source_id,source_hash,extractor_version,model_id) do nothing;
    select id into resume_doc from public.application_match_documents where source_kind='RESUME' and source_id=r.id
      and source_hash=r.matching_hash and extractor_version=s.extractor_version and model_id=s.model_id;
    insert into public.application_match_assessments(job_description_id,resume_id,jd_hash,resume_hash,jd_document_id,resume_document_id,rubric_version,extractor_version,model_id,requested_by)
      values(j.id,r.id,j.matching_hash,r.matching_hash,jd_doc,resume_doc,s.rubric_version,s.extractor_version,s.model_id,auth.uid())
      on conflict(job_description_id,resume_id,jd_hash,resume_hash,rubric_version,extractor_version,model_id) do update
        set status='PENDING',attempt_count=0,next_attempt_at=now(),error_code=null,lease_token=null,lease_expires_at=null
        where application_match_assessments.status in('FAILED','STALE');
    select * into a from public.application_match_assessments where job_description_id=j.id and resume_id=r.id and jd_hash=j.matching_hash
      and resume_hash=r.matching_hash and model_id=s.model_id and rubric_version=s.rubric_version and extractor_version=s.extractor_version;
    insert into public.application_match_comparison_pairs(assessment_id,application_id) values(a.id,app.id) on conflict(assessment_id) do nothing;
    if a.status in('PENDING','PROCESSING') then ids:=array_append(ids,a.id); end if;
  end loop;
  if cardinality(ids)=0 then return jsonb_build_object('runner',null,'queuedCount',0); end if;
  token:='mrb_'||rtrim(translate(encode(sha256(convert_to(gen_random_uuid()::text||gen_random_uuid()::text,'UTF8')),'base64'),'+/','-_'),'=');
  insert into public.application_match_runner_tickets(token_hash,created_by,model_id,rubric_version,extractor_version,expires_at)
    values(encode(sha256(convert_to(token,'UTF8')),'hex'),auth.uid(),s.model_id,s.rubric_version,s.extractor_version,expiry) returning id into ticket_id;
  insert into public.application_match_runner_items(ticket_id,assessment_id) select ticket_id,unnest(ids);
  return jsonb_build_object('queuedCount',cardinality(ids),'runner',jsonb_build_object('ticketId',ticket_id,'ticket',token,'expiresAt',expiry,'pairCount',cardinality(ids),'modelId',s.model_id));
end $$;

revoke all on function public.application_comparison_is_current_v378(public.application_match_assessments),
  public.application_resume_match_view_v378(uuid,uuid) from public,anon,authenticated;
revoke all on function public.get_application_match_comparison_v378(uuid),public.request_application_match_comparison_v378(uuid) from public,anon;
grant execute on function public.get_application_match_comparison_v378(uuid),public.request_application_match_comparison_v378(uuid) to authenticated;

-- Explicit comparison pairs may run after an Application exists. Creation gates stay unchanged.
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
    or (case when exists(select 1 from public.application_match_comparison_pairs c where c.assessment_id=a.id)
      then not public.application_comparison_is_current_v378(a)
      else not public.application_match_category_matches(a.job_description_id,a.resume_id) end) then
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
        or (not public.application_comparison_is_current_v378(queued) and not public.application_match_category_matches(queued.job_description_id,queued.resume_id)));
  select * into a from public.application_match_assessments x
    where x.model_id=s.model_id and x.rubric_version=s.rubric_version and x.extractor_version=s.extractor_version
      and (public.application_comparison_is_current_v378(x) or public.application_match_category_matches(x.job_description_id,x.resume_id))
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
          or (not public.application_comparison_is_current_v378(x)
            and public.application_match_eligibility(x.job_description_id,x.resume_id)->>'exclusionCode' not in('MATCH_PENDING','MATCH_PROCESSING')));
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

notify pgrst,'reload schema';
