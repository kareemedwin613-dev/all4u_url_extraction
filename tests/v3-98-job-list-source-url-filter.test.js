import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../supabase/migrations/202609161500_v3_98_job_list_source_url_filter.sql", import.meta.url),
  "utf8",
);

test("v3.98 adds Job Posting URL filter to the JD list RPC", () => {
  assert.match(migration, /p_source_url text default null/);
  assert.match(migration, /strpos\(lower\(coalesce\(j\.source_url/);
  assert.match(migration, /normalized_source_url/);
});
