import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(
  new URL("../supabase/migrations/202609101500_v3_71_bulk_job_subcategory_import.sql", import.meta.url),
  "utf8",
);

test("v3.71 manager bulk subcategory import RPC", () => {
  assert.match(sql, /manager_bulk_set_job_subcategories_v371/);
  assert.match(sql, /replace_job_description_subcategories/);
  assert.match(sql, /subcategories/);
  assert.match(sql, /Import at most 2000 rows/);
  assert.match(sql, /grant execute on function public\.manager_bulk_set_job_subcategories_v371/);
});
