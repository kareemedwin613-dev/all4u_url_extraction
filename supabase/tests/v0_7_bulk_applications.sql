begin;
select plan(32);

select ok((select relrowsecurity from pg_class where oid='public.application_creation_batches'::regclass),'batch RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.application_creation_batch_results'::regclass),'batch result RLS enabled');
select has_column('public','applications','creation_batch_id','Applications have an optional creation batch');

insert into auth.users(id,email,aud,role,raw_user_meta_data) values
 ('71000000-0000-4000-8000-000000000001','manager7@example.test','authenticated','authenticated','{}'),
 ('71000000-0000-4000-8000-000000000002','admin7@example.test','authenticated','authenticated','{}'),
 ('71000000-0000-4000-8000-000000000003','applier7@example.test','authenticated','authenticated','{}'),
 ('71000000-0000-4000-8000-000000000004','developer7@example.test','authenticated','authenticated','{}'),
 ('71000000-0000-4000-8000-000000000005','devmanager7@example.test','authenticated','authenticated','{}');

insert into public.user_roles(user_id,role_id)
select values_.user_id,roles.id from (values
 ('71000000-0000-4000-8000-000000000001'::uuid,'APPLYING_MANAGER'),
 ('71000000-0000-4000-8000-000000000002'::uuid,'ADMIN'),
 ('71000000-0000-4000-8000-000000000003'::uuid,'APPLIER'),
 ('71000000-0000-4000-8000-000000000004'::uuid,'DEVELOPER'),
 ('71000000-0000-4000-8000-000000000005'::uuid,'DEVELOPMENT_MANAGER')
) values_(user_id,code) join public.roles on roles.code=values_.code;

insert into public.categories(id,slug,name) values
 ('72000000-0000-4000-8000-000000000001','v0-7-engineering','v0.7 Engineering'),
 ('72000000-0000-4000-8000-000000000002','v0-7-analysis','v0.7 Analysis');
insert into public.job_descriptions(id,user_id,company,job_title,category_id,description_text) values
 ('73000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','Acme','Engineer I','72000000-0000-4000-8000-000000000001',repeat('job ',30)),
 ('73000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000001','Acme','Engineer II','72000000-0000-4000-8000-000000000001',repeat('job ',30)),
 ('73000000-0000-4000-8000-000000000003','71000000-0000-4000-8000-000000000001','Beta','Analyst','72000000-0000-4000-8000-000000000002',repeat('job ',30)),
 ('73000000-0000-4000-8000-000000000004','71000000-0000-4000-8000-000000000001','Gamma','Individual','72000000-0000-4000-8000-000000000001',repeat('job ',30));
insert into public.resumes(id,user_id,candidate_name,resume_name,primary_category_id,resume_text,storage_path,original_filename,mime_type,file_size_bytes,file_sha256,status) values
 ('74000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','Alex Active','Alex Resume','72000000-0000-4000-8000-000000000001',repeat('resume ',20),'71000000-0000-4000-8000-000000000001/alex.pdf','alex.pdf','application/pdf',1000,repeat('a',64),'ACTIVE'),
 ('74000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000001','Blair Active','Blair Resume','72000000-0000-4000-8000-000000000001',repeat('resume ',20),'71000000-0000-4000-8000-000000000001/blair.pdf','blair.pdf','application/pdf',1000,repeat('b',64),'ACTIVE'),
 ('74000000-0000-4000-8000-000000000003','71000000-0000-4000-8000-000000000001','Casey Archived','Casey Resume','72000000-0000-4000-8000-000000000001',repeat('resume ',20),'71000000-0000-4000-8000-000000000001/casey.pdf','casey.pdf','application/pdf',1000,repeat('c',64),'ARCHIVED'),
 ('74000000-0000-4000-8000-000000000004','71000000-0000-4000-8000-000000000001','Drew Active','Drew Resume','72000000-0000-4000-8000-000000000001',repeat('resume ',20),'71000000-0000-4000-8000-000000000001/drew.pdf','drew.pdf','application/pdf',1000,repeat('d',64),'ACTIVE');

set local role authenticated;
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000001',true);
select public.create_application('73000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000001',null,'NORMAL',null,'existing');

select is((public.preview_bulk_applications(array['73000000-0000-4000-8000-000000000001'::uuid,'73000000-0000-4000-8000-000000000001'::uuid,'73000000-0000-4000-8000-000000000002'::uuid])->>'selectedJdCount')::integer,2,'preview deduplicates JD identifiers');
select is((public.preview_bulk_applications(array['73000000-0000-4000-8000-000000000001'::uuid,'73000000-0000-4000-8000-000000000002'::uuid])->>'proposedCount')::integer,6,'preview uses active same-category Resumes only');
select is((public.preview_bulk_applications(array['73000000-0000-4000-8000-000000000001'::uuid])->>'duplicateCount')::integer,1,'preview identifies an existing JD-Resume pair');
select is((public.preview_bulk_applications(array['73000000-0000-4000-8000-000000000003'::uuid])->>'invalidJdCount')::integer,1,'preview reports JD with no active matching Resume');
select is((public.preview_bulk_applications(array['73999999-0000-4000-8000-000000000099'::uuid])->'invalidJds'->0->>'code'),'MISSING_JD','preview reports a missing JD');
select is((select count(*)::integer from public.application_creation_batches),0,'preview creates no batch');
select is((select count(*)::integer from public.applications),1,'preview creates no Application');
select throws_ok($$select public.preview_bulk_applications(array[]::uuid[])$$,'22023',null,'empty preview is rejected');
select throws_ok($$select public.preview_bulk_applications(array(select gen_random_uuid() from generate_series(1,101)))$$,'22023',null,'preview request limit is enforced');

create temporary table v07_result as select public.create_applications_bulk(jsonb_build_array(
 jsonb_build_object('job_description_id','73000000-0000-4000-8000-000000000001','resume_id','74000000-0000-4000-8000-000000000001'),
 jsonb_build_object('job_description_id','73000000-0000-4000-8000-000000000001','resume_id','74000000-0000-4000-8000-000000000002'),
 jsonb_build_object('job_description_id','73000000-0000-4000-8000-000000000002','resume_id','74000000-0000-4000-8000-000000000001'),
 jsonb_build_object('job_description_id','73000000-0000-4000-8000-000000000002','resume_id','74000000-0000-4000-8000-000000000003'),
 jsonb_build_object('job_description_id','73000000-0000-4000-8000-000000000003','resume_id','74000000-0000-4000-8000-000000000001'),
 jsonb_build_object('job_description_id','73999999-0000-4000-8000-000000000099','resume_id','74000000-0000-4000-8000-000000000001')
),'v0.7 partial batch') result;
select is((select (result->>'createdCount')::integer from v07_result),2,'partial request creates eligible pairs');
select is((select (result->>'duplicateCount')::integer from v07_result),1,'partial request reports existing pair');
select is((select (result->>'skippedCount')::integer from v07_result),3,'partial request skips inactive, mismatched, and missing rows');
select is((select result->>'status' from v07_result),'COMPLETED_WITH_WARNINGS','partial request completes with warnings');
select is((select count(*)::integer from public.applications where creation_batch_id is not null),2,'bulk Applications are associated with the batch');
select is((select count(*)::integer from public.applications where creation_batch_id is not null and assigned_to is null and assigned_by is null and work_status='UNASSIGNED' and application_status='NOT_APPLIED' and priority='NORMAL'),2,'bulk Applications use unassigned defaults');
select is((select requested_combination_count from public.application_creation_batches limit 1),6,'batch records requested count');
select is((select count(*)::integer from public.application_creation_batch_results),6,'batch retains one outcome per unique pair');

create temporary table v07_repeat as select public.create_applications_bulk(jsonb_build_array(
 jsonb_build_object('job_description_id','73000000-0000-4000-8000-000000000001','resume_id','74000000-0000-4000-8000-000000000002'),
 jsonb_build_object('job_description_id','73000000-0000-4000-8000-000000000002','resume_id','74000000-0000-4000-8000-000000000001')
),'v0.7 repeated batch') result;
select is((select (result->>'createdCount')::integer from v07_repeat),0,'repeated request creates no duplicates');
select is((select (result->>'duplicateCount')::integer from v07_repeat),2,'repeated request returns duplicate outcomes');
select is((select count(*)::integer from public.applications where creation_batch_id is not null),2,'idempotent repeat preserves Application count');
select is(jsonb_array_length(public.list_application_batch_options(20)),2,'manager can list batch filter options');
select throws_ok($$insert into public.application_creation_batches(name,created_by) values('forbidden','71000000-0000-4000-8000-000000000001')$$,'42501',null,'direct batch insert is denied');

select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000003',true);
select throws_ok($$select public.preview_bulk_applications(array['73000000-0000-4000-8000-000000000001'::uuid])$$,'42501',null,'Applier cannot generate preview');
select throws_ok($$select public.create_applications_bulk('[{"job_description_id":"73000000-0000-4000-8000-000000000001","resume_id":"74000000-0000-4000-8000-000000000004"}]'::jsonb,null)$$,'42501',null,'Applier cannot call bulk creation');
select is((select count(*)::integer from public.application_creation_batches),0,'Applier cannot read batch records through RLS');
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000004',true);
select throws_ok($$select public.preview_bulk_applications(array['73000000-0000-4000-8000-000000000001'::uuid])$$,'42501',null,'Developer cannot generate preview');
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000005',true);
select throws_ok($$select public.preview_bulk_applications(array['73000000-0000-4000-8000-000000000001'::uuid])$$,'42501',null,'Development Manager cannot generate preview');
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000002',true);
select is((public.preview_bulk_applications(array['73000000-0000-4000-8000-000000000004'::uuid])->>'validJdCount')::integer,1,'Admin can generate preview');
select is(public.create_application('73000000-0000-4000-8000-000000000004','74000000-0000-4000-8000-000000000004',null,'NORMAL',null,'individual regression')->>'creation_batch_id',null::text,'individual v0.6 Application retains null batch');

select * from finish();
rollback;
