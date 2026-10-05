import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(new URL("../supabase/migrations/202610021400_v3_148_application_list_reviewers.sql", import.meta.url), "utf8");
const page = await readFile(new URL("../dashboard/src/features/applications/application-pages.jsx", import.meta.url), "utf8");

test("application list returns and filters profile reviewers", () => {
  assert.match(sql, /p_primary_reviewer_id uuid default null/);
  assert.match(sql, /p_secondary_reviewer_id uuid default null/);
  assert.match(sql, /p_applied_from timestamptz default null/);
  assert.match(sql, /p_applied_to timestamptz default null/);
  assert.match(sql, /a\.applied_at >= p_applied_from/);
  assert.match(sql, /a\.applied_at < p_applied_to/);
  assert.match(sql, /original_profile\.screenshot_primary_reviewer_id as primary_reviewer_id/);
  assert.match(sql, /nullif\(primary_reviewer\.full_name,''\) as primary_reviewer_name/);
  assert.match(sql, /original_profile\.screenshot_secondary_reviewer_id as secondary_reviewer_id/);
  assert.match(sql, /coalesce\(resumes\.parent_resume_id, resumes\.id\)/);
  assert.match(sql, /p_primary_reviewer_id = v_unassigned and original_profile\.screenshot_primary_reviewer_id is null/);
  assert.match(sql, /notify pgrst, 'reload schema'/);
});

test("applications page shows reviewer columns and filters", () => {
  assert.match(page, /Primary Reviewer/);
  assert.match(page, /Secondary Reviewer/);
  assert.match(page, /primaryReviewerId: primaryReviewerId \|\| ""/);
  assert.match(page, /reviewerTableColumn\("Primary Reviewer"/);
  assert.match(page, /reviewerTableColumn\("Secondary Reviewer"/);
});
