import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(
  new URL("../supabase/migrations/202609100800_v3_68_bulk_se_subcategory_match.sql", import.meta.url),
  "utf8",
);

test("v3.68 requires Software Engineering subcategory match for bulk create when JD subcategory is set", () => {
  assert.match(sql, /resume_matches_job_for_bulk/);
  assert.match(sql, /slug = 'software-engineering'/);
  assert.match(sql, /s\.subcategory_id = p_subcategory_id/);
  assert.match(sql, /resume_matches_job_for_bulk\(resumes\.id, loaded\.category_id, loaded\.subcategory_id\)/);
  assert.match(sql, /resume_matches_job_for_bulk\(resumes\.id, jobs\.category_id, jobs\.subcategory_id\)/);
  assert.match(sql, /Software Engineering also requires matching subcategory/);
  assert.match(sql, /else public\.resume_has_primary_category\(p_resume_id, p_category_id\)/);
});
