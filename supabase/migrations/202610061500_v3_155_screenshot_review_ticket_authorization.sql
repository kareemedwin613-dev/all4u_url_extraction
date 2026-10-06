-- The runner and Storage use scoped tickets, not a user's JWT. Existing RBAC helpers
-- intentionally require auth.uid() to equal the subject, so they cannot check a ticket issuer.
-- Keep those shared helpers unchanged; check issuer status/roles only inside the capability path.
create or replace function public.screenshot_review_ticket_owner_allowed_v3155(p_user_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists (
    select 1 from public.profiles p
    join public.user_roles ur on ur.user_id=p.id
    join public.roles r on r.id=ur.role_id
    where p.id=p_user_id and p.status='ACTIVE'
      and r.active and r.code in ('ADMIN','APPLYING_MANAGER')
  );
$$;
revoke all on function public.screenshot_review_ticket_owner_allowed_v3155(uuid) from public,anon,authenticated;

-- Preserve the existing queue, review logic, grants and active tickets. Fail rather than
-- silently patch an unexpected definition; reapplying this correction is safe.
do $$
declare definition text; patched text;
begin
  definition:=pg_get_functiondef('public.screenshot_review_runner(text,text,jsonb)'::regprocedure);
  patched:=replace(definition,
    'not public.is_active_user(t.created_by) or not (public.has_role(''ADMIN'',t.created_by) or public.has_role(''APPLYING_MANAGER'',t.created_by))',
    'not public.screenshot_review_ticket_owner_allowed_v3155(t.created_by)');
  if patched=definition and position('public.screenshot_review_ticket_owner_allowed_v3155(t.created_by)' in definition)=0 then
    raise exception 'Unexpected screenshot_review_runner definition; authorization correction not applied.';
  end if;
  execute patched;

  definition:=pg_get_functiondef('public.screenshot_review_storage_allowed(text,text)'::regprocedure);
  patched:=replace(definition,
    'public.is_active_user(t.created_by) and (public.has_role(''ADMIN'',t.created_by) or public.has_role(''APPLYING_MANAGER'',t.created_by))',
    'public.screenshot_review_ticket_owner_allowed_v3155(t.created_by)');
  if patched=definition and position('public.screenshot_review_ticket_owner_allowed_v3155(t.created_by)' in definition)=0 then
    raise exception 'Unexpected screenshot_review_storage_allowed definition; authorization correction not applied.';
  end if;
  execute patched;
end $$;
notify pgrst,'reload schema';
