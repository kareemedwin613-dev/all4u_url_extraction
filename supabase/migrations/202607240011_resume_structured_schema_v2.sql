alter table public.resumes
  drop constraint if exists resumes_structured_schema_version_check;

alter table public.resumes
  add constraint resumes_structured_schema_version_check
  check (structured_schema_version in (1, 2));

comment on column public.resumes.structured_content is
  'Versioned, user-reviewed Resume document. Version 2 stores professional_experience as an ordered array of positions with company, job title, location, partial dates, current-role state, and one multiline experience_details value. Version 1 remains readable for compatibility.';
