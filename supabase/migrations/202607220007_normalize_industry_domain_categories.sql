create table public.industry_domain_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null unique check (char_length(name) between 1 and 100),
  description text not null default '',
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.industry_domain_categories (slug,name,sort_order) values
  ('technology','Technology',10),
  ('financial-services','Financial Services',20),
  ('fintech-payments','FinTech / Payments',30),
  ('healthcare-life-sciences','Healthcare / Life Sciences',40),
  ('government-defense','Government / Defense',50),
  ('retail-ecommerce','Retail / E-commerce',60),
  ('insurance','Insurance',70),
  ('telecommunications','Telecommunications',80),
  ('media-advertising','Media / Advertising',90),
  ('manufacturing','Manufacturing',100),
  ('energy-utilities','Energy / Utilities',110),
  ('transportation-logistics','Transportation / Logistics',120),
  ('education','Education',130),
  ('real-estate','Real Estate',140),
  ('professional-services','Professional Services',150),
  ('nonprofit','Nonprofit',160),
  ('other','Other',170);

alter table public.job_descriptions
  add column industry_domain_category_id uuid,
  add constraint job_descriptions_industry_domain_category_fkey
    foreign key (industry_domain_category_id) references public.industry_domain_categories(id);

update public.job_descriptions as jobs
set industry_domain_category_id = domains.id
from public.industry_domain_categories as domains
where jobs.industry_domain <> 'UNSPECIFIED'
  and domains.slug = lower(replace(jobs.industry_domain, '_', '-'));

alter table public.job_descriptions drop column industry_domain;

create index job_descriptions_industry_domain_category_idx
  on public.job_descriptions(industry_domain_category_id);

alter table public.industry_domain_categories enable row level security;
create policy "authenticated read active industry domains"
  on public.industry_domain_categories for select to authenticated
  using (active = true);
revoke all on public.industry_domain_categories from anon;
grant select on public.industry_domain_categories to authenticated;

create trigger industry_domain_categories_updated
before update on public.industry_domain_categories
for each row execute function public.set_updated_at();

comment on table public.industry_domain_categories is 'Controlled industry-domain taxonomy used by captured job descriptions.';
comment on column public.job_descriptions.industry_domain_category_id is 'Reviewed industry domain; null when no domain is known.';
