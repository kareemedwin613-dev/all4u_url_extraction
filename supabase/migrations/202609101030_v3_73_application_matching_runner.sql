-- Ticket-scoped matching, following the tailoring runner pattern. Existing scores,
-- weights, caches and service-only RPC grants are retained; no privileged API key
-- is required on the local runner or the application API.
create table public.application_match_runner_tickets (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  created_by uuid not null references public.profiles(id),
  model_id text not null,
  rubric_version text not null,
  extractor_version text not null,
  status text not null default 'ISSUED' check(status in('ISSUED','CLAIMED','COMPLETED','REVOKED')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '15 minutes',
  run_expires_at timestamptz
);
create table public.application_match_runner_items (
  ticket_id uuid not null references public.application_match_runner_tickets(id) on delete cascade,
  assessment_id uuid not null references public.application_match_assessments(id) on delete cascade,
  lease_token uuid,
  primary key(ticket_id,assessment_id)
);
alter table public.application_match_runner_tickets enable row level security;
alter table public.application_match_runner_items enable row level security;
revoke all on public.application_match_runner_tickets,public.application_match_runner_items from public,anon,authenticated;
grant all on public.application_match_runner_tickets,public.application_match_runner_items to service_role;

create function public.request_application_matches_with_ticket(p_combinations jsonb,p_retry_failed boolean default false)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare receipt jsonb; s public.application_match_settings; ids uuid[]; token text; ticket_id uuid;
  expiry timestamptz:=now()+interval '15 minutes';
begin
  perform public.assert_application_manager();
  receipt:=public.request_application_matches(p_combinations,p_retry_failed);
  select * into s from public.application_match_settings where singleton for share;
  select array_agg(distinct a.id) into ids
    from jsonb_to_recordset(p_combinations) p(job_description_id uuid,resume_id uuid)
    join public.application_match_assessments a on a.job_description_id=p.job_description_id and a.resume_id=p.resume_id
    join public.job_descriptions j on j.id=a.job_description_id and j.matching_hash=a.jd_hash
    join public.resumes r on r.id=a.resume_id and r.matching_hash=a.resume_hash
    where a.model_id=s.model_id and a.rubric_version=s.rubric_version and a.extractor_version=s.extractor_version
      and a.status in('PENDING','PROCESSING')
      and public.application_match_eligibility(j.id,r.id)->>'exclusionCode' in('MATCH_PENDING','MATCH_PROCESSING');
  if coalesce(cardinality(ids),0)=0 then return receipt||jsonb_build_object('runner',null); end if;
  -- Two independent random UUIDs provide >240 bits of entropy, using core PG
  -- functions so this migration does not depend on an extension search path.
  token:='mrb_'||rtrim(translate(encode(sha256(convert_to(gen_random_uuid()::text||gen_random_uuid()::text,'UTF8')),'base64'),'+/','-_'),'=');
  insert into public.application_match_runner_tickets(token_hash,created_by,model_id,rubric_version,extractor_version,expires_at)
    values(encode(sha256(convert_to(token,'UTF8')),'hex'),auth.uid(),s.model_id,s.rubric_version,s.extractor_version,expiry)
    returning id into ticket_id;
  insert into public.application_match_runner_items(ticket_id,assessment_id) select ticket_id,unnest(ids);
  return receipt||jsonb_build_object('runner',jsonb_build_object('ticketId',ticket_id,'ticket',token,
    'expiresAt',expiry,'pairCount',cardinality(ids),'modelId',s.model_id));
end $$;

-- Only this helper may turn a bearer ticket into access to a fixed set of pairs.
create function public.assert_application_match_ticket(p_ticket text,p_allow_issued boolean default false)
returns public.application_match_runner_tickets language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.application_match_runner_tickets; s public.application_match_settings;
begin
  if coalesce(p_ticket,'')!~'^mrb_[A-Za-z0-9_-]{43}$' then raise exception 'MATCH_TICKET_INVALID: Generate a new scoring command.'; end if;
  select * into t from public.application_match_runner_tickets
    where token_hash=encode(sha256(convert_to(p_ticket,'UTF8')),'hex') for update;
  if not found or t.status='REVOKED' then raise exception 'MATCH_TICKET_INVALID: Generate a new scoring command.'; end if;
  if not public.is_active_user(t.created_by) or not public.has_any_role(array['APPLYING_MANAGER','ADMIN'],t.created_by) then
    raise exception 'MATCH_TICKET_INVALID: The issuing manager no longer has access.';
  end if;
  if (t.status='ISSUED' and (not p_allow_issued or t.expires_at<=now()))
    or (t.status in('CLAIMED','COMPLETED') and (t.run_expires_at is null or t.run_expires_at<=now())) then
    raise exception 'MATCH_TICKET_EXPIRED: Generate a new scoring command.';
  end if;
  select * into s from public.application_match_settings where singleton;
  if t.model_id<>s.model_id or t.rubric_version<>s.rubric_version or t.extractor_version<>s.extractor_version then
    raise exception 'MATCH_WORKER_VERSION_MISMATCH: Scoring configuration changed; generate a new command.';
  end if;
  return t;
end $$;

-- JSON shape checks also run in PostgreSQL: callers cannot bypass them by
-- invoking a ticket endpoint directly instead of running the local worker.
create function public.assert_application_match_runner_output(p_value jsonb,p_document boolean)
returns void language plpgsql set search_path=public,pg_temp as $$
declare k text; e jsonb; n integer:=0;
begin
  if jsonb_typeof(p_value) is distinct from 'object' or octet_length(p_value::text)>150000
    or jsonb_typeof(p_value->'sufficient') is distinct from 'boolean'
    or jsonb_typeof(p_value->'summary') is distinct from 'string' or length(p_value->>'summary')>500 then
    raise exception 'MATCH_INVALID_RESULT: Invalid result structure.';
  end if;
  for k in select unnest(array['requiredSkills','preferredSkills','responsibilities','seniority','domain']) loop
    if p_document then
      if jsonb_typeof(p_value->k) is distinct from 'array' then raise exception 'MATCH_INVALID_RESULT: Invalid document facts.'; end if;
      if jsonb_array_length(p_value->k)>25 then raise exception 'MATCH_INVALID_RESULT: Too many facts.'; end if;
      n:=n+jsonb_array_length(p_value->k);
      for e in select value from jsonb_array_elements(p_value->k) loop
        if jsonb_typeof(e->'text') is distinct from 'string' or length(e->>'text')>500
          or jsonb_typeof(e->'quote') is distinct from 'string' or length(e->>'quote')>500
          or btrim(regexp_replace(normalize(e->>'quote',NFKC),'\s+',' ','g'))='' then
          raise exception 'MATCH_INVALID_RESULT: Invalid document fact.';
        end if;
      end loop;
    else
      e:=p_value->'components'->k;
      if jsonb_typeof(e) is distinct from 'object' or jsonb_typeof(e->'reason') is distinct from 'string' or length(e->>'reason')>500
        or not coalesce(e ? 'rating',false) then raise exception 'MATCH_INVALID_RESULT: Invalid score component.'; end if;
      if e->'rating'<>'null'::jsonb then
        if jsonb_typeof(e->'rating') is distinct from 'number' then raise exception 'MATCH_INVALID_RESULT: Invalid rating.'; end if;
        if (e->>'rating')::numeric not between 0 and 100 or (e->>'rating')::numeric<>trunc((e->>'rating')::numeric)
          or p_value->>'sufficient'='false' then raise exception 'MATCH_INVALID_RESULT: Invalid rating.'; end if;
      end if;
    end if;
  end loop;
  if n>60 then raise exception 'MATCH_INVALID_RESULT: Too many document facts.'; end if;
  if not p_document then
    if jsonb_typeof(p_value->'missingRequirements') is distinct from 'array' then raise exception 'MATCH_INVALID_RESULT: Invalid missing requirements.'; end if;
    if jsonb_array_length(p_value->'missingRequirements')>12 then raise exception 'MATCH_INVALID_RESULT: Too many missing requirements.'; end if;
    for e in select value from jsonb_array_elements(p_value->'missingRequirements') loop
      if jsonb_typeof(e) is distinct from 'string' or length(e#>>'{}')>500 then raise exception 'MATCH_INVALID_RESULT: Invalid missing requirement.'; end if;
    end loop;
  end if;
end $$;

create function public.application_match_runner_call(p_ticket text,p_operation text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.application_match_runner_tickets; a public.application_match_assessments; d public.application_match_documents;
  item public.application_match_runner_items; value jsonb; jd jsonb; resume jsonb; k text; fact jsonb;
  pending integer; failed integer; retry_at timestamptz;
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
      'extractorVersion',t.extractor_version,'runExpiresAt',t.run_expires_at);
  elsif p_operation='next' then
    if p_payload->>'modelId' is distinct from t.model_id or p_payload->>'rubricVersion' is distinct from t.rubric_version
      or p_payload->>'extractorVersion' is distinct from t.extractor_version then
      raise exception 'MATCH_WORKER_VERSION_MISMATCH: Worker and scoring configuration differ.';
    end if;
    -- Terminal tickets cannot reopen when a manager retries a failed pair with
    -- a new command. Completed-result receipt retries remain available below.
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
      'extractorVersion',a.extractor_version,'jdDocumentId',a.jd_document_id,'resumeDocumentId',a.resume_document_id,'attempt',a.attempt_count,'asOf',current_date);
  end if;
  if p_operation not in('document','document-result','result','failure') then raise exception 'MATCH_INVALID_REQUEST: Unknown runner operation.'; end if;
  select * into item from public.application_match_runner_items where ticket_id=t.id and assessment_id=(p_payload->>'jobId')::uuid;
  if not found or item.lease_token is null or item.lease_token is distinct from (p_payload->>'leaseToken')::uuid then
    raise exception 'MATCH_LEASE_EXPIRED: This ticket does not own the job lease.';
  end if;
  select * into a from public.application_match_assessments where id=item.assessment_id;
  -- A repeated submission after a lost HTTP response returns the original receipt.
  if p_operation='result' and a.status in('COMPLETED','INSUFFICIENT_DATA') and a.result=p_payload->'result' then
    return jsonb_build_object('status',a.status,'score',a.score);
  end if;
  if a.status<>'PROCESSING' or a.lease_token is distinct from item.lease_token or a.lease_expires_at<=now() then
    raise exception 'MATCH_LEASE_EXPIRED: The job lease expired or changed.';
  end if;
  if p_operation in('document','document-result') then
    if (p_payload->>'documentId')::uuid not in(a.jd_document_id,a.resume_document_id) or p_payload->>'documentId' is null then
      raise exception 'MATCH_TICKET_SCOPE: The document is outside this scoring job.';
    end if;
    if p_operation='document' then return public.claim_application_match_document((p_payload->>'documentId')::uuid); end if;
    value:=nullif(p_payload->'analysis','null'::jsonb);
    if value is not null then
      perform public.assert_application_match_runner_output(value,true);
      select * into d from public.application_match_documents where id=(p_payload->>'documentId')::uuid;
      for k in select unnest(array['requiredSkills','preferredSkills','responsibilities','seniority','domain']) loop
        for fact in select x from jsonb_array_elements(value->k) x loop
          if not exists(select 1 from jsonb_path_query(d.source,'strict $.** ? (@.type() == "string" || @.type() == "number" || @.type() == "boolean")') s(v)
            where position(lower(btrim(regexp_replace(normalize(fact->>'quote',NFKC),'\s+',' ','g')))
              in lower(btrim(regexp_replace(normalize(s.v#>>'{}',NFKC),'\s+',' ','g'))))>0) then
            raise exception 'MATCH_INVALID_RESULT: Document quote is not supported by its source.';
          end if;
        end loop;
      end loop;
    end if;
    return to_jsonb(public.complete_application_match_document((p_payload->>'documentId')::uuid,(p_payload->>'documentLeaseToken')::uuid,value));
  elsif p_operation='result' then
    value:=p_payload->'result';
    perform public.assert_application_match_runner_output(value,false);
    select analysis into jd from public.application_match_documents where id=a.jd_document_id;
    select analysis into resume from public.application_match_documents where id=a.resume_document_id;
    if value->>'sufficient'='true' then
      if jd->>'sufficient' is distinct from 'true' or resume->>'sufficient' is distinct from 'true' then
        raise exception 'MATCH_INVALID_RESULT: Both source profiles must be sufficient.';
      end if;
      for k in select unnest(array['requiredSkills','preferredSkills','responsibilities','seniority','domain']) loop
        if (jsonb_array_length(jd->k)=0) is distinct from (value->'components'->k->'rating'='null'::jsonb) then
          raise exception 'MATCH_INVALID_RESULT: Only absent JD dimensions may be unscored.';
        end if;
      end loop;
    end if;
    return public.complete_application_match(a.id,a.lease_token,value);
  else
    if coalesce(p_payload->>'code','')!~'^[A-Z][A-Z0-9_]{0,79}$' or jsonb_typeof(p_payload->'retryable') is distinct from 'boolean' then
      raise exception 'MATCH_INVALID_REQUEST: Invalid failure report.';
    end if;
    return to_jsonb(public.fail_application_match(a.id,a.lease_token,p_payload->>'code',(p_payload->>'retryable')::boolean,
      coalesce((p_payload->>'retryAfterSeconds')::integer,30)));
  end if;
end $$;

create function public.revoke_application_match_ticket(p_ticket_id uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform public.assert_application_manager();
  update public.application_match_runner_tickets set status='REVOKED' where id=p_ticket_id;
  if not found then return false; end if;
  update public.application_match_assessments a set status='PENDING',lease_token=null,lease_expires_at=null,next_attempt_at=now(),
    attempt_count=greatest(0,attempt_count-1),error_code='RUNNER_REVOKED'
    from public.application_match_runner_items i where i.ticket_id=p_ticket_id and a.id=i.assessment_id
      and a.status='PROCESSING' and a.lease_token=i.lease_token;
  return true;
end $$;

revoke all on function public.request_application_matches_with_ticket(jsonb,boolean),public.revoke_application_match_ticket(uuid) from public,anon;
grant execute on function public.request_application_matches_with_ticket(jsonb,boolean),public.revoke_application_match_ticket(uuid) to authenticated;
revoke all on function public.assert_application_match_ticket(text,boolean),public.assert_application_match_runner_output(jsonb,boolean),
  public.application_match_runner_call(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.application_match_runner_call(text,text,jsonb) to anon;
