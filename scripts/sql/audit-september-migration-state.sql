-- Read-only drift audit. Hashes are whitespace-normalized local function bodies.
select jsonb_build_object(
  'functions',(select jsonb_agg(jsonb_build_object('name',p.proname,'body_matches',md5(regexp_replace(p.prosrc,'\s','','g'))=e.hash,
    'security_definer',p.prosecdef,'search_path',p.proconfig,
    'authenticated_execute',has_function_privilege('authenticated',p.oid,'EXECUTE'),
    'anon_execute',has_function_privilege('anon',p.oid,'EXECUTE')))
    from (values ('jd_review_snapshot','589593d4db5585a41fc6837113cb92f4'),('jd_review_manage','f5d55f3e61f30340361bc747f395d6e8'),
      ('jd_review_runner','093bfa2ec207afcd1ac0371c99386dbd'),('list_job_descriptions_v396','4525251f8f6038996b571dc7deb9d99a')) e(name,hash)
    left join pg_proc p on p.proname=e.name and p.pronamespace='public'::regnamespace),
  'columns',(select jsonb_agg(jsonb_build_object('table',table_name,'column',column_name,'type',data_type,'nullable',is_nullable,'default',column_default) order by table_name,ordinal_position)
    from information_schema.columns where table_schema='public' and table_name in('jd_review_batches','jd_review_items','jd_review_tickets')),
  'constraints',(select jsonb_agg(jsonb_build_object('table',conrelid::regclass::text,'name',conname,'definition',pg_get_constraintdef(oid))) from pg_constraint
    where conrelid in('public.jd_review_batches'::regclass,'public.jd_review_items'::regclass,'public.jd_review_tickets'::regclass)),
  'tables',(select jsonb_agg(jsonb_build_object('name',relname,'rls',relrowsecurity,
    'authenticated_read',has_table_privilege('authenticated',oid,'SELECT'),'authenticated_write',has_table_privilege('authenticated',oid,'INSERT,UPDATE,DELETE'),
    'anon_read',has_table_privilege('anon',oid,'SELECT'),'anon_write',has_table_privilege('anon',oid,'INSERT,UPDATE,DELETE'))) from pg_class
    where oid in('public.jd_review_batches'::regclass,'public.jd_review_items'::regclass,'public.jd_review_tickets'::regclass)),
  'queue_index',(select indexdef from pg_indexes where schemaname='public' and indexname='jd_review_items_queue'),
  'status_function', (select jsonb_build_object('calls_sibling_blocking',prosrc like '%block_sibling_applications_for_blocked_job_v3106%',
    'preserves_priority',prosrc like '%p_priority is not null%') from pg_proc where oid='public.update_application_status_v101(uuid,text,text,timestamptz,text,text,timestamptz)'::regprocedure),
  'subtype',(select jsonb_build_object('active',c.active,'sort_order',c.sort_order,'name',c.name,'parent',p.slug) from categories c join categories p on p.id=c.parent_id where c.slug='javascript-typescript-engineering')
) as audit;
