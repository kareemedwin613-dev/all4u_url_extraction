import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../supabase/migrations/202609161200_v3_95_jd_finder_subcategory_read.sql", import.meta.url),
  "utf8",
);

test("v3.95 lets JD Finders read subcategory rows for their own captures", () => {
  assert.match(migration, /create or replace function public\.job_description_actor_can_view/);
  assert.match(migration, /has_role\('JD_FINDER'\)/);
  assert.match(migration, /j\.user_id = \(select auth\.uid\(\)\)/);
  assert.match(migration, /create policy "role scoped read job description subcategories"/);
  assert.match(migration, /a\.assigned_to = \(select auth\.uid\(\)\)/);
  assert.doesNotMatch(
    migration,
    /using \(\(select public\.job_description_actor_can_view\(job_description_id\)\)\);/,
  );
});
