import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pairTechStacks, matchingTechStacks } from "../extension/shared/tech-stacks.js";

const sql = await readFile(new URL("../supabase/migrations/202609031235_v3_57_resume_tech_stacks.sql", import.meta.url), "utf8");

test("v3.57 creates resume_tech_stacks and multi-category match helpers", () => {
  assert.match(sql, /create table if not exists public\.resume_tech_stacks/);
  assert.match(sql, /resume_has_primary_category/);
  assert.match(sql, /replace_resume_tech_stacks_v357/);
  assert.match(sql, /resume_has_primary_category\(resumes\.id, loaded\.category_id\)/);
  assert.match(sql, /not public\.resume_has_primary_category\(resumes\.id, jobs\.category_id\)/);
});

test("pairTechStacks keeps subcategories under their primary parents", () => {
  const parentById = new Map([
    ["ai", null],
    ["full", null],
    ["nlp", "ai"],
    ["react", "full"],
  ]);
  assert.deepEqual(
    pairTechStacks(["ai", "full"], ["nlp", "react"], parentById),
    [
      { primaryCategoryId: "ai", subcategoryId: "nlp" },
      { primaryCategoryId: "full", subcategoryId: "react" },
    ],
  );
});

test("matchingTechStacks accepts any matching primary category", () => {
  const stacks = matchingTechStacks(
    { categoryId: "full" },
    {
      tech_stacks: [
        { primary_category_id: "ai", subcategory_id: "nlp" },
        { primary_category_id: "full", subcategory_id: null },
      ],
    },
  );
  assert.equal(stacks.length, 1);
  assert.equal(stacks[0].primaryCategoryId, "full");
});
