import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  deriveProfileWorkloadStatus,
  normalizeApplierProfileWorkload,
  PROFILE_WORKLOAD_STATUS,
  summarizeProfileWorkloadKpis,
} from "../src/features/overview/applier-profile-workload.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Profile workload section appears on Applier Overview dashboard", async () => {
  const [app, page, table, model, sqlLatest, service, controller] = await Promise.all([
    read("../src/App.jsx"),
    read("../src/features/overview/applier-profile-workload-page.jsx"),
    read("../src/features/overview/applier-profile-workload-table.jsx"),
    read("../src/features/overview/applier-profile-workload.js"),
    read("../../supabase/migrations/202608270086_v3_26_profile_workload_by_resume.sql"),
    read("../../apps/api/src/applications/application.service.ts"),
    read("../../apps/api/src/applications/application.controller.ts"),
  ]);
  assert.match(app, /ApplierProfileWorkloadSection/);
  assert.match(app, /showProfileWorkload/);
  assert.match(app, /getApplierProfileWorkload\(client, apiBaseUrl, dateRange\)/);
  assert.match(app, /getApplicationCounts\(client, apiBaseUrl, dateRange\)/);
  assert.match(app, /<ApplierProfileWorkloadPage/);
  assert.match(page, /Activity Overview/);
  assert.match(page, /ActivityOverviewChart/);
  assert.match(table, /ApplierProfileWorkloadTable/);
  assert.match(table, /tableRowNumberColumn/);
  assert.doesNotMatch(table, /title: "Resume"/);
  assert.match(table, /"assigned", "applied", "blocked", "pending", "interview"/);
  assert.match(model, /deriveProfileWorkloadStatus/);
  assert.match(sqlLatest, /interview_count/);
  assert.match(service, /get_applier_resume_profile_workload_v31/);
  assert.match(controller, /profile-workload/);
});

test("normalizeApplierProfileWorkload maps overview rows for the profile chart", () => {
  const [row] = normalizeApplierProfileWorkload([
    {
      id: "r1",
      profile_name: "Michael Baqadi",
      resume_name: "Michael Baqadi Resume",
      applier_name: "Sami Ullah",
      total_count: 40,
      applied_count: 12,
      pending_count: 18,
      blocked_count: 4,
      interview_count: 3,
    },
  ]);
  assert.deepEqual(row, {
    id: "r1",
    name: "Michael Baqadi",
    resumeName: "Michael Baqadi Resume",
    applierName: "Sami Ullah",
    assigned: 40,
    applied: 12,
    pending: 18,
    blocked: 4,
    interview: 3,
    status: PROFILE_WORKLOAD_STATUS.NEEDS_ATTENTION.key,
  });
});

test("deriveProfileWorkloadStatus prioritizes blocked and pending application counts", () => {
  assert.equal(
    deriveProfileWorkloadStatus({ assigned: 5, applied: 0, pending: 2, blocked: 1, interview: 0 }),
    PROFILE_WORKLOAD_STATUS.NEEDS_ATTENTION.key,
  );
  assert.equal(
    deriveProfileWorkloadStatus({ assigned: 5, applied: 0, pending: 2, blocked: 0, interview: 0 }),
    PROFILE_WORKLOAD_STATUS.IN_PROGRESS.key,
  );
  assert.equal(
    deriveProfileWorkloadStatus({ assigned: 0, applied: 0, pending: 0, blocked: 0, interview: 0 }),
    PROFILE_WORKLOAD_STATUS.NO_ACTIVITY.key,
  );
});

test("summarizeProfileWorkloadKpis aggregates profile workload rows", () => {
  const rows = normalizeApplierProfileWorkload([
    {
      id: "r1",
      profile_name: "Alex",
      resume_name: "Alex Resume",
      total_count: 10,
      applied_count: 4,
      pending_count: 2,
      blocked_count: 1,
      interview_count: 0,
    },
    {
      id: "r2",
      profile_name: "Blair",
      resume_name: "Blair Resume",
      total_count: 0,
      applied_count: 0,
      pending_count: 0,
      blocked_count: 0,
      interview_count: 0,
    },
  ]);
  assert.deepEqual(summarizeProfileWorkloadKpis(rows), {
    totalProfiles: 2,
    activeProfiles: 1,
    applications: 10,
    needsAttention: 1,
  });
});
