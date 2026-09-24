import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(new URL(
  "../supabase/migrations/202609231600_v3_110_application_scoped_blocking.sql", import.meta.url,
), "utf8");
const id = (n) => String(n).padStart(32, "0").replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5");

test("application blocking remains local and enforces ownership", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create schema auth;
    create function auth.uid() returns uuid language sql as $$
      select nullif(current_setting('test.actor', true), '')::uuid
    $$;
    create function public.is_active_user(uuid) returns boolean language sql as $$
      select $1 is not null and current_setting('test.active', true) = 'true'
    $$;
    create function public.has_role(text, uuid) returns boolean language sql as $$
      select $2 is not null and current_setting('test.role', true) = $1
    $$;
    create function public.application_actor_can_manage() returns boolean language sql as $$
      select public.is_active_user(auth.uid()) and current_setting('test.role', true) = 'ADMIN'
    $$;
    create table public.applications(
      id uuid primary key, job_description_id uuid, assigned_to uuid, status text,
      notes text, application_url text, applied_at timestamptz, priority text,
      due_at timestamptz, updated_at timestamptz
    );
    create table public.job_descriptions(
      id uuid primary key, application_blocked_at timestamptz,
      application_blocked_by uuid, application_blocked_notes text,
      application_blocked_from_application_id uuid, updated_at timestamptz
    );
    create table public.application_status_history(
      application_id uuid, status_type text, previous_status text, new_status text,
      changed_by uuid, notes text
    );
    create table public.application_screenshots(application_id uuid);
    create function public.cancel_sibling_applications_for_blocked_job_v385(uuid, uuid, uuid, text)
      returns integer language sql as $$ select 1 $$;
    insert into job_descriptions values ('${id(100)}',null,null,'',null,null);
    insert into job_descriptions values ('${id(101)}',now(),'${id(1)}','Legacy block','${id(2)}',now());
    insert into applications values
      ('${id(1)}','${id(100)}','${id(10)}','ASSIGNED','Existing note',null,null,'NORMAL',null,null),
      ('${id(2)}','${id(100)}','${id(20)}','ASSIGNED','Other owner',null,null,'NORMAL',null,null),
      ('${id(3)}','${id(100)}','${id(10)}','ASSIGNED','Same owner, other application',null,null,'NORMAL',null,null),
      ('${id(4)}','${id(100)}',null,'UNASSIGNED',null,null,null,'NORMAL',null,null),
      ('${id(5)}','${id(100)}','${id(20)}','IN_PROGRESS',null,null,null,'NORMAL',null,null),
      ('${id(6)}','${id(100)}','${id(20)}','BLOCKED','Existing blocker',null,null,'NORMAL',null,null),
      ('${id(7)}','${id(100)}','${id(20)}','APPLIED',null,null,now(),'NORMAL',null,null),
      ('${id(8)}','${id(100)}','${id(20)}','CANCELLED','Historical cancellation',null,null,'NORMAL',null,null),
      ('${id(9)}','${id(101)}','${id(10)}','ASSIGNED',null,null,null,'NORMAL',null,null);
    select set_config('test.actor','${id(10)}',false);
    select set_config('test.role','APPLIER',false);
    select set_config('test.active','true',false);
  `);
  const rows = async (table) => (await db.query(`select * from ${table} order by id`)).rows;
  const originalJobs = await rows("job_descriptions");
  const originalApplications = await rows("applications");
  await db.exec(migration);
  assert.deepEqual(await rows("applications"), originalApplications, "migration must not restore historical cancellations");
  assert.deepEqual(await rows("job_descriptions"), originalJobs, "historical or explicit JD blocks remain unchanged");
  assert.equal((await db.query("select to_regprocedure('public.cancel_sibling_applications_for_blocked_job_v385(uuid,uuid,uuid,text)') as fn")).rows[0].fn, null);
  const update = async (n, status = "BLOCKED", notes = "Sign-in issue") => {
    const { rows } = await db.query(`select public.update_application_status_v101(
      $1::uuid,$2::text,null,null,$3::text,'NORMAL',null
    ) as result`, [id(n), status, notes]);
    return rows[0].result;
  };

  await t.test("applier blocks own application, not siblings or JD, and records history", async () => {
    const result = await update(1);
    assert.equal(result.status, "BLOCKED");
    assert.equal(result.job_application_blocked, false);
    assert.equal(result.siblings_cancelled, 0);
    assert.deepEqual((await rows("applications")).slice(1), originalApplications.slice(1));
    assert.deepEqual(await rows("job_descriptions"), originalJobs);
    assert.deepEqual((await db.query("select * from application_status_history")).rows, [{
      application_id: id(1), status_type: "STATUS", previous_status: "ASSIGNED",
      new_status: "BLOCKED", changed_by: id(10), notes: "Sign-in issue",
    }]);
    await update(1, "BLOCKED", "Updated note");
    assert.equal((await db.query("select count(*)::int as n from application_status_history")).rows[0].n, 1);
  });

  await t.test("appliers cannot block someone else's application, cancel, or omit block notes", async () => {
    await assert.rejects(() => update(2), /APPLICATION_ACCESS_DENIED/);
    await assert.rejects(() => update(3, "CANCELLED"), /APPLICATION_PROTECTED_FIELDS/);
    await assert.rejects(() => update(3, "BLOCKED", " "), /APPLICATION_NOTES_REQUIRED/);
    await db.exec("select set_config('test.active','false',false)");
    await assert.rejects(() => update(3), /APPLICATION_ACCESS_DENIED/);
    await db.exec("select set_config('test.active','true',false)");
    assert.deepEqual((await rows("applications")).slice(1), originalApplications.slice(1));
  });

  await t.test("existing JD blocks do not cause new cancellations", async () => {
    const result = await update(9);
    assert.equal(result.job_application_blocked, true);
    assert.equal(result.siblings_cancelled, 0);
    assert.deepEqual(await rows("job_descriptions"), originalJobs);
  });

  await t.test("manager blocking is also local; explicit manual cancellation remains available", async () => {
    await db.exec("select set_config('test.role','ADMIN',false)");
    const before = await rows("applications");
    await update(2);
    assert.deepEqual((await rows("applications")).filter((a) => a.id !== id(2)), before.filter((a) => a.id !== id(2)));
    assert.deepEqual(await rows("job_descriptions"), originalJobs);
    assert.equal((await update(3, "CANCELLED", "Manager cancelled explicitly")).status, "CANCELLED");
  });
});
