-- Use Sol for newly requested evaluation jobs and future settings rows.
-- Finish/stop older-model workers before applying, then issue fresh tickets.
-- Historical assessments and Application score snapshots are not rewritten.
-- Reasoning effort and concurrency are configured separately in the local worker.
set local lock_timeout = '3s';

alter table public.application_match_settings
  alter column model_id set default 'gpt-5.6-sol';

update public.application_match_settings
set model_id = 'gpt-5.6-sol'
where singleton and model_id is distinct from 'gpt-5.6-sol';
