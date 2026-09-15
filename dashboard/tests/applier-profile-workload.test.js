import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  deriveProfileWorkloadStatus,
  normalizeApplierProfileWorkload,
  PROFILE_WORKLOAD_STATUS,
  sumProfileMetricTotals,
  summarizeProfileWorkloadKpis,
} from "../src/features/overview/applier-profile-workload.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Profile workload section appears on Applier Overview dashboard", async () => {
  const [app, page, table, model, sqlLatest, service, controller] = await Promise.all([
    read("../src/App.jsx"),
    read("../src/features/overview/applier-profile-workload-page.jsx"),
    read("../src/features/overview/applier-profile-workload-table.jsx"),
    read("../src/features/overview/applier-profile-workload.js"),
    read("../../supabase/migrations/202609151920_v3_92_applied_means_submitted_in_period.sql"),
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
  assert.match(table, /My Active Profiles/);
  assert.match(table, /tableRowNumberColumn/);
  assert.doesNotMatch(table, /title: "Resume"/);
  assert.match(table, /PROFILE_TABLE_METRIC_KEYS/);
  assert.match(model, /PROFILE_TABLE_METRIC_KEYS/);
  assert.match(model, /tailored/);
  assert.match(model, /nonTailored/);
  assert.match(model, /interviews/);
  assert.match(model, /deriveProfileWorkloadStatus/);
  assert.match(sqlLatest, /interview_count/);
  assert.match(sqlLatest, /interview_tailored_count/);
  assert.match(sqlLatest, /period_apps/);
  assert.match(sqlLatest, /v_activity_scoped/);
  assert.match(sqlLatest, /profile_id/);
  assert.match(sqlLatest, /coalesce\(r\.parent_resume_id, r\.id\)/);
  assert.match(sqlLatest, /pa\.applied_at >= p_from and pa\.applied_at < p_to/);
  assert.doesNotMatch(sqlLatest, /a\.assigned_to = arp\.applier_user_id/);
  assert.match(service, /get_applier_resume_profile_workload_v31/);
  assert.match(controller, /profile-workload/);
});

test("Admin Overview Profile Status tab uses profile workload metrics", async () => {
  const [page, table, migration, app] = await Promise.all([
    read("../src/features/overview/applier-productivity-page.jsx"),
    read("../src/features/overview/applier-profile-workload-table.jsx"),
    read("../../supabase/migrations/202609151920_v3_92_applied_means_submitted_in_period.sql"),
    read("../src/App.jsx"),
  ]);
  assert.match(page, /Profile Status/);
  assert.match(page, /ApplierProfileWorkloadTable/);
  assert.doesNotMatch(page, /showApplier/);
  assert.doesNotMatch(page, /Activity Summary/);
  assert.doesNotMatch(page, /Performance Scorecard/);
  assert.match(table, /PROFILE_TABLE_METRIC_KEYS/);
  assert.match(table, /pagination=\{false\}/);
  assert.match(table, /sumProfileMetricTotals/);
  assert.match(table, /ProfileTableSummary/);
  assert.match(table, /productivity-table-summary-row/);
  assert.match(migration, /tailored_count/);
  assert.match(migration, /non_tailored_count/);
  assert.match(migration, /pa\.applied_at >= p_from and pa\.applied_at < p_to/);
  assert.doesNotMatch(migration, /else pa\.created_at >= p_from and pa\.created_at < p_to and pa\.status = 'APPLIED'/);
  assert.doesNotMatch(migration, /a\.assigned_to = arp\.applier_user_id/);
  assert.match(app, /getApplierProfileWorkload\(client, apiBaseUrl, dateRange\)/);
  assert.match(app, /profileRows: Array\.isArray\(profileRows\)/);
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
    applierUserId: "",
    name: "Michael Baqadi",
    resumeName: "Michael Baqadi Resume",
    applierName: "Sami Ullah",
    assigned: 40,
    applied: 12,
    pending: 18,
    blocked: 4,
    interviews: 3,
    interview: 3,
    interviewsTailored: 0,
    interviewsNonTailored: 0,
    tailored: 0,
    nonTailored: 0,
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

test("sumProfileMetricTotals adds application metric columns for the Profile Status footer", () => {
  const rows = normalizeApplierProfileWorkload([
    {
      id: "r1",
      profile_name: "Alex",
      total_count: 10,
      applied_count: 4,
      tailored_count: 3,
      non_tailored_count: 1,
      pending_count: 2,
      blocked_count: 1,
      interview_count: 3,
      interview_tailored_count: 2,
      interview_non_tailored_count: 1,
    },
    {
      id: "r2",
      profile_name: "Blair",
      total_count: 5,
      applied_count: 2,
      tailored_count: 0,
      non_tailored_count: 2,
      pending_count: 1,
      blocked_count: 0,
      interview_count: 1,
      interview_tailored_count: 0,
      interview_non_tailored_count: 1,
    },
  ]);
  assert.deepEqual(sumProfileMetricTotals(rows), {
    applied: 6,
    tailored: 3,
    nonTailored: 3,
    blocked: 1,
    pending: 3,
    interviews: 4,
    interviewsTailored: 2,
    interviewsNonTailored: 2,
  });
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
