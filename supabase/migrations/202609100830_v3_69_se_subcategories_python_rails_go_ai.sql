-- Add Software Engineering subcategories for finer bulk matching.

insert into public.categories (slug, name, parent_id, sort_order, active)
select
  v.slug,
  v.name,
  parent.id,
  v.sort_order,
  true
from public.categories parent
cross join (
  values
    ('python-engineering', 'Python Engineering', 36),
    ('ruby-on-rails-engineering', 'Ruby on Rails Engineering', 37),
    ('golang-engineering', 'Golang Engineering', 38),
    ('full-stack-ai-engineering', 'Full-Stack/AI Engineering', 39)
) as v(slug, name, sort_order)
where parent.slug = 'software-engineering'
  and parent.parent_id is null
on conflict (slug) do update
set name = excluded.name,
    parent_id = excluded.parent_id,
    sort_order = excluded.sort_order,
    active = true,
    updated_at = now();
