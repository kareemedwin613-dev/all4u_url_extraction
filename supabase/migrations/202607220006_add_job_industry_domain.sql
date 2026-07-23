alter table public.job_descriptions
  add column industry_domain text not null default 'UNSPECIFIED'
  check (industry_domain in (
    'UNSPECIFIED','TECHNOLOGY','FINANCIAL_SERVICES','FINTECH_PAYMENTS','HEALTHCARE_LIFE_SCIENCES','GOVERNMENT_DEFENSE','RETAIL_ECOMMERCE','INSURANCE','TELECOMMUNICATIONS','MEDIA_ADVERTISING','MANUFACTURING','ENERGY_UTILITIES','TRANSPORTATION_LOGISTICS','EDUCATION','REAL_ESTATE','PROFESSIONAL_SERVICES','NONPROFIT','OTHER'
  ));

comment on column public.job_descriptions.industry_domain is 'Reviewed controlled industry domain suggested by deterministic extraction.';
