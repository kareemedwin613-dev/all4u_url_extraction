-- Cover letter for an Application, for the extension's Download Cover Letter action.
-- Same access rule as get_application_resume_download_v17: the caller must be able to view the
-- Application, and its attached Resume must be active. Returns text, not a Storage path, so an
-- Applier never needs read access to the original Resume's private cover letter upload.
-- Prefers the tailored letter on the attached Resume, then the original Resume's base letter.
create function public.get_application_cover_letter_v123(p_application_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_result jsonb;
begin
  select jsonb_build_object(
    'text',coalesce(nullif(btrim(r.cover_letter_text),''),nullif(btrim(o.cover_letter_text),'')),
    'kind',case when nullif(btrim(r.cover_letter_text),'') is not null and r.resume_type='TAILORED' then 'TAILORED' else 'BASE' end,
    'applicationNumber',a.application_number,
    'resumeNumber',r.resume_number,
    'candidateName',r.candidate_name,
    'candidateEmail',r.candidate_email,
    'candidatePhone',r.candidate_phone,
    'city',r.address_city,
    'stateRegion',r.address_state_region,
    'linkedinUrl',r.linkedin_url)
  into v_result
  from public.applications a
  join public.resumes r on r.id=a.resume_id
  left join public.resumes o on o.id=case when r.resume_type='TAILORED' then r.parent_resume_id else r.id end
  where a.id=p_application_id
    and public.application_actor_can_view(a.assigned_to)
    and r.status='ACTIVE';

  if v_result is null then
    raise exception 'APPLICATION_RESUME_UNAVAILABLE: The active Resume is not available for this Application.' using errcode='42501';
  end if;
  if v_result->>'text' is null then
    raise exception 'APPLICATION_COVER_LETTER_NOT_FOUND: This Application has no cover letter yet.' using errcode='P0001';
  end if;
  return v_result;
end;
$$;
revoke all on function public.get_application_cover_letter_v123(uuid) from public,anon;
grant execute on function public.get_application_cover_letter_v123(uuid) to authenticated;
notify pgrst,'reload schema';
