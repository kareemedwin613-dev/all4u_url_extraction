-- v3.74: validate the stored ticket issuer, not the anonymous runner's identity.
-- is_active_user/has_any_role intentionally require auth.uid() to equal the
-- requested user. A ticket request has no user JWT, so v3.73 rejected every
-- otherwise valid ticket. Keep those general-purpose RLS helpers unchanged.
-- This forward-only fix preserves tickets, leases, scores and existing grants.
create or replace function public.assert_application_match_ticket(p_ticket text,p_allow_issued boolean default false)
returns public.application_match_runner_tickets language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.application_match_runner_tickets; s public.application_match_settings;
begin
  if coalesce(p_ticket,'')!~'^mrb_[A-Za-z0-9_-]{43}$' then raise exception 'MATCH_TICKET_INVALID: Generate a new scoring command.'; end if;
  select * into t from public.application_match_runner_tickets
    where token_hash=encode(sha256(convert_to(p_ticket,'UTF8')),'hex') for update;
  if not found or t.status='REVOKED' then raise exception 'MATCH_TICKET_INVALID: Generate a new scoring command.'; end if;
  -- The creator comes only from the hashed, persisted ticket, never the caller.
  -- This private security-definer helper can inspect the issuer's current access
  -- without impersonating that user or requiring a login token on the worker.
  if not exists (
    select 1 from public.profiles p
    join public.user_roles ur on ur.user_id=p.id
    join public.roles r on r.id=ur.role_id
    where p.id=t.created_by and p.status='ACTIVE'
      and r.active and r.code in('APPLYING_MANAGER','ADMIN')
  ) then
    raise exception 'MATCH_TICKET_INVALID: The issuing manager no longer has access.';
  end if;
  if (t.status='ISSUED' and (not p_allow_issued or t.expires_at<=now()))
    or (t.status in('CLAIMED','COMPLETED') and (t.run_expires_at is null or t.run_expires_at<=now())) then
    raise exception 'MATCH_TICKET_EXPIRED: Generate a new scoring command.';
  end if;
  select * into s from public.application_match_settings where singleton;
  if t.model_id<>s.model_id or t.rubric_version<>s.rubric_version or t.extractor_version<>s.extractor_version then
    raise exception 'MATCH_WORKER_VERSION_MISMATCH: Scoring configuration changed; generate a new command.';
  end if;
  return t;
end $$;

revoke all on function public.assert_application_match_ticket(text,boolean) from public,anon,authenticated;
