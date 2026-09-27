begin read only;
set local statement_timeout='8s';
select jsonb_build_object(
 'migration_applied',exists(select 1 from supabase_migrations.schema_migrations where version='202609251600'),
 'pairing_table',to_regclass('public.extension_pairings'),
 'approve_function',to_regprocedure('public.approve_extension_pairing_v124(uuid,text)'),
 'redeem_function',to_regprocedure('public.redeem_extension_pairing_v124(uuid,text)'),
 'row_level_security',(select relrowsecurity from pg_class where oid=to_regclass('public.extension_pairings')),
 'stalled_export_session_present',exists(select 1 from pg_stat_activity where pid=2498764 and xact_start between timestamptz '2026-09-27 16:06:23+00' and timestamptz '2026-09-27 16:06:26+00'),
 'stalled_export_locks_remaining',(select count(*) from pg_locks where pid=2498764)
) as verification;
rollback;
