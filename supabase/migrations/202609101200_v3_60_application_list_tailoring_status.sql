-- v3.60: return Application rows and their tailoring state in one client round trip.

create or replace function public.list_applications_v360(
  p_search text default '', p_assigned_to uuid default null, p_work_status text default '',
  p_application_status text default '', p_priority text default '', p_company text default '',
  p_category_id uuid default null, p_due_filter text default '', p_sort text default 'updated_desc',
  p_creation_batch_id uuid default null, p_creation_mode text default '',
  p_profile_name text default '', p_resume_name text default '',
  p_limit integer default 25, p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_items jsonb;
begin
  v_result := public.list_applications_v07(
    p_search => p_search,
    p_assigned_to => p_assigned_to,
    p_work_status => p_work_status,
    p_application_status => p_application_status,
    p_priority => p_priority,
    p_company => p_company,
    p_category_id => p_category_id,
    p_due_filter => p_due_filter,
    p_sort => p_sort,
    p_creation_batch_id => p_creation_batch_id,
    p_creation_mode => p_creation_mode,
    p_profile_name => p_profile_name,
    p_resume_name => p_resume_name,
    p_limit => p_limit,
    p_offset => p_offset
  );

  select coalesce(
    jsonb_agg(
      item.value || jsonb_build_object(
        'tailoring_status', tailoring.status,
        'tailoring_job_id', tailoring.id
      )
      order by item.ordinality
    ),
    '[]'::jsonb
  )
  into v_items
  from jsonb_array_elements(coalesce(v_result->'items', '[]'::jsonb))
    with ordinality as item(value, ordinality)
  left join public.tailoring_jobs tailoring
    on tailoring.application_id = (item.value->>'id')::uuid;

  return jsonb_set(v_result, '{items}', v_items, true);
end;
$$;

revoke all on function public.list_applications_v360(text,uuid,text,text,text,text,uuid,text,text,uuid,text,text,text,integer,integer) from public, anon;
grant execute on function public.list_applications_v360(text,uuid,text,text,text,text,uuid,text,text,uuid,text,text,text,integer,integer) to authenticated;

comment on function public.list_applications_v360(text,uuid,text,text,text,text,uuid,text,text,uuid,text,text,text,integer,integer) is
  'Returns the accessible Application page with its current tailoring status in one API-to-database request.';
