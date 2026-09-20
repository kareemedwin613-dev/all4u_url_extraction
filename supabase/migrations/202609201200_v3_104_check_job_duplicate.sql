-- v3.104: pre-save duplicate check for Chrome-extension JD capture (no insert).

create or replace function public.check_job_description_duplicate_v3104(
  p_company text,
  p_job_title text,
  p_normalized_source_url text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_job public.job_descriptions;
  v_normalized_url text := btrim(coalesce(p_normalized_source_url, ''));
  v_company text := regexp_replace(btrim(coalesce(p_company, '')), '\s+', ' ', 'g');
  v_job_title text := regexp_replace(btrim(coalesce(p_job_title, '')), '\s+', ' ', 'g');
begin
  if v_actor is null
     or not public.is_active_user(v_actor)
     or not public.has_any_role(array['APPLYING_MANAGER', 'JD_FINDER', 'ADMIN']) then
    raise exception 'JOB_CAPTURE_ACCESS_DENIED: Active capture access is required.' using errcode = '42501';
  end if;

  if v_company = '' and v_job_title = '' and v_normalized_url = '' then
    raise exception 'JOB_DUPLICATE_CHECK_INVALID: Enter a source URL and/or company and job title to check.' using errcode = '22023';
  end if;

  if v_normalized_url <> '' then
    if v_normalized_url !~* '^https?://' then
      raise exception 'JOB_DUPLICATE_CHECK_INVALID: The source URL must use HTTP or HTTPS.' using errcode = '22023';
    end if;

    select * into v_job
    from public.job_descriptions
    where user_id = v_actor and normalized_source_url = v_normalized_url
    order by created_at, id
    limit 1;

    if found then
      return jsonb_build_object(
        'duplicate', true,
        'duplicateReason', 'SOURCE_URL',
        'row', jsonb_build_object(
          'id', v_job.id,
          'company', v_job.company,
          'job_title', v_job.job_title,
          'source_url', v_job.source_url,
          'review_status', v_job.review_status,
          'status', v_job.status,
          'created_at', v_job.created_at
        )
      );
    end if;
  end if;

  if v_company <> '' and v_job_title <> '' then
    select * into v_job
    from public.job_descriptions
    where user_id = v_actor
      and lower(btrim(company)) = lower(v_company)
      and lower(btrim(job_title)) = lower(v_job_title)
    order by created_at, id
    limit 1;

    if found then
      return jsonb_build_object(
        'duplicate', true,
        'duplicateReason', 'COMPANY_JOB_TITLE',
        'row', jsonb_build_object(
          'id', v_job.id,
          'company', v_job.company,
          'job_title', v_job.job_title,
          'source_url', v_job.source_url,
          'review_status', v_job.review_status,
          'status', v_job.status,
          'created_at', v_job.created_at
        )
      );
    end if;
  end if;

  return jsonb_build_object(
    'duplicate', false,
    'duplicateReason', null,
    'row', null
  );
end;
$$;

revoke all on function public.check_job_description_duplicate_v3104(text, text, text) from public, anon;
grant execute on function public.check_job_description_duplicate_v3104(text, text, text) to authenticated;

comment on function public.check_job_description_duplicate_v3104(text, text, text) is
  'Read-only duplicate preview for Chrome-extension capture using the same caller-owned URL and company/title rules as capture_job_description_v353.';
