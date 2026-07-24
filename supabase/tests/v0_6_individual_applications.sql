begin;
select plan(31);

select ok((select relrowsecurity from pg_class where oid='public.applications'::regclass),'applications RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.application_assignment_history'::regclass),'assignment history RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.application_status_history'::regclass),'status history RLS enabled');

insert into auth.users(id,email,aud,role,raw_user_meta_data) values
 ('61000000-0000-4000-8000-000000000001','manager6@example.test','authenticated','authenticated','{}'),
 ('61000000-0000-4000-8000-000000000002','admin6@example.test','authenticated','authenticated','{}'),
 ('61000000-0000-4000-8000-000000000003','applier1@example.test','authenticated','authenticated','{}'),
 ('61000000-0000-4000-8000-000000000004','applier2@example.test','authenticated','authenticated','{}'),
 ('61000000-0000-4000-8000-000000000005','developer6@example.test','authenticated','authenticated','{}'),
 ('61000000-0000-4000-8000-000000000006','inactive6@example.test','authenticated','authenticated','{}');

insert into public.user_roles(user_id,role_id)
select x.user_id,r.id from (values
 ('61000000-0000-4000-8000-000000000001'::uuid,'APPLYING_MANAGER'),
 ('61000000-0000-4000-8000-000000000002'::uuid,'ADMIN'),
 ('61000000-0000-4000-8000-000000000003'::uuid,'APPLIER'),
 ('61000000-0000-4000-8000-000000000004'::uuid,'APPLIER'),
 ('61000000-0000-4000-8000-000000000005'::uuid,'DEVELOPER'),
 ('61000000-0000-4000-8000-000000000006'::uuid,'APPLIER')
) x(user_id,code) join public.roles r on r.code=x.code;
update public.profiles set status='INACTIVE' where id='61000000-0000-4000-8000-000000000006';

insert into public.categories(id,slug,name) values('62000000-0000-4000-8000-000000000001','v0-6-test','v0.6 Test');
insert into public.job_descriptions(id,user_id,company,job_title,category_id,description_text) values
 ('63000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001','Acme','Engineer','62000000-0000-4000-8000-000000000001',repeat('job ',30)),
 ('63000000-0000-4000-8000-000000000002','61000000-0000-4000-8000-000000000001','Acme','Analyst','62000000-0000-4000-8000-000000000001',repeat('job ',30));
insert into public.resumes(id,user_id,candidate_name,resume_name,primary_category_id,resume_text,storage_path,original_filename,mime_type,file_size_bytes,file_sha256) values
 ('64000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001','Candidate One','Primary','62000000-0000-4000-8000-000000000001',repeat('resume ',20),'61000000-0000-4000-8000-000000000001/resume1.pdf','resume1.pdf','application/pdf',1000,repeat('a',64)),
 ('64000000-0000-4000-8000-000000000002','61000000-0000-4000-8000-000000000001','Candidate Two','Secondary','62000000-0000-4000-8000-000000000001',repeat('resume ',20),'61000000-0000-4000-8000-000000000001/resume2.pdf','resume2.pdf','application/pdf',1000,repeat('b',64));

set local role authenticated;
select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000001',true);
select is(public.create_application('63000000-0000-4000-8000-000000000001','64000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000003','HIGH',now()+interval '1 day','First')->>'work_status','ASSIGNED','manager creates assigned Application');
select is((select count(*)::integer from public.application_assignment_history),1,'initial assignment history is automatic');
select throws_ok($$select public.create_application('63000000-0000-4000-8000-000000000001','64000000-0000-4000-8000-000000000001',null,'NORMAL',null,null)$$,'P0001',null,'duplicate job and resume is rejected');
select throws_ok($$select public.create_application('63000000-0000-4000-8000-000000000002','64000000-0000-4000-8000-000000000002','61000000-0000-4000-8000-000000000006','NORMAL',null,null)$$,'P0001',null,'inactive Applier cannot be assigned');
select throws_ok($$select public.create_application('63000000-0000-4000-8000-000000000002','64000000-0000-4000-8000-000000000002','61000000-0000-4000-8000-000000000005','NORMAL',null,null)$$,'P0001',null,'non-Applier cannot be assigned');

select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000003',true);
select is((select count(*)::integer from public.applications),1,'assigned Applier reads own Application');
select throws_ok($$select public.create_application('63000000-0000-4000-8000-000000000002','64000000-0000-4000-8000-000000000002',null,'NORMAL',null,null)$$,'42501',null,'Applier cannot create Application');
select is(public.update_application_progress((select id from public.applications limit 1),'IN_PROGRESS','APPLIED','https://example.test/application',null,null,null,null)->>'application_status','APPLIED','assigned Applier updates permitted status and URL');
select ok((select applied_at is not null from public.applications limit 1),'APPLIED automatically populates applied_at');
select is((select count(*)::integer from public.application_status_history),2,'two changed status fields create two history rows');
select public.update_application_progress((select id from public.applications limit 1),'IN_PROGRESS','APPLIED','https://example.test/application',null,null,null,null);
select is((select count(*)::integer from public.application_status_history),2,'no-op status update creates no history');
select throws_ok($$select public.update_application_progress((select id from public.applications limit 1),'IN_PROGRESS','APPLIED',null,null,null,'URGENT',null)$$,'42501',null,'Applier cannot change protected priority');
select throws_ok($$select public.update_application_progress((select id from public.applications limit 1),'CANCELLED','APPLIED',null,null,null,null,null)$$,'42501',null,'Applier cannot cancel Application');
select throws_ok($$update public.applications set priority='LOW'$$,'42501',null,'direct Application update is denied');
select throws_ok($$delete from public.applications$$,'42501',null,'direct Application delete is denied');
select is((select count(*)::integer from public.application_assignment_history),1,'Applier reads own assignment history');
select is((select count(*)::integer from public.application_status_history),2,'Applier reads own status history');

select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000004',true);
select is((select count(*)::integer from public.applications),0,'another Applier cannot read the Application');
select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000005',true);
select is((select count(*)::integer from public.applications),0,'Developer-only user cannot read Applications');

select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000001',true);
select is(public.reassign_application((select id from public.applications limit 1),'61000000-0000-4000-8000-000000000004','Capacity')->>'work_status','ASSIGNED','manager reassigns Application');
select is((select count(*)::integer from public.application_assignment_history),2,'reassignment creates assignment history');
select public.reassign_application((select id from public.applications limit 1),'61000000-0000-4000-8000-000000000004','No change');
select is((select count(*)::integer from public.application_assignment_history),2,'same-assignee operation is a no-op');
select is(public.reassign_application((select id from public.applications limit 1),null,'Paused')->>'work_status','UNASSIGNED','manager unassigns Application');
select is((select count(*)::integer from public.application_assignment_history),3,'unassignment creates assignment history');
select is(jsonb_array_length(public.list_active_appliers('',100)),2,'manager selector returns active Appliers only');

select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000002',true);
select is(public.create_application('63000000-0000-4000-8000-000000000002','64000000-0000-4000-8000-000000000002',null,'NORMAL',null,null)->>'work_status','UNASSIGNED','Admin creates unassigned Application');
select is((public.get_application_counts()->>'total')::integer,2,'Admin receives manager-wide counts');
select is(public.get_application_resume_file((select id from public.applications where job_description_id='63000000-0000-4000-8000-000000000002'))->>'bucket','original-resumes','authorized Application Resume RPC returns private bucket');

select * from finish();
rollback;
