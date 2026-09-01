import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Applier Insights component remains available outside Overview dashboard", async () => {
  const [app, insights] = await Promise.all([
    read("../src/App.jsx"),
    read("../src/features/overview/overview-applier-insights.jsx"),
  ]);
  assert.doesNotMatch(app, /OverviewApplierInsights/);
  assert.match(insights, /OverviewSection/);
  assert.match(insights, /title="Applier Insights"/);
  assert.match(insights, /overview-insights-grid/);
  assert.match(insights, /ProductivityNeedsAttention/);
  assert.match(insights, /ProductivityLeaders/);
  assert.match(insights, /getNeedsAttentionAppliers\(data, 5\)/);
  assert.match(insights, /getTopPerformers\(data, 5\)/);
});
