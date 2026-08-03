begin;
select plan(7);

select is((select name from public.roles where code='JD_FINDER'),'JD Finder','JD Finder is seeded in the fixed role catalog');
select ok((select active and is_system from public.roles where code='JD_FINDER'),'JD Finder is an active system role');
select policies_are('public','job_descriptions',array[
  'business roles read shared jobs',
  'jd finders insert own jobs',
  'jd finders read own jobs',
  'managers and admins insert jobs',
  'managers own or admins delete jobs',
  'managers own or admins update jobs'
]);

insert into auth.users(id,email,aud,role,raw_user_meta_data) values
 ('f1000000-0000-4000-8000-000000000001','finder@example.test','authenticated','authenticated','{}');
insert into public.user_roles(user_id,role_id)
select 'f1000000-0000-4000-8000-000000000001',id from public.roles where code='JD_FINDER';
insert into public.categories(id,slug,name)
values('f3000000-0000-4000-8000-000000000001','jd-finder-test','JD Finder Test');

set local role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',true);
insert into public.job_descriptions(id,user_id,company,job_title,category_id,description_text)
values('f2000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001','Finder Co','Data Engineer','f3000000-0000-4000-8000-000000000001',repeat('job ',30));
select is((select count(*)::integer from public.job_descriptions where id='f2000000-0000-4000-8000-000000000001'),1,'JD Finder can save and read their own JD');
select throws_ok(
  $$insert into public.job_descriptions(user_id,company,job_title,category_id,description_text) values('00000000-0000-0000-0000-000000000000','Other','Role','f3000000-0000-4000-8000-000000000001',repeat('job ',30))$$,
  '42501',null,'JD Finder cannot attribute a JD to another user'
);
update public.job_descriptions set company='Changed' where id='f2000000-0000-4000-8000-000000000001';
select is((select company from public.job_descriptions where id='f2000000-0000-4000-8000-000000000001'),'Finder Co','JD Finder cannot update a saved JD');
delete from public.job_descriptions where id='f2000000-0000-4000-8000-000000000001';
select is((select count(*)::integer from public.job_descriptions where id='f2000000-0000-4000-8000-000000000001'),1,'JD Finder cannot delete a saved JD');

select * from finish();
rollback;
