-- Scope Applier job-description reads to JDs linked to Applications assigned to them.
-- Managers/Admins keep full shared read. JD Finder own-row policy is unchanged.

create or replace function public.job_description_actor_can_view(p_job_description_id uuid)
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
        where a.assigned_to = (select auth.uid())
          and a.job_description_id = p_job_description_id
      )
    );
$$;

drop policy if exists "business roles read shared jobs" on public.job_descriptions;
drop policy if exists "role scoped read jobs" on public.job_descriptions;
create policy "role scoped read jobs" on public.job_descriptions
for select to authenticated
using ((select public.job_description_actor_can_view(id)));

revoke all on function public.job_description_actor_can_view(uuid) from public, anon;
grant execute on function public.job_description_actor_can_view(uuid) to authenticated;
