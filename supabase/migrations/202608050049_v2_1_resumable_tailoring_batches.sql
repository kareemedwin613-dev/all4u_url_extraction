-- v2.1: resumable, rate-limit-aware tailoring batches with job leases and
-- sanitized per-item diagnostics. Human review and materialization stay per job.

create table public.tailoring_batches(
  id uuid primary key default gen_random_uuid(),
  name text check(name is null or char_length(name) between 1 and 120),
  status text not null default 'PENDING' check(status in('PENDING','RUNNING','PAUSED_RATE_LIMIT','COMPLETED','COMPLETED_WITH_FAILURES','CANCELLED')),
  selected_count integer not null default 0 check(selected_count>=0),
  pending_count integer not null default 0 check(pending_count>=0),
  processing_count integer not null default 0 check(processing_count>=0),
  waiting_retry_count integer not null default 0 check(waiting_retry_count>=0),
  review_count integer not null default 0 check(review_count>=0),
  failed_count integer not null default 0 check(failed_count>=0),
  skipped_count integer not null default 0 check(skipped_count>=0),
  cancelled_count integer not null default 0 check(cancelled_count>=0),
  rate_limit_count integer not null default 0 check(rate_limit_count>=0),
  next_retry_at timestamptz,
  pause_reason text check(pause_reason is null or char_length(pause_reason)<=500),
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),started_at timestamptz,completed_at timestamptz
);
create index tailoring_batches_created_idx on public.tailoring_batches(created_at desc,id desc);
create index tailoring_batches_active_idx on public.tailoring_batches(status,updated_at desc) where status in('PENDING','RUNNING','PAUSED_RATE_LIMIT');
create trigger tailoring_batches_updated before update on public.tailoring_batches for each row execute function public.set_updated_at();

create table public.tailoring_batch_items(
  id uuid primary key default gen_random_uuid(),batch_id uuid not null references public.tailoring_batches(id) on delete cascade,
  tailoring_job_id uuid references public.tailoring_jobs(id) on delete cascade,application_id uuid not null references public.applications(id) on delete cascade,
  ordinal integer not null check(ordinal>0),status text not null default 'PENDING' check(status in('PENDING','PROCESSING','WAITING_RETRY','NEEDS_REVIEW','FAILED','SKIPPED','CANCELLED')),
  attempt_count integer not null default 0 check(attempt_count>=0),rate_limit_count integer not null default 0 check(rate_limit_count>=0),
  lease_token uuid,lease_expires_at timestamptz,next_retry_at timestamptz,
  failure_stage text check(failure_stage is null or failure_stage in('SOURCE_VALIDATION','TICKET_CLAIM','CODEX_LAUNCH','CODEX_GENERATION','OUTPUT_PARSING','OUTPUT_VALIDATION','API_SUBMISSION','SOURCE_CHANGED','LEASE_EXPIRED','UNKNOWN')),
  failure_code text check(failure_code is null or char_length(failure_code)<=100),failure_message text check(failure_message is null or char_length(failure_message)<=1000),retryable boolean not null default false,
  started_at timestamptz,finished_at timestamptz,duration_ms integer check(duration_ms is null or duration_ms>=0),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  unique(batch_id,application_id),unique(batch_id,tailoring_job_id),unique(batch_id,ordinal)
);
create index tailoring_batch_items_next_idx on public.tailoring_batch_items(batch_id,status,next_retry_at,ordinal);
create index tailoring_batch_items_job_idx on public.tailoring_batch_items(tailoring_job_id);
create trigger tailoring_batch_items_updated before update on public.tailoring_batch_items for each row execute function public.set_updated_at();

create table public.tailoring_batch_runner_tickets(
  id uuid primary key default gen_random_uuid(),batch_id uuid not null references public.tailoring_batches(id) on delete cascade,created_by uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique check(token_hash~'^[0-9a-f]{64}$'),status text not null default 'ISSUED' check(status in('ISSUED','CLAIMED','COMPLETED','REVOKED')),
  expires_at timestamptz not null,claimed_at timestamptz,run_expires_at timestamptz,completed_at timestamptz,created_at timestamptz not null default now()
);
create index tailoring_batch_runner_tickets_batch_idx on public.tailoring_batch_runner_tickets(batch_id,created_at desc);

alter table public.tailoring_batches enable row level security;
alter table public.tailoring_batch_items enable row level security;
alter table public.tailoring_batch_runner_tickets enable row level security;
create policy "application managers read tailoring batches" on public.tailoring_batches for select to authenticated using((select public.application_actor_can_manage()));
create policy "application managers read tailoring batch items" on public.tailoring_batch_items for select to authenticated using((select public.application_actor_can_manage()));
grant select on public.tailoring_batches,public.tailoring_batch_items to authenticated;
revoke insert,update,delete on public.tailoring_batches,public.tailoring_batch_items from authenticated;
revoke all on public.tailoring_batch_runner_tickets from anon,authenticated;

create or replace function public.sanitize_tailoring_failure_v21(p_message text)
returns text language sql immutable set search_path=public,pg_temp as $$
  select left(regexp_replace(regexp_replace(coalesce(p_message,''),'tr[bt]_[A-Za-z0-9_-]{20,}','[REDACTED]','g'),'[\r\n\t]+',' ','g'),1000)
$$;

create or replace function public.refresh_tailoring_batch_v21(p_batch_id uuid)
returns public.tailoring_batches language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.tailoring_batches;v_pending int;v_processing int;v_waiting int;v_review int;v_failed int;v_skipped int;v_cancelled int;v_next timestamptz;
begin
  select count(*) filter(where status='PENDING'),count(*) filter(where status='PROCESSING'),count(*) filter(where status='WAITING_RETRY'),count(*) filter(where status='NEEDS_REVIEW'),count(*) filter(where status='FAILED'),count(*) filter(where status='SKIPPED'),count(*) filter(where status='CANCELLED'),min(next_retry_at) filter(where status='WAITING_RETRY')
  into v_pending,v_processing,v_waiting,v_review,v_failed,v_skipped,v_cancelled,v_next from public.tailoring_batch_items where batch_id=p_batch_id;
  update public.tailoring_batches set pending_count=v_pending,processing_count=v_processing,waiting_retry_count=v_waiting,review_count=v_review,failed_count=v_failed,skipped_count=v_skipped,cancelled_count=v_cancelled,next_retry_at=v_next,
    status=case when status='CANCELLED' then status when v_next>now() then 'PAUSED_RATE_LIMIT' when v_processing>0 or v_pending>0 or v_waiting>0 then case when started_at is null then 'PENDING' else 'RUNNING' end when v_failed+v_skipped>0 then 'COMPLETED_WITH_FAILURES' else 'COMPLETED' end,
    completed_at=case when v_processing+v_pending+v_waiting=0 then coalesce(completed_at,now()) else null end
  where id=p_batch_id returning * into v;return v;
end$$;

create or replace function public.create_tailoring_batch_v21(p_application_ids uuid[],p_name text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_batch uuid:=gen_random_uuid();v_id uuid;v_ordinal int:=0;v_receipt jsonb;v_status text;v_job uuid;v_batch_row public.tailoring_batches;
begin
  perform public.assert_application_manager();
  if coalesce(array_length(p_application_ids,1),0) not between 1 and 500 then raise exception 'TAILORING_BATCH_LIMIT: Select between 1 and 500 Applications.' using errcode='22023';end if;
  if nullif(btrim(coalesce(p_name,'')),'') is not null and char_length(btrim(p_name))>120 then raise exception 'TAILORING_BATCH_INVALID: Batch name is too long.' using errcode='22023';end if;
  insert into public.tailoring_batches(id,name,selected_count,created_by) values(v_batch,nullif(btrim(coalesce(p_name,'')),''),(select count(distinct x) from unnest(p_application_ids)x),auth.uid());
  for v_id in select distinct x from unnest(p_application_ids)x loop v_ordinal:=v_ordinal+1;
    begin
      v_receipt:=public.request_application_tailoring_v13(v_id);v_job:=(v_receipt->>'id')::uuid;v_status:=v_receipt->>'status';
      insert into public.tailoring_batch_items(batch_id,tailoring_job_id,application_id,ordinal,status,retryable,finished_at)
      values(v_batch,v_job,v_id,v_ordinal,case when v_status in('NEEDS_REVIEW','APPROVED','MATERIALIZING','COMPLETED') then 'NEEDS_REVIEW' when v_status='PROCESSING' then 'SKIPPED' else 'PENDING' end,false,case when v_status in('NEEDS_REVIEW','APPROVED','MATERIALIZING','COMPLETED','PROCESSING') then now() else null end);
      if v_status='PROCESSING' then update public.tailoring_batch_items set failure_stage='SOURCE_VALIDATION',failure_code='ALREADY_PROCESSING',failure_message='Another runner is already processing this tailoring job.' where batch_id=v_batch and application_id=v_id;end if;
    exception when others then
      insert into public.tailoring_batch_items(batch_id,application_id,ordinal,status,failure_stage,failure_code,failure_message,retryable,finished_at)
      values(v_batch,v_id,v_ordinal,'SKIPPED','SOURCE_VALIDATION','APPLICATION_INELIGIBLE',public.sanitize_tailoring_failure_v21(sqlerrm),false,now());
    end;
  end loop;
  v_batch_row:=public.refresh_tailoring_batch_v21(v_batch);
  return to_jsonb(v_batch_row);
end$$;

create or replace function public.create_tailoring_batch_ticket_v21(p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_batch public.tailoring_batches;v_token text;v_id uuid;v_exp timestamptz:=now()+interval '15 minutes';
begin
  perform public.assert_application_manager();select * into v_batch from public.tailoring_batches where id=p_batch_id for update;
  if not found then raise exception 'TAILORING_BATCH_NOT_FOUND: The tailoring batch was not found.' using errcode='P0001';end if;
  if v_batch.status in('COMPLETED','COMPLETED_WITH_FAILURES','CANCELLED') and v_batch.pending_count+v_batch.waiting_retry_count=0 then raise exception 'TAILORING_BATCH_UNAVAILABLE: This batch has no runnable jobs.' using errcode='P0001';end if;
  update public.tailoring_batch_runner_tickets set status='REVOKED',completed_at=now() where batch_id=p_batch_id and status in('ISSUED','CLAIMED');
  update public.tailoring_batch_items set status='PENDING',lease_token=null,lease_expires_at=null,failure_stage='LEASE_EXPIRED',failure_code='RUNNER_REPLACED',failure_message='The previous runner was replaced; this item was safely requeued.',retryable=false where batch_id=p_batch_id and status='PROCESSING';
  update public.tailoring_jobs j set status='PENDING',processed_by=null,started_at=null,completed_at=null,failure_code=null,failure_message=null from public.tailoring_batch_items i where i.batch_id=p_batch_id and i.tailoring_job_id=j.id and i.status='PENDING' and i.failure_code='RUNNER_REPLACED';
  perform public.refresh_tailoring_batch_v21(p_batch_id);
  v_token:='trb_'||regexp_replace(translate(encode(gen_random_bytes(32),'base64'),'+/','-_'),'=+$','');
  insert into public.tailoring_batch_runner_tickets(batch_id,created_by,token_hash,expires_at) values(p_batch_id,auth.uid(),encode(digest(v_token,'sha256'),'hex'),v_exp) returning id into v_id;
  return jsonb_build_object('ticketId',v_id,'batchId',p_batch_id,'ticket',v_token,'expiresAt',v_exp);
end$$;

create or replace function public.claim_tailoring_batch_ticket_v21(p_ticket text)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_ticket public.tailoring_batch_runner_tickets;v_batch public.tailoring_batches;
begin
  if coalesce(p_ticket,'')!~'^trb_[A-Za-z0-9_-]{43}$' then raise exception 'TAILORING_BATCH_TICKET_INVALID: The batch ticket is invalid.' using errcode='P0001';end if;
  select * into v_ticket from public.tailoring_batch_runner_tickets where token_hash=encode(digest(p_ticket,'sha256'),'hex') for update;
  if not found or v_ticket.status in('REVOKED','COMPLETED') then raise exception 'TAILORING_BATCH_TICKET_INVALID: The batch ticket is invalid or completed.' using errcode='P0001';end if;
  if (v_ticket.status='ISSUED' and v_ticket.expires_at<=now()) or (v_ticket.status='CLAIMED' and v_ticket.run_expires_at<=now()) then raise exception 'TAILORING_BATCH_TICKET_EXPIRED: Create a new batch command.' using errcode='P0001';end if;
  if v_ticket.status='ISSUED' then update public.tailoring_batch_runner_tickets set status='CLAIMED',claimed_at=now(),run_expires_at=now()+interval '12 hours' where id=v_ticket.id returning * into v_ticket;end if;
  update public.tailoring_batches set status=case when status='PENDING' then 'RUNNING' else status end,started_at=coalesce(started_at,now()) where id=v_ticket.batch_id returning * into v_batch;
  return jsonb_build_object('ticketId',v_ticket.id,'batchId',v_batch.id,'runExpiresAt',v_ticket.run_expires_at,'selectedCount',v_batch.selected_count,'status',v_batch.status);
end$$;

create or replace function public.build_tailoring_input_v21(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_job public.tailoring_jobs;v_application public.applications;v_resume public.resumes;v_jd public.job_descriptions;v_experience jsonb;
begin
  select * into v_job from public.tailoring_jobs where id=p_job_id;select * into v_application from public.applications where id=v_job.application_id;select * into v_resume from public.resumes where id=v_job.resume_id;select * into v_jd from public.job_descriptions where id=v_job.job_description_id;
  if v_job.id is null or v_application.id is null or v_application.resume_id is distinct from v_resume.id or v_application.job_description_id is distinct from v_jd.id or v_resume.resume_type<>'ORIGINAL' or v_resume.status<>'ACTIVE' or v_jd.status<>'ACTIVE' then raise exception 'TAILORING_SOURCE_CHANGED: The Application source is no longer eligible.' using errcode='P0001';end if;
  select jsonb_agg(jsonb_build_object('id',x.value->>'id','company',x.value->>'company','title',x.value->>'job_title','location',nullif(x.value->>'location',''),'startDate',case when jsonb_typeof(x.value->'start_date')='object' then concat(x.value->'start_date'->>'year',case when coalesce((x.value->'start_date'->>'month')::integer,0)>0 then '-'||lpad(x.value->'start_date'->>'month',2,'0') else '' end) else null end,'endDate',case when lower(coalesce(x.value->>'is_current','false')) in('true','t','1','yes') then null when jsonb_typeof(x.value->'end_date')='object' then concat(x.value->'end_date'->>'year',case when coalesce((x.value->'end_date'->>'month')::integer,0)>0 then '-'||lpad(x.value->'end_date'->>'month',2,'0') else '' end) else null end,'details',x.value->>'experience_details') order by x.ordinality) into v_experience from jsonb_array_elements(v_resume.structured_content->'professional_experience') with ordinality x(value,ordinality);
  return jsonb_build_object('contractVersion','1.2','application',jsonb_build_object('id',v_application.id,'applicationNumber',v_application.application_number),'jobDescription',jsonb_build_object('id',v_jd.id,'company',v_jd.company,'jobTitle',v_jd.job_title,'descriptionText',v_jd.description_text,'skills',to_jsonb(v_jd.detected_skills)),'sourceResume',jsonb_build_object('id',v_resume.id,'resumeNumber',v_resume.resume_number,'resumeType','ORIGINAL','summary',v_resume.structured_content->>'summary','skills',to_jsonb(v_resume.skills),'professionalExperience',coalesce(v_experience,'[]'::jsonb)));
end$$;

create or replace function public.next_tailoring_batch_item_v21(p_ticket text)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_ticket public.tailoring_batch_runner_tickets;v_batch public.tailoring_batches;v_item public.tailoring_batch_items;v_lease uuid:=gen_random_uuid();v_input jsonb;v_retry int;
begin
  if coalesce(p_ticket,'')!~'^trb_[A-Za-z0-9_-]{43}$' then raise exception 'TAILORING_BATCH_TICKET_INVALID: The batch ticket is invalid.' using errcode='P0001';end if;
  select * into v_ticket from public.tailoring_batch_runner_tickets where token_hash=encode(digest(p_ticket,'sha256'),'hex') and status='CLAIMED' for update;
  if not found or v_ticket.run_expires_at<=now() then raise exception 'TAILORING_BATCH_TICKET_EXPIRED: Create a new batch command.' using errcode='P0001';end if;
  update public.tailoring_batch_items set status='WAITING_RETRY',failure_stage='LEASE_EXPIRED',failure_code='LEASE_EXPIRED',failure_message='The previous worker lease expired before submission.',retryable=true,next_retry_at=now(),lease_token=null,lease_expires_at=null where batch_id=v_ticket.batch_id and status='PROCESSING' and lease_expires_at<=now();
  update public.tailoring_jobs j set status='PENDING',processed_by=null,started_at=null,completed_at=null,failure_code=null,failure_message=null from public.tailoring_batch_items i where i.batch_id=v_ticket.batch_id and i.tailoring_job_id=j.id and i.status='WAITING_RETRY' and i.failure_code='LEASE_EXPIRED';
  update public.tailoring_batch_items set status='PENDING',next_retry_at=null where batch_id=v_ticket.batch_id and status='WAITING_RETRY' and next_retry_at<=now();
  select * into v_batch from public.refresh_tailoring_batch_v21(v_ticket.batch_id);
  if v_batch.status='CANCELLED' then return jsonb_build_object('state','CANCELLED','batchId',v_batch.id);end if;
  if v_batch.status='PAUSED_RATE_LIMIT' and v_batch.next_retry_at>now() then v_retry:=greatest(1,ceil(extract(epoch from(v_batch.next_retry_at-now())))::int);return jsonb_build_object('state','RATE_LIMITED','batchId',v_batch.id,'retryAfterSeconds',v_retry,'nextRetryAt',v_batch.next_retry_at);end if;
  select * into v_item from public.tailoring_batch_items where batch_id=v_ticket.batch_id and status='PENDING' order by ordinal for update skip locked limit 1;
  if not found then
    v_batch:=public.refresh_tailoring_batch_v21(v_ticket.batch_id);
    if v_batch.status in('COMPLETED','COMPLETED_WITH_FAILURES') then update public.tailoring_batch_runner_tickets set status='COMPLETED',completed_at=now() where id=v_ticket.id;end if;
    return jsonb_build_object('state',v_batch.status,'batchId',v_batch.id,'pendingCount',v_batch.pending_count,'processingCount',v_batch.processing_count,'waitingRetryCount',v_batch.waiting_retry_count,'reviewCount',v_batch.review_count,'failedCount',v_batch.failed_count,'skippedCount',v_batch.skipped_count);
  end if;
  begin v_input:=public.build_tailoring_input_v21(v_item.tailoring_job_id);exception when others then update public.tailoring_batch_items set status='FAILED',failure_stage='SOURCE_CHANGED',failure_code='SOURCE_CHANGED',failure_message=public.sanitize_tailoring_failure_v21(sqlerrm),retryable=false,finished_at=now() where id=v_item.id;update public.tailoring_jobs set status='FAILED',failure_code='SOURCE_CHANGED',failure_message='The Application source changed before tailoring.',completed_at=now() where id=v_item.tailoring_job_id;perform public.refresh_tailoring_batch_v21(v_item.batch_id);return jsonb_build_object('state','SKIPPED','itemId',v_item.id,'reason','SOURCE_CHANGED');end;
  update public.tailoring_batch_items set status='PROCESSING',attempt_count=attempt_count+1,lease_token=v_lease,lease_expires_at=now()+interval '20 minutes',started_at=now(),finished_at=null,failure_stage=null,failure_code=null,failure_message=null,retryable=false where id=v_item.id;
  update public.tailoring_jobs set status='PROCESSING',started_at=coalesce(started_at,now()),processed_by=v_ticket.created_by,failure_code=null,failure_message=null where id=v_item.tailoring_job_id;
  update public.tailoring_batches set status='RUNNING',started_at=coalesce(started_at,now()),pause_reason=null,next_retry_at=null where id=v_ticket.batch_id;
  return jsonb_build_object('state','JOB','batchId',v_ticket.batch_id,'itemId',v_item.id,'jobId',v_item.tailoring_job_id,'leaseToken',v_lease,'leaseExpiresAt',now()+interval '20 minutes','attemptNumber',v_item.attempt_count+1,'input',v_input);
end$$;

create or replace function public.submit_tailoring_batch_preview_v21(p_ticket text,p_item_id uuid,p_lease_token uuid,p_preview jsonb,p_generated_at timestamptz)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_ticket public.tailoring_batch_runner_tickets;v_item public.tailoring_batch_items;v_job public.tailoring_jobs;v_batch public.tailoring_batches;
begin
  select * into v_ticket from public.tailoring_batch_runner_tickets where token_hash=encode(digest(p_ticket,'sha256'),'hex') and status='CLAIMED';if not found or v_ticket.run_expires_at<=now() then raise exception 'TAILORING_BATCH_TICKET_EXPIRED: Create a new batch command.' using errcode='P0001';end if;
  select * into v_item from public.tailoring_batch_items where id=p_item_id and batch_id=v_ticket.batch_id for update;if not found or v_item.status<>'PROCESSING' or v_item.lease_token is distinct from p_lease_token or v_item.lease_expires_at<=now() then raise exception 'TAILORING_BATCH_LEASE_INVALID: The item lease expired or changed.' using errcode='P0001';end if;
  select * into v_job from public.tailoring_jobs where id=v_item.tailoring_job_id for update;perform public.assert_tailoring_preview_v14(v_job.resume_id,p_preview);
  update public.tailoring_jobs set status='NEEDS_REVIEW',output_schema_version=1,output_preview=p_preview,preview_generated_at=now(),completed_at=now(),failure_code=null,failure_message=null where id=v_job.id;
  update public.tailoring_batch_items set status='NEEDS_REVIEW',lease_token=null,lease_expires_at=null,finished_at=now(),duration_ms=greatest(0,(extract(epoch from(now()-started_at))*1000)::int),retryable=false where id=v_item.id;
  v_batch:=public.refresh_tailoring_batch_v21(v_item.batch_id);return jsonb_build_object('itemId',v_item.id,'jobId',v_job.id,'status','NEEDS_REVIEW','batchStatus',v_batch.status,'reviewCount',v_batch.review_count);
end$$;

create or replace function public.fail_tailoring_batch_item_v21(p_ticket text,p_item_id uuid,p_lease_token uuid,p_stage text,p_code text,p_message text,p_retryable boolean,p_rate_limited boolean,p_retry_after_seconds integer default null)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_ticket public.tailoring_batch_runner_tickets;v_item public.tailoring_batch_items;v_batch public.tailoring_batches;v_stage text:=upper(btrim(coalesce(p_stage,'UNKNOWN')));v_code text:=upper(left(btrim(coalesce(p_code,'WORKER_FAILED')),100));v_message text:=public.sanitize_tailoring_failure_v21(p_message);v_delay int:=least(900,greatest(30,coalesce(p_retry_after_seconds,60)));
begin
  if v_stage not in('SOURCE_VALIDATION','TICKET_CLAIM','CODEX_LAUNCH','CODEX_GENERATION','OUTPUT_PARSING','OUTPUT_VALIDATION','API_SUBMISSION','SOURCE_CHANGED','LEASE_EXPIRED','UNKNOWN') then v_stage:='UNKNOWN';end if;
  select * into v_ticket from public.tailoring_batch_runner_tickets where token_hash=encode(digest(p_ticket,'sha256'),'hex') and status='CLAIMED';if not found or v_ticket.run_expires_at<=now() then raise exception 'TAILORING_BATCH_TICKET_EXPIRED: Create a new batch command.' using errcode='P0001';end if;
  select * into v_item from public.tailoring_batch_items where id=p_item_id and batch_id=v_ticket.batch_id for update;if not found or v_item.status<>'PROCESSING' or v_item.lease_token is distinct from p_lease_token then raise exception 'TAILORING_BATCH_LEASE_INVALID: The item lease expired or changed.' using errcode='P0001';end if;
  if p_rate_limited then
    update public.tailoring_batch_items set status='WAITING_RETRY',rate_limit_count=rate_limit_count+1,next_retry_at=now()+make_interval(secs=>v_delay),failure_stage=v_stage,failure_code='RATE_LIMITED',failure_message=v_message,retryable=true,lease_token=null,lease_expires_at=null where id=v_item.id;
    update public.tailoring_jobs set status='PENDING',processed_by=null,started_at=null,completed_at=null,failure_code=null,failure_message=null where id=v_item.tailoring_job_id;
    update public.tailoring_batches set status='PAUSED_RATE_LIMIT',rate_limit_count=rate_limit_count+1,next_retry_at=now()+make_interval(secs=>v_delay),pause_reason=v_message where id=v_item.batch_id;
  else
    update public.tailoring_batch_items set status='FAILED',failure_stage=v_stage,failure_code=v_code,failure_message=v_message,retryable=coalesce(p_retryable,false),lease_token=null,lease_expires_at=null,finished_at=now(),duration_ms=greatest(0,(extract(epoch from(now()-started_at))*1000)::int) where id=v_item.id;
    update public.tailoring_jobs set status='FAILED',failure_code=v_code,failure_message=v_message,completed_at=now() where id=v_item.tailoring_job_id;
  end if;
  v_batch:=public.refresh_tailoring_batch_v21(v_item.batch_id);return jsonb_build_object('itemId',v_item.id,'status',case when p_rate_limited then 'WAITING_RETRY' else 'FAILED' end,'batchStatus',v_batch.status,'nextRetryAt',v_batch.next_retry_at,'retryable',case when p_rate_limited then true else p_retryable end);
end$$;

create or replace function public.retry_tailoring_batch_items_v21(p_batch_id uuid,p_item_ids uuid[] default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_count int;v_batch public.tailoring_batches;
begin
  perform public.assert_application_manager();
  update public.tailoring_jobs j set status='PENDING',output_preview=null,output_schema_version=null,preview_generated_at=null,processed_by=null,failure_code=null,failure_message=null,started_at=null,completed_at=null from public.tailoring_batch_items i where i.batch_id=p_batch_id and i.tailoring_job_id=j.id and i.status='FAILED' and i.retryable and(p_item_ids is null or i.id=any(p_item_ids));
  update public.tailoring_batch_items set status='PENDING',failure_stage=null,failure_code=null,failure_message=null,retryable=false,next_retry_at=null,finished_at=null where batch_id=p_batch_id and status='FAILED' and retryable and(p_item_ids is null or id=any(p_item_ids));get diagnostics v_count=row_count;
  if v_count=0 then raise exception 'TAILORING_BATCH_RETRY_EMPTY: No retryable failed items were selected.' using errcode='P0001';end if;
  update public.tailoring_batches set status='RUNNING',completed_at=null,pause_reason=null,next_retry_at=null where id=p_batch_id;v_batch:=public.refresh_tailoring_batch_v21(p_batch_id);return jsonb_build_object('batchId',p_batch_id,'retriedCount',v_count,'status',v_batch.status);
end$$;

create or replace function public.cancel_tailoring_batch_v21(p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_count int;
begin
  perform public.assert_application_manager();
  update public.tailoring_batch_items set status='CANCELLED',lease_token=null,lease_expires_at=null,next_retry_at=null,finished_at=now(),retryable=false where batch_id=p_batch_id and status in('PENDING','PROCESSING','WAITING_RETRY');get diagnostics v_count=row_count;
  update public.tailoring_jobs j set status='CANCELLED',completed_at=now(),processed_by=null from public.tailoring_batch_items i where i.batch_id=p_batch_id and i.tailoring_job_id=j.id and i.status='CANCELLED' and j.status in('PENDING','PROCESSING');
  update public.tailoring_batches set status='CANCELLED',completed_at=now(),next_retry_at=null,pause_reason='Cancelled by an Application Manager.' where id=p_batch_id;
  update public.tailoring_batch_runner_tickets set status='REVOKED',completed_at=now() where batch_id=p_batch_id and status in('ISSUED','CLAIMED');
  return jsonb_build_object('batchId',p_batch_id,'status','CANCELLED','cancelledCount',v_count);
end$$;

revoke all on function public.sanitize_tailoring_failure_v21(text),public.refresh_tailoring_batch_v21(uuid),public.build_tailoring_input_v21(uuid) from public,anon,authenticated;
revoke all on function public.create_tailoring_batch_v21(uuid[],text),public.create_tailoring_batch_ticket_v21(uuid),public.retry_tailoring_batch_items_v21(uuid,uuid[]),public.cancel_tailoring_batch_v21(uuid) from public,anon;
grant execute on function public.create_tailoring_batch_v21(uuid[],text),public.create_tailoring_batch_ticket_v21(uuid),public.retry_tailoring_batch_items_v21(uuid,uuid[]),public.cancel_tailoring_batch_v21(uuid) to authenticated;
revoke all on function public.claim_tailoring_batch_ticket_v21(text),public.next_tailoring_batch_item_v21(text),public.submit_tailoring_batch_preview_v21(text,uuid,uuid,jsonb,timestamptz),public.fail_tailoring_batch_item_v21(text,uuid,uuid,text,text,text,boolean,boolean,integer) from public,authenticated;
grant execute on function public.claim_tailoring_batch_ticket_v21(text),public.next_tailoring_batch_item_v21(text),public.submit_tailoring_batch_preview_v21(text,uuid,uuid,jsonb,timestamptz),public.fail_tailoring_batch_item_v21(text,uuid,uuid,text,text,text,boolean,boolean,integer) to anon;
