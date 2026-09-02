-- Human-readable Application Resume download filenames for extension and dashboard downloads.

create or replace function public.application_resume_download_filename_v352(
  p_candidate_name text,
  p_resume_name text,
  p_original_filename text,
  p_mime_type text,
  p_resume_type text default 'ORIGINAL'
)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(
    nullif(
      left(
        trim(
          regexp_replace(
            case
              when nullif(btrim(p_candidate_name), '') is not null then
                btrim(p_candidate_name) || ' Resume'
              else coalesce(
                nullif(btrim(p_resume_name), ''),
                nullif(btrim(regexp_replace(coalesce(p_original_filename, ''), '\.[^.]+$', '')), ''),
                'Resume'
              )
            end,
            '[<>:"/\\|?*\x00-\x1f]+',
            '',
            'g'
          )
        )
        || case lower(coalesce(p_mime_type, ''))
          when 'application/pdf' then '.pdf'
          when 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' then '.docx'
          when 'text/plain' then '.txt'
          else coalesce(nullif(lower(substring(coalesce(p_original_filename, '') from '\.[^.]+$')), ''), '.pdf')
        end,
        180
      ),
      ''
    ),
    'resume.pdf'
  );
$$;

create or replace function public.get_application_resume_download_v17(p_application_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'bucket', r.storage_bucket,
    'path', r.storage_path,
    'filename', public.application_resume_download_filename_v352(
      r.candidate_name,
      r.resume_name,
      r.original_filename,
      r.mime_type,
      r.resume_type
    ),
    'mimeType', r.mime_type,
    'fileSizeBytes', r.file_size_bytes,
    'resumeNumber', r.resume_number,
    'resumeType', r.resume_type,
    'candidateName', r.candidate_name,
    'resumeName', r.resume_name
  )
  into v_result
  from public.applications a
  join public.resumes r on r.id = a.resume_id
  where a.id = p_application_id
    and public.application_actor_can_view(a.assigned_to)
    and r.status = 'ACTIVE';

  if v_result is null then
    raise exception 'APPLICATION_RESUME_UNAVAILABLE: The active Resume is not available for this Application.'
      using errcode = '42501';
  end if;

  return v_result;
end;
$$;

comment on function public.application_resume_download_filename_v352(text, text, text, text, text) is
  'Build a job-application-friendly download filename such as "Andrew Thomas Resume.pdf".';

comment on function public.get_application_resume_download_v17(uuid) is
  'Resolve one authorized Application Resume download with a human-readable filename.';
