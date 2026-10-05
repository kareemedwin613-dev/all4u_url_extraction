import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(new URL("../supabase/migrations/202610051700_v3_150_application_list_feedback_text.sql", import.meta.url), "utf8");
const service = await readFile(new URL("../apps/api/src/applications/application.service.ts", import.meta.url), "utf8");
const page = await readFile(new URL("../dashboard/src/features/applications/application-pages.jsx", import.meta.url), "utf8");

test("application list can search screenshot review feedback text", () => {
  assert.match(sql, /p_screenshot_feedback_text text default ''/);
  assert.match(sql, /v_feedback = 'HAS_FEEDBACK'/);
  assert.match(sql, /a\.screenshot_feedback ilike/);
  assert.match(sql, /p_screenshot_feedback_text => p_screenshot_feedback_text/);
  assert.match(sql, /drop function if exists public\.list_applications_v360\(text, uuid, text, text, text, text, uuid, text, text, uuid, text, text, text, text, text, uuid, uuid, timestamptz, timestamptz, integer, integer\)/);
  assert.match(service, /p_screenshot_feedback_text:q\.screenshotFeedback==="HAS_FEEDBACK"\?\(q\.screenshotReviewFeedback\|\|""\):""/);
  assert.match(page, /Screenshot review feedback/);
  assert.match(page, /filters\.screenshotFeedback === "HAS_FEEDBACK"/);
});
