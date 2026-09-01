-- v3.34: automatically approve every structurally valid tailoring result,
-- select one ATS-safe template at random, and materialize it in the same API
-- submission request. Manual review/template selection remain available only
-- for legacy previews and recovery after a rendering failure.

alter table public.tailoring_jobs
  add column automatic_materialization boolean not null default false;

alter table public.tailoring_batch_items
  drop constraint if exists tailoring_batch_items_status_check;
alter table public.tailoring_batch_items
  add constraint tailoring_batch_items_status_check check(status in(
    'PENDING','PROCESSING','WAITING_RETRY','NEEDS_REVIEW','COMPLETED','FAILED','SKIPPED','CANCELLED'
  ));
alter table public.tailoring_batches
  add column completed_count integer not null default 0 check(completed_count>=0);

create or replace function public.random_tailored_resume_template_v34()
returns text language sql volatile set search_path=public,pg_temp as $$
  select (array[
    'CLASSIC_V1','MODERN_V1','COMPACT_V1','EXECUTIVE_V1','TECHNICAL_V1','MINIMAL_V1',
    'CORPORATE_V1','ELEGANT_V1','SLATE_V1','EMERALD_V1','ACADEMIC_V1','IMPACT_V1'
  ])[1+floor(random()*12)::integer]
$$;

create or replace function public.refresh_tailoring_batch_v21(p_batch_id uuid)
returns public.tailoring_batches language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.tailoring_batches;v_pending int;v_processing int;v_waiting int;v_review int;v_completed int;v_failed int;v_skipped int;v_cancelled int;v_next timestamptz;
begin
  select count(*) filter(where status='PENDING'),count(*) filter(where status='PROCESSING'),count(*) filter(where status='WAITING_RETRY'),count(*) filter(where status='NEEDS_REVIEW'),count(*) filter(where status='COMPLETED'),count(*) filter(where status='FAILED'),count(*) filter(where status='SKIPPED'),count(*) filter(where status='CANCELLED'),min(next_retry_at) filter(where status='WAITING_RETRY')
  into v_pending,v_processing,v_waiting,v_review,v_completed,v_failed,v_skipped,v_cancelled,v_next from public.tailoring_batch_items where batch_id=p_batch_id;
  update public.tailoring_batches set pending_count=v_pending,processing_count=v_processing,waiting_retry_count=v_waiting,review_count=v_review,completed_count=v_completed,failed_count=v_failed,skipped_count=v_skipped,cancelled_count=v_cancelled,next_retry_at=v_next,
    status=case when status='CANCELLED' then status when v_next>now() then 'PAUSED_RATE_LIMIT' when v_processing>0 or v_pending>0 or v_waiting>0 then case when started_at is null then 'PENDING' else 'RUNNING' end when v_failed+v_skipped>0 then 'COMPLETED_WITH_FAILURES' else 'COMPLETED' end,
    completed_at=case when v_processing+v_pending+v_waiting=0 then coalesce(completed_at,now()) else null end
  where id=p_batch_id returning * into v;return v;
end$$;

create or replace function public.submit_tailoring_preview_v13(p_tailoring_job_id uuid,p_preview jsonb,p_generated_at timestamptz)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_job public.tailoring_jobs;v_template text:=public.random_tailored_resume_template_v34();v_now timestamptz:=now();
begin
  perform public.assert_application_manager();
  select * into v_job from public.tailoring_jobs where id=p_tailoring_job_id for update;
  if not found or v_job.application_id is null then raise exception 'TAILORING_JOB_NOT_FOUND: The Application tailoring job was not found.' using errcode='P0001';end if;
  if v_job.status<>'PROCESSING' or v_job.processed_by is distinct from auth.uid() then raise exception 'TAILORING_JOB_NOT_PROCESSABLE: Load this job input before submitting its preview.' using errcode='P0001';end if;
  perform public.assert_tailoring_preview_v14(v_job.resume_id,p_preview);
  update public.tailoring_jobs set status='APPROVED',output_schema_version=1,output_preview=p_preview,preview_generated_at=v_now,completed_at=v_now,
    reviewed_by=auth.uid(),reviewed_at=v_now,review_notes='Automatically approved after structural validation.',render_template_key=v_template,
    template_selected_by=auth.uid(),template_selected_at=v_now,automatic_materialization=true,failure_code=null,failure_message=null where id=v_job.id;
  insert into public.tailoring_job_reviews(tailoring_job_id,application_id,action,previous_status,new_status,previous_preview,resulting_preview,notes,reviewed_by)
  values(v_job.id,v_job.application_id,'APPROVE',v_job.status,'APPROVED',coalesce(v_job.output_preview,'{}'::jsonb),p_preview,'Automatically approved after structural validation.',auth.uid());
  return jsonb_build_object('id',v_job.id,'applicationId',v_job.application_id,'status','APPROVED','renderTemplateKey',v_template,'automaticMaterialization',true,'outputSchemaVersion',1,'previewGeneratedAt',v_now);
end$$;

create or replace function public.submit_tailoring_runner_preview_v15(p_ticket text,p_preview jsonb,p_generated_at timestamptz)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_ticket public.tailoring_runner_tickets;v_job public.tailoring_jobs;v_template text:=public.random_tailored_resume_template_v34();v_now timestamptz:=now();
begin
  if coalesce(p_ticket,'')!~'^trt_[A-Za-z0-9_-]{43}$' then raise exception 'TAILORING_TICKET_INVALID: The runner ticket is invalid.' using errcode='P0001';end if;
  select * into v_ticket from public.tailoring_runner_tickets where token_hash=encode(digest(p_ticket,'sha256'),'hex') for update;
  if not found or v_ticket.status<>'CLAIMED' then raise exception 'TAILORING_TICKET_INVALID: The runner ticket is invalid or already used.' using errcode='P0001';end if;
  if v_ticket.run_expires_at<=now() then raise exception 'TAILORING_TICKET_EXPIRED: The runner session expired. Create a new ticket from the dashboard.' using errcode='P0001';end if;
  select * into v_job from public.tailoring_jobs where id=v_ticket.tailoring_job_id for update;
  if not found or v_job.status<>'PROCESSING' or v_job.processed_by is distinct from v_ticket.created_by or v_job.output_preview is not null then raise exception 'TAILORING_TICKET_UNAVAILABLE: The tailoring job is no longer available to this ticket.' using errcode='P0001';end if;
  perform public.assert_tailoring_preview_v14(v_job.resume_id,p_preview);
  update public.tailoring_jobs set status='APPROVED',output_schema_version=1,output_preview=p_preview,preview_generated_at=v_now,completed_at=v_now,
    reviewed_by=v_ticket.created_by,reviewed_at=v_now,review_notes='Automatically approved after structural validation.',render_template_key=v_template,
    template_selected_by=v_ticket.created_by,template_selected_at=v_now,automatic_materialization=true,failure_code=null,failure_message=null where id=v_job.id;
  insert into public.tailoring_job_reviews(tailoring_job_id,application_id,action,previous_status,new_status,previous_preview,resulting_preview,notes,reviewed_by)
  values(v_job.id,v_job.application_id,'APPROVE',v_job.status,'APPROVED',coalesce(v_job.output_preview,'{}'::jsonb),p_preview,'Automatically approved after structural validation.',v_ticket.created_by);
  return jsonb_build_object('id',v_job.id,'jobId',v_job.id,'applicationId',v_job.application_id,'status','APPROVED','renderTemplateKey',v_template,'automaticMaterialization',true,'outputSchemaVersion',1,'previewGeneratedAt',v_now);
end$$;

create or replace function public.submit_tailoring_batch_preview_v21(p_ticket text,p_item_id uuid,p_lease_token uuid,p_preview jsonb,p_generated_at timestamptz)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_ticket public.tailoring_batch_runner_tickets;v_item public.tailoring_batch_items;v_job public.tailoring_jobs;v_template text:=public.random_tailored_resume_template_v34();v_now timestamptz:=now();
begin
  select * into v_ticket from public.tailoring_batch_runner_tickets where token_hash=encode(digest(p_ticket,'sha256'),'hex') and status='CLAIMED';if not found or v_ticket.run_expires_at<=now() then raise exception 'TAILORING_BATCH_TICKET_EXPIRED: Create a new batch command.' using errcode='P0001';end if;
  select * into v_item from public.tailoring_batch_items where id=p_item_id and batch_id=v_ticket.batch_id for update;if not found or v_item.status<>'PROCESSING' or v_item.lease_token is distinct from p_lease_token or v_item.lease_expires_at<=now() then raise exception 'TAILORING_BATCH_LEASE_INVALID: The item lease expired or changed.' using errcode='P0001';end if;
  select * into v_job from public.tailoring_jobs where id=v_item.tailoring_job_id for update;perform public.assert_tailoring_preview_v14(v_job.resume_id,p_preview);
  update public.tailoring_jobs set status='APPROVED',output_schema_version=1,output_preview=p_preview,preview_generated_at=v_now,completed_at=v_now,
    reviewed_by=v_ticket.created_by,reviewed_at=v_now,review_notes='Automatically approved after structural validation.',render_template_key=v_template,
    template_selected_by=v_ticket.created_by,template_selected_at=v_now,automatic_materialization=true,failure_code=null,failure_message=null where id=v_job.id;
  insert into public.tailoring_job_reviews(tailoring_job_id,application_id,action,previous_status,new_status,previous_preview,resulting_preview,notes,reviewed_by)
  values(v_job.id,v_job.application_id,'APPROVE',v_job.status,'APPROVED',coalesce(v_job.output_preview,'{}'::jsonb),p_preview,'Automatically approved after structural validation.',v_ticket.created_by);
  return jsonb_build_object('itemId',v_item.id,'jobId',v_job.id,'status','APPROVED','renderTemplateKey',v_template,'automaticMaterialization',true);
end$$;

create or replace function public.begin_tailoring_runner_materialization_v34(p_ticket text)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_ticket public.tailoring_runner_tickets;v_job public.tailoring_jobs;
begin
  select * into v_ticket from public.tailoring_runner_tickets where token_hash=encode(digest(p_ticket,'sha256'),'hex') and status='CLAIMED' for update;
  if not found or v_ticket.run_expires_at<=now() then raise exception 'TAILORING_TICKET_EXPIRED: The runner ticket cannot materialize this Resume.' using errcode='P0001';end if;
  select * into v_job from public.tailoring_jobs where id=v_ticket.tailoring_job_id for update;
  if not found or v_job.status<>'APPROVED' or not v_job.automatic_materialization then raise exception 'TAILORING_MATERIALIZATION_UNAVAILABLE: The automatically approved Resume is unavailable.' using errcode='P0001';end if;
  perform set_config('request.jwt.claim.sub',v_ticket.created_by::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',v_ticket.created_by,'role','authenticated')::text,true);
  return public.begin_tailoring_materialization_v19(v_job.id);
end$$;

create or replace function public.finalize_tailoring_runner_materialization_v34(p_ticket text,p_materialization_token uuid,p_storage_path text,p_original_filename text,p_mime_type text,p_file_size_bytes bigint,p_file_sha256 text)
returns jsonb language plpgsql security definer set search_path=public,extensions,storage,pg_temp as $$
declare v_ticket public.tailoring_runner_tickets;v_result jsonb;
begin
  select * into v_ticket from public.tailoring_runner_tickets where token_hash=encode(digest(p_ticket,'sha256'),'hex') and status='CLAIMED' for update;
  if not found or v_ticket.run_expires_at<=now() then raise exception 'TAILORING_TICKET_EXPIRED: The runner ticket cannot finalize this Resume.' using errcode='P0001';end if;
  perform set_config('request.jwt.claim.sub',v_ticket.created_by::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',v_ticket.created_by,'role','authenticated')::text,true);
  v_result:=public.finalize_tailoring_materialization_v19(v_ticket.tailoring_job_id,p_materialization_token,p_storage_path,p_original_filename,p_mime_type,p_file_size_bytes,p_file_sha256);
  update public.tailoring_runner_tickets set status='COMPLETED',completed_at=now() where id=v_ticket.id;
  return v_result;
end$$;

create or replace function public.fail_tailoring_runner_materialization_v34(p_ticket text,p_materialization_token uuid,p_failure_code text)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_ticket public.tailoring_runner_tickets;v_result jsonb;
begin
  select * into v_ticket from public.tailoring_runner_tickets where token_hash=encode(digest(p_ticket,'sha256'),'hex') and status='CLAIMED' for update;
  if not found then raise exception 'TAILORING_TICKET_INVALID: The runner ticket cannot report materialization failure.' using errcode='P0001';end if;
  perform set_config('request.jwt.claim.sub',v_ticket.created_by::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',v_ticket.created_by,'role','authenticated')::text,true);
  v_result:=public.fail_tailoring_materialization_v16(v_ticket.tailoring_job_id,p_materialization_token,p_failure_code);
  update public.tailoring_runner_tickets set status='COMPLETED',completed_at=now() where id=v_ticket.id;
  return v_result;
end$$;

create or replace function public.begin_tailoring_batch_materialization_v34(p_ticket text,p_item_id uuid,p_lease_token uuid)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_ticket public.tailoring_batch_runner_tickets;v_item public.tailoring_batch_items;v_job public.tailoring_jobs;
begin
  select * into v_ticket from public.tailoring_batch_runner_tickets where token_hash=encode(digest(p_ticket,'sha256'),'hex') and status='CLAIMED';if not found or v_ticket.run_expires_at<=now() then raise exception 'TAILORING_BATCH_TICKET_EXPIRED: The batch ticket cannot materialize this Resume.' using errcode='P0001';end if;
  select * into v_item from public.tailoring_batch_items where id=p_item_id and batch_id=v_ticket.batch_id for update;if not found or v_item.status<>'PROCESSING' or v_item.lease_token is distinct from p_lease_token or v_item.lease_expires_at<=now() then raise exception 'TAILORING_BATCH_LEASE_INVALID: The item lease expired or changed.' using errcode='P0001';end if;
  select * into v_job from public.tailoring_jobs where id=v_item.tailoring_job_id for update;if not found or v_job.status<>'APPROVED' or not v_job.automatic_materialization then raise exception 'TAILORING_MATERIALIZATION_UNAVAILABLE: The automatically approved Resume is unavailable.' using errcode='P0001';end if;
  perform set_config('request.jwt.claim.sub',v_ticket.created_by::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',v_ticket.created_by,'role','authenticated')::text,true);
  return public.begin_tailoring_materialization_v19(v_job.id);
end$$;

create or replace function public.finalize_tailoring_batch_materialization_v34(p_ticket text,p_item_id uuid,p_lease_token uuid,p_materialization_token uuid,p_storage_path text,p_original_filename text,p_mime_type text,p_file_size_bytes bigint,p_file_sha256 text)
returns jsonb language plpgsql security definer set search_path=public,extensions,storage,pg_temp as $$
declare v_ticket public.tailoring_batch_runner_tickets;v_item public.tailoring_batch_items;v_result jsonb;v_batch public.tailoring_batches;
begin
  select * into v_ticket from public.tailoring_batch_runner_tickets where token_hash=encode(digest(p_ticket,'sha256'),'hex') and status='CLAIMED';if not found or v_ticket.run_expires_at<=now() then raise exception 'TAILORING_BATCH_TICKET_EXPIRED: The batch ticket cannot finalize this Resume.' using errcode='P0001';end if;
  select * into v_item from public.tailoring_batch_items where id=p_item_id and batch_id=v_ticket.batch_id for update;if not found or v_item.status<>'PROCESSING' or v_item.lease_token is distinct from p_lease_token then raise exception 'TAILORING_BATCH_LEASE_INVALID: The item lease expired or changed.' using errcode='P0001';end if;
  perform set_config('request.jwt.claim.sub',v_ticket.created_by::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',v_ticket.created_by,'role','authenticated')::text,true);
  v_result:=public.finalize_tailoring_materialization_v19(v_item.tailoring_job_id,p_materialization_token,p_storage_path,p_original_filename,p_mime_type,p_file_size_bytes,p_file_sha256);
  update public.tailoring_batch_items set status='COMPLETED',lease_token=null,lease_expires_at=null,finished_at=now(),duration_ms=greatest(0,(extract(epoch from(now()-started_at))*1000)::int),failure_stage=null,failure_code=null,failure_message=null,retryable=false where id=v_item.id;
  v_batch:=public.refresh_tailoring_batch_v21(v_item.batch_id);
  return v_result||jsonb_build_object('itemId',v_item.id,'batchStatus',v_batch.status,'completedCount',v_batch.completed_count);
end$$;

create or replace function public.fail_tailoring_batch_materialization_v34(p_ticket text,p_item_id uuid,p_lease_token uuid,p_materialization_token uuid,p_failure_code text)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_ticket public.tailoring_batch_runner_tickets;v_item public.tailoring_batch_items;v_result jsonb;v_batch public.tailoring_batches;
begin
  select * into v_ticket from public.tailoring_batch_runner_tickets where token_hash=encode(digest(p_ticket,'sha256'),'hex') and status='CLAIMED';if not found then raise exception 'TAILORING_BATCH_TICKET_INVALID: The batch ticket cannot report materialization failure.' using errcode='P0001';end if;
  select * into v_item from public.tailoring_batch_items where id=p_item_id and batch_id=v_ticket.batch_id for update;if not found or v_item.status<>'PROCESSING' or v_item.lease_token is distinct from p_lease_token then raise exception 'TAILORING_BATCH_LEASE_INVALID: The item lease expired or changed.' using errcode='P0001';end if;
  perform set_config('request.jwt.claim.sub',v_ticket.created_by::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',v_ticket.created_by,'role','authenticated')::text,true);
  v_result:=public.fail_tailoring_materialization_v16(v_item.tailoring_job_id,p_materialization_token,p_failure_code);
  update public.tailoring_batch_items set status='FAILED',lease_token=null,lease_expires_at=null,finished_at=now(),duration_ms=greatest(0,(extract(epoch from(now()-started_at))*1000)::int),failure_stage='API_SUBMISSION',failure_code=p_failure_code,failure_message='Automatic Resume creation failed; retry this item.',retryable=true where id=v_item.id;
  v_batch:=public.refresh_tailoring_batch_v21(v_item.batch_id);
  return v_result||jsonb_build_object('itemId',v_item.id,'batchStatus',v_batch.status,'retryable',true);
end$$;

create or replace function public.can_auto_materialize_tailored_resume_v34(p_object_name text)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(
    select 1 from public.tailoring_jobs t join public.resumes r on r.id=t.resume_id
    where t.status='MATERIALIZING' and t.automatic_materialization and t.materializing_by=t.processed_by
      and p_object_name=r.user_id::text||'/'||t.id::text||'/resume-'||r.resume_number||'-application-'||(select application_number from public.applications where id=t.application_id)||'-tailored.'||lower(t.render_format)
  )
$$;

drop policy if exists "runner automatically materializes tailored resumes" on storage.objects;
create policy "runner automatically materializes tailored resumes" on storage.objects for insert to anon with check(
  bucket_id='tailored-resumes' and (select public.can_auto_materialize_tailored_resume_v34(name))
);
drop policy if exists "runner cleans automatic tailored materialization" on storage.objects;
create policy "runner cleans automatic tailored materialization" on storage.objects for delete to anon using(
  bucket_id='tailored-resumes' and (select public.can_auto_materialize_tailored_resume_v34(name))
);

revoke all on function public.random_tailored_resume_template_v34() from public,anon,authenticated;
revoke all on function public.can_auto_materialize_tailored_resume_v34(text) from public,authenticated;
revoke all on function public.begin_tailoring_runner_materialization_v34(text),public.finalize_tailoring_runner_materialization_v34(text,uuid,text,text,text,bigint,text),public.fail_tailoring_runner_materialization_v34(text,uuid,text) from public,authenticated;
revoke all on function public.begin_tailoring_batch_materialization_v34(text,uuid,uuid),public.finalize_tailoring_batch_materialization_v34(text,uuid,uuid,uuid,text,text,text,bigint,text),public.fail_tailoring_batch_materialization_v34(text,uuid,uuid,uuid,text) from public,authenticated;
grant execute on function public.begin_tailoring_runner_materialization_v34(text),public.finalize_tailoring_runner_materialization_v34(text,uuid,text,text,text,bigint,text),public.fail_tailoring_runner_materialization_v34(text,uuid,text) to anon;
grant execute on function public.begin_tailoring_batch_materialization_v34(text,uuid,uuid),public.finalize_tailoring_batch_materialization_v34(text,uuid,uuid,uuid,text,text,text,bigint,text),public.fail_tailoring_batch_materialization_v34(text,uuid,uuid,uuid,text) to anon;
grant execute on function public.can_auto_materialize_tailored_resume_v34(text) to anon;

comment on column public.tailoring_jobs.automatic_materialization is 'True when structural validation automatically approved the preview and reserved immediate artifact creation.';
comment on function public.random_tailored_resume_template_v34() is 'Uniformly chooses one of the twelve code-owned ATS-safe Resume template keys.';
