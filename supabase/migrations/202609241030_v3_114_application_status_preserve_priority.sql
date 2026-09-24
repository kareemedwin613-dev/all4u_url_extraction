-- Status-only callers (including existing extensions) send NULL for protected
-- fields they do not edit. Preserve the locked row's priority and due date.
-- A manager's full edit still supplies priority; a NULL due date in that case
-- intentionally clears the date. Non-NULL due dates may be updated independently.
-- Patch only these expressions in the installed function: copying an older full
-- definition could accidentally restore the removed JD-wide blocking behavior.
do $migration$
declare
  definition text := pg_get_functiondef(
    'public.update_application_status_v101(uuid,text,text,timestamptz,text,text,timestamptz)'::regprocedure
  );
  old_expressions text[] := array[
    'if v_manager and v_priority not in',
    'priority = case when v_manager then v_priority else priority end',
    'due_at = case when v_manager then p_due_at else due_at end'
  ];
  new_expressions text[] := array[
    'if v_manager and p_priority is not null and v_priority not in',
    'priority = case when v_manager and p_priority is not null then v_priority else priority end',
    'due_at = case when v_manager and (p_priority is not null or p_due_at is not null) then p_due_at else due_at end'
  ];
  i integer;
begin
  for i in 1..array_length(old_expressions, 1) loop
    if strpos(definition, old_expressions[i]) = 0 then
      raise exception 'APPLICATION_STATUS_PATCH_CONFLICT: Unexpected status function definition; review it before migrating.';
    end if;
    definition := replace(definition, old_expressions[i], new_expressions[i]);
  end loop;
  -- CREATE OR REPLACE retains the function's grants and SECURITY DEFINER settings.
  execute definition;
end;
$migration$;
