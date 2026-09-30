import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(
  new URL("../supabase/migrations/202609301500_v3_136_application_list_page_first.sql", import.meta.url),
  "utf8",
);
const repair = await readFile(
  new URL("../supabase/migrations/202609301600_v3_137_application_list_return_page.sql", import.meta.url),
  "utf8",
);

test("application list computes screenshot and tech-stack fields after paging", () => {
  const filtered = sql.slice(sql.indexOf("with filtered as"), sql.indexOf("), ranked as"));
  const paged = sql.slice(sql.indexOf("), paged as"));
  assert.doesNotMatch(filtered, /screenshot_count/);
  assert.doesNotMatch(filtered, /resume_primary_category_ids/);
  assert.match(filtered, /category_asc/);
  assert.match(paged, /screenshot_count/);
  assert.match(paged, /resume_primary_category_ids\(ranked\.resume_id\)/);
  assert.match(paged, /resume_primary_category_names\(ranked\.resume_id\)/);
  assert.match(paged, /page_rank > v_offset/);
  assert.match(sql, /screenshot_review_status/);
  assert.match(sql, /return jsonb_build_object\('items',v_items,'total',v_total,'limit',v_limit,'offset',v_offset\)/);
  assert.match(repair, /return jsonb_build_object\('items',v_items,'total',v_total,'limit',v_limit,'offset',v_offset\)/);
  assert.match(repair, /page_rank > v_offset/);
});
