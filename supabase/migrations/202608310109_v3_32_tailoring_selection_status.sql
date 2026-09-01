-- v3.32: expose Application tailoring status at selection time and prevent
-- approved/materializing/completed work from entering another tailoring batch.

create or replace function public.get_application_tailoring_statuses_v32(p_application_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_result jsonb;
begin
  if coalesce(array_length(p_application_ids,1),0)>5000 then
    raise exception 'TAILORING_STATUS_LIMIT: Load no more than 5000 Application statuses.' using errcode='22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'applicationId',t.application_id,
    'tailoringJobId',t.id,
    'status',t.status
  ) order by t.application_id),'[]'::jsonb)
  into v_result
  from public.tailoring_jobs t
  join public.applications a on a.id=t.application_id
  where t.application_id=any(coalesce(p_application_ids,array[]::uuid[]))
    and (
      public.application_actor_can_manage()
      or (public.has_role('APPLIER') and a.assigned_to=auth.uid())
    );
  return v_result;
end$$;

create or replace function public.create_tailoring_batch_v32(p_application_ids uuid[],p_name text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_eligible uuid[];v_requested_count integer;v_result jsonb;
begin
  perform public.assert_application_manager();
  if coalesce(array_length(p_application_ids,1),0) not between 1 and 500 then
    raise exception 'TAILORING_BATCH_LIMIT: Select between 1 and 500 Applications.' using errcode='22023';
  end if;

  with requested as(
    select application_id,min(position) position
    from unnest(p_application_ids) with ordinality selected(application_id,position)
    group by application_id
  )
  select array_agg(r.application_id order by r.position),count(*)
  into v_eligible,v_requested_count
  from requested r
  where not exists(
    select 1 from public.tailoring_jobs t
    where t.application_id=r.application_id
      and t.status in('APPROVED','MATERIALIZING','COMPLETED')
  );

  if coalesce(v_requested_count,0)=0 then
    raise exception 'TAILORING_BATCH_ALREADY_APPROVED: Every selected Application already has approved tailored content.' using errcode='P0001';
  end if;

  v_result:=public.create_tailoring_batch_v21(v_eligible,p_name);
  return v_result||jsonb_build_object(
    'excludedApprovedCount',(select count(distinct x) from unnest(p_application_ids)x)-v_requested_count
  );
end$$;

revoke all on function public.get_application_tailoring_statuses_v32(uuid[]) from public,anon;
revoke all on function public.create_tailoring_batch_v32(uuid[],text) from public,anon;
grant execute on function public.get_application_tailoring_statuses_v32(uuid[]) to authenticated;
grant execute on function public.create_tailoring_batch_v32(uuid[],text) to authenticated;

comment on function public.get_application_tailoring_statuses_v32(uuid[]) is
  'Returns the existing tailoring job/status for accessible Applications.';
comment on function public.create_tailoring_batch_v32(uuid[],text) is
  'Creates a v2.1 batch after excluding Applications with approved or materialized tailoring.';
