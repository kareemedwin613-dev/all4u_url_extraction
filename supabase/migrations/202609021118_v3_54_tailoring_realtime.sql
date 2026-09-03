-- v3.54: push tailoring status transitions to visible dashboard pages.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tailoring_jobs'
    ) then
      alter publication supabase_realtime add table public.tailoring_jobs;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tailoring_batches'
    ) then
      alter publication supabase_realtime add table public.tailoring_batches;
    end if;
  end if;
end;
$$;
