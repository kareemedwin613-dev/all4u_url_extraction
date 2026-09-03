-- Fix: application_number is bigint, not integer.
-- Drop the integer overload and recreate with bigint parameter.

drop function if exists public.application_resume_download_filename_v352(text, text, text, text, text, integer);

create or replace function public.application_resume_download_filename_v352(
  p_candidate_name text,
  p_resume_name text,
  p_original_filename text,
  p_mime_type text,
  p_resume_type text default 'ORIGINAL',
  p_application_number bigint default null
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
                || case when p_application_number is not null then ' - App ' || p_application_number else '' end
              else coalesce(
                nullif(btrim(p_resume_name), ''),
                nullif(btrim(regexp_replace(coalesce(p_original_filename, ''), '\.[^.]+$', '')), ''),
                'Resume'
              )
              || case when p_application_number is not null then ' - App ' || p_application_number else '' end
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
        220
      ),
      ''
    ),
    'resume.pdf'
  );
$$;

comment on function public.application_resume_download_filename_v352(text, text, text, text, text, bigint) is
  'Build a job-application-friendly download filename such as "Andrew Thomas Resume - App 42.pdf".';
