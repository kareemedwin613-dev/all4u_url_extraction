begin;
select plan(12);

select has_column('public','tailoring_jobs','tailored_resume_id','tailoring job records its materialized Resume');
select has_column('public','tailoring_jobs','materialization_token','materialization attempts are token guarded');
select has_column('public','tailoring_jobs','materialized_at','materialization completion is timestamped');
select has_function('public','begin_tailoring_materialization_v16',array['uuid']);
select has_function('public','finalize_tailoring_materialization_v16',array['uuid','uuid','text','text','text','bigint','text']);
select has_function('public','fail_tailoring_materialization_v16',array['uuid','uuid','text']);
select has_function('public','prevent_application_resume_family_duplicate_v16',array[]::text[]);
select ok(
  exists(select 1 from pg_indexes where schemaname='public' and indexname='tailoring_jobs_tailored_resume_key'),
  'one tailoring job can own each tailored Resume'
);
select ok(
  exists(select 1 from pg_trigger where tgname='applications_resume_family_unique_v16' and not tgisinternal),
  'Application duplicate protection follows the original Resume family'
);
select ok(
  exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='application scoped or manager read tailored resumes'),
  'tailored Resume reads remain Application scoped'
);
select ok(
  exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='manager materializes tailored resumes'),
  'only a manager materialization reservation can upload the artifact'
);
select ok(
  not exists(
    select 1 from information_schema.routine_privileges
    where routine_schema='public'
      and routine_name in('begin_tailoring_materialization_v16','finalize_tailoring_materialization_v16','fail_tailoring_materialization_v16')
      and grantee in('PUBLIC','anon')
  ),
  'materialization functions are not executable anonymously'
);

select * from finish();
rollback;
