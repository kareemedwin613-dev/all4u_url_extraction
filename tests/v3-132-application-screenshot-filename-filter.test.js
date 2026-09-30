import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(
  new URL("../supabase/migrations/202609301300_v3_132_application_screenshot_filename_filter.sql", import.meta.url),
  "utf8",
);
const page = await readFile(
  new URL("../dashboard/src/features/applications/application-pages.jsx", import.meta.url),
  "utf8",
);
const service = await readFile(
  new URL("../apps/api/src/applications/application.service.ts", import.meta.url),
  "utf8",
);

test("v3.132 filters Applications by screenshot file name", () => {
  assert.match(sql, /p_screenshot_filename text default ''/);
  assert.match(sql, /shots\.original_filename ilike '%' \|\| v_screenshot_filename \|\| '%'/);
  assert.match(sql, /p_screenshot_filename => p_screenshot_filename/);
  assert.match(sql, /drop function if exists public\.list_applications_v360\(text, uuid, text, text, text, text, uuid, text, text, uuid, text, text, text, text, integer, integer\)/);
});

test("Applications filter panel searches by screenshot file name", () => {
  assert.match(page, /Screenshot file name/);
  assert.match(page, /screenshotFilename: screenshotFilename\.trim\(\)\.slice\(0, 100\)/);
});

test("Application list forwards screenshot file name only when set", () => {
  assert.match(service, /q\.screenshotFilename\?\{p_screenshot_filename:q\.screenshotFilename\}/);
});
