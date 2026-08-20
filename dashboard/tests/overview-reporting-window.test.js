import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DEFAULT_OVERVIEW_WINDOW, overviewDateBounds } from "../src/features/overview/overview-date.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Overview defaults to today and supports bounded calendar windows", () => {
  assert.equal(DEFAULT_OVERVIEW_WINDOW.window, "TODAY");
  const now = new Date(2026, 7, 13, 14, 30);
  const today = overviewDateBounds(DEFAULT_OVERVIEW_WINDOW, now);
  const week = overviewDateBounds({ window: "THIS_WEEK" }, now);
  const month = overviewDateBounds({ window: "THIS_MONTH" }, now);
  const custom = overviewDateBounds({ window: "CUSTOM", from: "2026-08-02", to: "2026-08-05" }, now);
  assert.equal((new Date(today.to) - new Date(today.from)) / 86400000, 1);
  assert.equal(new Date(week.from).getDay(), 1);
  assert.equal(new Date(month.from).getDate(), 1);
  assert.equal((new Date(custom.to) - new Date(custom.from)) / 86400000, 4);
});

test("the sticky top bar owns the shared Overview reporting period", async () => {
  const app = await read("../src/App.jsx");
  const cards = await read("../src/features/applications/application-pages.jsx");
  assert.match(app, /headerExtra=\{route\.name === "overview"/);
  assert.match(app, /<OverviewDateFilter compact value=\{overviewPeriod\} onChange=\{setOverviewPeriod\}/);
  assert.doesNotMatch(app, /<OverviewDateFilter value=\{period\}/);
  assert.match(app, /dateRange=\{dateRange\}/);
  assert.match(app, /ApplierPerformanceChart rows=\{result\.applierPerformance \|\| \[\]\} dateLabel=\{dateLabel\}/);
  assert.match(app, /JdFinderPerformanceChart rows=\{result\.jdFinderPerformance \|\| \[\]\} dateLabel=\{dateLabel\}/);
  assert.doesNotMatch(app, /CapturedJobUrls|Captured job URLs/);
  assert.match(cards, /dateLabel/);
});

test("date-windowed Overview RPCs are role checked, bounded, and use canonical Application status", async () => {
  const sql = await read("../../supabase/migrations/202608130057_v2_9_overview_reporting_window.sql");
  assert.match(sql, /get_application_counts_v29\(p_from timestamptz,p_to timestamptz\)/);
  assert.match(sql, /p_to-p_from>interval '370 days'/);
  assert.match(sql, /application_actor_can_manage\(\)/);
  assert.match(sql, /status='IN_PROGRESS'/);
  assert.match(sql, /resume_type='ORIGINAL'/);
  assert.match(sql, /grant execute on function public\.get_business_overview_v29/);
});

test("the API requests the combined role-performance Overview contract", async () => {
  const service = await read("../../apps/api/src/platform/platform.service.ts");
  assert.match(service, /get_business_overview_v30/);
  assert.match(service, /\{p_from:from,p_to:to\}/);
});
