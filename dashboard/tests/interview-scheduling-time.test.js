import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { interviewSchedulingTime } from "../src/features/overview/interview-conversion.js";

const counts = (samples, average, interviewed = samples) => ({ applied_cohort: {
  applied_count: 20, interviewed_count: interviewed,
  interview_scheduling_sample_count: samples, avg_days_to_interview_scheduled: average,
} });

test("scheduling averages use the server's applied-date sample without reusing activity counts", () => {
  assert.deepEqual(interviewSchedulingTime({ ...counts(3, 5, 7), interviews: 999, applied: 1 }),
    { sampleCount: 3, averageDays: 5, excludedCount: 4 });
  assert.deepEqual(interviewSchedulingTime(counts(1, 0)), { sampleCount: 1, averageDays: 0, excludedCount: 0 });
  assert.deepEqual(interviewSchedulingTime(counts(0, null, 2)), { sampleCount: 0, averageDays: null, excludedCount: 2 });
});

test("older responses and invalid timing data never become a zero-day average", () => {
  for (const data of [undefined, null, {}, { applied_cohort: { applied_count: 20, interviewed_count: 2 } },
    counts(-1, 5), counts(1.5, 5), counts(3, 5, 2), counts(1, null), counts(1, "5"), counts(1, -1),
    counts(1, Infinity), counts(1, NaN), counts(0, 0), counts(0, undefined)]) {
    assert.equal(interviewSchedulingTime(data), null);
  }
});

const compiled = await build({
  entryPoints: [fileURLToPath(new URL("../src/features/overview/interview-scheduling-time-card.jsx", import.meta.url))],
  bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
});
const module = { exports: {} };
new Function("require", "module", "exports", compiled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { InterviewSchedulingTimeCard } = module.exports;
const render = data => parseHTML(renderToStaticMarkup(React.createElement(InterviewSchedulingTimeCard, { counts: data }))).document;

test("the card shows elapsed days, sample size, applied-date basis and excluded interviews", () => {
  const document = render(counts(3, 5.25, 7));
  assert.equal(document.querySelector(".overview-kpi-card__label").textContent, "Avg Days to Interview Scheduled");
  assert.equal(document.querySelector(".overview-kpi-card__value").textContent, "5.3 days");
  const meta = document.querySelector(".overview-kpi-card__meta").textContent;
  assert.match(meta, /Based on 3 applications/);
  assert.match(meta, /Applied in selected date range; first scheduling recorded/);
  assert.match(meta, /4 interviewed applications excluded: missing or invalid timestamps/);
});

test("same-time scheduling is zero days, while empty and unavailable samples show a dash", () => {
  const zero = render(counts(1, 0)), empty = render(counts(0, null)), missing = render({});
  assert.equal(zero.querySelector(".overview-kpi-card__value").textContent, "0.0 days");
  assert.match(zero.querySelector(".overview-kpi-card__meta").textContent, /Based on 1 application\./);
  assert.doesNotMatch(zero.querySelector(".overview-kpi-card__meta").textContent, /excluded/);
  assert.equal(empty.querySelector(".overview-kpi-card__value").textContent, "—");
  assert.match(empty.querySelector(".overview-kpi-card__meta").textContent, /No applications with usable/);
  assert.equal(missing.querySelector(".overview-kpi-card__value").textContent, "—");
  assert.match(missing.querySelector(".overview-kpi-card__meta").textContent, /data unavailable/);
});

test("Admin and Applier dashboards pass their existing date-filtered counts to the timing card", async () => {
  for (const filename of ["applier-productivity-page.jsx", "applier-profile-workload-page.jsx"]) {
    const source = await readFile(new URL(`../src/features/overview/${filename}`, import.meta.url), "utf8");
    assert.match(source, /<InterviewSchedulingTimeCard counts=\{applicationCounts\}/);
  }
});
