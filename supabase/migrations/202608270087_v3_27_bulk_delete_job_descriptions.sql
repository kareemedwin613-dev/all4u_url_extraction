-- Bulk hard-delete Job Descriptions that have no Applications.

create or replace function public.bulk_delete_job_descriptions_v314(
  p_job_description_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids uuid[];
  v_id uuid;
  v_job public.job_descriptions;
  v_app_count integer;
  v_results jsonb := '[]'::jsonb;
  v_succeeded integer := 0;
begin
  perform public.assert_application_manager();

  if p_job_description_ids is null then
    raise exception 'JOB_DELETE_INVALID: Select at least one Job Description.' using errcode = '22023';
  end if;

  select array_agg(x order by x)
  into v_ids
  from (
    select distinct t.x
    from unnest(p_job_description_ids) as t(x)
    where t.x is not null
  ) d;

  if v_ids is null or cardinality(v_ids) < 1 then
    raise exception 'JOB_DELETE_INVALID: Select at least one Job Description.' using errcode = '22023';
  end if;
  if cardinality(v_ids) > 1000 then
    raise exception 'JOB_DELETE_INVALID: Select no more than 1000 Job Descriptions.' using errcode = '22023';
  end if;

  foreach v_id in array v_ids loop
    select * into v_job
    from public.job_descriptions
    where id = v_id
    for update;

    if not found then
      v_results := v_results || jsonb_build_array(
        jsonb_build_object(
          'id', v_id,
          'ok', false,
          'code', 'JOB_NOT_FOUND',
          'message', 'The job description was not found or is not accessible.'
        )
      );
      continue;
    end if;

    select count(*)::integer
    into v_app_count
    from public.applications
    where job_description_id = v_id;

    if v_app_count > 0 then
      v_results := v_results || jsonb_build_array(
        jsonb_build_object(
          'id', v_id,
          'ok', false,
          'code', 'JOB_HAS_APPLICATIONS',
          'message', format(
            'Job Description has %s Application%s and cannot be deleted. Decline it instead.',
            v_app_count,
            case when v_app_count = 1 then '' else 's' end
          )
        )
      );
      continue;
    end if;

    delete from public.job_descriptions where id = v_id;
    v_succeeded := v_succeeded + 1;
    v_results := v_results || jsonb_build_array(
      jsonb_build_object(
        'id', v_id,
        'ok', true,
        'data', jsonb_build_object(
          'id', v_id,
          'company', v_job.company,
          'job_title', v_job.job_title,
          'source_url', v_job.source_url
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

revoke all on function public.bulk_delete_job_descriptions_v314(uuid[]) from public, anon;
grant execute on function public.bulk_delete_job_descriptions_v314(uuid[]) to authenticated;

comment on function public.bulk_delete_job_descriptions_v314(uuid[]) is
  'Permanently delete Job Descriptions with no Applications (Applying Manager / Admin).';
