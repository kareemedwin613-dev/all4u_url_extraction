-- Add the least-privilege JD Finder role. JD Finders may capture JDs under
-- their own user ID, but cannot read shared business data or modify saved JDs.

insert into public.roles(code,name,description,active,is_system)
values('JD_FINDER','JD Finder','Captures and saves job descriptions without Application, Resume, tailoring, or administration access.',true,true)
on conflict(code) do update set
  name=excluded.name,
  description=excluded.description,
  active=true,
  is_system=true;

drop policy if exists "jd finders read own jobs" on public.job_descriptions;
create policy "jd finders read own jobs" on public.job_descriptions
for select to authenticated using(
  (select public.is_active_user(auth.uid()))
  and (select public.has_role('JD_FINDER'))
  and user_id=(select auth.uid())
);

drop policy if exists "jd finders insert own jobs" on public.job_descriptions;
create policy "jd finders insert own jobs" on public.job_descriptions
for insert to authenticated with check(
  (select public.is_active_user(auth.uid()))
  and (select public.has_role('JD_FINDER'))
  and user_id=(select auth.uid())
);

comment on policy "jd finders read own jobs" on public.job_descriptions is
  'Allows duplicate detection and confirmation only for JDs captured by the active JD Finder.';
comment on policy "jd finders insert own jobs" on public.job_descriptions is
  'Allows an active JD Finder to save a JD attributed to their own authenticated user ID.';
