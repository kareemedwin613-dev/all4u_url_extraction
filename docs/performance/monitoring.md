# Monitoring (v0.7.1)

No monitoring code ships in the app itself — database statistics are never exposed to normal users (there is no RPC in this migration that reads `pg_stat_statements` or any catalog view; everything below runs manually, with elevated access, in the Supabase SQL editor or a direct `psql` connection).

## Enabling `pg_stat_statements`

Supabase projects generally have `pg_stat_statements` available by default; confirm with:

```sql
select * from pg_extension where extname = 'pg_stat_statements';
```

If missing, enable it from the Supabase dashboard's Database → Extensions page (requires project owner access — not something this app's runtime credentials can do).

## Developer queries (run manually, not from the app)

**Highest total-time queries:**
```sql
select query, calls, total_exec_time, mean_exec_time, rows
from pg_stat_statements
order by total_exec_time desc
limit 20;
```

**Highest mean-time queries (candidates for missing indexes):**
```sql
select query, calls, mean_exec_time, rows
from pg_stat_statements
where calls > 5
order by mean_exec_time desc
limit 20;
```

**Most frequent queries:**
```sql
select query, calls, mean_exec_time
from pg_stat_statements
order by calls desc
limit 20;
```

**Sequential scans on operational tables (should stay near zero for `applications`/`job_descriptions`/`resumes` at scale):**
```sql
select relname, seq_scan, seq_tup_read, idx_scan, idx_tup_fetch
from pg_stat_user_tables
where schemaname = 'public'
order by seq_scan desc
limit 20;
```

**Largest tables and indexes:**
```sql
select relname, pg_size_pretty(pg_total_relation_size(relid)) as total_size
from pg_catalog.pg_statio_user_tables
order by pg_total_relation_size(relid) desc
limit 20;

select indexrelname, relname, pg_size_pretty(pg_relation_size(indexrelid)) as index_size
from pg_stat_user_indexes
order by pg_relation_size(indexrelid) desc
limit 20;
```

**Index usage (candidates for removal — cross-check against the index-strategy doc before dropping anything):**
```sql
select relname, indexrelname, idx_scan, idx_tup_read
from pg_stat_user_indexes
where schemaname = 'public'
order by idx_scan asc
limit 30;
```

**Database size:**
```sql
select pg_size_pretty(pg_database_size(current_database()));
```

**Connection usage:**
```sql
select count(*), state from pg_stat_activity group by state;
```

Supabase's own **Query Performance** and **Performance Advisor** dashboard pages (Project → Advisors) surface most of the above without hand-written SQL and are the easier first stop.

These are deliberately kept as copy-pasteable SQL rather than a script: querying `pg_stat_statements`/system catalogs needs a direct Postgres connection (not the app's Supabase JS/REST client), and a script that ships in this repo with hard-coded query text but no credentials handling would add a new dependency (a Postgres driver) and a plausible place to accidentally leak connection strings for very little benefit over "paste this into the SQL editor." If recurring automated monitoring becomes a real need, that's a deliberate follow-up, not something to bolt on here.
