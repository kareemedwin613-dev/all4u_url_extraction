import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const readMigration = name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
const id = number => `00000000-0000-0000-0000-${String(number).padStart(12, "0")}`;
const from = "2026-09-01T00:00:00Z", to = "2026-09-08T00:00:00Z";

test("interview scheduling SQL averages first entries without changing cohort or access rules", async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    set time zone 'UTC';
    create role anon; create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('test.actor', true), '')::uuid
    $$;
    create function public.is_active_user(uuid) returns boolean language sql stable as $$
      select $1 is not null and current_setting('test.active', true) = 'true'
    $$;
    create function public.has_role(text, uuid) returns boolean language sql stable as $$
      select $1 = 'APPLIER' and $2 is not null and current_setting('test.role', true) = 'applier'
    $$;
    create function public.application_actor_can_manage() returns boolean language sql stable as $$
      select public.is_active_user(auth.uid()) and current_setting('test.role', true) = 'manager'
    $$;
    create table public.resumes (id uuid primary key, resume_type text);
    create table public.applications (
      id uuid primary key, resume_id uuid, assigned_to uuid, status text,
      applied_at timestamptz, created_at timestamptz, updated_at timestamptz, due_at timestamptz
    );
    create table public.application_status_history (
      application_id uuid, status_type text, previous_status text, new_status text, created_at timestamptz
    );
    create index application_status_history_application_idx on public.application_status_history(application_id, created_at desc);
    insert into public.resumes values ('${id(101)}', 'ORIGINAL'), ('${id(102)}', 'TAILORED');
  `);
  const insertApp = (number, status, applied, actor = 201) => db.query(
    "insert into public.applications values ($1,$2,$3,$4,$5,'2026-08-01','2026-09-15',null)",
    [id(number), id(number % 2 ? 101 : 102), actor ? id(actor) : null, status, applied]);
  const history = (number, at, type = "STATUS", previous = "APPLIED", next = "INTERVIEW_SCHEDULED") => db.query(
    "insert into public.application_status_history values ($1,$2,$3,$4,$5)", [id(number), type, previous, next, at]);
  for (const values of [
    [1, "INTERVIEW_SCHEDULED", "2026-09-01T12:00:00Z"],
    [2, "REJECTED", "2026-09-02T12:00:00Z"],
    [3, "CLOSED", "2026-09-03T12:00:00Z"],
    [4, "INTERVIEW_SCHEDULED", "2026-09-04T12:00:00Z"], // No history: updated_at isn't scheduling.
    [5, "CLOSED", "2026-09-05T12:00:00Z"], // History only leaving interview.
    [6, "INTERVIEW_SCHEDULED", "2026-09-06T12:00:00Z"], // First entry predates applied_at.
    [7, "APPLIED", "2026-09-07T12:00:00Z"],
    [8, "APPLIED", "2026-09-07T12:00:00Z"], // Unrelated history type.
    [9, "INTERVIEW_SCHEDULED", null],
    [10, "INTERVIEW_SCHEDULED", "2026-08-31T23:59:59.999Z"],
    [11, "INTERVIEW_SCHEDULED", to],
    [12, "INTERVIEW_SCHEDULED", "2026-09-04T12:00:00Z", 202],
    [13, "INTERVIEW_SCHEDULED", "2026-09-04T12:00:00Z", null],
    [14, "INTERVIEW_SCHEDULED", "2026-09-04T12:00:00Z"], // Non-finite history date.
    [15, "INTERVIEW_SCHEDULED", "2026-09-04T12:00:00Z"], // Same-status entry isn't scheduling.
  ]) await insertApp(...values);
  await history(1, "2026-09-04T12:00:00Z"); // 3 days.
  await history(2, "2026-09-07T12:00:00Z"); // 5 days, not the subsequent round.
  await history(2, "2026-09-12T12:00:00Z", "STATUS", "SCREENING");
  await history(2, "2026-09-13T12:00:00Z", "STATUS", "INTERVIEW_SCHEDULED", "REJECTED");
  await history(3, "2026-09-10T12:00:00Z", "APPLICATION_STATUS"); // 7 days, outside reporting range.
  await history(5, "2026-09-11T12:00:00Z", "APPLICATION_STATUS", "INTERVIEW_SCHEDULED", "CLOSED");
  await history(6, "2026-09-05T12:00:00Z");
  await history(6, "2026-09-09T12:00:00Z", "STATUS", "SCREENING");
  await history(8, "2026-09-10T12:00:00Z", "WORK_STATUS");
  for (const number of [9, 10, 11]) await history(number, "2026-09-12T12:00:00Z");
  await history(12, "2026-09-06T12:00:00Z"); // Other assignee: 2 days.
  await history(13, "2026-09-08T12:00:00Z"); // Unassigned: 4 days.
  await history(14, "infinity");
  await history(15, "2026-09-08T12:00:00Z", "STATUS", "INTERVIEW_SCHEDULED");

  const actor = (role, number = 201, active = true) => db.query(
    "select set_config('test.role',$1,false),set_config('test.actor',$2,false),set_config('test.active',$3,false)",
    [role, number ? id(number) : "", String(active)]);
  const counts = async (start = from, end = to) => (await db.query(
    "select public.get_application_counts_v29($1::timestamptz,$2::timestamptz) as value", [start, end])).rows[0].value;
  await db.exec(await readMigration("202609161100_v3_95_applied_interview_conversion.sql"));
  await actor("manager");
  const oldWeek = await counts(), oldMonth = await counts(from, "2026-10-01");
  await actor("applier");
  const oldApplier = await counts();
  const originalApps = (await db.query("select * from applications order by id")).rows;
  const sql = await readMigration("202609181000_v3_101_interview_scheduling_time.sql");
  await db.exec(sql);
  assert.deepEqual((await db.query("select * from applications order by id")).rows, originalApps);
  await db.exec("set role authenticated");

  await t.test("all pre-existing counts and applied cohorts stay unchanged", async () => {
    const withoutTiming = result => {
      const { interview_scheduling_sample_count, avg_days_to_interview_scheduled, ...cohort } = result.applied_cohort;
      return { ...result, applied_cohort: cohort };
    };
    await actor("manager");
    assert.deepEqual(withoutTiming(await counts()), oldWeek);
    assert.deepEqual(withoutTiming(await counts(from, "2026-10-01")), oldMonth);
    await actor("applier");
    assert.deepEqual(withoutTiming(await counts()), oldApplier);
  });
  await t.test("3, 5 and 7 days average to 5; missing and negative first entries aren't replaced", async () => {
    await actor("applier");
    const cohort = (await counts()).applied_cohort;
    assert.equal(cohort.applied_count, 10);
    assert.equal(cohort.interviewed_count, 8);
    assert.equal(cohort.interview_scheduling_sample_count, 3);
    assert.equal(cohort.avg_days_to_interview_scheduled, 5);
    const laterInterview = (await counts("2026-09-03", "2026-09-04")).applied_cohort;
    assert.equal(laterInterview.interview_scheduling_sample_count, 1);
    assert.equal(laterInterview.avg_days_to_interview_scheduled, 7);
  });
  await t.test("manager and assignee visibility constrain numerator and sample equally", async () => {
    await actor("manager");
    const cohort = (await counts()).applied_cohort;
    assert.equal(cohort.interview_scheduling_sample_count, 5);
    assert.equal(cohort.avg_days_to_interview_scheduled, 4.2);
    assert.deepEqual((await counts("2026-08-31T20:00:00-04:00", "2026-09-07T20:00:00-04:00")).applied_cohort, cohort);
    await actor("applier", 202);
    assert.equal((await counts()).applied_cohort.avg_days_to_interview_scheduled, 2);
    await actor("applier", 203);
    assert.equal((await counts()).applied_cohort.interview_scheduling_sample_count, 0);
    assert.equal((await counts()).applied_cohort.avg_days_to_interview_scheduled, null);
  });
  await t.test("same-time and sub-day samples are valid and duration uses elapsed time across DST", async () => {
    await db.exec("reset role");
    await insertApp(100, "INTERVIEW_SCHEDULED", "2026-01-01T12:00:00Z");
    await history(100, "2026-01-01T12:00:00Z", "STATUS", null);
    await insertApp(101, "INTERVIEW_SCHEDULED", "2026-01-02T00:00:00Z");
    await history(101, "2026-01-02T12:00:00Z");
    await insertApp(102, "INTERVIEW_SCHEDULED", "2026-03-08T01:30:00-05:00");
    await history(102, "2026-03-09T01:30:00-04:00");
    await db.exec("set role authenticated");
    await actor("applier");
    assert.equal((await counts("2026-01-01", "2026-01-02")).applied_cohort.avg_days_to_interview_scheduled, 0);
    assert.equal((await counts("2026-01-01", "2026-01-03")).applied_cohort.avg_days_to_interview_scheduled, 0.25);
    assert.ok(Math.abs((await counts("2026-03-08", "2026-03-10")).applied_cohort.avg_days_to_interview_scheduled - 23 / 24) < 1e-10);
  });
  await t.test("no applications or usable scheduling entries return null, not a fabricated zero", async () => {
    await actor("applier");
    for (const [start, end] of [["2025-01-01", "2025-01-02"], ["2026-09-04", "2026-09-05"], ["2026-09-07", "2026-09-08"]]) {
      const cohort = (await counts(start, end)).applied_cohort;
      assert.equal(cohort.interview_scheduling_sample_count, 0);
      assert.equal(cohort.avg_days_to_interview_scheduled, null);
    }
  });
  await t.test("inactive, unrelated and anonymous callers and invalid date ranges remain rejected", async () => {
    for (const [role, number, active] of [["applier", 201, false], ["manager", 201, false], ["other", 201, true], ["applier", null, true]]) {
      await actor(role, number, active);
      await assert.rejects(counts, /APPLICATION_ACCESS_DENIED/);
    }
    await db.exec("set role anon");
    await assert.rejects(counts, /permission denied/);
    await db.exec("set role authenticated");
    await actor("manager");
    for (const [start, end] of [[null, to], [from, null], [to, from], [from, from], ["2025-01-01", "2026-09-01"]]) {
      await assert.rejects(() => counts(start, end), /OVERVIEW_DATE_RANGE_INVALID/);
    }
  });
});
