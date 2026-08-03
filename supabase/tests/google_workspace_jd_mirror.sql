begin;
select plan(12);

select has_table('public','job_description_workspace_syncs');
select has_column('public','job_description_workspace_syncs','status');
select ok((select relrowsecurity from pg_class where oid='public.job_description_workspace_syncs'::regclass),'workspace sync state has RLS enabled');
select has_function('public','begin_google_workspace_jd_sync',array['uuid']);
select has_function('public','finish_google_workspace_jd_sync',array['uuid','boolean','text']);
select ok(exists(select 1 from pg_policies where schemaname='public' and tablename='job_description_workspace_syncs' and policyname='actors read own workspace JD syncs'),'workspace state read policy exists');

insert into auth.users(id,email,aud,role,raw_user_meta_data) values('f4000000-0000-4000-8000-000000000001','workspace-finder@example.test','authenticated','authenticated','{}');
insert into public.user_roles(user_id,role_id) select 'f4000000-0000-4000-8000-000000000001',id from public.roles where code='JD_FINDER';
insert into public.categories(id,slug,name) values('f4000000-0000-4000-8000-000000000002','workspace-sync-test','Workspace Sync Test');
set local role authenticated;
select set_config('request.jwt.claim.sub','f4000000-0000-4000-8000-000000000001',true);
insert into public.job_descriptions(id,user_id,company,job_title,category_id,description_text)
values('f4000000-0000-4000-8000-000000000003','f4000000-0000-4000-8000-000000000001','Workspace Co','Engineer','f4000000-0000-4000-8000-000000000002',repeat('job ',30));
select is((select count(*)::integer from public.job_descriptions where id='f4000000-0000-4000-8000-000000000003'),1,'JD Finder can create the source JD');
select is(public.begin_google_workspace_jd_sync('f4000000-0000-4000-8000-000000000003')->>'status','SYNCING','begin reserves a delivery');
select is((select status from public.job_description_workspace_syncs where job_description_id='f4000000-0000-4000-8000-000000000003'),'SYNCING','delivery state is visible to its actor');
select is(public.finish_google_workspace_jd_sync((select id from public.job_description_workspace_syncs where job_description_id='f4000000-0000-4000-8000-000000000003'),true,null)->>'status','SUCCEEDED','finish records success');
select is(public.begin_google_workspace_jd_sync('f4000000-0000-4000-8000-000000000003')->>'status','SUCCEEDED','successful delivery is idempotent');
select throws_ok($$update public.job_description_workspace_syncs set status='FAILED'$$,'42501',null,'direct sync-state mutation is denied');

select * from finish();
rollback;
