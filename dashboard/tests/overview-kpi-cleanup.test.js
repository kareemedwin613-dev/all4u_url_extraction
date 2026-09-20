import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";

async function loadComponent(filename) {
  const compiled = await build({
    entryPoints: [fileURLToPath(new URL(`../src/features/overview/${filename}`, import.meta.url))],
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    define: { "import.meta.env": "{}" },
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  return module.exports;
}

const [{ BusinessRecordCards }, { ApplierProductivityPage }] = await Promise.all([
  loadComponent("overview-count-cards.jsx"), loadComponent("applier-productivity-page.jsx"),
]);
const render = (component, props) => parseHTML(renderToStaticMarkup(React.createElement(component, props))).document;
const labels = document => [...document.querySelectorAll(".overview-kpi-card__label")].map(node => node.textContent);

test("business record cards show only JD totals with a gap-free responsive grid", () => {
  const document = render(BusinessRecordCards, { jobCounts: { total: 17, active: 9 }, resumeCounts: { total: 100, active: 80 } });
  assert.deepEqual(labels(document), ["Total Job Descriptions", "Active Job Descriptions"]);
  assert.deepEqual([...document.querySelectorAll(".overview-kpi-card__value")].map(node => node.textContent), ["17", "9"]);
  assert.equal(document.querySelector(".overview-kpi-grid").className, "overview-kpi-grid");
  assert.doesNotMatch(document.querySelector(".overview-section__description").textContent, /Resume/);
});

test("empty business record counts still display zero without reintroducing Resume KPIs", () => {
  const document = render(BusinessRecordCards, {});
  assert.deepEqual([...document.querySelectorAll(".overview-kpi-card__value")].map(node => node.textContent), ["0", "0"]);
  assert.equal(labels(document).length, 2);
});

test("productivity keeps active Appliers, applications and applied-cohort interviews, not ambiguous averages", () => {
  const document = render(ApplierProductivityPage, {
    rows: [], profileRows: [], dateLabel: "This week",
    dateRange: { from: "2026-09-14T04:00:00Z", to: "2026-09-21T04:00:00Z" },
    applicationCounts: { applied: 80, applied_cohort: { applied_count: 80, interviewed_count: 12,
      interview_scheduling_sample_count: 10, avg_days_to_interview_scheduled: 5 } },
  });
  assert.deepEqual(labels(document), ["Active Appliers", "Applications", "Interviews / Applied", "Avg Days to Interview Scheduled"]);
  assert.deepEqual([...document.querySelectorAll(".overview-kpi-card__value")].map(node => node.textContent), ["0", "80", "15%", "5.0 days"]);
  assert.ok(document.querySelector(".overview-kpi-grid--4"));
  assert.match(document.querySelector(".productivity-page").textContent, /Activity Overview/);
  assert.match(document.querySelector(".productivity-page").textContent, /Productivity Leaders/);
  assert.match(document.querySelectorAll(".overview-kpi-card__meta")[2].textContent, /12 interviewed \/ 80 applied/);
});
