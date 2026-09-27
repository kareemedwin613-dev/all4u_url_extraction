-- v3.126: evaluate role checks once per statement instead of once per row.
--
-- These four SELECT policies passed a row column into a SECURITY DEFINER helper
-- (application_actor_can_view / resume_actor_can_view). SECURITY DEFINER functions are
-- never inlined, so every visible-row candidate re-ran the profiles/user_roles/roles
-- lookups, even for Managers and Admins who can see every row. At ~40k applications,
-- ~31k resumes, ~76k tech stacks, and ~88k status history rows this dominated list
-- queries and pushed some past the 8s statement timeout.
--
-- Each rewrite is logically identical to the helper it replaces:
--   application_actor_can_view(p) = can_manage() or (p = uid and active(uid) and has_role('APPLIER', uid))
--   resume_actor_can_view(r)      = has_any_role(MANAGER, ADMIN) or (has_role('APPLIER') and active(uid) and <assigned link>)
-- The row-independent checks are wrapped in (select ...) so Postgres runs them once as
-- InitPlans, and the Manager/Admin branch comes first. Appliers' visible Resume ids are
-- computed once per statement (applier_visible_resume_ids_v126). The original helpers are
-- unchanged and still used by RPCs and other policies.

drop policy if exists "role scoped read applications" on public.applications;
create policy "role scoped read applications" on public.applications
for select to authenticated
using (
  (select public.application_actor_can_manage())
  or (
    assigned_to = (select auth.uid())
    and (select public.is_active_user(auth.uid()))
    and (select public.has_role('APPLIER', auth.uid()))
  )
);

drop policy if exists "role scoped read status history" on public.application_status_history;
create policy "role scoped read status history" on public.application_status_history
for select to authenticated
using (
  (select public.application_actor_can_manage())
  or exists (
    select 1
    from public.applications a
    where a.id = application_status_history.application_id
      and a.assigned_to = (select auth.uid())
      and (select public.is_active_user(auth.uid()))
      and (select public.has_role('APPLIER', auth.uid()))
  )
);

-- The Applier branch of resume_actor_can_view, as one set per statement: the Resume of every
-- Application assigned to the caller, plus that Resume's parent (original). The uncorrelated
-- "id in (select ...)" is computed once and hashed instead of re-joined for every row.
create or replace function public.applier_visible_resume_ids_v126()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select linked.id
  from public.applications a
  join public.resumes linked on linked.id = a.resume_id
  where a.assigned_to = auth.uid()
  union
  select linked.parent_resume_id
  from public.applications a
  join public.resumes linked on linked.id = a.resume_id
  where a.assigned_to = auth.uid()
    and linked.parent_resume_id is not null;
$$;
revoke all on function public.applier_visible_resume_ids_v126() from public, anon;
grant execute on function public.applier_visible_resume_ids_v126() to authenticated;

drop policy if exists "role scoped read resumes" on public.resumes;
create policy "role scoped read resumes" on public.resumes
for select to authenticated
using (
  (select public.has_any_role(array['APPLYING_MANAGER','ADMIN']))
  or (
    (select public.has_role('APPLIER'))
    and (select public.is_active_user(auth.uid()))
    and id in (select public.applier_visible_resume_ids_v126())
  )
);

drop policy if exists "role scoped read resume tech stacks" on public.resume_tech_stacks;
create policy "role scoped read resume tech stacks" on public.resume_tech_stacks
for select to authenticated
using (
  (select public.has_any_role(array['APPLYING_MANAGER','ADMIN']))
  or (
    (select public.has_role('APPLIER'))
    and (select public.is_active_user(auth.uid()))
    and resume_id in (select public.applier_visible_resume_ids_v126())
  )
);
