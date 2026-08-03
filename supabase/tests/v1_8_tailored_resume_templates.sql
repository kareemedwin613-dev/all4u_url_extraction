begin;
select plan(10);

select has_column('public','tailoring_jobs','render_template_key');
select has_column('public','tailoring_jobs','template_selected_by');
select has_column('public','tailoring_jobs','template_selected_at');
select has_column('public','resumes','render_template_key');
select has_function('public','select_tailoring_template_v18',array['uuid','text','timestamp with time zone']);
select has_function('public','begin_tailoring_materialization_v16',array['uuid']);
select has_function('public','finalize_tailoring_materialization_v16',array['uuid','uuid','text','text','text','bigint','text']);
select ok(exists(select 1 from pg_trigger where tgname='resumes_assign_template_v18' and not tgisinternal),'tailored Resume template defaults are trigger protected');
select ok(not exists(select 1 from information_schema.routine_privileges where routine_schema='public' and routine_name like '%_pre_v18' and grantee in('PUBLIC','anon','authenticated')),'wrapped v1.6 implementations are private');
select ok(not exists(select 1 from information_schema.routine_privileges where routine_schema='public' and routine_name='select_tailoring_template_v18' and grantee in('PUBLIC','anon')),'template selection is not anonymous');

select * from finish();
rollback;
