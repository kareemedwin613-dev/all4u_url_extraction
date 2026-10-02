import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(
  new URL("../supabase/migrations/202610011800_v3_145_interview_category_color.sql", import.meta.url),
  "utf8",
);

test("interview records expose the primary category shared by the job and the resume", () => {
  assert.match(sql, /'categorySlug'/);
  assert.match(sql, /j\.category_id/);
  assert.match(sql, /resume_tech_stacks/);
  assert.match(sql, /c\.parent_id is null/);
});
