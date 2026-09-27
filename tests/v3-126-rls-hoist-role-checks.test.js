import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(new URL("../supabase/migrations/202609271100_v3_126_rls_hoist_role_checks.sql", import.meta.url), "utf8");
const policy = name => {
  const match = sql.match(new RegExp(`create policy "${name}"[\\s\\S]*?\\n\\);`));
  assert.ok(match, `missing policy ${name}`);
  return match[0];
};

test("applications and status history check the Manager role once, before the Applier row check", () => {
  for (const name of ["role scoped read applications", "role scoped read status history"]) {
    const body = policy(name);
    assert.match(body, /for select to authenticated/);
    assert.match(body, /using \(\s*\(select public\.application_actor_can_manage\(\)\)\s*or/);
    assert.match(body, /assigned_to = \(select auth\.uid\(\)\)/);
    assert.match(body, /\(select public\.is_active_user\(auth\.uid\(\)\)\)/);
    assert.match(body, /\(select public\.has_role\('APPLIER', auth\.uid\(\)\)\)/);
    assert.doesNotMatch(body, /application_actor_can_view\(/);
  }
});

test("resumes and tech stacks compute an Applier's visible Resume ids once per statement", () => {
  for (const [name, column] of [["role scoped read resumes", "id"], ["role scoped read resume tech stacks", "resume_id"]]) {
    const body = policy(name);
    assert.match(body, /for select to authenticated/);
    assert.match(body, /using \(\s*\(select public\.has_any_role\(array\['APPLYING_MANAGER','ADMIN'\]\)\)\s*or/);
    assert.match(body, /\(select public\.has_role\('APPLIER'\)\)\s*and \(select public\.is_active_user\(auth\.uid\(\)\)\)/);
    assert.match(body, new RegExp(`and ${column} in \\(select public\\.applier_visible_resume_ids_v126\\(\\)\\)`));
    assert.doesNotMatch(body, /resume_actor_can_view\(/);
  }
  assert.match(sql, /create or replace function public\.applier_visible_resume_ids_v126\(\)\s+returns setof uuid\s+language sql\s+stable\s+security definer\s+set search_path = public, pg_temp/);
  assert.match(sql, /where a\.assigned_to = auth\.uid\(\)\s+union\s+select linked\.parent_resume_id/);
  assert.match(sql, /revoke all on function public\.applier_visible_resume_ids_v126\(\) from public, anon;/);
});

test("each rewritten policy replaces its predecessor", () => {
  for (const [name, table] of [["role scoped read applications", "applications"], ["role scoped read status history", "application_status_history"], ["role scoped read resumes", "resumes"], ["role scoped read resume tech stacks", "resume_tech_stacks"]]) {
    assert.match(sql, new RegExp(`drop policy if exists "${name}" on public\\.${table};\\s*create policy "${name}" on public\\.${table}`));
  }
});
