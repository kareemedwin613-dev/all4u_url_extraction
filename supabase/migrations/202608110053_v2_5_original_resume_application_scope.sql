-- v2.5: Application creation starts from active ORIGINAL Resumes only.
-- Tailored children remain attached to their existing Application and must not
-- be offered as sources for individual or bulk Application creation.

create or replace function public.preview_bulk_applications(p_selected_jd_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_ids uuid[];v_limit constant integer:=100;v_result jsonb;
begin
  perform public.assert_application_manager();
  select coalesce(array_agg(id order by id),array[]::uuid[]) into v_ids
  from(select distinct id from unnest(coalesce(p_selected_jd_ids,array[]::uuid[])) ids(id) where id is not null)x;
  if cardinality(v_ids)=0 then raise exception 'BULK_NO_JDS: Select at least one job description.' using errcode='22023';end if;
  if cardinality(v_ids)>v_limit then raise exception 'BULK_JD_LIMIT: You can select up to 100 job descriptions in one bulk operation.' using errcode='22023';end if;

  with requested as(
    select id from unnest(v_ids) requested_ids(id)
  ),loaded as(
    select requested.id requested_id,jobs.id,jobs.company,jobs.job_title,jobs.category_id,categories.name category_name
    from requested left join public.job_descriptions jobs on jobs.id=requested.id
    left join public.categories categories on categories.id=jobs.category_id and categories.active
  ),combinations as(
    select concat(loaded.id,':',resumes.id) key,loaded.id job_description_id,resumes.id resume_id,
      loaded.company,loaded.job_title,loaded.category_id job_category_id,loaded.category_name job_category_name,
      resumes.resume_number,resumes.resume_type,resumes.candidate_name,resumes.resume_name,
      resumes.primary_category_id resume_category_id,resume_categories.name resume_category_name,
      applications.id existing_application_id,applications.id is null eligible,
      case when applications.id is not null then 'EXISTING_APPLICATION' end exclusion_code,
      case when applications.id is not null then 'Application already exists' end exclusion_reason
    from loaded join public.resumes resumes
      on resumes.primary_category_id=loaded.category_id and resumes.status='ACTIVE' and resumes.resume_type='ORIGINAL'
    left join public.categories resume_categories on resume_categories.id=resumes.primary_category_id
    left join public.applications applications on applications.job_description_id=loaded.id
      and coalesce((select parent_resume_id from public.resumes where id=applications.resume_id),applications.resume_id)=resumes.id
    where loaded.id is not null and loaded.category_id is not null and loaded.category_name is not null
  ),invalid_jds as(
    select loaded.requested_id job_description_id,coalesce(loaded.company,'Unavailable job description') company,
      coalesce(loaded.job_title,'Unavailable') job_title,
      case when loaded.id is null then 'MISSING_JD' when loaded.category_id is null or loaded.category_name is null then 'MISSING_CATEGORY' else 'NO_MATCHING_ACTIVE_RESUMES' end code,
      case when loaded.id is null then 'The job description does not exist or is unavailable.' when loaded.category_id is null or loaded.category_name is null then 'The job description has no valid primary category.' else 'No active original Resumes have the same primary category.' end reason
    from loaded where loaded.id is null or loaded.category_id is null or loaded.category_name is null
      or not exists(select 1 from combinations where combinations.job_description_id=loaded.id)
  )
  select jsonb_build_object(
    'selectedJdCount',cardinality(v_ids),'validJdCount',cardinality(v_ids)-(select count(*) from invalid_jds),
    'invalidJdCount',(select count(*) from invalid_jds),'activeResumeCount',(select count(distinct resume_id) from combinations),
    'proposedCount',(select count(*) from combinations),'eligibleCount',(select count(*) from combinations where eligible),
    'duplicateCount',(select count(*) from combinations where not eligible),
    'excludedCount',(select count(*) from combinations where not eligible)+(select count(*) from invalid_jds),
    'combinations',coalesce((select jsonb_agg(jsonb_build_object(
      'key',key,'jobDescriptionId',job_description_id,'resumeId',resume_id,'resumeNumber',resume_number,'resumeType',resume_type,
      'company',company,'jobTitle',job_title,'jobCategoryId',job_category_id,'jobCategoryName',job_category_name,
      'candidateName',candidate_name,'resumeName',resume_name,'resumeCategoryId',resume_category_id,
      'resumeCategoryName',resume_category_name,'eligible',eligible,'existingApplicationId',existing_application_id,
      'exclusionCode',exclusion_code,'exclusionReason',exclusion_reason
    )order by company,job_title,candidate_name,resume_name)from combinations),'[]'::jsonb),
    'invalidJds',coalesce((select jsonb_agg(jsonb_build_object('jobDescriptionId',job_description_id,'company',company,
      'jobTitle',job_title,'code',code,'reason',reason)order by company,job_title)from invalid_jds),'[]'::jsonb)
  )into v_result;
  return v_result;
end$$;

comment on function public.preview_bulk_applications(uuid[]) is
  'Previews selected JD pairs using active ORIGINAL Resumes only; tailored variants are never Application sources.';

