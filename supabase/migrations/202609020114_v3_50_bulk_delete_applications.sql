-- Permanently delete cancelled Applications (Applying Manager / Admin).

create or replace function public.bulk_delete_applications_v317(
  p_application_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids uuid[];
  v_id uuid;
  v_current public.applications;
  v_results jsonb := '[]'::jsonb;
  v_succeeded integer := 0;
begin
  perform public.assert_application_manager();

  if p_application_ids is null then
    raise exception 'APPLICATION_DELETE_INVALID: Select at least one Application.'
      using errcode = '22023';
  end if;

  select array_agg(x order by x)
  into v_ids
  from (
    select distinct t.x
    from unnest(p_application_ids) as t(x)
    where t.x is not null
  ) d;

  if v_ids is null or cardinality(v_ids) < 1 then
    raise exception 'APPLICATION_DELETE_INVALID: Select at least one Application.'
      using errcode = '22023';
  end if;
  if cardinality(v_ids) > 2000 then
    raise exception 'APPLICATION_DELETE_INVALID: Select no more than 2000 Applications.'
      using errcode = '22023';
  end if;

  foreach v_id in array v_ids loop
    select * into v_current
    from public.applications
    where id = v_id
    for update;

    if not found then
      v_results := v_results || jsonb_build_array(
        jsonb_build_object(
          'id', v_id,
          'ok', false,
          'code', 'APPLICATION_NOT_FOUND',
          'message', 'The Application was not found or is not accessible.'
        )
      );
      continue;
    end if;

    if v_current.status <> 'CANCELLED' then
      v_results := v_results || jsonb_build_array(
        jsonb_build_object(
          'id', v_id,
          'ok', false,
          'code', 'APPLICATION_NOT_CANCELLED',
          'message', 'Only cancelled Applications can be permanently deleted.'
        )
      );
      continue;
    end if;

    delete from public.applications
    where id = v_id;

    v_succeeded := v_succeeded + 1;
    v_results := v_results || jsonb_build_array(
      jsonb_build_object(
        'id', v_id,
        'ok', true,
        'data', jsonb_build_object(
          'id', v_id,
          'applicationNumber', v_current.application_number
        )
      )
    );
  end loop;

  return jsonb_build_object(
    'total', cardinality(v_ids),
    'succeeded', v_succeeded,
    'failed', cardinality(v_ids) - v_succeeded,
    'results', v_results
  );
end;
$$;

revoke all on function public.bulk_delete_applications_v317(uuid[])
  from public, anon;
grant execute on function public.bulk_delete_applications_v317(uuid[])
  to authenticated;

comment on function public.bulk_delete_applications_v317(uuid[]) is
  'Permanently delete cancelled Applications for Applying Managers and Admins.';
