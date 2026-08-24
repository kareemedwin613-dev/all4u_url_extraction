begin;
select plan(30);

select ok((select relrowsecurity from pg_class where oid='public.categories'::regclass),'categories RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.job_descriptions'::regclass),'jobs RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.resumes'::regclass),'resumes RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.tailoring_jobs'::regclass),'queue RLS enabled');

insert into auth.users(id,email,aud,role) values
  ('11111111-1111-4111-8111-111111111111','admin@example.test','authenticated','authenticated'),
  ('22222222-2222-4222-8222-222222222222','applier@example.test','authenticated','authenticated'),
  ('33333333-3333-4333-8333-333333333333','manager@example.test','authenticated','authenticated'),
  ('44444444-4444-4444-8444-444444444444','developer@example.test','authenticated','authenticated'),
  ('55555555-5555-4555-8555-555555555555','devmanager@example.test','authenticated','authenticated'),
  ('66666666-6666-4666-8666-666666666666','pending@example.test','authenticated','authenticated'),
  ('77777777-7777-4777-8777-777777777777','inactive@example.test','authenticated','authenticated'),
  ('88888888-8888-4888-8888-888888888888','manager2@example.test','authenticated','authenticated');

insert into public.user_roles(user_id,role_id)
select assignments.user_id,roles.id from (values
  ('11111111-1111-4111-8111-111111111111'::uuid,'ADMIN'),
  ('22222222-2222-4222-8222-222222222222'::uuid,'APPLIER'),
  ('33333333-3333-4333-8333-333333333333'::uuid,'APPLYING_MANAGER'),
  ('44444444-4444-4444-8444-444444444444'::uuid,'DEVELOPER'),
  ('55555555-5555-4555-8555-555555555555'::uuid,'DEVELOPMENT_MANAGER'),
  ('77777777-7777-4777-8777-777777777777'::uuid,'APPLIER'),
  ('88888888-8888-4888-8888-888888888888'::uuid,'APPLYING_MANAGER')
) as assignments(user_id,code) join public.roles as roles on roles.code=assignments.code;
update public.profiles set status='INACTIVE' where id='77777777-7777-4777-8777-777777777777';

insert into public.categories(id,slug,name) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','test-category','Test Category');
insert into public.job_descriptions(id,user_id,company,job_title,category_id,seniority,source_url,normalized_source_url,description_text,capture_method,extraction_confidence)
values('aaaaaaaa-0000-4000-8000-000000000001','33333333-3333-4333-8333-333333333333','Company A','Data Engineer','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','SENIOR','https://example.test/jobs/1','https://example.test/jobs/1',repeat('description ',12),'dom','medium');
insert into public.resumes(id,user_id,candidate_name,resume_name,primary_category_id,seniority,resume_text,storage_path,original_filename,mime_type,file_size_bytes,file_sha256)
values('aaaaaaaa-0000-4000-8000-000000000002','33333333-3333-4333-8333-333333333333','Candidate A','Data Resume','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','SENIOR',repeat('resume text ',12),'33333333-3333-4333-8333-333333333333/aaaaaaaa-0000-4000-8000-000000000002/file.txt','file.txt','text/plain',100,repeat('a',64));
insert into storage.objects(bucket_id,name) values('original-resumes','33333333-3333-4333-8333-333333333333/aaaaaaaa-0000-4000-8000-000000000002/file.txt');
insert into public.applications(id,job_description_id,resume_id,assigned_to,assigned_by,work_status,created_by)
values('aaaaaaaa-0000-4000-8000-000000000003','aaaaaaaa-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000002','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','ASSIGNED','33333333-3333-4333-8333-333333333333');

set local role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
select is((select count(*)::integer from public.job_descriptions),1,'Applier reads jobs for assigned Applications');
select is((select count(*)::integer from public.resumes),1,'Applier reads resumes for assigned Applications');
select throws_ok($$insert into public.job_descriptions(company,job_title,category_id,description_text) values('Denied','Denied','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',repeat('description ',12))$$,'42501',null,'Applier cannot insert jobs');
with changed as (update public.job_descriptions set company='Denied' returning 1) select is((select count(*)::integer from changed),0,'Applier cannot update jobs');
select is((select count(*)::integer from storage.objects where bucket_id='original-resumes'),1,'Applier reads original resume objects for assigned Applications');
select throws_ok($$insert into storage.objects(bucket_id,name) values('original-resumes','22222222-2222-4222-8222-222222222222/new.txt')$$,'42501',null,'Applier cannot upload objects');

select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
select is((select count(*)::integer from public.job_descriptions),1,'Applying Manager reads shared jobs');
select lives_ok($$insert into public.job_descriptions(company,job_title,category_id,description_text) values('Own','Own job','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',repeat('description ',12))$$,'Applying Manager inserts own job');
with changed as (update public.job_descriptions set company='Owned update' where id='aaaaaaaa-0000-4000-8000-000000000001' returning 1) select is((select count(*)::integer from changed),1,'Applying Manager updates own job');
select lives_ok($$insert into storage.objects(bucket_id,name) values('original-resumes','33333333-3333-4333-8333-333333333333/new.txt')$$,'Applying Manager uploads to own path');
select throws_ok($$insert into storage.objects(bucket_id,name) values('original-resumes','88888888-8888-4888-8888-888888888888/wrong.txt')$$,'42501',null,'Applying Manager cannot upload to another path');

select set_config('request.jwt.claim.sub','88888888-8888-4888-8888-888888888888',true);
with changed as (update public.job_descriptions set company='Denied' where id='aaaaaaaa-0000-4000-8000-000000000001' returning 1) select is((select count(*)::integer from changed),0,'Applying Manager cannot modify another manager row');

select set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',true);
select is((select count(*)::integer from public.job_descriptions),0,'Developer cannot read jobs');
select is((select count(*)::integer from public.resumes),0,'Developer cannot read resumes');
select is((select count(*)::integer from storage.objects where bucket_id='original-resumes'),0,'Developer cannot read resume objects');

select set_config('request.jwt.claim.sub','55555555-5555-4555-8555-555555555555',true);
select is((select count(*)::integer from public.job_descriptions),0,'Development Manager cannot read jobs');

select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select ok((select count(*) from public.job_descriptions)>=1,'Admin reads all jobs');
select ok((select count(*) from public.resumes)>=1,'Admin reads all resumes');
select ok((select count(*) from storage.objects where bucket_id='original-resumes')>=1,'Admin reads workspace objects');

select set_config('request.jwt.claim.sub','77777777-7777-4777-8777-777777777777',true);
select is((select count(*)::integer from public.job_descriptions),0,'Inactive user cannot read jobs');
select is((select count(*)::integer from storage.objects where bucket_id='original-resumes'),0,'Inactive user cannot read objects');

select set_config('request.jwt.claim.sub','66666666-6666-4666-8666-666666666666',true);
select is((select count(*)::integer from public.job_descriptions),0,'No-role user cannot read jobs');
select is((select count(*)::integer from public.resumes),0,'No-role user cannot read resumes');

set local role anon;
select is((select count(*)::integer from public.job_descriptions),0,'Anonymous user cannot read jobs');
select is((select count(*)::integer from public.resumes),0,'Anonymous user cannot read resumes');
select is((select count(*)::integer from storage.objects where bucket_id='original-resumes'),0,'Anonymous user cannot read objects');

select * from finish();
rollback;
