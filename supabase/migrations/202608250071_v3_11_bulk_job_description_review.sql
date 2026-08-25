-- v3.11: bulk JD review in one statement (avoids N sequential RPC round-trips / client timeouts).

create or replace function public.bulk_review_job_descriptions_v311(
  p_job_description_ids uuid[],
  p_review_status text,
  p_decline_reason text default null,
  p_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_new text := upper(btrim(coalesce(p_review_status, '')));
  v_reason text := nullif(upper(btrim(coalesce(p_decline_reason, ''))), '');
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_archive_reason text;
  v_ids uuid[];
  v_updated jsonb := '[]'::jsonb;
  v_results jsonb := '[]'::jsonb;
  v_id uuid;
  v_row jsonb;
  v_succeeded integer := 0;
begin
  perform public.assert_application_manager();

  if p_job_description_ids is null then
    raise exception 'JOB_REVIEW_INVALID: Select at least one Job Description.' using errcode = '22023';
  end if;

  select array_agg(x order by x)
    into v_ids
  from (
    select distinct t.x
    from unnest(p_job_description_ids) as t(x)
    where t.x is not null
  ) d;

  if v_ids is null or cardinality(v_ids) < 1 then
    raise exception 'JOB_REVIEW_INVALID: Select at least one Job Description.' using errcode = '22023';
  end if;
  if cardinality(v_ids) > 100 then
    raise exception 'JOB_REVIEW_INVALID: Select no more than 100 Job Descriptions.' using errcode = '22023';
  end if;
  if v_new not in ('NEEDS_REVIEW', 'APPROVED', 'NEEDS_CORRECTION', 'DECLINED') then
    raise exception 'JOB_REVIEW_INVALID: Select a valid review decision.' using errcode = '22023';
  end if;
  if v_new = 'DECLINED' and v_reason not in ('EXPIRED', 'NOT_ELIGIBLE', 'DUPLICATE', 'INVALID_URL', 'OTHER') then
    raise exception 'JOB_REVIEW_REASON_INVALID: Select a decline reason.' using errcode = '22023';
  end if;
  if v_new <> 'DECLINED' then
    v_reason := null;
  end if;
  if char_length(coalesce(v_comment, '')) > 1000 then
    raise exception 'JOB_REVIEW_COMMENT_INVALID: Comments may contain at most 1000 characters.' using errcode = '22023';
  end if;

  v_archive_reason := case v_reason
    when 'EXPIRED' then 'EXPIRED'
    when 'DUPLICATE' then 'DUPLICATE'
    when 'NOT_ELIGIBLE' then 'NOT_APPLICABLE'
    else 'OTHER'
  end;

  with updated as (
    update public.job_descriptions
    set
      review_status = v_new,
      review_comment = v_comment,
      review_decline_reason = v_reason,
      reviewed_by = auth.uid(),
      reviewed_at = clock_timestamp(),
      status = case when v_new = 'DECLINED' then 'ARCHIVED' else 'ACTIVE' end,
      archive_reason = case when v_new = 'DECLINED' then v_archive_reason else null end
    where id = any (v_ids)
    returning
      id,
      review_status,
      review_comment,
      review_decline_reason,
      reviewed_by,
      reviewed_at,
      status,
      archive_reason,
      archived_at,
      archived_by,
      updated_at
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', u.id,
        'review_status', u.review_status,
        'review_comment', u.review_comment,
        'review_decline_reason', u.review_decline_reason,
        'reviewed_by', u.reviewed_by,
        'reviewed_at', u.reviewed_at,
        'status', u.status,
        'archive_reason', u.archive_reason,
        'archived_at', u.archived_at,
        'archived_by', u.archived_by,
        'updated_at', u.updated_at
      )
    ),
    '[]'::jsonb
  )
  into v_updated
  from updated u;

  foreach v_id in array v_ids loop
    select e
      into v_row
    from jsonb_array_elements(v_updated) e
    where e->>'id' = v_id::text
    limit 1;

    if v_row is null then
      v_results := v_results || jsonb_build_array(
        jsonb_build_object(
          'id', v_id,
          'ok', false,
          'code', 'JOB_NOT_FOUND',
          'message', 'The job description was not found or is not accessible.'
        )
      );
    else
      v_succeeded := v_succeeded + 1;
      v_results := v_results || jsonb_build_array(
        jsonb_build_object('id', v_id, 'ok', true, 'data', v_row)
      );
    end if;
  end loop;

  return jsonb_build_object(
    'total', cardinality(v_ids),
    'succeeded', v_succeeded,
    'failed', cardinality(v_ids) - v_succeeded,
    'results', v_results
  );
end;
$$;

revoke all on function public.bulk_review_job_descriptions_v311(uuid[], text, text, text) from public, anon;
grant execute on function public.bulk_review_job_descriptions_v311(uuid[], text, text, text) to authenticated;
