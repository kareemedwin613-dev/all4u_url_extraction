import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("manager Overview presents matching Applier and JD Finder performance panels", async () => {
  const [app, applier, finder] = await Promise.all([
    read("../src/App.jsx"),
    read("../src/features/overview/applier-performance-chart.jsx"),
    read("../src/features/overview/jd-finder-performance-chart.jsx"),
  ]);
  assert.match(app, /showApplierPerformance = hasCapability\(access, CAPABILITIES\.APPLICATION_MANAGE\)/);
  assert.match(app, /<Col xs=\{24\} xl=\{12\}><ApplierPerformanceChart/);
  assert.match(app, /<Col xs=\{24\} xl=\{12\}><JdFinderPerformanceChart/);
  assert.match(app, /dateLabel=\{dateLabel\}/);
  assert.match(applier, /role="img" aria-label="Applier performance graph"/);
  assert.match(finder, /role="img" aria-label="JD Finder performance graph"/);
  assert.match(applier, /aria-label="Search Applier performance by name or email"/);
  assert.match(finder, /aria-label="Search JD Finder performance by name or email"/);
  assert.match(applier, /item\.name} \$\{item\.email/);
  assert.match(finder, /item\.name} \$\{item\.email/);
  assert.match(applier, /No Appliers match this search/);
  assert.match(finder, /No JD Finders match this search/);
  for (const label of ["Assigned", "Active", "Completed", "Applied", "completionRate"]) {
    assert.match(applier, new RegExp(label));
  }
  for (const label of ["Captured", "Approved", "Needs review", "Correction", "Declined", "approvalRate"]) {
    assert.match(finder, new RegExp(label));
  }
  assert.doesNotMatch(applier, /Segmented|Last 3 Days/);
});

test("role performance aggregation is set-based, bounded, role-gated, and status-aware", async () => {
  const sql = await read("../../supabase/migrations/202608130058_v3_0_overview_role_performance.sql");
  assert.match(sql, /get_business_overview_v30\(p_from timestamptz,p_to timestamptz\)/);
  assert.match(sql, /p_to-p_from>interval '370 days'/);
  assert.match(sql, /has_role\('APPLYING_MANAGER'\).*has_role\('ADMIN'\)/);
  assert.match(sql, /r\.code='APPLIER'/);
  assert.match(sql, /r\.code='JD_FINDER'/);
  assert.match(sql, /p\.status='ACTIVE'and r\.active/);
  assert.match(sql, /left join public\.applications a on a\.assigned_to=p\.id/);
  assert.match(sql, /left join public\.job_descriptions j on j\.user_id=p\.id/);
  for (const status of ["APPROVED", "NEEDS_REVIEW", "NEEDS_CORRECTION", "DECLINED"]) {
    assert.match(sql, new RegExp(`review_status='${status}'`));
  }
  assert.match(sql, /grant execute on function public\.get_business_overview_v30\(timestamptz,timestamptz\)to authenticated/);
});
