-- Candidate identity fields support duplicate detection across differently
-- exported PDF files. The original SHA-256 remains retained for auditing.
alter table public.resumes
  add column if not exists candidate_email text,
  add column if not exists candidate_phone text;

-- Conservatively populate contact information for legacy rows when a common
-- email or phone format is present in the extracted Resume text.
update public.resumes
set candidate_email = lower(substring(resume_text from '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'))
where candidate_email is null
  and resume_text ~* '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}';

update public.resumes
set candidate_phone = substring(resume_text from '\+?[0-9]{0,3}[ .-]*[(]?[0-9]{3}[)]?[ .-]+[0-9]{3}[ .-]+[0-9]{4}')
where candidate_phone is null
  and resume_text ~ '\+?[0-9]{0,3}[ .-]*[(]?[0-9]{3}[)]?[ .-]+[0-9]{3}[ .-]+[0-9]{4}';

alter table public.resumes
  drop constraint if exists resumes_candidate_email_format,
  add constraint resumes_candidate_email_format
    check (
      candidate_email is null
      or (
        char_length(candidate_email) between 3 and 320
        and candidate_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      )
    ) not valid,
  drop constraint if exists resumes_candidate_phone_format,
  add constraint resumes_candidate_phone_format
    check (
      candidate_phone is null
      or char_length(regexp_replace(candidate_phone, '[^0-9]', '', 'g')) between 7 and 15
    ) not valid;

create index if not exists resumes_candidate_identity_idx
on public.resumes (
  (regexp_replace(lower(btrim(candidate_name)), '[^[:alnum:]]+', '', 'g')),
  (lower(btrim(candidate_email))),
  (regexp_replace(candidate_phone, '[^0-9]', '', 'g'))
)
where candidate_email is not null and candidate_phone is not null;

create or replace function public.find_resume_identity_duplicates(
  p_candidate_name text,
  p_candidate_email text,
  p_candidate_phone text
)
returns table (
  id uuid,
  candidate_name text,
  candidate_email text,
  candidate_phone text,
  resume_name text,
  status text,
  created_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_name text := regexp_replace(lower(btrim(coalesce(p_candidate_name, ''))), '[^[:alnum:]]+', '', 'g');
  v_email text := lower(btrim(coalesce(p_candidate_email, '')));
  v_phone text := regexp_replace(coalesce(p_candidate_phone, ''), '[^0-9]', '', 'g');
begin
  if v_name = '' or v_email = '' or char_length(v_phone) < 7 then
    return;
  end if;

  return query
  select
    resumes.id,
    resumes.candidate_name,
    resumes.candidate_email,
    resumes.candidate_phone,
    resumes.resume_name,
    resumes.status,
    resumes.created_at
  from public.resumes as resumes
  where regexp_replace(lower(btrim(resumes.candidate_name)), '[^[:alnum:]]+', '', 'g') = v_name
    and lower(btrim(resumes.candidate_email)) = v_email
    and regexp_replace(resumes.candidate_phone, '[^0-9]', '', 'g') = v_phone
  order by (resumes.status = 'ACTIVE') desc, resumes.created_at desc
  limit 10;
end;
$$;

revoke all on function public.find_resume_identity_duplicates(text, text, text) from public, anon;
grant execute on function public.find_resume_identity_duplicates(text, text, text) to authenticated;
