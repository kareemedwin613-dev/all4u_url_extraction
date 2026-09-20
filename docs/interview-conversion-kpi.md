# Interviews / Applied

The Overview KPI uses the shared reporting date filter to select applications by
`applied_at` (start inclusive, end exclusive). Applications without an applied date
are excluded. Creation, assignment and interview dates do not select the cohort.

- Denominator: applications applied in that date range, regardless of current status.
- Numerator: distinct applications in that same cohort that reached `INTERVIEW_SCHEDULED`.
- Rate: numerator / denominator, displayed as a percentage rounded to one decimal place.
- An empty cohort shows `—` with `0 interviewed / 0 applied`, not a misleading success rate.

Interview evidence is the current status or a `STATUS` / legacy
`APPLICATION_STATUS` history entry entering or leaving `INTERVIEW_SCHEDULED`.
Multiple rounds count once. Interviews after the selected period count, and a
subsequent rejection, offer or closure does not erase an interview already recorded.
An offer alone is not assumed to prove an interview. Missing historical records
cannot be reconstructed by this metric. Recent cohorts may improve as interviews arrive.

Existing Activity Overview counts retain their own reporting semantics; they are
not used to calculate this rate. The new `applied_cohort` object is returned by the
existing counts RPC, with no extra dashboard requests. Administrators/managers keep
their existing visibility; Appliers see only applications currently assigned to them.

Apply `202609161100_v3_95_applied_interview_conversion.sql` and deploy the dashboard.
The migration only replaces the counts function; it does not change application
data or add tables. Until it is applied, the card says conversion data is unavailable
rather than falling back to mismatched counts.

## Avg Days to Interview Scheduled

The adjacent KPI uses the same applied-date cohort and visibility rules. For each
application it subtracts `applied_at` from the earliest recorded `STATUS` or legacy
`APPLICATION_STATUS` transition **into** `INTERVIEW_SCHEDULED`, then averages the
elapsed seconds divided by 86,400. The display rounds to one decimal place, e.g.
`5.0 days`, with the number of applications used. These are elapsed 24-hour days,
not business days or a count of calendar-date boundaries.

Later interviews count even when scheduled outside the selected applied-date
range. Rescheduling/extra rounds do not add samples or replace the first recorded
scheduling time, and later rejection/closure does not discard a valid sample.
This measures when scheduling was recorded in the application, not the date the
interview takes place. Historical scheduling times cannot be reconstructed if
their original transition was not recorded.

Applications with no usable entry timestamp, non-finite dates, or a first
scheduling time before their applied date are excluded, not counted as zero.
Leaving Interview Scheduled and `updated_at` are not substitutes for an entry
timestamp. Same-status history entries are not transitions. Same-time scheduling
is a valid zero-day sample. The card shows the number of interviewed applications
excluded due to missing/invalid timestamps; an empty sample shows `—`.

Apply `202609181000_v3_101_interview_scheduling_time.sql` and deploy the dashboard.
The migration replaces the existing counts function and reuses the indexed
status history; no new date columns, extra dashboard requests, or API changes
are required. It adds `interview_scheduling_sample_count` and
`avg_days_to_interview_scheduled` inside `applied_cohort`, preserving every existing
count. An older API/database response shows unavailable data rather than a fake
zero-day average. No application records are modified.
