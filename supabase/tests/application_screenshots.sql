begin;
select plan(21);

select has_function('public','attach_application_screenshot',array['uuid','text','text','text','bigint'],'attach RPC exists');
select has_function('public','remove_application_screenshot',array['uuid'],'remove RPC exists');
select ok((select relrowsecurity from pg_class where oid='public.application_screenshots'::regclass),'application_screenshots RLS enabled');
select ok((select not public from storage.buckets where id='application-screenshots'),'application-screenshots bucket is private');
select is((select file_size_limit from storage.buckets where id='application-screenshots'),5242880,'application-screenshots size limit is 5 MiB');

insert into auth.users(id,email,aud,role,raw_user_meta_data) values
 ('91000000-0000-4000-8000-000000000001','manager9@example.test','authenticated','authenticated','{}'),
 ('91000000-0000-4000-8000-000000000002','applier9a@example.test','authenticated','authenticated','{}'),
 ('91000000-0000-4000-8000-000000000003','applier9b@example.test','authenticated','authenticated','{}');

insert into public.user_roles(user_id,role_id)
select x.user_id,r.id from (values
 ('91000000-0000-4000-8000-000000000001'::uuid,'APPLYING_MANAGER'),
 ('91000000-0000-4000-8000-000000000002'::uuid,'APPLIER'),
 ('91000000-0000-4000-8000-000000000003'::uuid,'APPLIER')
) x(user_id,code) join public.roles r on r.code=x.code;

insert into public.categories(id,slug,name) values('92000000-0000-4000-8000-000000000001','screenshot-test','Screenshot Test');
insert into public.job_descriptions(id,user_id,company,job_title,category_id,description_text) values
 ('93000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','Acme','Engineer','92000000-0000-4000-8000-000000000001',repeat('job ',30)),
 ('93000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000001','Acme','Analyst','92000000-0000-4000-8000-000000000001',repeat('job ',30));
insert into public.resumes(id,user_id,candidate_name,resume_name,primary_category_id,resume_text,storage_path,original_filename,mime_type,file_size_bytes,file_sha256) values
 ('94000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','Candidate','Primary','92000000-0000-4000-8000-000000000001',repeat('resume ',20),'91000000-0000-4000-8000-000000000001/resume1.pdf','resume1.pdf','application/pdf',1000,repeat('c',64));

set local role authenticated;
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001',true);
select public.create_application('93000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002','NORMAL',null,'App one');
select public.create_application('93000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000003','NORMAL',null,'App two');
create temporary table apps as select id,job_description_id from public.applications;

select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000002',true);
select is((public.attach_application_screenshot(
  (select id from apps where job_description_id='93000000-0000-4000-8000-000000000001'),
  (select id::text||'/confirmation.png' from apps where job_description_id='93000000-0000-4000-8000-000000000001'),
  'confirmation.png','image/png',2048
)->>'original_filename'),'confirmation.png','assigned Applier attaches a screenshot to their own Application');

select throws_ok($$select public.attach_application_screenshot(
  (select id from apps where job_description_id='93000000-0000-4000-8000-000000000001'),
  'wrong-prefix/confirmation.png','confirmation.png','image/png',2048
)$$,'22023',null,'screenshot path must be prefixed with the Application id');
select throws_ok($$select public.attach_application_screenshot(
  (select id from apps where job_description_id='93000000-0000-4000-8000-000000000001'),
  (select id::text||'/confirmation.exe' from apps where job_description_id='93000000-0000-4000-8000-000000000001'),
  'confirmation.exe','application/x-msdownload',2048
)$$,'22023',null,'unsupported mime type is rejected');
select throws_ok($$select public.attach_application_screenshot(
  (select id from apps where job_description_id='93000000-0000-4000-8000-000000000001'),
  (select id::text||'/big.png' from apps where job_description_id='93000000-0000-4000-8000-000000000001'),
  'big.png','image/png',10485760
)$$,'22023',null,'oversized screenshot is rejected');

select throws_ok($$select public.update_application_progress(
  (select id from apps where job_description_id='93000000-0000-4000-8000-000000000001'),
  'IN_PROGRESS','APPLIED',null,null,null,null,null
)$$,'22023',null,'marking Applied without an Application URL is blocked even with a screenshot on file');

select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000003',true);
select throws_ok($$select public.attach_application_screenshot(
  (select id from apps where job_description_id='93000000-0000-4000-8000-000000000001'),
  (select id::text||'/intrusion.png' from apps where job_description_id='93000000-0000-4000-8000-000000000001'),
  'intrusion.png','image/png',2048
)$$,'42501',null,'a different Applier cannot attach a screenshot to an Application not assigned to them');
select throws_ok($$select public.update_application_progress(
  (select id from apps where job_description_id='93000000-0000-4000-8000-000000000002'),
  'IN_PROGRESS','APPLIED','https://example.test/app-two',null,null,null,null
)$$,'22023',null,'marking Applied without any screenshot is blocked even with a URL');

select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000002',true);
select is(public.update_application_progress(
  (select id from apps where job_description_id='93000000-0000-4000-8000-000000000001'),
  'IN_PROGRESS','APPLIED','https://example.test/app-one',null,null,null,null
)->>'application_status','APPLIED','marking Applied succeeds once URL and screenshot are both present');
select is((select (x->>'screenshot_count')::integer from jsonb_array_elements(
  (public.list_applications_v07('',null,'','','','',null,'','updated_desc',null,'',25,0)->'items')
) x where (x->>'id')::uuid=(select id from apps where job_description_id='93000000-0000-4000-8000-000000000001')
),1,'list_applications_v07 reports the screenshot count');

select is((select count(*)::integer from public.application_screenshots
  where application_id=(select id from apps where job_description_id='93000000-0000-4000-8000-000000000001')
),1,'assigned Applier reads their own screenshot metadata');
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000003',true);
select is((select count(*)::integer from public.application_screenshots
  where application_id=(select id from apps where job_description_id='93000000-0000-4000-8000-000000000001')
),0,'a different Applier cannot read screenshot metadata for an Application not assigned to them');

select throws_ok(
  $$insert into public.application_screenshots(application_id,uploaded_by,storage_path,original_filename,mime_type,file_size_bytes)
    values((select id from apps limit 1),auth.uid(),'x/y.png','y.png','image/png',10)$$,
  '42501',null,'direct insert into application_screenshots is denied'
);

select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000002',true);
select is((public.remove_application_screenshot(
  (select id from public.application_screenshots where application_id=(select id from apps where job_description_id='93000000-0000-4000-8000-000000000001'))
)->>'storagePath') is not null,true,'assigned Applier removes their own screenshot');
select is((select count(*)::integer from public.application_screenshots
  where application_id=(select id from apps where job_description_id='93000000-0000-4000-8000-000000000001')
),0,'screenshot metadata row is gone after removal');

select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001',true);
select is((public.attach_application_screenshot(
  (select id from apps where job_description_id='93000000-0000-4000-8000-000000000002'),
  (select id::text||'/manager-upload.pdf' from apps where job_description_id='93000000-0000-4000-8000-000000000002'),
  'manager-upload.pdf','application/pdf',4096
)->>'mime_type'),'application/pdf','manager attaches a PDF screenshot on behalf of an Application');
select is(public.update_application_progress(
  (select id from apps where job_description_id='93000000-0000-4000-8000-000000000002'),
  'IN_PROGRESS','APPLIED',null,null,null,null,null
)->>'application_status','APPLIED','manager marking Applied is not blocked by the Applier-only proof requirement');

select * from finish();
rollback;
