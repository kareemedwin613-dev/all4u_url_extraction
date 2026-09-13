import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  applicationTechStackIds,
  applicationTechStackLabels,
} from "../dashboard/src/services/category-service.js";

const sql = await readFile(
  new URL("../supabase/migrations/202609121200_v3_80_dedupe_resume_primary_categories.sql", import.meta.url),
  "utf8",
);

test("v3.80 dedupes resume primary category helpers in SQL", () => {
  assert.match(sql, /select distinct on \(s\.primary_category_id\)/);
  assert.match(sql, /create or replace function public\.resume_primary_category_names/);
  assert.match(sql, /create or replace function public\.resume_primary_category_ids/);
});

test("applicationTechStack helpers collapse duplicate primary categories", () => {
  const record = {
    resume_category_ids: ["se", "se", "se", "data"],
    resume_category_names: [
      "Software Engineering",
      "Software Engineering",
      "Software Engineering",
      "Data Science",
    ],
  };
  assert.deepEqual(applicationTechStackIds(record), ["se", "data"]);
  assert.deepEqual(applicationTechStackLabels(record), [
    "Software Engineering",
    "Data Science",
  ]);
});
