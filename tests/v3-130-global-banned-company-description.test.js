import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(new URL("../supabase/migrations/202609282000_v3_130_global_banned_company_description.sql", import.meta.url), "utf8");
const page = readFileSync(new URL("../dashboard/src/features/banned-companies/banned-companies-page.jsx", import.meta.url), "utf8");

test("global banned companies store why the company is banned", () => {
  assert.match(sql, /add column if not exists description text/);
  assert.match(sql, /add_global_banned_company_v3130\(p_company_name text, p_description text\)/);
  assert.match(sql, /update_global_banned_company_v3130\(p_id uuid, p_description text\)/);
  assert.match(sql, /'description', b\.description/);
  assert.match(sql, /char_length\(v_description\) < 1 or char_length\(v_description\) > 500/);
});

test("banned companies page shows and edits the description", () => {
  assert.match(page, /title: "Description"/);
  assert.match(page, /Why is this company banned\?/);
  assert.match(page, /updateGlobalBannedCompany/);
});
