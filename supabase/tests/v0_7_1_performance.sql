begin;
select plan(25);

-- Indexes
select has_index('public','applications','idx_applications_assignee_queue','composite assignee-queue index exists');
select hasnt_index('public','user_roles','user_roles_user_id_idx','redundant standalone user_id index was dropped');
select has_index('public','job_descriptions','idx_job_descriptions_search','job_descriptions GIN search index exists');
select has_index('public','resumes','idx_resumes_search','resumes GIN search index exists');

select has_function('public','list_applications_cursor',array['text','uuid','text','text','text','text','uuid','text','uuid','text','timestamptz','uuid','integer'],'cursor RPC exists');
select has_function('public','get_business_overview',array[]::text[],'business overview RPC exists');

insert into auth.users(id,email,aud,role,raw_user_meta_data) values
 ('95000000-0000-4000-8000-000000000001','manager95@example.test','authenticated','authenticated','{}'),
 ('95000000-0000-4000-8000-000000000002','applier95a@example.test','authenticated','authenticated','{}'),
 ('95000000-0000-4000-8000-000000000003','applier95b@example.test','authenticated','authenticated','{}'),
 ('95000000-0000-4000-8000-000000000004','developer95@example.test','authenticated','authenticated','{}');

insert into public.user_roles(user_id,role_id)
select x.user_id,r.id from (values
 ('95000000-0000-4000-8000-000000000001'::uuid,'APPLYING_MANAGER'),
 ('95000000-0000-4000-8000-000000000002'::uuid,'APPLIER'),
 ('95000000-0000-4000-8000-000000000003'::uuid,'APPLIER'),
 ('95000000-0000-4000-8000-000000000004'::uuid,'DEVELOPER')
) x(user_id,code) join public.roles r on r.code=x.code;

insert into public.categories(id,slug,name) values('96000000-0000-4000-8000-000000000001','perf-test','Performance Test');
insert into public.job_descriptions(id,user_id,company,job_title,category_id,description_text) values
 ('97000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000001','Globex','Distributed Systems Engineer','96000000-0000-4000-8000-000000000001',repeat('kubernetes and terraform automation ',10)),
 ('97000000-0000-4000-8000-000000000002','95000000-0000-4000-8000-000000000001','Initech','Payroll Analyst','96000000-0000-4000-8000-000000000001',repeat('spreadsheet reconciliation ',10));
insert into public.resumes(id,user_id,candidate_name,resume_name,primary_category_id,resume_text,storage_path,original_filename,mime_type,file_size_bytes,file_sha256) values
 ('98000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000001','Perf Candidate','Perf Resume','96000000-0000-4000-8000-000000000001',repeat('resume ',20),'95000000-0000-4000-8000-000000000001/perf.pdf','perf.pdf','application/pdf',1000,repeat('d',64));

set local role authenticated;
select set_config('request.jwt.claim.sub','95000000-0000-4000-8000-000000000001',true);

-- RLS still enforces the same authorization after the (select ...) rewrite
select ok((select count(*)::integer from public.job_descriptions where id='97000000-0000-4000-8000-000000000001')=1,'manager reads shared jobs after RLS rewrite');
select lives_ok($$update public.job_descriptions set company='Globex Corp' where id='97000000-0000-4000-8000-000000000001'$$,'owning manager can still update jobs after RLS rewrite');

select set_config('request.jwt.claim.sub','95000000-0000-4000-8000-000000000004',true);
select is((select count(*)::integer from public.job_descriptions),0,'a Developer (no business role) still cannot read jobs after RLS rewrite');
select throws_ok($$update public.job_descriptions set company='Hacked' where id='97000000-0000-4000-8000-000000000001'$$,'42501',null,'a Developer cannot write jobs after RLS rewrite');
select throws_ok($$select public.get_business_overview()$$,'42501',null,'a Developer cannot call get_business_overview');

-- get_business_overview: shape and correctness
select set_config('request.jwt.claim.sub','95000000-0000-4000-8000-000000000001',true);
select is((public.get_business_overview()->'jobCounts'->>'total')::integer,(select count(*)::integer from public.job_descriptions),'business overview job total matches a direct count');
select is(jsonb_typeof(public.get_business_overview()->'recentJobs'),'array','business overview recentJobs is an array');

-- list_applications_v07 no longer exposes notes
select public.create_application('97000000-0000-4000-8000-000000000001','98000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000002','NORMAL',null,'Private manager note');
select ok(not ((public.list_applications_v07('',null,'','','','',null,'','updated_desc',null,'',25,0)->'items'->0) ? 'notes'),'list_applications_v07 no longer returns the notes column');

-- Full-text search: matches JD body text, still RLS-scoped
select ok(jsonb_array_length(public.list_applications_v07('kubernetes',null,'','','','',null,'','updated_desc',null,'',25,0)->'items')=1,'full-text search matches job description body text');
select is(jsonb_array_length(public.list_applications_v07('zzz_no_such_term',null,'','','','',null,'','updated_desc',null,'',25,0)->'items'),0,'full-text search returns nothing for an unmatched term');
select ok(jsonb_array_length(public.list_application_resumes('97000000-0000-4000-8000-000000000001','Perf Candidate',100))=1,'list_application_resumes full-text search finds the candidate by name');
select ok(jsonb_array_length(public.list_application_jobs('Globex',100))=1,'list_application_jobs full-text search finds the job by company name');

select set_config('request.jwt.claim.sub','95000000-0000-4000-8000-000000000003',true);
select is(jsonb_array_length(public.list_applications_v07('kubernetes',null,'','','','',null,'','updated_desc',null,'',25,0)->'items'),0,'full-text search still respects per-row scoping for a non-assigned Applier');

-- list_applications_cursor: no duplicate/skipped rows across pages, hasMore/nextCursor correctness
select set_config('request.jwt.claim.sub','95000000-0000-4000-8000-000000000001',true);
select public.create_application('97000000-0000-4000-8000-000000000002','98000000-0000-4000-8000-000000000001',null,'NORMAL',null,null);
create temporary table cursor_page_1 as select public.list_applications_cursor('',null,'','','','',null,'',null,'',null,null,1) result;
select is((select (result->>'hasMore')::boolean from cursor_page_1),true,'first cursor page of 2 rows with page size 1 reports hasMore');
select is((select jsonb_array_length(result->'items') from cursor_page_1),1,'first cursor page returns exactly one row');
create temporary table cursor_page_2 as select public.list_applications_cursor(
  '',null,'','','','',null,'',null,'',
  ((select result->'nextCursor'->>'updatedAt' from cursor_page_1))::timestamptz,
  ((select result->'nextCursor'->>'id' from cursor_page_1))::uuid,
  1
) result;
select is((select (result->>'hasMore')::boolean from cursor_page_2),false,'second cursor page reports no further pages');
select is((select jsonb_array_length(result->'items') from cursor_page_2),1,'second cursor page returns the remaining row');
select isnt(
  (select result->'items'->0->>'id' from cursor_page_1),
  (select result->'items'->0->>'id' from cursor_page_2),
  'cursor pages do not return a duplicate row'
);
select throws_ok($$select public.list_applications_cursor('',null,'','','','',null,'',null,'',now(),null,25)$$,'22023',null,'cursor RPC rejects a half-supplied cursor pair');

select * from finish();
rollback;
