import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  new URL("../supabase/migrations/202609151400_v3_85_block_jd_on_application_blocked.sql", import.meta.url),
  "utf8",
);

test("v385 blocks the JD when an Application becomes BLOCKED", () => {
  assert.match(sql, /application_blocked_at timestamptz/);
  assert.match(sql, /application_blocked_notes text not null default ''/);
  assert.match(sql, /cancel_sibling_applications_for_blocked_job_v385/);
  assert.match(sql, /if v_updated\.status = 'BLOCKED' and v_current\.status is distinct from 'BLOCKED'/);
  assert.match(sql, /siblings_cancelled/);
  assert.match(sql, /job_application_blocked/);
  assert.match(sql, /if v_status = 'BLOCKED' and v_notes is null/);
});

test("v385 gates create and matching against application-blocked JDs", () => {
  assert.match(sql, /APPLICATION_JOB_BLOCKED/);
  assert.match(sql, /job_description_open_for_applications/);
  assert.match(sql, /j\.application_blocked_at is null/);
  assert.match(sql, /code := 'APPLICATION_JOB_BLOCKED'/);
  assert.match(sql, /unblock_job_description_applications_v385/);
});

test("API and UI surface unblock plus block messaging", () => {
  const api = readFileSync(new URL("../apps/api/src/job-descriptions/job-description-read.controller.ts", import.meta.url), "utf8");
  const service = readFileSync(new URL("../apps/api/src/applications/application.service.ts", import.meta.url), "utf8");
  const modal = readFileSync(new URL("../extension/sidepanel/components/ApplicationStatusModal.jsx", import.meta.url), "utf8");
  const progress = readFileSync(new URL("../dashboard/src/features/applications/application-pages.jsx", import.meta.url), "utf8");
  assert.match(api, /application-unblock/);
  assert.match(service, /jobApplicationBlocked/);
  assert.match(service, /siblingsCancelled/);
  assert.match(modal, /Blocking removes this job for all profiles/);
  assert.match(progress, /Unblock job for Applications/);
});
