-- Deduplicate resume primary categories for Application list tags.
-- Resumes can have multiple tech-stack rows under the same primary (different subcategories);
-- list helpers previously returned one tag per row.

create or replace function public.resume_primary_category_names(p_resume_id uuid)
returns text[]
language sql
stable
parallel safe
set search_path = public, pg_temp
as $$
  select coalesce(array(
    select x.name
    from (
      select distinct on (s.primary_category_id)
        c.name,
        s.sort_order,
        s.id
      from public.resume_tech_stacks s
      join public.categories c on c.id = s.primary_category_id
      where s.resume_id = coalesce(
        (select parent_resume_id from public.resumes where id = p_resume_id),
        p_resume_id
      )
      order by s.primary_category_id, s.sort_order, s.id
    ) x
    order by x.sort_order, x.id
  ), array[]::text[]);
$$;

create or replace function public.resume_primary_category_ids(p_resume_id uuid)
returns uuid[]
language sql
stable
parallel safe
set search_path = public, pg_temp
as $$
  select coalesce(array(
    select x.primary_category_id
    from (
      select distinct on (s.primary_category_id)
        s.primary_category_id,
        s.sort_order,
        s.id
      from public.resume_tech_stacks s
      where s.resume_id = coalesce(
        (select parent_resume_id from public.resumes where id = p_resume_id),
        p_resume_id
      )
      order by s.primary_category_id, s.sort_order, s.id
    ) x
    order by x.sort_order, x.id
  ), array[]::uuid[]);
$$;

revoke all on function public.resume_primary_category_names(uuid) from public, anon;
grant execute on function public.resume_primary_category_names(uuid) to authenticated;
revoke all on function public.resume_primary_category_ids(uuid) from public, anon;
grant execute on function public.resume_primary_category_ids(uuid) to authenticated;

comment on function public.resume_primary_category_names(uuid) is
  'Distinct primary category names for a resume (or its parent profile), ordered by first tech-stack appearance.';
comment on function public.resume_primary_category_ids(uuid) is
  'Distinct primary category ids for a resume (or its parent profile), ordered by first tech-stack appearance.';
