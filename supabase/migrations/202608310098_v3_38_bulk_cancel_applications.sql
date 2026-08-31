-- Bulk-cancel Applications for Applying Managers and Admins (retains history).

create or replace function public.bulk_cancel_applications_v315(
  p_application_ids uuid[],
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_ids uuid[];
  v_id uuid;
  v_current public.applications;
  v_updated public.applications;
  v_notes text := nullif(left(trim(coalesce(p_notes, '')), 2000), '');
  v_results jsonb := '[]'::jsonb;
  v_succeeded integer := 0;
begin
  perform public.assert_application_manager();

  if p_application_ids is null then
    raise exception 'APPLICATION_CANCEL_INVALID: Select at least one Application.'
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
    raise exception 'APPLICATION_CANCEL_INVALID: Select at least one Application.'
      using errcode = '22023';
  end if;
  if cardinality(v_ids) > 2000 then
    raise exception 'APPLICATION_CANCEL_INVALID: Select no more than 2000 Applications.'
      using errcode = '22023';
  end if;
  if char_length(coalesce(p_notes, '')) > 10000 then
    raise exception 'APPLICATION_INVALID_NOTES: Notes cannot exceed 10000 characters.'
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

    if v_current.status = 'CANCELLED' then
      v_succeeded := v_succeeded + 1;
      v_results := v_results || jsonb_build_array(
        jsonb_build_object(
          'id', v_id,
          'ok', true,
          'data', jsonb_build_object(
            'id', v_id,
            'status', 'CANCELLED',
            'application_number', v_current.application_number
          )
        )
      );
      continue;
    end if;

    update public.applications
    set status = 'CANCELLED'
    where id = v_id
    returning * into v_updated;

    if v_current.status is distinct from v_updated.status then
      insert into public.application_status_history(
        application_id,
        status_type,
        previous_status,
        new_status,
        changed_by,
        notes
      )
      values (
        v_updated.id,
        'STATUS',
        v_current.status,
        v_updated.status,
        v_actor,
        v_notes
      );
    end if;

    v_succeeded := v_succeeded + 1;
    v_results := v_results || jsonb_build_array(
      jsonb_build_object(
        'id', v_id,
        'ok', true,
        'data', jsonb_build_object(
          'id', v_id,
          'status', v_updated.status,
          'application_number', v_updated.application_number
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

revoke all on function public.bulk_cancel_applications_v315(uuid[], text)
  from public, anon;
grant execute on function public.bulk_cancel_applications_v315(uuid[], text)
  to authenticated;

comment on function public.bulk_cancel_applications_v315(uuid[], text) is
  'Cancel many Applications at once for Applying Managers and Admins; records are retained.';
