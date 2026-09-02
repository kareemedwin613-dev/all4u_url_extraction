-- Repair: Supabase blocks direct DELETE on storage.objects (storage.protect_delete).
-- Remove screenshot object cleanup from the batch delete RPC; metadata still cascades.

create or replace function public.bulk_delete_application_batches_v316(
  p_batch_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids uuid[];
  v_id uuid;
  v_batch public.application_creation_batches;
  v_app_ids uuid[];
  v_active_count integer;
  v_deleted_apps integer;
  v_results jsonb := '[]'::jsonb;
  v_succeeded integer := 0;
begin
  perform public.assert_application_manager();

  if p_batch_ids is null then
    raise exception 'BATCH_DELETE_INVALID: Select at least one Application batch.'
      using errcode = '22023';
  end if;

  select array_agg(x order by x)
  into v_ids
  from (
    select distinct t.x
    from unnest(p_batch_ids) as t(x)
    where t.x is not null
  ) d;

  if v_ids is null or cardinality(v_ids) < 1 then
    raise exception 'BATCH_DELETE_INVALID: Select at least one Application batch.'
      using errcode = '22023';
  end if;
  if cardinality(v_ids) > 100 then
    raise exception 'BATCH_DELETE_INVALID: Select no more than 100 Application batches.'
      using errcode = '22023';
  end if;

  foreach v_id in array v_ids loop
    v_deleted_apps := 0;
    select * into v_batch
    from public.application_creation_batches
    where id = v_id
    for update;

    if not found then
      v_results := v_results || jsonb_build_array(
        jsonb_build_object(
          'id', v_id,
          'ok', false,
          'code', 'BATCH_NOT_FOUND',
          'message', 'The Application batch was not found or is not accessible.'
        )
      );
      continue;
    end if;

    if v_batch.status = 'PROCESSING' then
      v_results := v_results || jsonb_build_array(
        jsonb_build_object(
          'id', v_id,
          'ok', false,
          'code', 'BATCH_STILL_PROCESSING',
          'message', 'This batch is still processing and cannot be deleted yet.'
        )
      );
      continue;
    end if;

    select count(*)::integer
    into v_active_count
    from public.applications
    where creation_batch_id = v_id
      and status <> 'CANCELLED';

    if v_active_count > 0 then
      v_results := v_results || jsonb_build_array(
        jsonb_build_object(
          'id', v_id,
          'ok', false,
          'code', 'BATCH_HAS_ACTIVE_APPLICATIONS',
          'message', format(
            'This batch has %s active Application%s. Cancel them before deleting the batch.',
            v_active_count,
            case when v_active_count = 1 then '' else 's' end
          )
        )
      );
      continue;
    end if;

    select coalesce(array_agg(a.id order by a.id), array[]::uuid[])
    into v_app_ids
    from public.applications a
    where a.creation_batch_id = v_id;

    if cardinality(v_app_ids) > 0 then
      delete from public.applications
      where id = any(v_app_ids);
    end if;

    get diagnostics v_deleted_apps = row_count;

    delete from public.application_creation_batches
    where id = v_id;

    v_succeeded := v_succeeded + 1;
    v_results := v_results || jsonb_build_array(
      jsonb_build_object(
        'id', v_id,
        'ok', true,
        'data', jsonb_build_object(
          'id', v_id,
          'name', v_batch.name,
          'deletedApplicationCount', coalesce(v_deleted_apps, 0)
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

comment on function public.bulk_delete_application_batches_v316(uuid[]) is
  'Permanently delete Application creation batches when every linked Application is cancelled (Applying Manager / Admin). Screenshot storage objects may remain until cleaned separately.';
