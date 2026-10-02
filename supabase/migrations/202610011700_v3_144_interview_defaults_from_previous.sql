-- The next interview on an Application keeps the interviewee, company website, and job type
-- already entered on an earlier round.

create or replace function public.interview_application_defaults_v139(p_application_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_app public.applications;
  v_salary text;
begin
  select * into v_app from public.applications where id = p_application_id;
  if not found or not public.application_actor_can_view(v_app.assigned_to) then
    raise exception 'INTERVIEW_APPLICATION_NOT_FOUND: The Application was not found or is not accessible.' using errcode = 'P0001';
  end if;
  select case
    when nullif(btrim(j.salary_text), '') is not null then btrim(j.salary_text)
    when j.salary_min is not null then trim(both from concat_ws(' ',
      nullif(j.salary_currency, ''),
      j.salary_min::text,
      case when j.salary_max is not null and j.salary_max is distinct from j.salary_min then '– ' || j.salary_max::text else null end
    ))
    else null
  end
  into v_salary
  from public.job_descriptions j
  where j.id = v_app.job_description_id;
  return (
    select jsonb_build_object(
      'applicationId', v_app.id,
      'applicationNumber', v_app.application_number,
      'intervieweeUserId', (
        select i.interviewee_user_id
        from public.interviews i
        where i.application_id = v_app.id
          and i.interviewee_user_id is not null
        order by i.created_at desc
        limit 1
      ),
      'intervieweeName', r.candidate_name,
      'profileName', r.candidate_name,
      'profileEmail', r.candidate_email,
      'profilePhone', r.candidate_phone,
      'companyName', j.company,
      'companyWebsite', (
        select i.company_website
        from public.interviews i
        where i.application_id = v_app.id
          and nullif(btrim(i.company_website), '') is not null
        order by i.created_at desc
        limit 1
      ),
      'jobLink', j.source_url,
      'roleTitle', j.job_title,
      'jobType', (
        select i.job_type
        from public.interviews i
        where i.application_id = v_app.id
          and i.job_type in ('FULL_TIME', 'PART_TIME', 'CONTRACT')
        order by i.created_at desc
        limit 1
      ),
      'location', case j.work_arrangement
        when 'REMOTE' then 'REMOTE'
        when 'HYBRID' then 'HYBRID'
        when 'ONSITE' then 'ONSITE'
        else null
      end,
      'place', nullif(btrim(j.location_text), ''),
      'salaryRange', v_salary,
      'appliedDate', v_app.applied_at::date,
      'linkedinUrl', r.linkedin_url,
      'resumeId', r.id
    )
    from public.job_descriptions j
    join public.resumes r on r.id = v_app.resume_id
    where j.id = v_app.job_description_id
  );
end;
$$;
