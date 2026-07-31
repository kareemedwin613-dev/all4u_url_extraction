begin;
select plan(3);
select has_function('public','resume_answer_sensitive_patterns_valid_v091',array['text','text[]']);
select ok(not public.resume_answer_sensitive_patterns_valid_v091('gender_identity',array['Disability status']),'cross-category sensitive patterns are rejected');
select ok(public.resume_answer_sensitive_patterns_valid_v091('veteran_status',array['Veteran status']),'matching voluntary category patterns are accepted');
select * from finish();
rollback;
