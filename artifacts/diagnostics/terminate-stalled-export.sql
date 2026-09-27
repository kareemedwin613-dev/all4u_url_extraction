-- Terminate only the previously identified idle export, never a reused PID.
select pid, state, xact_start, query_start,
  pg_terminate_backend(pid) as terminated
from pg_stat_activity
where pid=2498764
  and datname='postgres'
  and usename='postgres'
  and application_name='Supavisor'
  and state='idle in transaction'
  and wait_event='ClientRead'
  and xact_start between timestamptz '2026-09-27 16:06:23+00' and timestamptz '2026-09-27 16:06:26+00'
  and query_start between timestamptz '2026-09-27 16:09:08+00' and timestamptz '2026-09-27 16:09:11+00'
  and query ~* '^COPY .* TO stdout';
