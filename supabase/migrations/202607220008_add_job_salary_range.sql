alter table public.job_descriptions
  add column salary_min numeric(14,2),
  add column salary_max numeric(14,2),
  add column salary_currency text,
  add column salary_period text,
  add column salary_text text,
  add constraint job_descriptions_salary_values_check check (
    (salary_min is null or salary_min >= 0)
    and (salary_max is null or salary_max >= 0)
    and (salary_min is null or salary_max is null or salary_max >= salary_min)
  ),
  add constraint job_descriptions_salary_currency_check check (
    salary_currency is null or salary_currency ~ '^[A-Z]{3}$'
  ),
  add constraint job_descriptions_salary_period_check check (
    salary_period is null or salary_period in ('HOUR','DAY','WEEK','MONTH','YEAR','OTHER')
  ),
  add constraint job_descriptions_salary_text_check check (
    salary_text is null or char_length(salary_text) <= 500
  );

comment on column public.job_descriptions.salary_min is 'Reviewed minimum compensation amount in salary_currency.';
comment on column public.job_descriptions.salary_max is 'Reviewed maximum compensation amount in salary_currency.';
comment on column public.job_descriptions.salary_currency is 'Reviewed ISO 4217 currency code.';
comment on column public.job_descriptions.salary_period is 'Reviewed compensation period.';
comment on column public.job_descriptions.salary_text is 'Original extracted compensation text retained for audit and review.';
