-- Shared language/technology subtype; resume assignments are evidence-reviewed
-- separately, never inferred for all profiles by this taxonomy migration.
do $$
begin
  if not exists(select 1 from public.categories where slug='software-engineering' and parent_id is null and active) then
    raise exception 'Active Software Engineering primary category is required';
  end if;
  if exists(select 1 from public.categories c where c.slug='javascript-typescript-engineering'
    and c.parent_id is distinct from (select id from public.categories where slug='software-engineering')) then
    raise exception 'JavaScript/TypeScript slug already belongs to another category';
  end if;
end $$;

insert into public.categories(slug,name,parent_id,sort_order,active)
select 'javascript-typescript-engineering','JavaScript / TypeScript Engineering',id,40,true
from public.categories where slug='software-engineering' and parent_id is null and active
on conflict(slug) do update
set name=excluded.name,sort_order=excluded.sort_order,active=true,updated_at=now();
