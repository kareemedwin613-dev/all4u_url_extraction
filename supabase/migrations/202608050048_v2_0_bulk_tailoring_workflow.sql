-- v2.0: bounded bulk tailoring orchestration. Existing job, ticket, review,
-- materialization, RLS, and private Storage boundaries remain authoritative.

create or replace function public.request_application_tailoring_bulk_v20(p_application_ids uuid[])
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid;v_result jsonb:='[]'::jsonb;v_receipt jsonb;
begin
  perform public.assert_application_manager();
  if coalesce(array_length(p_application_ids,1),0) not between 1 and 100 then raise exception 'TAILORING_BULK_LIMIT: Select between 1 and 100 Applications.' using errcode='22023';end if;
  for v_id in select distinct x from unnest(p_application_ids) x loop
    begin
      v_receipt:=public.request_application_tailoring_v13(v_id);
      v_result:=v_result||jsonb_build_array(jsonb_build_object('applicationId',v_id,'outcome','READY','job',v_receipt));
    exception when others then
      v_result:=v_result||jsonb_build_array(jsonb_build_object('applicationId',v_id,'outcome','SKIPPED','reason',sqlerrm));
    end;
  end loop;
  return v_result;
end$$;

create or replace function public.create_tailoring_runner_tickets_bulk_v20(p_tailoring_job_ids uuid[])
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid;v_result jsonb:='[]'::jsonb;v_receipt jsonb;
begin
  perform public.assert_application_manager();
  if coalesce(array_length(p_tailoring_job_ids,1),0) not between 1 and 5 then raise exception 'TAILORING_BULK_LIMIT: Select between 1 and 5 pending tailoring jobs.' using errcode='22023';end if;
  for v_id in select distinct x from unnest(p_tailoring_job_ids) x loop
    begin
      v_receipt:=public.create_tailoring_runner_ticket_v15(v_id);
      v_result:=v_result||jsonb_build_array(v_receipt);
    exception when others then
      v_result:=v_result||jsonb_build_array(jsonb_build_object('jobId',v_id,'error',sqlerrm));
    end;
  end loop;
  if not exists(select 1 from jsonb_array_elements(v_result) x where x?'ticket') then raise exception 'TAILORING_BULK_EMPTY: None of the selected jobs can be run.' using errcode='P0001';end if;
  return v_result;
end$$;

revoke all on function public.request_application_tailoring_bulk_v20(uuid[]) from public,anon;
revoke all on function public.create_tailoring_runner_tickets_bulk_v20(uuid[]) from public,anon;
grant execute on function public.request_application_tailoring_bulk_v20(uuid[]) to authenticated;
grant execute on function public.create_tailoring_runner_tickets_bulk_v20(uuid[]) to authenticated;

comment on function public.request_application_tailoring_bulk_v20(uuid[]) is 'Creates or reuses up to 100 Application-scoped tailoring jobs with per-Application outcomes.';
comment on function public.create_tailoring_runner_tickets_bulk_v20(uuid[]) is 'Issues up to five existing short-lived job-scoped runner capabilities in one authorized call.';
