-- One authorized snapshot of the exact attached Resume and JD for a user-initiated clipboard action.
-- No files, profile answer libraries, credentials, or other Applications are returned.
create function public.get_application_qa_context_v3154(p_application_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not public.is_active_user(auth.uid()) then
    raise exception 'APPLICATION_ACCESS_DENIED: An active authenticated user is required.' using errcode='42501';
  end if;
  select jsonb_build_object(
    'applicationNumber',a.application_number,
    'company',j.company,'jobTitle',j.job_title,'jobDescription',j.description_text,
    'resumeId',r.id,'resumeType',r.resume_type,'resumeText',r.resume_text
  ) into v_result
  from public.applications a
  join public.job_descriptions j on j.id=a.job_description_id
  join public.resumes r on r.id=a.resume_id
  where a.id=p_application_id and public.application_actor_can_view(a.assigned_to) and r.status='ACTIVE';
  if v_result is null then
    raise exception 'APPLICATION_CONTEXT_UNAVAILABLE: The Application or its active Resume is unavailable.' using errcode='42501';
  end if;
  if nullif(btrim(v_result->>'resumeText'),'') is null or nullif(btrim(v_result->>'jobDescription'),'') is null then
    raise exception 'APPLICATION_CONTEXT_INCOMPLETE: Save readable Resume and job description text before copying the Q&A prompt.' using errcode='P0001';
  end if;
  return v_result;
end; $$;
revoke all on function public.get_application_qa_context_v3154(uuid) from public,anon;
grant execute on function public.get_application_qa_context_v3154(uuid) to authenticated;
notify pgrst,'reload schema';
