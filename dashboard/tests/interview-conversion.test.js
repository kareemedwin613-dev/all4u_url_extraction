import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { interviewConversion } from "../src/features/overview/interview-conversion.js";

const counts = (applied, interviews) => ({ applied_cohort: { applied_count: applied, interviewed_count: interviews } });

test("conversion uses only paired applied-cohort counts, never the activity metrics", () => {
  assert.deepEqual(interviewConversion({ ...counts(100, 12), interviews: 500, applied: 2 }),
    { applied: 100, interviews: 12, rate: 12 });
  assert.deepEqual(interviewConversion(counts(3, 1)), { applied: 3, interviews: 1, rate: 33.3 });
  assert.deepEqual(interviewConversion(counts(5, 0)), { applied: 5, interviews: 0, rate: 0 });
  assert.deepEqual(interviewConversion(counts(5, 5)), { applied: 5, interviews: 5, rate: 100 });
  assert.deepEqual(interviewConversion(counts(0, 0)), { applied: 0, interviews: 0, rate: null });
});

test("missing or inconsistent cohort data never produces a fabricated rate", () => {
  for (const data of [undefined, null, {}, { applied: 100, interviews: 12 }, counts(0, 1), counts(-1, 0), counts(10, -1), counts(10, 0.5), counts(10, undefined), counts(null, null)]) {
    assert.equal(interviewConversion(data), null);
  }
});

const compiled = await build({
  entryPoints: [fileURLToPath(new URL("../src/features/overview/interview-conversion-card.jsx", import.meta.url))],
  bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
});
const module = { exports: {} };
new Function("require", "module", "exports", compiled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { InterviewConversionCard } = module.exports;
const render = data => parseHTML(renderToStaticMarkup(React.createElement(InterviewConversionCard, { counts: data }))).document;

test("the KPI displays percentage, both counts and its applied-date basis", () => {
  const document = render(counts(100, 12));
  assert.equal(document.querySelector(".overview-kpi-card__value").textContent, "12%");
  assert.equal(document.querySelector(".overview-kpi-card__label").textContent, "Interviews / Applied");
  const meta = document.querySelector(".overview-kpi-card__meta").textContent;
  assert.match(meta, /12 interviewed \/ 100 applied/);
  assert.match(meta, /Applied in selected date range; includes later interviews/);
});

test("the KPI distinguishes no applications from missing migration data", () => {
  const empty = render(counts(0, 0)), unavailable = render({ applied: 100, interviews: 12 });
  assert.equal(empty.querySelector(".overview-kpi-card__value").textContent, "—");
  assert.match(empty.querySelector(".overview-kpi-card__meta").textContent, /0 interviewed \/ 0 applied.*No applications applied/);
  assert.equal(unavailable.querySelector(".overview-kpi-card__value").textContent, "—");
  assert.match(unavailable.querySelector(".overview-kpi-card__meta").textContent, /data unavailable/);
});

test("Admin and Applier overviews reuse their existing date-filtered counts", async () => {
  for (const path of ["applier-productivity-page.jsx", "applier-profile-workload-page.jsx"]) {
    const source = await readFile(new URL(`../src/features/overview/${path}`, import.meta.url), "utf8");
    assert.match(source, /<InterviewConversionCard counts=\{applicationCounts\}/);
  }
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.match(app, /getApplicationCounts\(client, apiBaseUrl, dateRange\)/);
  assert.match(app, /dateRange\?\.from, dateRange\?\.to/);
});
