-- Raise bulk JD selection limits from 100 to 1000 (matches large Jobs page sizes).

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
  if cardinality(v_ids) > 1000 then
    raise exception 'JOB_REVIEW_INVALID: Select no more than 1000 Job Descriptions.' using errcode = '22023';
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

create or replace function public.preview_bulk_applications(p_selected_jd_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_ids uuid[];v_limit constant integer:=1000;v_result jsonb;
begin
  perform public.assert_application_manager();
  select coalesce(array_agg(id order by id),array[]::uuid[]) into v_ids from(select distinct id from unnest(coalesce(p_selected_jd_ids,array[]::uuid[])) ids(id) where id is not null)x;
  if cardinality(v_ids)=0 then raise exception 'BULK_NO_JDS: Select at least one job description.' using errcode='22023';end if;
  if cardinality(v_ids)>v_limit then raise exception 'BULK_JD_LIMIT: You can select up to 1000 job descriptions in one bulk operation.' using errcode='22023';end if;
  with requested as(select id from unnest(v_ids) requested_ids(id)),loaded as(
    select requested.id requested_id,jobs.id,jobs.company,jobs.job_title,jobs.category_id,jobs.status,jobs.review_status,categories.name category_name
    from requested left join public.job_descriptions jobs on jobs.id=requested.id
    left join public.categories categories on categories.id=jobs.category_id and categories.active
  ),combinations as(
    select concat(loaded.id,':',resumes.id) key,loaded.id job_description_id,resumes.id resume_id,loaded.company,loaded.job_title,
      loaded.category_id job_category_id,loaded.category_name job_category_name,resumes.resume_number,resumes.resume_type,
      resumes.candidate_name,resumes.resume_name,resumes.primary_category_id resume_category_id,resume_categories.name resume_category_name,
      applications.id existing_application_id,
      exists(
        select 1 from public.resume_banned_companies banned
        where banned.resume_id = resumes.id
          and banned.normalized_company = public.normalize_company_name(loaded.company)
      ) as banned_company,
      applications.id is null
        and not exists(
          select 1 from public.resume_banned_companies banned
          where banned.resume_id = resumes.id
            and banned.normalized_company = public.normalize_company_name(loaded.company)
        ) as eligible,
      case
        when applications.id is not null then 'EXISTING_APPLICATION'
        when exists(
          select 1 from public.resume_banned_companies banned
          where banned.resume_id = resumes.id
            and banned.normalized_company = public.normalize_company_name(loaded.company)
        ) then 'BANNED_COMPANY'
      end as exclusion_code,
      case
        when applications.id is not null then 'Application already exists'
        when exists(
          select 1 from public.resume_banned_companies banned
          where banned.resume_id = resumes.id
            and banned.normalized_company = public.normalize_company_name(loaded.company)
        ) then 'This Resume bans applications to this company'
      end as exclusion_reason
    from loaded join public.resumes resumes on resumes.primary_category_id=loaded.category_id and resumes.status='ACTIVE' and resumes.resume_type='ORIGINAL'
    left join public.categories resume_categories on resume_categories.id=resumes.primary_category_id
    left join public.applications applications on applications.job_description_id=loaded.id
      and coalesce((select parent_resume_id from public.resumes where id=applications.resume_id),applications.resume_id)=resumes.id
    where loaded.id is not null and loaded.status='ACTIVE' and loaded.review_status='APPROVED'
      and loaded.category_id is not null and loaded.category_name is not null
  ),invalid_jds as(
    select loaded.requested_id job_description_id,coalesce(loaded.company,'Unavailable job description') company,coalesce(loaded.job_title,'Unavailable') job_title,
      case when loaded.id is null then 'MISSING_JD' when loaded.status<>'ACTIVE' then 'INACTIVE_JD'
        when loaded.review_status<>'APPROVED' then 'UNAPPROVED_JD'
        when loaded.category_id is null or loaded.category_name is null then 'MISSING_CATEGORY' else 'NO_MATCHING_ACTIVE_RESUMES' end code,
      case when loaded.id is null then 'The job description does not exist or is unavailable.' when loaded.status<>'ACTIVE' then 'The job description is archived.'
        when loaded.review_status<>'APPROVED' then 'The job description has not been approved.'
        when loaded.category_id is null or loaded.category_name is null then 'The job description has no valid primary category.' else 'No active original Resumes have the same primary category.' end reason
    from loaded where loaded.id is null or loaded.status<>'ACTIVE' or loaded.review_status<>'APPROVED' or loaded.category_id is null or loaded.category_name is null
      or not exists(select 1 from combinations where combinations.job_description_id=loaded.id)
  ) select jsonb_build_object('selectedJdCount',cardinality(v_ids),'validJdCount',cardinality(v_ids)-(select count(*) from invalid_jds),
    'invalidJdCount',(select count(*) from invalid_jds),'activeResumeCount',(select count(distinct resume_id) from combinations),
    'proposedCount',(select count(*) from combinations),'eligibleCount',(select count(*) from combinations where eligible),
    'duplicateCount',(select count(*) from combinations where not eligible and exclusion_code='EXISTING_APPLICATION'),
    'excludedCount',(select count(*) from combinations where not eligible)+(select count(*) from invalid_jds),
    'combinations',coalesce((select jsonb_agg(jsonb_build_object('key',key,'jobDescriptionId',job_description_id,'resumeId',resume_id,'resumeNumber',resume_number,'resumeType',resume_type,
      'company',company,'jobTitle',job_title,'jobCategoryId',job_category_id,'jobCategoryName',job_category_name,'candidateName',candidate_name,'resumeName',resume_name,
      'resumeCategoryId',resume_category_id,'resumeCategoryName',resume_category_name,'eligible',eligible,'existingApplicationId',existing_application_id,
      'exclusionCode',exclusion_code,'exclusionReason',exclusion_reason)order by company,job_title,candidate_name,resume_name)from combinations),'[]'::jsonb),
    'invalidJds',coalesce((select jsonb_agg(jsonb_build_object('jobDescriptionId',job_description_id,'company',company,'jobTitle',job_title,'code',code,'reason',reason)order by company,job_title)from invalid_jds),'[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;
