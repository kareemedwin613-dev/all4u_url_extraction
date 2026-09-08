-- Remove expired Job URLs: delete pre-apply applications, then hard-delete JDs
-- only when no applications remain (Applied / Blocked / later keep the JD).

create or replace function public.remove_expired_job_descriptions_v364(
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
  v_results jsonb := '[]'::jsonb;
  v_succeeded integer := 0;
  v_deleted_applications integer := 0;
  v_kept_applications integer := 0;
  v_job_deleted boolean := false;
  v_deleted_applications_total integer := 0;
begin
  perform public.assert_application_manager();

  if p_job_description_ids is null then
    raise exception 'JOB_DELETE_INVALID: Select at least one Job Description.'
      using errcode = '22023';
  end if;

  select array_agg(x order by x)
  into v_ids
  from (
    select distinct t.x
    from unnest(p_job_description_ids) as t(x)
    where t.x is not null
  ) d;

  if v_ids is null or cardinality(v_ids) < 1 then
    raise exception 'JOB_DELETE_INVALID: Select at least one Job Description.'
      using errcode = '22023';
  end if;
  if cardinality(v_ids) > 1000 then
    raise exception 'JOB_DELETE_INVALID: Select no more than 1000 Job Descriptions.'
      using errcode = '22023';
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
          'message', 'The Job Description was not found or is not accessible.'
        )
      );
      continue;
    end if;

    with deleted as (
      delete from public.applications
      where job_description_id = v_id
        and status in ('UNASSIGNED', 'ASSIGNED', 'IN_PROGRESS')
      returning 1
    )
    select count(*)::integer into v_deleted_applications
    from deleted;

    select count(*)::integer into v_kept_applications
    from public.applications
    where job_description_id = v_id;

    v_job_deleted := false;
    if v_kept_applications = 0 then
      delete from public.job_descriptions
      where id = v_id;
      v_job_deleted := true;
    end if;

    v_deleted_applications_total := v_deleted_applications_total + v_deleted_applications;
    v_succeeded := v_succeeded + 1;
    v_results := v_results || jsonb_build_array(
      jsonb_build_object(
        'id', v_id,
        'ok', true,
        'data', jsonb_build_object(
          'id', v_id,
          'deletedApplications', v_deleted_applications,
          'keptApplications', v_kept_applications,
          'jobDeleted', v_job_deleted,
          'message', case
            when v_job_deleted then 'Job Description deleted.'
            else 'Job Description kept because Applied, Blocked, or later applications remain.'
          end
        )
      )
    );
  end loop;

  return jsonb_build_object(
    'total', cardinality(v_ids),
    'succeeded', v_succeeded,
    'failed', cardinality(v_ids) - v_succeeded,
    'deletedApplications', v_deleted_applications_total,
    'results', v_results
  );
end;
$$;

revoke all on function public.remove_expired_job_descriptions_v364(uuid[])
  from public, anon;
grant execute on function public.remove_expired_job_descriptions_v364(uuid[])
  to authenticated;

comment on function public.remove_expired_job_descriptions_v364(uuid[]) is
  'Deletes UNASSIGNED/ASSIGNED/IN_PROGRESS applications for selected JDs, then hard-deletes each JD only when no applications remain.';
