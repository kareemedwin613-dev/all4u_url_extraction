begin;
select plan(39);

select is((select array_agg(code order by code) from public.roles),array['ADMIN','APPLIER','APPLYING_MANAGER','DEVELOPER','DEVELOPMENT_MANAGER']::text[],'five exact role codes are seeded');
select ok((select relrowsecurity from pg_class where oid='public.profiles'::regclass),'profiles RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.roles'::regclass),'roles RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.user_roles'::regclass),'user_roles RLS enabled');

insert into auth.users(id,email,aud,role,raw_user_meta_data) values
  ('10101010-1010-4010-8010-101010101010','ADMIN@EXAMPLE.TEST','authenticated','authenticated','{"full_name":"Admin User"}'),
  ('20202020-2020-4020-8020-202020202020','user@example.test','authenticated','authenticated','{}'),
  ('30303030-3030-4030-8030-303030303030','pending@example.test','authenticated','authenticated','{}'),
  ('40404040-4040-4040-8040-404040404040','inactiveadmin@example.test','authenticated','authenticated','{}');

select is((select email from public.profiles where id='10101010-1010-4010-8010-101010101010'),'admin@example.test','Auth trigger lowercases profile email');
select is((select full_name from public.profiles where id='10101010-1010-4010-8010-101010101010'),'Admin User','Auth trigger copies full name');
select is((select count(*)::integer from public.user_roles where user_id='20202020-2020-4020-8020-202020202020'),0,'new user receives no automatic role');

insert into public.user_roles(user_id,role_id)
select '10101010-1010-4010-8010-101010101010',id from public.roles where code='ADMIN';

set local role authenticated;
select set_config('request.jwt.claim.sub','20202020-2020-4020-8020-202020202020',true);
select throws_ok($$insert into public.profiles(id,email) values('90909090-9090-4090-8090-909090909090','x@example.test')$$,'42501',null,'browser user cannot insert profiles');
select throws_ok($$update public.profiles set status='INACTIVE' where id='20202020-2020-4020-8020-202020202020'$$,'42501',null,'browser user cannot directly update status');
select throws_ok($$delete from public.profiles where id='20202020-2020-4020-8020-202020202020'$$,'42501',null,'browser user cannot delete profiles');
select throws_ok($$insert into public.roles(code,name) values('CUSTOM','Custom')$$,'42501',null,'browser user cannot create roles');
select throws_ok($$insert into public.user_roles(user_id,role_id) select '20202020-2020-4020-8020-202020202020',id from public.roles where code='APPLIER'$$,'42501',null,'non-admin cannot directly assign roles');
select throws_ok($$select public.admin_assign_role('20202020-2020-4020-8020-202020202020','APPLIER')$$,'42501','ACCESS_DENIED','non-admin Admin RPC is rejected');
select is((select count(*)::integer from public.roles where active),5,'active authenticated user reads role catalog');
select throws_ok($$update public.roles set name='Changed' where code='APPLIER'$$,'42501',null,'browser user cannot update roles');
select throws_ok($$delete from public.roles where code='APPLIER'$$,'42501',null,'browser user cannot delete roles');
select is((select count(*)::integer from public.user_roles),0,'non-admin cannot list another user role assignment');

select set_config('request.jwt.claim.sub','10101010-1010-4010-8010-101010101010',true);
select ok(public.is_active_user(),'active profile is active');
select ok(public.has_role('admin'),'role input is normalized');
select ok(public.has_any_role(array['unknown','ADMIN']),'has_any_role finds one active role');
select isnt(public.has_role('unknown'),true,'unknown role returns false');
select is((public.get_my_access_context()->'roles')::text,'["ADMIN"]','access context returns sorted roles');
select is((select count(*)::integer from public.admin_list_users('',null,null,25,0)),4,'Admin can list safe profiles');
select is(public.admin_assign_role('20202020-2020-4020-8020-202020202020','APPLIER'),array['APPLIER']::text[],'Admin assigns role');
select is(public.admin_assign_role('20202020-2020-4020-8020-202020202020','APPLIER'),array['APPLIER']::text[],'repeated assignment is idempotent');
select is(public.admin_assign_role('20202020-2020-4020-8020-202020202020','DEVELOPER'),array['APPLIER','DEVELOPER']::text[],'one user can hold multiple roles');
select is(public.admin_remove_role('20202020-2020-4020-8020-202020202020','DEVELOPER'),array['APPLIER']::text[],'Admin removes role');
reset role;
select throws_ok($$insert into public.user_roles(user_id,role_id) select '20202020-2020-4020-8020-202020202020',id from public.roles where code='APPLIER'$$,'23505',null,'duplicate role assignment is prevented');
set local role authenticated;
select set_config('request.jwt.claim.sub','10101010-1010-4010-8010-101010101010',true);
select is(public.admin_set_user_status('20202020-2020-4020-8020-202020202020','INACTIVE')->>'status','INACTIVE','Admin deactivates user');
select is(public.admin_set_user_status('20202020-2020-4020-8020-202020202020','ACTIVE')->>'status','ACTIVE','Admin reactivates user');
select throws_ok($$select public.admin_set_user_status('20202020-2020-4020-8020-202020202020','BAD')$$,'22023','VALIDATION_ERROR: Invalid status.','invalid status is rejected');
select throws_ok($$select public.admin_assign_role('20202020-2020-4020-8020-202020202020','BAD')$$,'22023','ROLE_NOT_FOUND','invalid role is rejected');
select throws_ok($$select public.admin_get_user('90909090-9090-4090-8090-909090909090')$$,'P0002','USER_NOT_FOUND','missing user is rejected');
select throws_ok($$select public.admin_remove_role('10101010-1010-4010-8010-101010101010','ADMIN')$$,'P0001','LAST_ACTIVE_ADMIN_REQUIRED: At least one active Admin must remain.','final Admin role cannot be removed');
select throws_ok($$select public.admin_set_user_status('10101010-1010-4010-8010-101010101010','INACTIVE')$$,'P0001','LAST_ACTIVE_ADMIN_REQUIRED: At least one active Admin must remain.','final Admin cannot be deactivated');

select set_config('request.jwt.claim.sub','20202020-2020-4020-8020-202020202020',true);
select is((select count(*)::integer from public.user_roles),1,'user can read their own assigned roles');

reset role;
insert into public.user_roles(user_id,role_id)
select '40404040-4040-4040-8040-404040404040',id from public.roles where code='ADMIN';
update public.profiles set status='INACTIVE' where id='40404040-4040-4040-8040-404040404040';
set local role authenticated;
select set_config('request.jwt.claim.sub','40404040-4040-4040-8040-404040404040',true);
select isnt(public.has_role('ADMIN'),true,'inactive user fails role checks');
select throws_ok($$select public.admin_list_users('',null,null,25,0)$$,'42501','ACCESS_DENIED','inactive Admin RPC is rejected');

select set_config('request.jwt.claim.sub','30303030-3030-4030-8030-303030303030',true);
select is((public.get_my_access_context()->'roles')::text,'[]','active no-role user receives empty role array');

select * from finish();
rollback;
