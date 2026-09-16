-- Lower AI match creation threshold from 70 to 60.

update public.application_match_settings
set threshold = 60
where singleton;

alter table public.application_match_settings
  alter column threshold set default 60;
