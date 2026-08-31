import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildActivityOverviewSegments,
  computeProductivityScore,
  deriveProductivityStatus,
  formatLastActivity,
  getNeedsAttentionAppliers,
  getTopPerformers,
  normalizeApplierProductivity,
  overviewWindowDays,
  PRODUCTIVITY_STATUS,
  summarizeProductivityKpis,
} from "../src/features/overview/applier-productivity.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const sampleRow = {
  id: "a1",
  applier_name: "Alex Applier",
  email: "alex@example.com",
  profile_status: "ACTIVE",
  assigned_count: 10,
  pending_count: 2,
  blocked_count: 1,
  completed_count: 6,
  applied_count: 8,
  active_days: 4,
  avg_per_day: 2,
  last_activity_at: "2026-08-28T14:30:00.000Z",
  completion_rate: 60,
};

test("Admin Overview includes the redesigned Applier Productivity page", async () => {
  const [app, page, table] = await Promise.all([
    read("../src/App.jsx"),
    read("../src/features/overview/applier-productivity-page.jsx"),
    read("../src/features/overview/applier-productivity-table.jsx"),
  ]);
  assert.match(app, /isAdmin \? \(\s*<ApplierProductivitySection/);
  assert.match(app, /ApplierProfileWorkloadSection/);
  assert.doesNotMatch(app, /OverviewApplierInsights/);
  assert.match(app, /<ApplierProductivityPage/);
  assert.match(app, /getApplicationCounts\(client, apiBaseUrl, dateRange\)/);
  assert.doesNotMatch(page, /Needs Attention/);
  assert.match(page, /Productivity Leaders/);
  assert.match(page, /Activity Overview/);
  assert.match(table, /title: "Applications"/);
  assert.match(table, /tableRowNumberColumn/);
  assert.match(table, /children: PRODUCTIVITY_TABLE_METRIC_KEYS/);
  assert.match(table, /title: "Avg \/ Day"/);
  assert.doesNotMatch(table, /title: "Success Rate"/);
  assert.match(table, /title: "Score"/);
  assert.match(table, /productivity-table-scroll/);
  assert.match(table, /showTotal:/);
  assert.match(table, /useState\(10\)/);
  assert.match(table, /productivity-status-pill/);
  assert.match(table, /productivity-score/);
  assert.match(table, /aria-label="Search Applier Productivity by name or email"/);
});

test("normalizeApplierProductivity maps productivity metrics from overview rows", () => {
  const [row] = normalizeApplierProductivity([sampleRow], {
    dateRange: {
      from: "2026-08-25T04:00:00.000Z",
      to: "2026-08-29T04:00:00.000Z",
    },
  });
  assert.equal(row.name, "Alex Applier");
  assert.equal(row.activeDays, 4);
  assert.equal(row.avgPerDay, 2);
  assert.equal(row.applied, 8);
  assert.equal(row.assigned, 10);
  assert.equal(row.pending, 2);
  assert.equal(row.blocked, 1);
  assert.equal(row.completed, 6);
  assert.equal(row.completionRate, 60);
  assert.ok(row.score >= 0 && row.score <= 100);
  assert.match(row.grade, /^[ABC]$/);
  assert.equal(row.productivityStatus, PRODUCTIVITY_STATUS.ACTIVE.key);
  assert.match(row.lastActivityLabel, /^Today /);
});

test("gradeFromScore maps numeric scores to letter grades", async () => {
  const { gradeFromScore } = await import("../src/features/overview/applier-productivity.js");
  assert.equal(gradeFromScore(90).grade, "A");
  assert.equal(gradeFromScore(80).grade, "A");
  assert.equal(gradeFromScore(55).grade, "B");
  assert.equal(gradeFromScore(54).grade, "C");
});

test("summarizeProductivityKpis and sidebar helpers derive Phase 1 insights", () => {
  const rows = normalizeApplierProductivity(
    [
      sampleRow,
      {
        ...sampleRow,
        id: "a2",
        applier_name: "Sam Slow",
        email: "sam@example.com",
        applied_count: 0,
        active_days: 0,
        avg_per_day: 0,
        last_activity_at: null,
        completion_rate: 0,
      },
    ],
    {
      dateRange: {
        from: "2026-08-25T04:00:00.000Z",
        to: "2026-08-29T04:00:00.000Z",
      },
    },
  );
  const kpis = summarizeProductivityKpis(rows);
  assert.equal(kpis.totalAppliers, 2);
  assert.equal(kpis.applications, 8);
  const kpisWithCounts = summarizeProductivityKpis(rows, {
    windowDays: 4,
    appliedTotal: 10,
  });
  assert.equal(kpisWithCounts.applications, 10);
  assert.equal(kpisWithCounts.windowDays, 4);
  assert.ok(kpis.avgSuccessRate > 0);
  assert.equal(getNeedsAttentionAppliers(rows).length, 1);
  assert.equal(getTopPerformers(rows)[0].name, "Alex Applier");
  assert.deepEqual(buildActivityOverviewSegments({
    assigned: 20,
    total: 20,
    applied_today: 8,
    pending: 6,
    blocked: 2,
    interviews: 1,
  }).map((segment) => segment.key), ["assigned", "applied", "blocked", "pending", "interviews"]);
  assert.deepEqual(buildActivityOverviewSegments({
    my_assigned: 15,
    applied_today: 4,
    pending: 5,
    blocked: 1,
    interviews: 0,
  }).map((segment) => segment.key), ["assigned", "applied", "blocked", "pending"]);
});

test("computeProductivityScore weights completion, pace, and status", () => {
  const active = {
    completionRate: 90,
    avgPerDay: 4,
    productivityStatus: PRODUCTIVITY_STATUS.ACTIVE.key,
  };
  const inactive = {
    completionRate: 10,
    avgPerDay: 0,
    productivityStatus: PRODUCTIVITY_STATUS.INACTIVE.key,
  };
  assert.ok(computeProductivityScore(active) > computeProductivityScore(inactive));
});

test("deriveProductivityStatus marks inactive accounts and stale activity", () => {
  assert.equal(
    deriveProductivityStatus(
      {
        profileStatus: "INACTIVE",
        lastActivityAt: "2026-08-28T10:00:00.000Z",
        applied: 5,
        activeDays: 3,
        avgPerDay: 2,
      },
      7,
    ),
    PRODUCTIVITY_STATUS.INACTIVE.key,
  );
});

test("formatLastActivity uses Today, Yesterday, and relative day labels", () => {
  const now = new Date("2026-08-28T15:00:00.000Z");
  assert.match(formatLastActivity("2026-08-28T14:30:00.000Z", now), /^Today /);
  assert.equal(formatLastActivity("2026-08-27T14:30:00.000Z", now), "Yesterday");
  assert.equal(formatLastActivity(null, now), "No activity");
});

test("formatLastActivityMeta adds a secondary relative label", async () => {
  const { formatLastActivityMeta } = await import("../src/features/overview/applier-productivity.js");
  const now = new Date("2026-08-28T15:00:00.000Z");
  const recent = formatLastActivityMeta("2026-08-28T14:58:00.000Z", now);
  assert.match(recent.primary, /^Today /);
  assert.match(recent.secondary, /m ago$/);
});

test("overviewWindowDays derives inclusive calendar span from API bounds", () => {
  assert.equal(
    overviewWindowDays({
      from: "2026-08-25T04:00:00.000Z",
      to: "2026-08-29T04:00:00.000Z",
    }),
    4,
  );
});

test("applier productivity RPC extends business overview with bounded activity metrics", async () => {
  const sql = await read(
    "../../supabase/migrations/202608280091_v3_31_overview_applier_productivity.sql",
  );
  assert.match(sql, /get_business_overview_v31\(p_from timestamptz,p_to timestamptz\)/);
  assert.match(sql, /active_days/);
  assert.match(sql, /avg_per_day/);
  assert.match(sql, /last_activity_at/);
});
