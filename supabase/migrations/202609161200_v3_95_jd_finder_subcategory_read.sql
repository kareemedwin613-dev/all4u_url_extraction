-- v3.95: Job Description list embeds job_description_subcategories.
-- That junction still used job_description_actor_can_view(), which omitted JD Finder
-- and reintroduced the slow per-row helper v3.62 removed from job_descriptions SELECT.
-- Inline role checks (including JD Finder own captures) for subcategory reads, and
-- keep the helper aligned for other call sites.

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
      (select public.has_role('JD_FINDER'))
      and (select public.is_active_user(auth.uid()))
      and exists (
        select 1
        from public.job_descriptions j
        where j.id = p_job_description_id
          and j.user_id = (select auth.uid())
      )
    )
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

revoke all on function public.job_description_actor_can_view(uuid) from public, anon;
grant execute on function public.job_description_actor_can_view(uuid) to authenticated;

drop policy if exists "role scoped read job description subcategories" on public.job_description_subcategories;
create policy "role scoped read job description subcategories" on public.job_description_subcategories
for select to authenticated
using (
  (select public.has_any_role(array['APPLYING_MANAGER','ADMIN']))
  or (
    (select public.has_role('JD_FINDER'))
    and (select public.is_active_user(auth.uid()))
    and exists (
      select 1
      from public.job_descriptions j
      where j.id = job_description_id
        and j.user_id = (select auth.uid())
    )
  )
  or (
    (select public.has_role('APPLIER'))
    and (select public.is_active_user(auth.uid()))
    and exists (
      select 1
      from public.applications a
      where a.assigned_to = (select auth.uid())
        and a.job_description_id = job_description_subcategories.job_description_id
    )
  )
);

comment on policy "role scoped read job description subcategories" on public.job_description_subcategories is
  'Managers read all; JD Finders read subcategories for their own captures; Appliers read subcategories for assigned Applications. Inline checks avoid slow embeds.';

grant select on public.job_description_subcategories to authenticated;
