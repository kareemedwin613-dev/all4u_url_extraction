-- Read-only report. Run in the production Supabase SQL Editor and export CSV.
-- Match these bounds to the dashboard's selected day/timezone before running.
-- Default: September 21, 2026 in America/New_York.
-- No rows are updated. Actor IDs are audit attribution, not proof of intent.
with bounds as (
  select timestamp '2026-09-21 00:00:00' at time zone 'America/New_York' as from_at,
         timestamp '2026-09-22 00:00:00' at time zone 'America/New_York' as to_at
), records as (
  select a.id, a.application_number, a.job_description_id, a.status,
         a.created_at, a.updated_at, a.applied_at,
         h.created_at as cancelled_at, h.changed_by,
         coalesce(nullif(btrim(h.notes), ''), '[No reason recorded in cancellation history]') as reason,
         case
           when h.id is null then 'MISSING_CANCELLATION_HISTORY'
           when h.notes like 'Cancelled because this job was blocked for all profiles:%'
             then 'JOB_WIDE_BLOCK_CASCADE'
           else 'OTHER_CANCELLATION_REVIEW_HISTORY'
         end as mechanism,
         b.from_at, b.to_at,
         exists (
           select 1 from public.application_status_history activity
           where activity.application_id = a.id
             and activity.created_at >= b.from_at and activity.created_at < b.to_at
         ) as history_in_period
  from public.applications a
  cross join bounds b
  left join lateral (
    select ch.id, ch.created_at, ch.changed_by, ch.notes
    from public.application_status_history ch
    where ch.application_id = a.id
      and ch.status_type in ('STATUS', 'APPLICATION_STATUS', 'WORK_STATUS')
      and ch.new_status = 'CANCELLED'
      and ch.previous_status is distinct from 'CANCELLED'
    order by ch.created_at desc, ch.id desc
    limit 1
  ) h on true
), cohorts as (
  select 'TODAY_OVERVIEW_CURRENTLY_CANCELLED' as cohort, r.*
  from records r
  where status = 'CANCELLED' and (
    (created_at >= from_at and created_at < to_at)
    or (applied_at >= from_at and applied_at < to_at)
    or (updated_at >= from_at and updated_at < to_at and updated_at is distinct from created_at)
    or history_in_period
  )
  union all
  select 'CREATED_TODAY_CURRENTLY_CANCELLED', r.* from records r
  where status = 'CANCELLED' and created_at >= from_at and created_at < to_at
  union all
  select 'LATEST_CANCELLATION_TODAY', r.* from records r
  where cancelled_at >= from_at and cancelled_at < to_at
)
select cohort, mechanism, reason, changed_by,
       count(*) as application_count,
       count(distinct job_description_id) as job_count,
       min(cancelled_at) as first_cancellation,
       max(cancelled_at) as last_cancellation,
       array_agg(application_number order by application_number) as application_numbers
from cohorts
group by cohort, mechanism, reason, changed_by
order by cohort, application_count desc, reason;

-- Cohorts overlap: do not add counts across cohorts.
-- The overview cohort matches the manager short-window count's activity scope.
-- A restricted user's dashboard may show fewer records due to assignment scope.
-- Latest cancellation today includes records subsequently reopened; the other
-- cohorts require current CANCELLED status. Missing reasons remain unknown.
