-- v1.5: short-lived, job-scoped capability tickets for the local tailoring
-- runner. Raw tickets are returned once and only SHA-256 hashes are stored.

create table public.tailoring_runner_tickets(
  id uuid primary key default gen_random_uuid(),
  tailoring_job_id uuid not null references public.tailoring_jobs(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique check(token_hash~'^[0-9a-f]{64}$'),
  status text not null default 'ISSUED' check(status in('ISSUED','CLAIMED','COMPLETED','FAILED','REVOKED')),
  expires_at timestamptz not null,
  claimed_at timestamptz,
  run_expires_at timestamptz,
  completed_at timestamptz,
  failure_code text check(failure_code is null or failure_code in('CODEX_FAILED','VALIDATION_FAILED','API_SUBMISSION_FAILED','WORKER_FAILED')),
  created_at timestamptz not null default now(),
  check(expires_at>created_at and expires_at<=created_at+interval '15 minutes'),
  check(run_expires_at is null or run_expires_at<=coalesce(claimed_at,created_at)+interval '45 minutes')
);
create index tailoring_runner_tickets_job_created_idx on public.tailoring_runner_tickets(tailoring_job_id,created_at desc);
create index tailoring_runner_tickets_active_expiry_idx on public.tailoring_runner_tickets(expires_at)
where status in('ISSUED','CLAIMED');

alter table public.tailoring_runner_tickets enable row level security;
revoke all on public.tailoring_runner_tickets from anon,authenticated;

create or replace function public.create_tailoring_runner_ticket_v15(p_tailoring_job_id uuid)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_job public.tailoring_jobs;v_token text;v_expires timestamptz:=now()+interval '10 minutes';v_id uuid;
begin
  perform public.assert_application_manager();
  select * into v_job from public.tailoring_jobs where id=p_tailoring_job_id for update;
  if not found or v_job.application_id is null then raise exception 'TAILORING_JOB_NOT_FOUND: The Application tailoring job was not found.' using errcode='P0001';end if;
  if v_job.status not in('PENDING','PROCESSING') or v_job.output_preview is not null then raise exception 'TAILORING_TICKET_UNAVAILABLE: A runner ticket requires a pending job without a preview.' using errcode='P0001';end if;
  update public.tailoring_runner_tickets set status='REVOKED',completed_at=now()
  where tailoring_job_id=v_job.id and status in('ISSUED','CLAIMED');
  if v_job.status='PROCESSING' then
    update public.tailoring_jobs set status='PENDING',processed_by=null,started_at=null,failure_code=null,failure_message=null where id=v_job.id;
  end if;
  v_token:='trt_'||regexp_replace(translate(encode(gen_random_bytes(32),'base64'),'+/','-_'),'=+$','');
  insert into public.tailoring_runner_tickets(tailoring_job_id,created_by,token_hash,expires_at)
  values(v_job.id,auth.uid(),encode(digest(v_token,'sha256'),'hex'),v_expires) returning id into v_id;
  return jsonb_build_object('ticketId',v_id,'jobId',v_job.id,'ticket',v_token,'expiresAt',v_expires);
end$$;

create or replace function public.claim_tailoring_runner_ticket_v15(p_ticket text)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_ticket public.tailoring_runner_tickets;v_job public.tailoring_jobs;v_application public.applications;v_resume public.resumes;v_jd public.job_descriptions;v_experience jsonb;
begin
  if coalesce(p_ticket,'')!~'^trt_[A-Za-z0-9_-]{43}$' then raise exception 'TAILORING_TICKET_INVALID: The runner ticket is invalid.' using errcode='P0001';end if;
  select * into v_ticket from public.tailoring_runner_tickets where token_hash=encode(digest(p_ticket,'sha256'),'hex') for update;
  if not found or v_ticket.status in('REVOKED','FAILED','COMPLETED') then raise exception 'TAILORING_TICKET_INVALID: The runner ticket is invalid or already used.' using errcode='P0001';end if;
  if (v_ticket.status='ISSUED' and v_ticket.expires_at<=now()) or (v_ticket.status='CLAIMED' and v_ticket.run_expires_at<=now()) then raise exception 'TAILORING_TICKET_EXPIRED: The runner ticket expired. Create a new ticket from the dashboard.' using errcode='P0001';end if;
  select * into v_job from public.tailoring_jobs where id=v_ticket.tailoring_job_id for update;
  if not found or v_job.application_id is null or v_job.output_preview is not null or v_job.status not in('PENDING','PROCESSING') then raise exception 'TAILORING_TICKET_UNAVAILABLE: The tailoring job is no longer available to this ticket.' using errcode='P0001';end if;
  select * into v_application from public.applications where id=v_job.application_id;
  select * into v_resume from public.resumes where id=v_job.resume_id;
  select * into v_jd from public.job_descriptions where id=v_job.job_description_id;
  if v_application.resume_id is distinct from v_resume.id or v_application.job_description_id is distinct from v_jd.id or v_resume.resume_type<>'ORIGINAL' or v_resume.status<>'ACTIVE' then raise exception 'TAILORING_SOURCE_CHANGED: The Application source is no longer eligible.' using errcode='P0001';end if;
  select jsonb_agg(jsonb_build_object(
    'id',x.value->>'id','company',x.value->>'company','title',x.value->>'job_title','location',nullif(x.value->>'location',''),
    'startDate',case when jsonb_typeof(x.value->'start_date')='object' then concat(x.value->'start_date'->>'year',case when coalesce((x.value->'start_date'->>'month')::integer,0)>0 then '-'||lpad(x.value->'start_date'->>'month',2,'0') else '' end) else null end,
    'endDate',case when lower(coalesce(x.value->>'is_current','false')) in('true','t','1','yes') then null when jsonb_typeof(x.value->'end_date')='object' then concat(x.value->'end_date'->>'year',case when coalesce((x.value->'end_date'->>'month')::integer,0)>0 then '-'||lpad(x.value->'end_date'->>'month',2,'0') else '' end) else null end,
    'details',x.value->>'experience_details') order by x.ordinality) into v_experience
  from jsonb_array_elements(v_resume.structured_content->'professional_experience') with ordinality x(value,ordinality);
  if v_ticket.status='ISSUED' then
    update public.tailoring_runner_tickets set status='CLAIMED',claimed_at=now(),run_expires_at=now()+interval '30 minutes' where id=v_ticket.id returning * into v_ticket;
  end if;
  update public.tailoring_jobs set status='PROCESSING',started_at=coalesce(started_at,now()),processed_by=v_ticket.created_by,failure_code=null,failure_message=null where id=v_job.id;
  return jsonb_build_object('ticketId',v_ticket.id,'jobId',v_job.id,'runExpiresAt',v_ticket.run_expires_at,'input',jsonb_build_object(
    'contractVersion','1.2','application',jsonb_build_object('id',v_application.id,'applicationNumber',v_application.application_number),
    'jobDescription',jsonb_build_object('id',v_jd.id,'company',v_jd.company,'jobTitle',v_jd.job_title,'descriptionText',v_jd.description_text,'skills',to_jsonb(v_jd.detected_skills)),
    'sourceResume',jsonb_build_object('id',v_resume.id,'resumeNumber',v_resume.resume_number,'resumeType','ORIGINAL','summary',v_resume.structured_content->>'summary','skills',to_jsonb(v_resume.skills),'professionalExperience',coalesce(v_experience,'[]'::jsonb))));
end$$;

create or replace function public.submit_tailoring_runner_preview_v15(p_ticket text,p_preview jsonb,p_generated_at timestamptz)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_ticket public.tailoring_runner_tickets;v_job public.tailoring_jobs;v_generated_at timestamptz:=now();
begin
  if coalesce(p_ticket,'')!~'^trt_[A-Za-z0-9_-]{43}$' then raise exception 'TAILORING_TICKET_INVALID: The runner ticket is invalid.' using errcode='P0001';end if;
  select * into v_ticket from public.tailoring_runner_tickets where token_hash=encode(digest(p_ticket,'sha256'),'hex') for update;
  if not found or v_ticket.status<>'CLAIMED' then raise exception 'TAILORING_TICKET_INVALID: The runner ticket is invalid or already used.' using errcode='P0001';end if;
  if v_ticket.run_expires_at<=now() then raise exception 'TAILORING_TICKET_EXPIRED: The runner session expired. Create a new ticket from the dashboard.' using errcode='P0001';end if;
  select * into v_job from public.tailoring_jobs where id=v_ticket.tailoring_job_id for update;
  if not found or v_job.status<>'PROCESSING' or v_job.processed_by is distinct from v_ticket.created_by or v_job.output_preview is not null then raise exception 'TAILORING_TICKET_UNAVAILABLE: The tailoring job is no longer available to this ticket.' using errcode='P0001';end if;
  perform public.assert_tailoring_preview_v14(v_job.resume_id,p_preview);
  update public.tailoring_jobs set status='NEEDS_REVIEW',output_schema_version=1,output_preview=p_preview,preview_generated_at=v_generated_at,completed_at=now(),failure_code=null,failure_message=null where id=v_job.id;
  update public.tailoring_runner_tickets set status='COMPLETED',completed_at=now() where id=v_ticket.id;
  return jsonb_build_object('id',v_job.id,'applicationId',v_job.application_id,'status','NEEDS_REVIEW','outputSchemaVersion',1,'previewGeneratedAt',v_generated_at);
end$$;

create or replace function public.fail_tailoring_runner_v15(p_ticket text,p_failure_code text)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_ticket public.tailoring_runner_tickets;v_code text:=upper(btrim(coalesce(p_failure_code,'')));
begin
  if coalesce(p_ticket,'')!~'^trt_[A-Za-z0-9_-]{43}$' or v_code not in('CODEX_FAILED','VALIDATION_FAILED','API_SUBMISSION_FAILED','WORKER_FAILED') then raise exception 'TAILORING_TICKET_INVALID: The runner failure report is invalid.' using errcode='P0001';end if;
  select * into v_ticket from public.tailoring_runner_tickets where token_hash=encode(digest(p_ticket,'sha256'),'hex') for update;
  if not found or v_ticket.status<>'CLAIMED' then raise exception 'TAILORING_TICKET_INVALID: The runner ticket is invalid or no longer active.' using errcode='P0001';end if;
  update public.tailoring_jobs set status='FAILED',completed_at=now(),failure_code=v_code,failure_message='The local tailoring runner did not complete. Create a new Application tailoring request and retry.' where id=v_ticket.tailoring_job_id and status='PROCESSING' and processed_by=v_ticket.created_by;
  update public.tailoring_runner_tickets set status='FAILED',failure_code=v_code,completed_at=now() where id=v_ticket.id;
  return jsonb_build_object('jobId',v_ticket.tailoring_job_id,'status','FAILED','failureCode',v_code);
end$$;

revoke all on function public.create_tailoring_runner_ticket_v15(uuid) from public,anon;
grant execute on function public.create_tailoring_runner_ticket_v15(uuid) to authenticated;
revoke all on function public.claim_tailoring_runner_ticket_v15(text) from public;
revoke all on function public.submit_tailoring_runner_preview_v15(text,jsonb,timestamptz) from public;
revoke all on function public.fail_tailoring_runner_v15(text,text) from public;
grant execute on function public.claim_tailoring_runner_ticket_v15(text) to anon;
grant execute on function public.submit_tailoring_runner_preview_v15(text,jsonb,timestamptz) to anon;
grant execute on function public.fail_tailoring_runner_v15(text,text) to anon;

comment on table public.tailoring_runner_tickets is 'Hashed, expiring, one-job capabilities for the local v1.5 Codex runner; raw tickets are never persisted.';
