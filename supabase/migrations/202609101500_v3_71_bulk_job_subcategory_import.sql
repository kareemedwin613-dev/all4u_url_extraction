-- v3.71: manager bulk subcategory update from Excel (works on Approved JDs).

create or replace function public.manager_bulk_set_job_subcategories_v371(p_updates jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_limit constant integer := 2000;
  v_count integer;
  v_results jsonb := '[]'::jsonb;
  v_item jsonb;
  v_job_id uuid;
  v_category_id uuid;
  v_names text[];
  v_ids uuid[];
  v_name text;
  v_matched uuid;
  v_ok integer := 0;
  v_failed integer := 0;
begin
  if v_actor is null or not public.is_active_user(v_actor) or not public.application_actor_can_manage() then
    raise exception 'JOB_EDIT_FORBIDDEN: An active Applying Manager or Admin account is required.' using errcode = '42501';
  end if;

  if p_updates is null or jsonb_typeof(p_updates) <> 'array' then
    raise exception 'JOB_SUBCATEGORY_IMPORT_INVALID: Upload an array of job subcategory updates.' using errcode = '22023';
  end if;

  v_count := jsonb_array_length(p_updates);
  if v_count < 1 then
    raise exception 'JOB_SUBCATEGORY_IMPORT_INVALID: The spreadsheet has no data rows.' using errcode = '22023';
  end if;
  if v_count > v_limit then
    raise exception 'JOB_SUBCATEGORY_IMPORT_INVALID: Import at most 2000 rows at a time.' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_updates) loop
    begin
      v_job_id := nullif(btrim(coalesce(v_item->>'jobDescriptionId', v_item->>'id', '')), '')::uuid;
      if v_job_id is null then
        raise exception 'INVALID_ID' using errcode = 'P0001';
      end if;

      select category_id into v_category_id
      from public.job_descriptions
      where id = v_job_id
        and status = 'ACTIVE'
      for update;
      if not found then
        raise exception 'NOT_FOUND' using errcode = 'P0001';
      end if;

      if jsonb_typeof(v_item->'subcategoryIds') = 'array' then
        select coalesce(array_agg(id order by ord), array[]::uuid[])
        into v_ids
        from (
          select id, min(ord) ord
          from (
            select nullif(btrim(value), '')::uuid id, ordinality::integer ord
            from jsonb_array_elements_text(v_item->'subcategoryIds') with ordinality t(value, ordinality)
            where nullif(btrim(value), '') is not null
          ) raw
          where id is not null
          group by id
        ) ordered;
      else
        select coalesce(
          array_agg(distinct btrim(value)) filter (where btrim(value) <> ''),
          array[]::text[]
        )
        into v_names
        from unnest(
          string_to_array(
            coalesce(v_item->>'subcategories', v_item->>'subcategoryNames', ''),
            ';'
          )
        ) as u(value);

        -- Also allow comma-separated when no semicolons present.
        if cardinality(v_names) = 1 and position(',' in v_names[1]) > 0 then
          select coalesce(
            array_agg(distinct btrim(value)) filter (where btrim(value) <> ''),
            array[]::text[]
          )
          into v_names
          from unnest(string_to_array(v_names[1], ',')) as u(value);
        end if;

        v_ids := array[]::uuid[];
        if v_names is not null then
          foreach v_name in array v_names loop
            select c.id into v_matched
            from public.categories c
            where c.parent_id = v_category_id
              and c.active
              and (
                lower(c.name) = lower(v_name)
                or lower(c.slug) = lower(v_name)
              )
            limit 1;
            if v_matched is null then
              raise exception 'UNKNOWN_SUBCATEGORY:%', v_name using errcode = 'P0001';
            end if;
            if not (v_matched = any (v_ids)) then
              v_ids := array_append(v_ids, v_matched);
            end if;
          end loop;
        end if;
      end if;

      perform public.replace_job_description_subcategories(v_job_id, v_category_id, v_ids, true);

      v_ok := v_ok + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'id', v_job_id,
        'ok', true,
        'subcategoryIds', to_jsonb(public.job_description_subcategory_ids(v_job_id))
      ));
    exception when others then
      v_failed := v_failed + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'id', coalesce(v_item->>'jobDescriptionId', v_item->>'id'),
        'ok', false,
        'code', SQLSTATE,
        'message', case
          when SQLERRM like 'UNKNOWN_SUBCATEGORY:%' then 'Unknown subcategory: ' || split_part(SQLERRM, ':', 2)
          when SQLERRM = 'INVALID_ID' then 'Missing or invalid Job ID.'
          when SQLERRM = 'NOT_FOUND' then 'Job description not found or not active.'
          when SQLERRM like 'JOB_EDIT_INVALID:%' then regexp_replace(SQLERRM, '^JOB_EDIT_INVALID:\s*', '')
          else 'The subcategory update could not be saved.'
        end
      ));
    end;
  end loop;

  return jsonb_build_object(
    'total', v_count,
    'succeeded', v_ok,
    'failed', v_failed,
    'results', v_results
  );
end;
$$;

revoke all on function public.manager_bulk_set_job_subcategories_v371(jsonb) from public, anon;
grant execute on function public.manager_bulk_set_job_subcategories_v371(jsonb) to authenticated;

comment on function public.manager_bulk_set_job_subcategories_v371(jsonb) is
  'Manager/Admin bulk set of JD subcategories by id (including Approved). Names resolved under each JD primary category.';
