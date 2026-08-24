-- Scope Applier resume reads to Resumes linked to Applications assigned to them.
-- Managers/Admins keep full shared read. Matches original-resume storage scoping.

create or replace function public.resume_actor_can_view(p_resume_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    (select public.has_any_role(array['APPLYING_MANAGER','ADMIN']))
    or (
      (select public.has_role('APPLIER'))
      and (select public.is_active_user(auth.uid()))
      and exists (
        select 1
        from public.applications a
        join public.resumes linked on linked.id = a.resume_id
        where a.assigned_to = (select auth.uid())
          and (
            linked.id = p_resume_id
            or linked.parent_resume_id = p_resume_id
          )
      )
    );
$$;

create or replace function public.candidate_resume_actor_can_view_v088(p_resume_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.resume_actor_can_view(p_resume_id);
$$;

drop policy if exists "business roles read shared resumes" on public.resumes;
drop policy if exists "role scoped read resumes" on public.resumes;
create policy "role scoped read resumes" on public.resumes
for select to authenticated
using ((select public.resume_actor_can_view(id)));

revoke all on function public.resume_actor_can_view(uuid) from public, anon;
grant execute on function public.resume_actor_can_view(uuid) to authenticated;
