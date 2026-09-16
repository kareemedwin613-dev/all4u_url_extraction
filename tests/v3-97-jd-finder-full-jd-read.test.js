import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../supabase/migrations/202609161400_v3_97_jd_finder_full_jd_read.sql", import.meta.url),
  "utf8",
);

test("v3.97 grants JD Finders shared Job Description read like managers", () => {
  assert.match(migration, /has_any_role\(array\['APPLYING_MANAGER','ADMIN','JD_FINDER'\]\)/);
  assert.match(migration, /drop policy if exists "jd finders read own jobs"/);
  assert.match(migration, /v_shared_reader boolean := public\.has_any_role\(array\['APPLYING_MANAGER', 'ADMIN', 'JD_FINDER'\]/);
  assert.match(migration, /list_job_description_capturers/);
  assert.doesNotMatch(migration, /v_finder and j\.user_id = v_actor/);
});
