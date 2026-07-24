begin;
select plan(22);

select has_function('public','bulk_assign_applications',array['uuid[]','uuid','text'],'bulk assignment RPC exists');

insert into auth.users(id,email,aud,role,raw_user_meta_data) values
 ('81000000-0000-4000-8000-000000000001','manager8@example.test','authenticated','authenticated','{}'),
 ('81000000-0000-4000-8000-000000000002','admin8@example.test','authenticated','authenticated','{}'),
 ('81000000-0000-4000-8000-000000000003','applier8@example.test','authenticated','authenticated','{}'),
 ('81000000-0000-4000-8000-000000000004','inactive8@example.test','authenticated','authenticated','{}');

insert into public.user_roles(user_id,role_id)
select values_.user_id,roles.id from (values
 ('81000000-0000-4000-8000-000000000001'::uuid,'APPLYING_MANAGER'),
 ('81000000-0000-4000-8000-000000000002'::uuid,'ADMIN'),
 ('81000000-0000-4000-8000-000000000003'::uuid,'APPLIER'),
 ('81000000-0000-4000-8000-000000000004'::uuid,'APPLIER')
) values_(user_id,code) join public.roles on roles.code=values_.code;
update public.profiles set status='INACTIVE' where id='81000000-0000-4000-8000-000000000004';

insert into public.categories(id,slug,name) values
 ('82000000-0000-4000-8000-000000000001','bulk-assignment-engineering','Bulk Assignment Engineering');
insert into public.job_descriptions(id,user_id,company,job_title,category_id,description_text) values
 ('83000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','Acme','Engineer I','82000000-0000-4000-8000-000000000001',repeat('job ',30)),
 ('83000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000001','Gamma','Engineer II','82000000-0000-4000-8000-000000000001',repeat('job ',30));
insert into public.resumes(id,user_id,candidate_name,resume_name,primary_category_id,resume_text,storage_path,original_filename,mime_type,file_size_bytes,file_sha256,status) values
 ('84000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','Alex Candidate','Alex Resume','82000000-0000-4000-8000-000000000001',repeat('resume ',20),'81000000-0000-4000-8000-000000000001/alex.pdf','alex.pdf','application/pdf',1000,repeat('8',64),'ACTIVE');

set local role authenticated;
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000001',true);
select public.create_application('83000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000001',null,'NORMAL',null,'bulk assignment one');
select public.create_application('83000000-0000-4000-8000-000000000002','84000000-0000-4000-8000-000000000001',null,'NORMAL',null,'bulk assignment two');

create temporary table assignment_targets as
select id,job_description_id from public.applications
where job_description_id in ('83000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000002');
create temporary table first_assignment as
select public.bulk_assign_applications(array[
 (select id from assignment_targets where job_description_id='83000000-0000-4000-8000-000000000001'),
 (select id from assignment_targets where job_description_id='83000000-0000-4000-8000-000000000001'),
 (select id from assignment_targets where job_description_id='83000000-0000-4000-8000-000000000002')
],'81000000-0000-4000-8000-000000000003','Initial queue assignment') result;

select is((select (result->>'changedCount')::integer from first_assignment),2,'manager assigns multiple Applications in one call');
select is((select (result->>'requestedCount')::integer from first_assignment),2,'bulk assignment deduplicates Application IDs');
select is((select count(*)::integer from public.applications where id in(select id from assignment_targets) and assigned_to='81000000-0000-4000-8000-000000000003' and assigned_by='81000000-0000-4000-8000-000000000001' and work_status='ASSIGNED'),2,'assignment updates all selected Applications with secure defaults');
select is((select count(*)::integer from public.application_assignment_history where application_id in(select id from assignment_targets)),2,'assignment history is automatic for each changed row');

create temporary table repeat_assignment as select public.bulk_assign_applications(array(select id from assignment_targets),'81000000-0000-4000-8000-000000000003','Repeated') result;
select is((select (result->>'changedCount')::integer from repeat_assignment),0,'repeating an assignment makes no changes');
select is((select (result->>'unchangedCount')::integer from repeat_assignment),2,'repeated rows are reported unchanged');
select is((select count(*)::integer from public.application_assignment_history where application_id in(select id from assignment_targets)),2,'idempotent repeat creates no duplicate history');

select is((public.bulk_assign_applications(array[(select id from assignment_targets limit 1),'89999999-0000-4000-8000-000000000099'],null,null)->>'missingCount')::integer,1,'missing Applications are reported without aborting valid rows');
select is((public.bulk_assign_applications(array(select id from assignment_targets),null,'Return to queue')->>'changedCount')::integer,1,'remaining assigned Application can be bulk unassigned');
select is((select count(*)::integer from public.applications where id in(select id from assignment_targets) and assigned_to is null and work_status='UNASSIGNED'),2,'unassignment returns every selected Application to the queue');
select is((select count(*)::integer from public.application_assignment_history where application_id in(select id from assignment_targets)),4,'unassignment writes history only for changed rows');
select is((select count(*)::integer from public.application_status_history where application_id in(select id from assignment_targets) and status_type='WORK_STATUS'),4,'bulk assignment records each automatic work-status transition');

select throws_ok($$select public.bulk_assign_applications(array[(select id from assignment_targets limit 1)],'81000000-0000-4000-8000-000000000004',null)$$,'22023',null,'inactive Applier cannot receive bulk assignments');
select throws_ok($$select public.bulk_assign_applications(array(select gen_random_uuid() from generate_series(1,501)),null,null)$$,'22023',null,'bulk assignment limit is enforced');

select public.bulk_assign_applications(array[(select id from assignment_targets limit 1)],'81000000-0000-4000-8000-000000000003',null);
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000003',true);
select throws_ok($$select public.bulk_assign_applications(array[(select id from assignment_targets limit 1)],null,null)$$,'42501',null,'Applier cannot call bulk assignment RPC');
select throws_ok($$update public.applications set assigned_to=null where id=(select id from assignment_targets limit 1)$$,'42501',null,'Applier cannot bypass the RPC to change protected assignment fields');

select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000001',true);
select is((public.list_application_batches_v2('', '', 'created_desc', 25, 0)->>'total')::integer,0,'Applying Manager can use the sorted batch list RPC');
select throws_ok($$select public.admin_list_users_v2('',null,null,'created_desc',25,0)$$,'42501',null,'Applying Manager cannot use Admin user listing');

select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000002',true);
select ok((select count(*) from public.admin_list_users_v2('',null,null,'email_asc',25,0))>0,'Admin can use the sorted user list RPC');
select is(public.list_applications_v07('',null,'','','','',null,'','company_desc',null,'',25,0)->'items'->0->>'company','Gamma','Application table sort uses displayed company values');
select is((select count(*)::integer from public.applications where job_description_id in ('83000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000002')),2,'individual Application records remain intact');

select * from finish();
rollback;
