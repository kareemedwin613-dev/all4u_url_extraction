import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const readMigration = name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
const id = number => `00000000-0000-0000-0000-${String(number).padStart(12, "0")}`;
const from = "2026-09-01T00:00:00Z", to = "2026-09-08T00:00:00Z";

test("applied-cohort conversion SQL preserves reporting and visibility rules", async t => {
  const db = new PGlite();
  t.after(() => db.close());
  // Minimal surrounding schema; execute the real old/new reporting functions.
  await db.exec(`
    create role anon;
    create role authenticated;
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
    insert into public.resumes values ('${id(101)}', 'ORIGINAL'), ('${id(102)}', 'TAILORED');
  `);
  const fixtures = [
    [1, "APPLIED", "2026-09-01T00:00:00Z", 201], // inclusive start; created before range
    [2, "REJECTED", "2026-09-02T12:00:00Z", 201], // two later interview rounds
    [3, "INTERVIEW_SCHEDULED", "2026-09-03T12:00:00Z", 202], // current status, no history
    [4, "INTERVIEW_SCHEDULED", "2026-08-31T23:59:59.999Z", 201], // interview in range, apply outside
    [5, "INTERVIEW_SCHEDULED", "2026-09-08T00:00:00Z", 201], // exclusive end
    [6, "INTERVIEW_SCHEDULED", null, 201], // no applied date
    [7, "OFFER_RECEIVED", "2026-09-05T12:00:00Z", 201], // no inferred interview
    [8, "CLOSED", "2026-09-06T12:00:00Z", 201], // legacy history leaving interview
    [9, "INTERVIEW_SCHEDULED", "2026-09-07T23:59:59.999Z", null], // unassigned, visible to manager
    [10, "REJECTED", "2026-09-04T12:00:00Z", 201], // unrelated WORK_STATUS must not count
  ];
  for (const [number, status, applied, actor] of fixtures) {
    await db.query(`insert into public.applications values ($1,$2,$3,$4,$5,'2026-08-01','2026-09-03',null)`,
      [id(number), id(number % 2 ? 101 : 102), actor ? id(actor) : null, status, applied]);
  }
  for (const [number, type, previous, next, at] of [
    [2, "STATUS", "APPLIED", "INTERVIEW_SCHEDULED", "2026-09-12"],
    [2, "STATUS", "SCREENING", "INTERVIEW_SCHEDULED", "2026-09-13"],
    [2, "STATUS", "INTERVIEW_SCHEDULED", "REJECTED", "2026-09-14"],
    [4, "STATUS", "APPLIED", "INTERVIEW_SCHEDULED", "2026-09-03"],
    [8, "APPLICATION_STATUS", "INTERVIEW_SCHEDULED", "CLOSED", "2026-09-13"],
    [10, "WORK_STATUS", "IN_PROGRESS", "INTERVIEW_SCHEDULED", "2026-09-13"],
  ]) {
    await db.query("insert into public.application_status_history values ($1,$2,$3,$4,$5)", [id(number), type, previous, next, at]);
  }
  const actor = async (role, number = 201, active = true) => {
    await db.query("select set_config('test.role',$1,false), set_config('test.actor',$2,false), set_config('test.active',$3,false)",
      [role, number ? id(number) : "", String(active)]);
  };
  const counts = async (start = from, end = to) => (await db.query(
    "select public.get_application_counts_v29($1::timestamptz,$2::timestamptz) as value", [start, end])).rows[0].value;

  const previous = await readMigration("202609151920_v3_92_applied_means_submitted_in_period.sql");
  await db.exec(previous.split("create or replace function public.get_business_overview_v31")[0]);
  await actor("manager");
  const oldWeek = await counts(), oldMonth = await counts(from, "2026-10-01T00:00:00Z");
  await actor("applier");
  const oldApplier = await counts();
  const migration = await readMigration("202609161100_v3_95_applied_interview_conversion.sql");
  await db.exec(migration);
  await db.exec("set role authenticated");

  await t.test("all existing fields are unchanged for short/long windows and Appliers", async () => {
    const withoutCohort = ({ applied_cohort, ...rest }) => rest;
    await actor("manager");
    assert.deepEqual(withoutCohort(await counts()), oldWeek);
    assert.deepEqual(withoutCohort(await counts(from, "2026-10-01T00:00:00Z")), oldMonth);
    await actor("applier");
    assert.deepEqual(withoutCohort(await counts()), oldApplier);
  });
  await t.test("only applied dates select applications; later interviews count once", async () => {
    await actor("manager");
    const result = await counts();
    assert.deepEqual(result.applied_cohort, { applied_count: 7, interviewed_count: 4 });
    assert.equal(result.applied_cohort.applied_count, result.applied_count);
    assert.deepEqual((await counts("2026-09-02T00:00:00Z", "2026-09-03T00:00:00Z")).applied_cohort,
      { applied_count: 1, interviewed_count: 1 });
    assert.deepEqual((await counts(from, "2026-10-01T00:00:00Z")).applied_cohort,
      { applied_count: 8, interviewed_count: 5 });
  });
  await t.test("timezone-equivalent boundaries produce the same cohort", async () => {
    assert.deepEqual((await counts("2026-08-31T20:00:00-04:00", "2026-09-07T20:00:00-04:00")).applied_cohort,
      (await counts()).applied_cohort);
  });
  await t.test("Appliers cannot count another assignee or unassigned applications", async () => {
    await actor("applier", 201);
    assert.deepEqual((await counts()).applied_cohort, { applied_count: 5, interviewed_count: 2 });
    await actor("applier", 202);
    assert.deepEqual((await counts()).applied_cohort, { applied_count: 1, interviewed_count: 1 });
    await actor("applier", 203);
    assert.deepEqual((await counts()).applied_cohort, { applied_count: 0, interviewed_count: 0 });
  });
  await t.test("zero applications returns zero counts", async () => {
    await actor("manager");
    assert.deepEqual((await counts("2025-01-01", "2025-02-01")).applied_cohort,
      { applied_count: 0, interviewed_count: 0 });
  });
  await t.test("inactive, unauthenticated and unrelated roles are denied", async () => {
    for (const [role, user, active] of [["manager", 201, false], ["applier", 201, false], ["other", 201, true], ["applier", null, true]]) {
      await actor(role, user, active);
      await assert.rejects(counts, /APPLICATION_ACCESS_DENIED/);
    }
    await db.exec("set role anon");
    await assert.rejects(counts, /permission denied/);
    await db.exec("set role authenticated");
  });
  await t.test("invalid and oversized reporting windows are still rejected", async () => {
    await actor("manager");
    for (const [start, end] of [[null, to], [from, null], [to, from], [from, from], ["2025-01-01", "2026-09-01"]]) {
      await assert.rejects(() => counts(start, end), /OVERVIEW_DATE_RANGE_INVALID/);
    }
  });
});
