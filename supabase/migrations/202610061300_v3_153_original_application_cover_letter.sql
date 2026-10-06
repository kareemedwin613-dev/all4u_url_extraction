-- Original applications download the uploaded file, never a reconstruction from saved text.
-- Keep v123 intact for older callers and for tailored-letter rendering/fallback behavior.
create function public.get_application_cover_letter_v3153(p_application_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_resume record;
begin
  select r.*, a.application_number as download_application_number into v_resume
  from public.applications a join public.resumes r on r.id=a.resume_id
  where a.id=p_application_id and public.application_actor_can_view(a.assigned_to) and r.status='ACTIVE';
  if v_resume.id is null then
    raise exception 'APPLICATION_RESUME_UNAVAILABLE: The active Resume is not available for this Application.' using errcode='42501';
  end if;
  if v_resume.resume_type='TAILORED' then
    return public.get_application_cover_letter_v123(p_application_id);
  end if;
  if v_resume.cover_letter_storage_path is null then
    raise exception 'APPLICATION_COVER_LETTER_NOT_FOUND: Upload an original cover letter to this Resume before downloading it from an Application.' using errcode='P0001';
  end if;
  return jsonb_build_object(
    'kind','BASE','source','ORIGINAL_UPLOAD',
    'bucket',v_resume.cover_letter_storage_bucket,'path',v_resume.cover_letter_storage_path,
    'filename',v_resume.cover_letter_original_filename,'mimeType',v_resume.cover_letter_mime_type,
    'fileSizeBytes',v_resume.cover_letter_file_size_bytes,
    'resumeNumber',v_resume.resume_number,'applicationNumber',v_resume.download_application_number);
end; $$;
revoke all on function public.get_application_cover_letter_v3153(uuid) from public,anon;
grant execute on function public.get_application_cover_letter_v3153(uuid) to authenticated;
notify pgrst,'reload schema';
