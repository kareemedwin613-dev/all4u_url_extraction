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
