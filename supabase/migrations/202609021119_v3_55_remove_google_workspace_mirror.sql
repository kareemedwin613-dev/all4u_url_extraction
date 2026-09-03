-- v3.55: remove the retired Google Workspace JD mirror and its stored state.

drop function if exists public.finish_google_workspace_jd_sync(uuid, boolean, text);
drop function if exists public.begin_google_workspace_jd_sync(uuid);
drop table if exists public.job_description_workspace_syncs;
