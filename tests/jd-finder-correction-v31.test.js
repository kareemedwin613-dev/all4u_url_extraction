import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../supabase/migrations/202608140059_v3_1_jd_finder_corrections.sql", import.meta.url), "utf8");
const controller = readFileSync(new URL("../apps/api/src/job-descriptions/job-description-read.controller.ts", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../dashboard/src/App.jsx", import.meta.url), "utf8");
const extensionApp = readFileSync(new URL("../extension/sidepanel/App.jsx", import.meta.url), "utf8");
const extensionView = readFileSync(new URL("../extension/sidepanel/views/MyJobDescriptionsView.jsx", import.meta.url), "utf8");

test("v3.1 correction RPC is owner-scoped and locks final review states", () => {
  assert.match(migration, /user_id=v_actor for update/i);
  assert.match(migration, /review_status not in \('NEEDS_REVIEW','NEEDS_CORRECTION'\)/i);
  assert.match(migration, /has_role\('JD_FINDER',v_actor\)/i);
  assert.match(migration, /JOB_DUPLICATE/i);
  assert.doesNotMatch(migration, /review_status\s*=\s*p_/i);
  assert.match(migration, /revoke all on function public\.update_my_job_description_v31[\s\S]*from public,anon/i);
});

test("JD Finder can list and correct pending captures in the extension", () => {
  assert.match(extensionApp, /"my-jds"/);
  assert.match(extensionApp, /canListOwnJobs/);
  assert.match(extensionView, /My JDs/);
  assert.match(extensionView, /NEEDS_REVIEW/);
  assert.match(extensionView, /NEEDS_CORRECTION/);
  assert.match(extensionView, /updateOwnJob/);
  assert.match(extensionView, /Approved JDs are locked/);
});

test("JD Finder correction is exposed through the authenticated backend and edit UI", () => {
  assert.match(controller, /@Patch\(":id\/correction"\)/);
  assert.match(controller, /@RequireRoles\("JD_FINDER"\)/);
  assert.match(dashboard, /Edit my JD/);
  assert.match(dashboard, /NEEDS_REVIEW[\s\S]*NEEDS_CORRECTION/);
  assert.match(dashboard, /updateOwnJob/);
});

test("dashboard job detail exposes manager review decisions", () => {
  assert.match(dashboard, /reviewJob/);
  assert.match(dashboard, /submitReview\("APPROVED"\)/);
  assert.match(dashboard, /Needs correction/);
  assert.match(dashboard, /Decline review/);
  assert.match(controller, /@Patch\(":id\/review"\)/);
});
