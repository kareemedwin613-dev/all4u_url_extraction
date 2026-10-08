-- v3.158: more wordings for the Application Guide's Personal Details "Location" answer, seen on Ashby
-- ("What location do you intend to work from?"). Appends only; Admin-added wordings are kept and the
-- 20-wording limit is respected. Safe to re-run.
update public.application_guide_entries
set autofill_patterns = (
  select array_agg(pattern order by first_seen)
  from (
    select pattern, min(position) as first_seen
    from unnest(autofill_patterns || array[
      'location do you intend to work from',
      'where do you intend to work from',
      'where will you be working from',
      'where are you based'
    ]) with ordinality as wording(pattern, position)
    group by pattern
  ) wordings
),
updated_at = clock_timestamp()
where question ilike 'What does%mean in Personal Details%'
  and autofill_mode = 'DERIVED'
  and autofill_source = 'candidate.currentLocation'
  and cardinality(autofill_patterns) <= 16
  and not ('location do you intend to work from' = any(autofill_patterns));

notify pgrst, 'reload schema';
