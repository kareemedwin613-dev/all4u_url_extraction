-- v3.62: Speed Applier Job Description list reads.
-- The previous SELECT policy called job_description_actor_can_view(id) per row,
-- which scanned ~all ACTIVE JDs and often exceeded the dashboard 15s timeout.
-- Inline manager InitPlan + Applier EXISTS so Postgres can use a semi-join.

create index if not exists applications_assigned_job_idx
  on public.applications (assigned_to, job_description_id);

drop policy if exists "role scoped read jobs" on public.job_descriptions;
create policy "role scoped read jobs" on public.job_descriptions
for select to authenticated
using (
  (select public.has_any_role(array['APPLYING_MANAGER','ADMIN']))
  or (
    (select public.has_role('APPLIER'))
    and (select public.is_active_user(auth.uid()))
    and exists (
      select 1
      from public.applications a
      where a.assigned_to = (select auth.uid())
        and a.job_description_id = job_descriptions.id
    )
  )
);

-- Keep the helper for non-list authorization call sites, but align it with the policy.
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
