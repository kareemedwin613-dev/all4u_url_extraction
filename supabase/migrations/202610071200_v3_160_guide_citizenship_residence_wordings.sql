-- v3.160: more Application Guide wordings seen on JazzHR (applytojob.com):
--   "What's your citizenship / employment eligibility?"  → the work-authorization answer (U.S. citizen)
--   "What city and state do you reside in?"              → the Personal Details location
-- Appends only; Admin-added wordings are kept and the 20-wording limit is respected. Safe to re-run.
create or replace function pg_temp.v3160_add_wordings(p_question_like text, p_wordings text[])
returns void language sql as $$
  update public.application_guide_entries
  set autofill_patterns = (
        select array_agg(pattern order by first_seen)
        from (
          select pattern, min(position) as first_seen
          from unnest(autofill_patterns || p_wordings) with ordinality as wording(pattern, position)
          group by pattern
        ) wordings
      ),
      updated_at = clock_timestamp()
  where question ilike p_question_like
    and autofill_mode in ('FIXED', 'DERIVED')
    and cardinality(autofill_patterns) + cardinality(p_wordings) <= 20
    and not (p_wordings[1] = any(autofill_patterns));
$$;

select pg_temp.v3160_add_wordings('What is your work authorization%',
  array['citizenship / employment eligibility', 'employment eligibility', 'citizenship', 'work eligibility']);

select pg_temp.v3160_add_wordings('What does%mean in Personal Details%',
  array['city and state do you reside', 'where do you reside', 'where do you live', 'city and state of residence']);

notify pgrst, 'reload schema';
