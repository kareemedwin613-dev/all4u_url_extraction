# Unified Application status — v1.0.1

Applications expose one canonical `status` through the NestJS API, dashboard,
and Chrome extension:

`UNASSIGNED`, `ASSIGNED`, `IN_PROGRESS`, `BLOCKED`, `APPLIED`, `SCREENING`,
`INTERVIEW_SCHEDULED`, `OFFER_RECEIVED`, `REJECTED`, `WITHDRAWN`, `CLOSED`,
and `CANCELLED`.

Existing rows are mapped without deleting history. An external hiring status
(`APPLIED` or later) takes precedence over the former operational status. A
legacy `COMPLETED` + `NOT_APPLIED` row becomes `CLOSED`.

The old `work_status` and `application_status` columns are deprecated internal
compatibility fields in this release. A database trigger keeps them synchronized
so the existing atomic bulk-assignment, capacity, count, and history RPCs keep
working. API clients cannot set either legacy field; all interactive mutations
use `update_application_status_v101` and write one `STATUS` history event.

The compatibility columns can be removed in a later migration after every
deployed reporting and bulk RPC has been rewritten against `status`.
