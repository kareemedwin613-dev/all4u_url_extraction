import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(new URL("../supabase/migrations/202609301200_v3_131_applier_assigned_sort.sql", import.meta.url), "utf8");
const view = readFileSync(new URL("../extension/sidepanel/views/MyApplicationsView.jsx", import.meta.url), "utf8");

test("extension lists previously assigned applications ahead of later work", () => {
  assert.match(sql, /'assigned_asc'/);
  assert.match(sql, /when status in \('ASSIGNED', 'IN_PROGRESS'\) then 0/);
  assert.match(sql, /when status = 'BLOCKED' then 1/);
  assert.match(sql, /case when v_sort = 'assigned_asc' then assigned_at end asc/);
  assert.match(sql, /new_assignee_id = auth\.uid\(\)/);
  assert.match(view, /sort: "assigned_asc"/);
  assert.doesNotMatch(view, /sort: "captured_desc"/);
});
