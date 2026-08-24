import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizeApplierPerformance } from "../src/features/overview/applier-performance.js";
import { normalizeJdFinderPerformance } from "../src/features/overview/jd-finder-performance.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("manager Overview presents matching Applier and JD Finder Performance panels", async () => {
  const [app, applier, applierModel, finder, finderModel] = await Promise.all([
    read("../src/App.jsx"),
    read("../src/features/overview/applier-performance-chart.jsx"),
    read("../src/features/overview/applier-performance.js"),
    read("../src/features/overview/jd-finder-performance-chart.jsx"),
    read("../src/features/overview/jd-finder-performance.js"),
  ]);
  assert.match(app, /showApplierPerformance = hasCapability\(access, CAPABILITIES\.APPLICATION_MANAGE\)/);
  assert.match(app, /<Col xs=\{24\} xl=\{12\}><ApplierPerformanceChart/);
  assert.match(app, /<Col xs=\{24\} xl=\{12\}><JdFinderPerformanceChart/);
  assert.match(app, /dateLabel=\{dateLabel\}/);
  assert.match(applier, /role="img"[\s\S]*aria-label="Applier Performance Graph"/);
  assert.match(finder, /role="img"[\s\S]*aria-label="JD Finder Performance Graph"/);
  assert.match(applier, /aria-label="Search Applier Performance by name or email"/);
  assert.match(finder, /aria-label="Search JD Finder Performance by name or email"/);
  assert.match(applier, /item\.name} \$\{item\.email/);
  assert.match(finder, /item\.name} \$\{item\.email/);
  assert.match(applier, /No Appliers match this search/);
  assert.match(finder, /No JD Finders match this search/);
  assert.match(applier, /from "recharts"/);
  assert.match(finder, /from "recharts"/);
  assert.match(applier, /BarChart/);
  assert.match(finder, /BarChart/);
  assert.match(applier, /ApplierPerformanceTooltip/);
  assert.match(finder, /JdFinderPerformanceTooltip/);
  assert.match(applier, /overview-chart-scroll/);
  assert.match(finder, /overview-chart-scroll/);
  assert.match(applier, /dataKey=\{metric\.key\}/);
  assert.match(finder, /dataKey=\{metric\.key\}/);
  for (const label of ["Assigned", "Active", "Completed", "Applied", "completionRate"]) {
    assert.match(applierModel, new RegExp(label));
  }
  for (const label of ["Captured", "Approved", "Needs Review", "Correction", "Declined", "approvalRate"]) {
    assert.match(finderModel, new RegExp(label));
  }
  assert.doesNotMatch(applier, /Segmented|Last 3 Days/);
  assert.doesNotMatch(finder, /Segmented|Last 3 Days/);
});

test("normalizeApplierPerformance maps overview rows for the grouped bar chart", () => {
  const [row] = normalizeApplierPerformance([
    {
      id: "a1",
      applier_name: "Alex Applier",
      email: "alex@example.com",
      assigned_count: 4,
      active_count: 1,
      completed_count: 2,
      applied_count: 3,
      completion_rate: 50,
    },
  ]);
  assert.deepEqual(row, {
    id: "a1",
    name: "Alex Applier",
    email: "alex@example.com",
    assigned: 4,
    active: 1,
    completed: 2,
    applied: 3,
    completionRate: 50,
  });
});

test("normalizeApplierPerformance rejects email-like labels", () => {
  const [row] = normalizeApplierPerformance([
    {
      id: "a2",
      applier_name: "khannaira558@gmail.com",
      email: "khannaira558@gmail.com",
      assigned_count: 0,
      active_count: 0,
      completed_count: 0,
      applied_count: 0,
      completion_rate: 0,
    },
  ]);
  assert.equal(row.name, "khannaira558");
  assert.doesNotMatch(row.name, /@/);
});

test("normalizeJdFinderPerformance maps overview rows for the grouped bar chart", () => {
  const [row] = normalizeJdFinderPerformance([
    {
      id: "f1",
      finder_name: "Jordan Finder",
      email: "jordan@example.com",
      captured_count: 10,
      approved_count: 6,
      needs_review_count: 2,
      needs_correction_count: 1,
      declined_count: 1,
      approval_rate: 60,
    },
  ]);
  assert.deepEqual(row, {
    id: "f1",
    name: "Jordan Finder",
    email: "jordan@example.com",
    captured: 10,
    approved: 6,
    needsReview: 2,
    needsCorrection: 1,
    declined: 1,
    approvalRate: 60,
  });
});

test("normalizeJdFinderPerformance prefers display names over email-like finder labels", () => {
  const [row] = normalizeJdFinderPerformance([
    {
      id: "f2",
      finder_name: "hr@buildall4u.com",
      display_name: "BuildAll HR",
      email: "hr@buildall4u.com",
      captured_count: 1,
      approved_count: 0,
      needs_review_count: 1,
      needs_correction_count: 0,
      declined_count: 0,
      approval_rate: 0,
    },
  ]);
  assert.equal(row.name, "BuildAll HR");
});

test("role performance aggregation is set-based, bounded, role-gated, and status-aware", async () => {
  const sql = await read("../../supabase/migrations/202608210060_v3_2_overview_role_performance_display_names.sql");
  assert.match(sql, /get_business_overview_v30\(p_from timestamptz,p_to timestamptz\)/);
  assert.match(sql, /p_to-p_from>interval '370 days'/);
  assert.match(sql, /has_role\('APPLYING_MANAGER'\).*has_role\('ADMIN'\)/);
  assert.match(sql, /r\.code='APPLIER'/);
  assert.match(sql, /r\.code='JD_FINDER'/);
  assert.match(sql, /p\.status='ACTIVE'and r\.active/);
  assert.match(sql, /left join public\.user_profiles up on up\.id=p\.id/);
  assert.match(sql, /nullif\(btrim\(up\.display_name\),''\)/);
  assert.match(sql, /position\('@' in btrim\(p\.full_name\)\)=0/);
  assert.match(sql, /split_part\(coalesce\(p\.email,''\),'@',1\)/);
  assert.match(sql, /'Unknown Applier'/);
  assert.match(sql, /'Unknown JD Finder'/);
  assert.match(sql, /left join public\.applications a on a\.assigned_to=p\.id/);
  assert.match(sql, /left join public\.job_descriptions j on j\.user_id=p\.id/);
  for (const status of ["APPROVED", "NEEDS_REVIEW", "NEEDS_CORRECTION", "DECLINED"]) {
    assert.match(sql, new RegExp(`review_status='${status}'`));
  }
  assert.match(sql, /grant execute on function public\.get_business_overview_v30\(timestamptz,timestamptz\)to authenticated/);
});
