-- Finalize the PDF first. Comparison setup is a separate, recoverable subtransaction;
-- an unavailable scoring model must never undo a successfully materialized Resume.
set local lock_timeout = '3s';
create function public.finalize_tailoring_materialization_v379(
  p_tailoring_job_id uuid,p_materialization_token uuid,p_storage_path text,p_original_filename text,p_mime_type text,p_file_size_bytes bigint,p_file_sha256 text
)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare receipt jsonb; comparison jsonb;
begin
  receipt:=public.finalize_tailoring_materialization_v19(p_tailoring_job_id,p_materialization_token,p_storage_path,p_original_filename,p_mime_type,p_file_size_bytes,p_file_sha256);
  begin
    comparison:=public.request_application_match_comparison_v378((receipt->>'applicationId')::uuid);
    return receipt||jsonb_build_object('matching',comparison);
  exception when others then
    -- No raw database/provider messages or credentials go into the materialization receipt.
    return receipt||jsonb_build_object('matching',jsonb_build_object('runner',null,'errorCode',
      case when sqlerrm like 'MATCHING_NOT_CONFIGURED:%' then 'MATCHING_NOT_CONFIGURED' else 'COMPARISON_QUEUE_FAILED' end));
  end;
end $$;
revoke all on function public.finalize_tailoring_materialization_v379(uuid,uuid,text,text,text,bigint,text) from public,anon;
grant execute on function public.finalize_tailoring_materialization_v379(uuid,uuid,text,text,text,bigint,text) to authenticated;

-- Keep the existing ticket, issuer and lease checks for both tailoring command modes.
create or replace function public.finalize_tailoring_runner_materialization_v34(p_ticket text,p_materialization_token uuid,p_storage_path text,p_original_filename text,p_mime_type text,p_file_size_bytes bigint,p_file_sha256 text)
returns jsonb language plpgsql security definer set search_path=public,extensions,storage,pg_temp as $$
declare v_ticket public.tailoring_runner_tickets;v_result jsonb;
begin
  select * into v_ticket from public.tailoring_runner_tickets where token_hash=encode(digest(p_ticket,'sha256'),'hex') and status='CLAIMED' for update;
  if not found or v_ticket.run_expires_at<=now() then raise exception 'TAILORING_TICKET_EXPIRED: The runner ticket cannot finalize this Resume.' using errcode='P0001';end if;
  perform set_config('request.jwt.claim.sub',v_ticket.created_by::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',v_ticket.created_by,'role','authenticated')::text,true);
  v_result:=public.finalize_tailoring_materialization_v379(v_ticket.tailoring_job_id,p_materialization_token,p_storage_path,p_original_filename,p_mime_type,p_file_size_bytes,p_file_sha256);
  update public.tailoring_runner_tickets set status='COMPLETED',completed_at=now() where id=v_ticket.id;
  return v_result;
end$$;

create or replace function public.finalize_tailoring_batch_materialization_v34(p_ticket text,p_item_id uuid,p_lease_token uuid,p_materialization_token uuid,p_storage_path text,p_original_filename text,p_mime_type text,p_file_size_bytes bigint,p_file_sha256 text)
returns jsonb language plpgsql security definer set search_path=public,extensions,storage,pg_temp as $$
declare v_ticket public.tailoring_batch_runner_tickets;v_item public.tailoring_batch_items;v_result jsonb;v_batch public.tailoring_batches;
begin
  select * into v_ticket from public.tailoring_batch_runner_tickets where token_hash=encode(digest(p_ticket,'sha256'),'hex') and status='CLAIMED';if not found or v_ticket.run_expires_at<=now() then raise exception 'TAILORING_BATCH_TICKET_EXPIRED: The batch ticket cannot finalize this Resume.' using errcode='P0001';end if;
  select * into v_item from public.tailoring_batch_items where id=p_item_id and batch_id=v_ticket.batch_id for update;if not found or v_item.status<>'PROCESSING' or v_item.lease_token is distinct from p_lease_token then raise exception 'TAILORING_BATCH_LEASE_INVALID: The item lease expired or changed.' using errcode='P0001';end if;
  perform set_config('request.jwt.claim.sub',v_ticket.created_by::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',v_ticket.created_by,'role','authenticated')::text,true);
  v_result:=public.finalize_tailoring_materialization_v379(v_item.tailoring_job_id,p_materialization_token,p_storage_path,p_original_filename,p_mime_type,p_file_size_bytes,p_file_sha256);
  update public.tailoring_batch_items set status='COMPLETED',lease_token=null,lease_expires_at=null,finished_at=now(),duration_ms=greatest(0,(extract(epoch from(now()-started_at))*1000)::int),failure_stage=null,failure_code=null,failure_message=null,retryable=false where id=v_item.id;
  v_batch:=public.refresh_tailoring_batch_v21(v_item.batch_id);
  return v_result||jsonb_build_object('itemId',v_item.id,'batchStatus',v_batch.status,'completedCount',v_batch.completed_count);
end$$;

notify pgrst,'reload schema';
