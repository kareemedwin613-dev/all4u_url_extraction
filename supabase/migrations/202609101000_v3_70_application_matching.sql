-- Application matching is independent of tailoring. Apply only with a configured worker.
-- No historical Applications are rescored or deleted. Subcategories never gate selection.

-- The CLI applies this file as one transaction. Acquire the live-table locks BEFORE
-- changing/backfilling JDs or Resumes: an existing Application reader may otherwise
-- hold applications while waiting on a source table that this migration already owns.
-- NOWAIT fails before schema changes if traffic is still using any required table.
-- Use a quiet maintenance window; these locks last through the hash backfill/commit.
set local lock_timeout = '3s';
do $matching_migration_locks$
begin
  lock table public.applications, public.job_descriptions, public.resumes
    in access exclusive mode nowait;
  -- Creating the requested_by foreign key also locks its existing parent table.
  lock table public.profiles in share row exclusive mode nowait;
exception when lock_not_available then
  raise exception using errcode='55P03',
    message='MATCHING_MIGRATION_BUSY: Matching migration could not acquire its startup locks.',
    hint='Pause dashboard polling, captures, workers, and other database activity; let in-flight requests finish, then retry db push. Do not mark this migration applied.';
end
$matching_migration_locks$;

create table public.application_match_settings (
  singleton boolean primary key default true check (singleton),
  threshold integer not null default 70 check (threshold between 1 and 100),
  rubric_version text not null default 'match-v1',
  extractor_version text not null default 'facts-v1',
  model_id text not null default 'UNCONFIGURED' check (length(model_id) between 1 and 120)
);
insert into public.application_match_settings(singleton) values(true);
alter table public.application_match_settings enable row level security;
revoke all on public.application_match_settings from public, anon, authenticated;
grant all on public.application_match_settings to service_role;

-- Whitelist scoring inputs: no contact details, demographic answers, status, or outcome.
create function public.application_match_job_source(j public.job_descriptions)
returns jsonb language sql immutable set search_path=public,pg_temp as $$
  select jsonb_build_object('title',j.job_title,'description',j.description_text,
    'sections',j.structured_content,'skillHints',j.detected_skills,'seniority',j.seniority)
$$;
create function public.application_match_resume_source(r public.resumes)
returns jsonb language sql immutable set search_path=public,pg_temp as $$
  select jsonb_build_object('summary',r.structured_content->'summary','skills',r.skills,
    'experience',coalesce((select jsonb_agg(jsonb_build_object(
      'title',e->>'job_title','start',e->'start_date','end',e->'end_date',
      'current',e->'is_current','details',e->>'experience_details') order by ordinal)
      from jsonb_array_elements(case when jsonb_typeof(r.structured_content->'professional_experience')='array'
        then r.structured_content->'professional_experience' else '[]'::jsonb end) with ordinality x(e,ordinal)), '[]'::jsonb),
    'education',coalesce((select jsonb_agg(jsonb_build_object('degree',e->>'degree','field',e->>'field_of_study'))
      from jsonb_array_elements(case when jsonb_typeof(r.structured_content->'education')='array'
        then r.structured_content->'education' else '[]'::jsonb end) x(e)), '[]'::jsonb),
    'certifications',coalesce((select jsonb_agg(e->>'name') from jsonb_array_elements(
      case when jsonb_typeof(r.structured_content->'certifications')='array'
        then r.structured_content->'certifications' else '[]'::jsonb end) x(e)), '[]'::jsonb))
$$;

alter table public.job_descriptions add column matching_hash text;
alter table public.resumes add column matching_hash text;
create function public.refresh_application_matching_hash()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if tg_table_name='job_descriptions' then
    new.matching_hash:=encode(sha256(convert_to(public.application_match_job_source(new)::text,'UTF8')),'hex');
  else
    new.matching_hash:=encode(sha256(convert_to((public.application_match_resume_source(new)||
      jsonb_build_object('fileHash',new.file_sha256))::text,'UTF8')),'hex');
  end if;
  return new;
end $$;
create trigger matching_job_hash before insert or update of job_title,description_text,structured_content,detected_skills,seniority,matching_hash
  on public.job_descriptions for each row execute function public.refresh_application_matching_hash();
create trigger matching_resume_hash before insert or update of structured_content,skills,file_sha256,matching_hash
  on public.resumes for each row execute function public.refresh_application_matching_hash();
update public.job_descriptions set matching_hash=null;
update public.resumes set matching_hash=null;
alter table public.job_descriptions alter column matching_hash set not null;
alter table public.resumes alter column matching_hash set not null;

create table public.application_match_documents (
  id uuid primary key default gen_random_uuid(),
  source_kind text not null check(source_kind in('JD','RESUME')),
  source_id uuid not null,
  source_hash text not null,
  extractor_version text not null,
  model_id text not null,
  source jsonb not null,
  analysis jsonb,
  status text not null default 'PENDING' check(status in('PENDING','PROCESSING','COMPLETED','INSUFFICIENT_DATA')),
  lease_token uuid,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique(source_kind,source_id,source_hash,extractor_version,model_id)
);
create table public.application_match_assessments (
  id uuid primary key default gen_random_uuid(),
  job_description_id uuid not null references public.job_descriptions(id) on delete cascade,
  resume_id uuid not null references public.resumes(id) on delete cascade,
  jd_hash text not null,
  resume_hash text not null,
  jd_document_id uuid not null references public.application_match_documents(id),
  resume_document_id uuid not null references public.application_match_documents(id),
  rubric_version text not null,
  extractor_version text not null,
  model_id text not null,
  status text not null default 'PENDING' check(status in('PENDING','PROCESSING','COMPLETED','FAILED','STALE','INSUFFICIENT_DATA')),
  score integer check(score between 1 and 100),
  result jsonb,
  error_code text,
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  requested_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(job_description_id,resume_id,jd_hash,resume_hash,rubric_version,extractor_version,model_id),
  check((status='COMPLETED')=(score is not null))
);
create index application_match_queue_idx on public.application_match_assessments(next_attempt_at,created_at)
  where status in('PENDING','PROCESSING');
create index application_match_pair_idx on public.application_match_assessments(job_description_id,resume_id,created_at desc);
alter table public.application_match_documents enable row level security;
alter table public.application_match_assessments enable row level security;
revoke all on public.application_match_documents,public.application_match_assessments from public,anon,authenticated;
grant all on public.application_match_documents,public.application_match_assessments to service_role;

-- Code, not the model, owns the weighted total. NULL means the JD does not request a dimension.
create function public.calculate_application_match_score(p_result jsonb)
returns integer language plpgsql immutable set search_path=public,pg_temp as $$
declare item record; rating numeric; weighted numeric:=0; denominator integer:=0;
begin
  if p_result->>'sufficient' is distinct from 'true' then return null; end if;
  for item in select * from (values('requiredSkills',35),('preferredSkills',15),('responsibilities',25),('seniority',15),('domain',10)) x(key,weight) loop
    if not coalesce(p_result->'components','{}'::jsonb) ? item.key then
      raise exception 'MATCH_INVALID_RESULT: Missing score component.' using errcode='22023';
    end if;
    if p_result->'components'->item.key->'rating'='null'::jsonb then continue; end if;
    if jsonb_typeof(p_result->'components'->item.key->'rating') is distinct from 'number' then
      raise exception 'MATCH_INVALID_RESULT: Invalid component rating.' using errcode='22023';
    end if;
    rating:=(p_result->'components'->item.key->>'rating')::numeric;
    if rating<0 or rating>100 or rating<>trunc(rating) then
      raise exception 'MATCH_INVALID_RESULT: Ratings must be integers from 0 to 100.' using errcode='22023';
    end if;
    denominator:=denominator+item.weight; weighted:=weighted+rating*item.weight;
  end loop;
  if denominator=0 then raise exception 'MATCH_INVALID_RESULT: No assessed dimensions.' using errcode='22023'; end if;
  return greatest(1,least(100,round(weighted/denominator)::integer));
end $$;

create function public.application_match_eligibility(p_job_id uuid,p_resume_id uuid)
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

create function public.request_application_matches(p_combinations jsonb,p_retry_failed boolean default false)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.application_match_settings; requested integer; accepted integer;
begin
  perform public.assert_application_manager();
  if jsonb_typeof(p_combinations) is distinct from 'array' or jsonb_array_length(p_combinations) not between 1 and 5000 then
    raise exception 'MATCH_INVALID_REQUEST: Select between 1 and 5000 pairs.' using errcode='22023';
  end if;
  select * into s from public.application_match_settings where singleton for share;
  if s.model_id='UNCONFIGURED' then raise exception 'MATCHING_NOT_CONFIGURED: Configure the scoring worker and model first.' using errcode='22023'; end if;
  -- Lock sources in a consistent order; snapshot hashes and contents from the same revision.
  perform 1 from public.job_descriptions j where j.id in(select x.job_description_id from jsonb_to_recordset(p_combinations) x(job_description_id uuid)) order by j.id for share;
  perform 1 from public.resumes r where r.id in(select x.resume_id from jsonb_to_recordset(p_combinations) x(resume_id uuid)) order by r.id for share;
  with pairs as (select distinct x.job_description_id,x.resume_id from jsonb_to_recordset(p_combinations) x(job_description_id uuid,resume_id uuid)),
  candidates as (select p.* from pairs p join public.job_descriptions j on j.id=p.job_description_id join public.resumes r on r.id=p.resume_id
    where j.status='ACTIVE' and j.review_status='APPROVED' and r.status='ACTIVE' and r.resume_type='ORIGINAL'
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

-- Service-only queue operations. A browser cannot submit a score or impersonate a worker.
create function public.claim_application_match(p_model_id text,p_rubric_version text default 'match-v1',p_extractor_version text default 'facts-v1')
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
  -- Do not spend model calls on queued snapshots superseded before a worker reached them.
  update public.application_match_assessments queued set status='STALE',error_code='SOURCE_CHANGED',lease_token=null,lease_expires_at=null
    where (queued.status='PENDING' or (queued.status='PROCESSING' and queued.lease_expires_at<now()))
      and (queued.model_id<>s.model_id or queued.rubric_version<>s.rubric_version or queued.extractor_version<>s.extractor_version
        or not exists(select 1 from public.job_descriptions j where j.id=queued.job_description_id and j.matching_hash=queued.jd_hash)
        or not exists(select 1 from public.resumes r where r.id=queued.resume_id and r.matching_hash=queued.resume_hash));
  select * into a from public.application_match_assessments x
    where x.model_id=s.model_id and x.rubric_version=s.rubric_version and x.extractor_version=s.extractor_version
      and x.attempt_count<3 and ((x.status='PENDING' and x.next_attempt_at<=now()) or (x.status='PROCESSING' and x.lease_expires_at<now()))
    order by x.next_attempt_at,x.created_at,x.id for update skip locked limit 1;
  if not found then return null; end if;
  update public.application_match_assessments set status='PROCESSING',attempt_count=attempt_count+1,
    lease_token=gen_random_uuid(),lease_expires_at=now()+interval '5 minutes',error_code=null where id=a.id returning * into a;
  return jsonb_build_object('id',a.id,'leaseToken',a.lease_token,'modelId',a.model_id,'rubricVersion',a.rubric_version,'extractorVersion',a.extractor_version,
    'jdDocumentId',a.jd_document_id,'resumeDocumentId',a.resume_document_id,'attempt',a.attempt_count,'asOf',current_date);
end $$;

create function public.claim_application_match_document(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.application_match_documents;
begin
  select * into d from public.application_match_documents where id=p_id for update;
  if not found then raise exception 'MATCH_DOCUMENT_NOT_FOUND'; end if;
  if d.status in('COMPLETED','INSUFFICIENT_DATA') then return jsonb_build_object('id',d.id,'status',d.status,'analysis',d.analysis); end if;
  if d.status='PROCESSING' and d.lease_expires_at>now() then return jsonb_build_object('id',d.id,'status','BUSY'); end if;
  update public.application_match_documents set status='PROCESSING',lease_token=gen_random_uuid(),lease_expires_at=now()+interval '90 seconds'
    where id=p_id returning * into d;
  return jsonb_build_object('id',d.id,'status','PROCESSING','kind',d.source_kind,'source',d.source,'leaseToken',d.lease_token);
end $$;
create function public.complete_application_match_document(p_id uuid,p_lease_token uuid,p_analysis jsonb)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if p_analysis is not null and jsonb_typeof(p_analysis->'sufficient') is distinct from 'boolean' then raise exception 'MATCH_INVALID_DOCUMENT'; end if;
  update public.application_match_documents set analysis=p_analysis,
    status=case when p_analysis is null then 'PENDING' when (p_analysis->>'sufficient')::boolean then 'COMPLETED' else 'INSUFFICIENT_DATA' end,
    lease_token=null,lease_expires_at=null
    where id=p_id and status='PROCESSING' and lease_token=p_lease_token and lease_expires_at>now();
  return found;
end $$;
create function public.complete_application_match(p_id uuid,p_lease_token uuid,p_result jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.application_match_assessments; s public.application_match_settings; jh text; rh text; score_value integer;
begin
  select * into s from public.application_match_settings where singleton for share;
  -- Follow enqueue/create lock order: settings, JD, Resume, assessment.
  select * into a from public.application_match_assessments where id=p_id;
  select matching_hash into jh from public.job_descriptions where id=a.job_description_id for share;
  select matching_hash into rh from public.resumes where id=a.resume_id for share;
  select * into a from public.application_match_assessments where id=p_id for update;
  if not found or a.status<>'PROCESSING' or a.lease_token is distinct from p_lease_token or a.lease_expires_at<=now() then
    raise exception 'MATCH_LEASE_EXPIRED: This result no longer owns its lease.';
  end if;
  if jh is distinct from a.jd_hash or rh is distinct from a.resume_hash or s.model_id<>a.model_id
    or s.rubric_version<>a.rubric_version or s.extractor_version<>a.extractor_version then
    update public.application_match_assessments set status='STALE',lease_token=null,lease_expires_at=null,error_code='SOURCE_CHANGED' where id=a.id;
    return jsonb_build_object('status','STALE');
  end if;
  if jsonb_typeof(p_result->'sufficient') is distinct from 'boolean' then raise exception 'MATCH_INVALID_RESULT: Missing sufficiency flag.'; end if;
  score_value:=public.calculate_application_match_score(p_result);
  update public.application_match_assessments set status=case when score_value is null then 'INSUFFICIENT_DATA' else 'COMPLETED' end,
    score=score_value,result=p_result,completed_at=now(),lease_token=null,lease_expires_at=null where id=a.id;
  return jsonb_build_object('status',case when score_value is null then 'INSUFFICIENT_DATA' else 'COMPLETED' end,'score',score_value);
end $$;
create function public.fail_application_match(p_id uuid,p_lease_token uuid,p_code text,p_retryable boolean,p_retry_after integer default 30)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update public.application_match_assessments set
    status=case when p_code='DOCUMENT_BUSY' or (p_retryable and attempt_count<3) then 'PENDING' else 'FAILED' end,
    attempt_count=case when p_code='DOCUMENT_BUSY' then greatest(0,attempt_count-1) else attempt_count end,
    next_attempt_at=now()+make_interval(secs=>greatest(5,least(900,coalesce(p_retry_after,30)))),
    error_code=left(p_code,80),lease_token=null,lease_expires_at=null
    where id=p_id and status='PROCESSING' and lease_token=p_lease_token and lease_expires_at>now();
  return found;
end $$;

-- One authoritative gate, including direct SQL RPC creation and changes to a different pair.
alter table public.applications
  add column match_assessment_id uuid references public.application_match_assessments(id) on delete restrict,
  add column match_score integer check(match_score between 1 and 100),
  add column match_threshold integer check(match_threshold between 1 and 100);
create function public.enforce_application_match()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare gate jsonb; old_family uuid; new_family uuid;
begin
  if tg_op='UPDATE' then
    select coalesce(parent_resume_id,id) into old_family from public.resumes where id=old.resume_id;
    select coalesce(parent_resume_id,id) into new_family from public.resumes where id=new.resume_id;
    if old.job_description_id=new.job_description_id and old_family=new_family then
      new.match_assessment_id:=old.match_assessment_id; new.match_score:=old.match_score; new.match_threshold:=old.match_threshold;
      return new; -- Tailoring an existing Application must not retroactively change its creation score.
    end if;
  end if;
  perform 1 from public.application_match_settings where singleton for share;
  -- Serialize creation for a JD, including original/tailored family duplicate checks.
  perform 1 from public.job_descriptions where id=new.job_description_id for update;
  perform 1 from public.resumes where id=new.resume_id for share;
  gate:=public.application_match_eligibility(new.job_description_id,new.resume_id);
  if not (gate->>'eligible')::boolean then
    raise exception '%: %',gate->>'exclusionCode',gate->>'exclusionReason' using errcode='P0001';
  end if;
  new.match_assessment_id:=(gate->>'assessmentId')::uuid;
  new.match_score:=(gate->>'matchScore')::integer;
  new.match_threshold:=(gate->>'matchThreshold')::integer;
  return new;
end $$;
-- Run before the existing family advisory-lock trigger to keep every path's lock order consistent.
create trigger applications_00_match_gate before insert or update of job_description_id,resume_id,match_assessment_id,match_score,match_threshold
  on public.applications for each row execute function public.enforce_application_match();

-- Kept for backwards-compatible callers; category labels are informational, never exclusions.
-- Some deployed databases use p_job_description_id for argument 3; v3.68 used
-- p_subcategory_id. PostgreSQL forbids renaming existing input arguments with
-- CREATE OR REPLACE. Preserve names/defaults, function identity and dependents;
-- both legacy variants have the Resume ID in position 1. Do not DROP the function.
do $matching_legacy_signature$
declare legacy_arguments text;
begin
  select pg_get_function_arguments(p.oid) into legacy_arguments
    from pg_proc p where p.oid=to_regprocedure('public.resume_matches_job_for_bulk(uuid,uuid,uuid)');
  legacy_arguments:=coalesce(legacy_arguments,
    'p_resume_id uuid,p_category_id uuid,p_job_description_id uuid default null');
  execute format($definition$
    create or replace function public.resume_matches_job_for_bulk(%s)
    returns boolean language sql stable set search_path=public,pg_temp as $body$
      select exists(select 1 from public.resumes where id=$1 and resume_type='ORIGINAL' and status='ACTIVE')
    $body$;
  $definition$,legacy_arguments);
end
$matching_legacy_signature$;
revoke all on function public.resume_matches_job_for_bulk(uuid,uuid,uuid) from public,anon;
grant execute on function public.resume_matches_job_for_bulk(uuid,uuid,uuid) to authenticated;
comment on function public.resume_matches_job_for_bulk(uuid,uuid,uuid) is
  'Legacy candidate availability check: active original Resume only; category/JD arguments are retained for compatibility and do not exclude candidates. Creation uses the scored gate.';

-- Revoke default PUBLIC execute, including internal security-definer helpers.
revoke all on function public.application_match_job_source(public.job_descriptions),public.application_match_resume_source(public.resumes),
  public.refresh_application_matching_hash(),public.calculate_application_match_score(jsonb),public.application_match_eligibility(uuid,uuid),
  public.request_application_matches(jsonb,boolean),public.claim_application_match(text,text,text),public.claim_application_match_document(uuid),
  public.complete_application_match_document(uuid,uuid,jsonb),public.complete_application_match(uuid,uuid,jsonb),
  public.fail_application_match(uuid,uuid,text,boolean,integer),public.enforce_application_match()
  from public,anon,authenticated;
grant execute on function public.request_application_matches(jsonb,boolean) to authenticated;
grant execute on function public.claim_application_match(text,text,text),public.claim_application_match_document(uuid),
  public.complete_application_match_document(uuid,uuid,jsonb),public.complete_application_match(uuid,uuid,jsonb),
  public.fail_application_match(uuid,uuid,text,boolean,integer) to service_role;
