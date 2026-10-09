import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(new URL("../supabase/migrations/202610091400_v3_169_application_list_applied_sort.sql", import.meta.url), "utf8");
const service = await readFile(new URL("../apps/api/src/applications/application.service.ts", import.meta.url), "utf8");
const dto = await readFile(new URL("../apps/api/src/applications/application.dto.ts", import.meta.url), "utf8");

test("applications list opens newest applied date first", () => {
  assert.match(sql, /p_sort text default 'applied_desc'/);
  assert.match(sql, /coalesce\(p_sort,'applied_desc'\)/);
  assert.match(sql, /'applied_asc','applied_desc'/);
  assert.match(sql, /v_sort='applied_desc' then applied_at end desc nulls last/);
  assert.match(service, /p_sort:q\.sort\|\|"applied_desc"/);
  assert.match(dto, /sort="applied_desc"/);
});
