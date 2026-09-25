-- A batch item that failed while rendering, uploading, or finalizing its PDF already has an
-- approved preview. Retrying it used to clear that preview and pay for a new generation.
-- Retry now keeps it, and the lease hands it to the worker to resubmit without calling the model.
create or replace function public.retry_tailoring_batch_items_v21(p_batch_id uuid,p_item_ids uuid[] default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_count int;v_batch public.tailoring_batches;
begin
  perform public.assert_application_manager();
  update public.tailoring_jobs j set status='PENDING',
    output_preview=case when i.failure_code in('RENDER_FAILED','UPLOAD_FAILED','FINALIZE_FAILED') then j.output_preview end,
    output_schema_version=case when i.failure_code in('RENDER_FAILED','UPLOAD_FAILED','FINALIZE_FAILED') and j.output_preview is not null then j.output_schema_version end,
    preview_generated_at=case when i.failure_code in('RENDER_FAILED','UPLOAD_FAILED','FINALIZE_FAILED') and j.output_preview is not null then j.preview_generated_at end,
    processed_by=null,failure_code=null,failure_message=null,started_at=null,completed_at=null
    from public.tailoring_batch_items i where i.batch_id=p_batch_id and i.tailoring_job_id=j.id and i.status='FAILED' and i.retryable and(p_item_ids is null or i.id=any(p_item_ids));
  update public.tailoring_batch_items set status='PENDING',failure_stage=null,failure_code=null,failure_message=null,retryable=false,next_retry_at=null,finished_at=null where batch_id=p_batch_id and status='FAILED' and retryable and(p_item_ids is null or id=any(p_item_ids));get diagnostics v_count=row_count;
  if v_count=0 then raise exception 'TAILORING_BATCH_RETRY_EMPTY: No retryable failed items were selected.' using errcode='P0001';end if;
  update public.tailoring_batches set status='RUNNING',completed_at=null,pause_reason=null,next_retry_at=null where id=p_batch_id;v_batch:=public.refresh_tailoring_batch_v21(p_batch_id);return jsonb_build_object('batchId',p_batch_id,'retriedCount',v_count,'status',v_batch.status);
end$$;

alter function public.next_tailoring_batch_item_v21(text) rename to next_tailoring_batch_item_legacy_v118;
create function public.next_tailoring_batch_item_v21(p_ticket text) returns jsonb
language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare result jsonb;preview jsonb;
begin
  result:=public.next_tailoring_batch_item_legacy_v118(p_ticket);
  if result->>'state'='JOB' then
    select output_preview into preview from public.tailoring_jobs where id=(result->>'jobId')::uuid;
    if preview is not null then result:=result||jsonb_build_object('approvedPreview',preview);end if;
  end if;
  return result;
end$$;
revoke all on function public.next_tailoring_batch_item_legacy_v118(text),public.next_tailoring_batch_item_v21(text) from public,anon,authenticated;
grant execute on function public.next_tailoring_batch_item_v21(text) to anon;
