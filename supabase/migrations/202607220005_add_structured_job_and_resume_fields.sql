alter table public.job_descriptions
  add column location_text text,
  add column work_arrangement text not null default 'UNSPECIFIED'
    check (work_arrangement in ('REMOTE','HYBRID','ONSITE','UNSPECIFIED')),
  add column clearance_requirements text[] not null default '{}'
    check (clearance_requirements <@ array['PUBLIC_TRUST','DOD_SECRET','TOP_SECRET','TS_SCI','OTHER_SECURITY_CLEARANCE']::text[]),
  add column travel_required boolean,
  add column travel_details text,
  add column structured_content jsonb not null default '{"overview":"","responsibilities":"","qualifications":"","benefits":"","other":""}'::jsonb
    check (jsonb_typeof(structured_content) = 'object');

alter table public.resumes
  add column structured_content jsonb not null default '{"summary":"","professional_experience":"","education":"","skills":""}'::jsonb
    check (jsonb_typeof(structured_content) = 'object'),
  add column structured_schema_version smallint not null default 1
    check (structured_schema_version = 1);

comment on column public.job_descriptions.location_text is 'Reviewed job location; nullable for fully remote roles.';
comment on column public.job_descriptions.work_arrangement is 'Reviewed REMOTE, HYBRID, ONSITE, or UNSPECIFIED arrangement.';
comment on column public.job_descriptions.clearance_requirements is 'Reviewed public trust or security clearance requirements.';
comment on column public.job_descriptions.travel_required is 'True, false, or null when the posting does not specify travel.';
comment on column public.job_descriptions.structured_content is 'Rule-based, user-reviewable JD sections. description_text remains the complete source text.';
comment on column public.resumes.structured_content is 'Rule-based, user-reviewable resume sections. resume_text remains the complete source text.';
