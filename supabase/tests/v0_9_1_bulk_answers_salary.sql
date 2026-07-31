begin;
select plan(2);
select has_function('public','save_resume_application_answers_v091',array['uuid','jsonb']);
select ok(has_function_privilege('authenticated','public.save_resume_application_answers_v091(uuid,jsonb)','EXECUTE'),'authenticated can execute the protected bulk Answer setup function');
select * from finish();
rollback;
