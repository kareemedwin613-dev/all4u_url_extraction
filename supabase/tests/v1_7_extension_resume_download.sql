begin;
select plan(6);

select has_function('public','list_my_applications_v17',array['text','text','integer']);
select has_function('public','get_application_resume_download_v17',array['uuid']);
select function_returns('public','list_my_applications_v17',array['text','text','integer'],'jsonb');
select function_returns('public','get_application_resume_download_v17',array['uuid'],'jsonb');
select ok(
  not exists(select 1 from information_schema.routine_privileges where routine_schema='public' and routine_name in('list_my_applications_v17','get_application_resume_download_v17') and grantee in('PUBLIC','anon')),
  'v1.7 extension functions are not executable anonymously'
);
select ok(
  exists(select 1 from information_schema.routine_privileges where routine_schema='public' and routine_name='get_application_resume_download_v17' and grantee='authenticated'),
  'authenticated callers use the protected download resolver'
);

select * from finish();
rollback;
