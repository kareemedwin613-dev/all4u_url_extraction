-- Read-only final verification, including any recent effects of the user's older replay.
select jsonb_build_object(
  'recent_migrations',(select jsonb_agg(version order by version) from supabase_migrations.schema_migrations where version>='202609200000'),
  'jd_review_default',(select column_default from information_schema.columns where table_schema='public' and table_name='jd_review_batches' and column_name='prompt_version'),
  'current_status_guards',(select jsonb_build_object(
    'no_sibling_blocking',prosrc not like '%block_sibling_applications_for_blocked_job_v3106%' and prosrc not like '%cancel_sibling_applications_for_blocked_job_v385%',
    'priority_preserved',prosrc like '%priority = case when v_manager and p_priority is not null then v_priority else priority end%',
    'due_date_preserved',prosrc like '%due_at = case when v_manager and (p_priority is not null or p_due_at is not null) then p_due_at else due_at end%')
    from pg_proc where oid='public.update_application_status_v101(uuid,text,text,timestamptz,text,text,timestamptz)'::regprocedure),
  'recent_legacy_status_repairs',(select coalesce(jsonb_agg(x),'[]') from (
    select date_trunc('second',created_at) as recorded_at,count(*) as applications_changed
    from application_status_history where created_at>now()-interval '24 hours'
      and previous_status='CANCELLED' and new_status='BLOCKED'
      and notes like 'Blocked because this job was blocked for all profiles:%'
    group by date_trunc('second',created_at) order by recorded_at desc limit 10
  ) x)
) as verification;
