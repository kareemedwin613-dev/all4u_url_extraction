-- Calendar events use the primary category shared by the job and the resume.

create or replace function public.interview_json(p_row public.interviews)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', p_row.id,
    'applicationId', p_row.application_id,
    'applicationNumber', (
      select a.application_number from public.applications a where a.id = p_row.application_id
    ),
    'categorySlug', (
      select c.slug
      from public.applications a
      join public.job_descriptions j on j.id = a.job_description_id
      join public.categories c on c.id = j.category_id and c.parent_id is null
      where a.id = p_row.application_id
        and (
          exists (
            select 1
            from public.resume_tech_stacks s
            where s.primary_category_id = j.category_id
              and s.resume_id in (
                a.resume_id,
                (select r.parent_resume_id from public.resumes r where r.id = a.resume_id)
              )
          )
          or exists (
            select 1
            from public.resumes r
            where r.primary_category_id = j.category_id
              and r.id in (
                a.resume_id,
                (select parent.parent_resume_id from public.resumes parent where parent.id = a.resume_id)
              )
          )
        )
    ),
    'intervieweeUserId', p_row.interviewee_user_id,
    'startsAt', p_row.starts_at,
    'endsAt', p_row.ends_at,
    'intervieweeName', p_row.interviewee_name,
    'profileName', p_row.profile_name,
    'profileEmail', p_row.profile_email,
    'profilePhone', p_row.profile_phone,
    'professionalStack', p_row.professional_stack,
    'companyName', p_row.company_name,
    'companyWebsite', p_row.company_website,
    'jobLink', p_row.job_link,
    'roleTitle', p_row.role_title,
    'jobType', p_row.job_type,
    'location', p_row.location,
    'salaryRange', p_row.salary_range,
    'stage', p_row.stage,
    'status', p_row.status,
    'interviewType', p_row.interview_type,
    'meetingUrl', p_row.meeting_url,
    'meetingId', p_row.meeting_id,
    'passcode', p_row.passcode,
    'recruiterName', p_row.recruiter_name,
    'recruiterEmail', p_row.recruiter_email,
    'recruiterPhone', p_row.recruiter_phone,
    'interviewers', p_row.interviewers,
    'interviewerPosition', p_row.interviewer_position,
    'interviewerLocation', p_row.interviewer_location,
    'linkedinUrl', p_row.linkedin_url,
    'resumeLink', p_row.resume_link,
    'place', p_row.place,
    'appliedDate', p_row.applied_date,
    'notes', p_row.notes,
    'detailedInformation', p_row.detailed_information,
    'createdBy', p_row.created_by,
    'createdAt', p_row.created_at,
    'updatedAt', p_row.updated_at,
    'rounds', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'roundName', r.round_name,
        'startsAt', r.starts_at,
        'endsAt', r.ends_at,
        'interviewer', r.interviewer,
        'status', r.status,
        'notes', r.notes
      ) order by r.sort_order)
      from public.interview_rounds r
      where r.interview_id = p_row.id
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.interview_json(public.interviews) from public, anon, authenticated;
