-- Read-only deployment verification. Expected: all true except anonymous_allowed.
-- Run: npx supabase db query --linked --file scripts/sql/verify-application-status-priority.sql
select
  strpos(pg_get_functiondef(p.oid),
    'if v_manager and p_priority is not null and v_priority not in') > 0
    as validates_only_supplied_priority,
  strpos(pg_get_functiondef(p.oid),
    'priority = case when v_manager and p_priority is not null then v_priority else priority end') > 0
    as preserves_priority,
  strpos(pg_get_functiondef(p.oid),
    'due_at = case when v_manager and (p_priority is not null or p_due_at is not null) then p_due_at else due_at end') > 0
    as preserves_due_date,
  strpos(pg_get_functiondef(p.oid), 'cancel_sibling_applications_for_blocked_job_v385') = 0
    as no_sibling_cancellation,
  p.prosecdef as security_definer,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_allowed,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anonymous_allowed
from pg_proc p
where p.oid = 'public.update_application_status_v101(uuid,text,text,timestamptz,text,text,timestamptz)'::regprocedure;
