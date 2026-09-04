-- v3.59: Allow Create/resume runner command when a PROCESSING batch item is
-- stuck in MATERIALIZING. Resetting the job to PENDING must also clear active
-- materialization columns or tailoring_jobs_active_materialization_check fails.

create or replace function public.create_tailoring_batch_ticket_v21(p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare v_batch public.tailoring_batches;v_token text;v_id uuid;v_exp timestamptz:=now()+interval '15 minutes';
begin
  perform public.assert_application_manager();select * into v_batch from public.tailoring_batches where id=p_batch_id for update;
  if not found then raise exception 'TAILORING_BATCH_NOT_FOUND: The tailoring batch was not found.' using errcode='P0001';end if;
  if v_batch.status in('COMPLETED','COMPLETED_WITH_FAILURES','CANCELLED') and v_batch.pending_count+v_batch.waiting_retry_count=0 then raise exception 'TAILORING_BATCH_UNAVAILABLE: This batch has no runnable jobs.' using errcode='P0001';end if;
  update public.tailoring_batch_runner_tickets set status='REVOKED',completed_at=now() where batch_id=p_batch_id and status in('ISSUED','CLAIMED');
  update public.tailoring_batch_items set status='PENDING',lease_token=null,lease_expires_at=null,failure_stage='LEASE_EXPIRED',failure_code='RUNNER_REPLACED',failure_message='The previous runner was replaced; this item was safely requeued.',retryable=false where batch_id=p_batch_id and status='PROCESSING';
  update public.tailoring_jobs j
    set status='PENDING',
        processed_by=null,
        started_at=null,
        completed_at=null,
        failure_code=null,
        failure_message=null,
        materializing_by=null,
        materialization_token=null,
        materialization_started_at=null
  from public.tailoring_batch_items i
  where i.batch_id=p_batch_id and i.tailoring_job_id=j.id and i.status='PENDING' and i.failure_code='RUNNER_REPLACED';
  perform public.refresh_tailoring_batch_v21(p_batch_id);
  v_token:='trb_'||regexp_replace(translate(encode(gen_random_bytes(32),'base64'),'+/','-_'),'=+$','');
  insert into public.tailoring_batch_runner_tickets(batch_id,created_by,token_hash,expires_at) values(p_batch_id,auth.uid(),encode(digest(v_token,'sha256'),'hex'),v_exp) returning id into v_id;
  return jsonb_build_object('ticketId',v_id,'batchId',p_batch_id,'ticket',v_token,'expiresAt',v_exp);
end$$;

revoke all on function public.create_tailoring_batch_ticket_v21(uuid) from public,anon;
grant execute on function public.create_tailoring_batch_ticket_v21(uuid) to authenticated;
