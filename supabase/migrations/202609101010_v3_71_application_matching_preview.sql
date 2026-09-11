create function public.preview_application_matches(p_selected_jd_ids uuid[],p_resume_ids uuid[] default null)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare ids uuid[]; result jsonb;
begin
  perform public.assert_application_manager();
  select array_agg(distinct id) into ids from unnest(p_selected_jd_ids) x(id) where id is not null;
  if coalesce(cardinality(ids),0) not between 1 and 1000 then raise exception 'MATCH_INVALID_REQUEST: Select 1 to 1000 JDs.' using errcode='22023'; end if;
  with jobs as materialized (
    select j.* from public.job_descriptions j where j.id=any(ids) and j.status='ACTIVE' and j.review_status='APPROVED'
  ), resumes as materialized (
    select r.* from public.resumes r where r.status='ACTIVE' and r.resume_type='ORIGINAL'
      and (p_resume_ids is null or r.id=any(p_resume_ids))
  ), pairs as materialized (
    select j.id jid,r.id rid,j.company,j.job_title,j.category_id,r.primary_category_id,r.candidate_name,r.resume_name,r.resume_number
    from jobs j cross join resumes r order by j.company,j.job_title,j.id,r.candidate_name,r.id limit 5000
  ), evaluated as materialized (
    select p.*,public.application_match_eligibility(p.jid,p.rid) gate from pairs p
  ), rows as (
    select jsonb_build_object('key',jid::text||':'||rid::text,'jobDescriptionId',jid,'resumeId',rid,
      'resumeType','ORIGINAL','resumeNumber',resume_number,'company',company,'jobTitle',job_title,
      'candidateName',candidate_name,'resumeName',resume_name,'jobCategoryId',category_id,
      'resumeCategoryId',primary_category_id,'jobCategoryName',(select name from public.categories where id=category_id),
      'resumeCategoryName',array_to_string(public.resume_primary_category_names(rid),', '),
      'matchSummary',gate->'matchDetails'->>'summary',
      'matchBreakdown',(select jsonb_object_agg(key,value->'rating') from jsonb_each(coalesce(gate->'matchDetails'->'components','{}'::jsonb))),
      'missingRequirements',gate->'matchDetails'->'missingRequirements') || (gate-'matchDetails') row
    from evaluated
  ), invalid as (
    select id from unnest(ids) x(id) where not exists(select 1 from jobs j where j.id=x.id)
  ) select jsonb_build_object(
    'selectedJdCount',cardinality(ids),'validJdCount',(select count(*) from jobs),'invalidJdCount',(select count(*) from invalid),
    'activeResumeCount',(select count(*) from resumes),'proposedCount',(select count(*) from pairs),
    'totalCombinationCount',(select count(*) from jobs)*(select count(*) from resumes),
    'truncated',((select count(*) from jobs)*(select count(*) from resumes))>5000,
    'matchThreshold',(select threshold from public.application_match_settings where singleton),
    'matchingConfigured',(select model_id<>'UNCONFIGURED' from public.application_match_settings where singleton),
    'eligibleCount',(select count(*) from evaluated where (gate->>'eligible')::boolean),
    'duplicateCount',(select count(*) from evaluated where gate->>'exclusionCode'='EXISTING_APPLICATION'),
    'belowThresholdCount',(select count(*) from evaluated where gate->>'exclusionCode'='BELOW_THRESHOLD'),
    'pendingCount',(select count(*) from evaluated where gate->>'matchStatus' in('PENDING','PROCESSING')),
    'excludedCount',(select count(*) from evaluated where not (gate->>'eligible')::boolean)+(select count(*) from invalid),
    'resumeOptions',(select coalesce(jsonb_agg(jsonb_build_object('resumeId',r.id,'resumeNumber',r.resume_number,'candidateName',r.candidate_name,'resumeName',r.resume_name) order by r.candidate_name,r.id),'[]'::jsonb)
      from public.resumes r where r.status='ACTIVE' and r.resume_type='ORIGINAL'),
    'combinations',coalesce((select jsonb_agg(row) from rows),'[]'::jsonb),
    'invalidJds',coalesce((select jsonb_agg(jsonb_build_object('jobDescriptionId',i.id,'company',j.company,'jobTitle',j.job_title,
      'code',case when j.id is null then 'MISSING_JD' when j.status<>'ACTIVE' then 'INACTIVE_JD' else 'UNAPPROVED_JD' end,
      'reason','JD is missing, archived, or not approved.'))
      from invalid i left join public.job_descriptions j on j.id=i.id),'[]'::jsonb)
  ) into result;
  return result;
end $$;
revoke all on function public.preview_application_matches(uuid[],uuid[]) from public,anon;
grant execute on function public.preview_application_matches(uuid[],uuid[]) to authenticated;
create or replace function public.preview_bulk_applications(p_selected_jd_ids uuid[])
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select public.preview_application_matches(p_selected_jd_ids,null)
$$;
comment on function public.preview_bulk_applications(uuid[]) is 'Original Resume candidates, cached scores and threshold eligibility; no category or subcategory exclusion.';
