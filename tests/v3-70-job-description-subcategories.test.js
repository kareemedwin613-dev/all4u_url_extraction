import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(
  new URL("../supabase/migrations/202609101400_v3_70_job_description_subcategories.sql", import.meta.url),
  "utf8",
);

test("v3.70 creates job_description_subcategories junction and replace helper", () => {
  assert.match(sql, /create table if not exists public\.job_description_subcategories/);
  assert.match(sql, /replace_job_description_subcategories/);
  assert.match(sql, /Software Engineering jobs require at least one subcategory/);
  assert.match(sql, /p_enforce_se_required/);
});

test("v3.70 bulk match uses ANY JD subcategory via job id", () => {
  assert.match(sql, /resume_matches_job_for_bulk/);
  assert.match(sql, /job_description_subcategories jds/);
  assert.match(sql, /jds\.subcategory_id = s\.subcategory_id/);
  assert.match(sql, /resume_matches_job_for_bulk\(resumes\.id, loaded\.category_id, loaded\.id\)/);
  assert.match(sql, /resume_matches_job_for_bulk\(resumes\.id, jobs\.category_id, jobs\.id\)/);
  assert.match(sql, /else public\.resume_has_primary_category\(p_resume_id, p_category_id\)/);
});

test("v3.70 edit and capture RPCs sync subcategory_ids", () => {
  assert.match(sql, /p_subcategory_ids uuid\[] default null/);
  assert.match(sql, /update_my_job_description_v31/);
  assert.match(sql, /manager_update_job_description_v312/);
  assert.match(sql, /subcategory_ids/);
  assert.match(sql, /capture_job_description_v353/);
});
