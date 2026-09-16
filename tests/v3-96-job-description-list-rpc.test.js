import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../supabase/migrations/202609161300_v3_96_job_description_list_rpc.sql", import.meta.url),
  "utf8",
);

test("v3.96 serves Job Description pages through a scoped list RPC", () => {
  assert.match(migration, /list_job_descriptions_v396/);
  assert.match(migration, /job_descriptions_status_created_idx/);
  assert.match(migration, /has_role\('JD_FINDER'/);
  assert.match(migration, /has_role\('APPLIER'/);
  assert.match(migration, /list_job_description_capturers/);
  assert.match(migration, /v_applier\s+and exists/i);
  assert.doesNotMatch(migration, /has_any_role\(array\['APPLIER','APPLYING_MANAGER','ADMIN'\]\)/);
});
