-- Use Terra for newly requested evaluation jobs and future settings rows.
-- Finish/stop older-model workers before applying, then issue fresh tickets.
-- Model identity is part of the score cache key: historical assessments and
-- Application creation scores stay unchanged and are never relabeled as Terra.
-- Reasoning effort and concurrency are configured by the local matching worker.
set local lock_timeout = '3s';

alter table public.application_match_settings
  alter column model_id set default 'gpt-5.6-terra';

update public.application_match_settings
set model_id = 'gpt-5.6-terra'
where singleton and model_id is distinct from 'gpt-5.6-terra';
