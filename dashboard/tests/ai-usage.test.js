import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatUsd, summarizeAiUsage } from "../src/features/overview/ai-usage.js";

const local = (y, m, d, h = 0) => new Date(y, m - 1, d, h);
const hour = (date, values) => ({ hour: date.toISOString(), pages: 0, questionsAsked: 0, questionsFromTable: 0, modelCalls: 0, questionsSent: 0, inputTokens: 0, outputTokens: 0, costMicroUsd: 0, ...values });
const report = (hours, extra = {}) => ({
  hours, autofilledApplications: 40, learnedWordings: 120,
  month: { costMicroUsd: 3_420_000, start: local(2026, 10, 1).toISOString(), end: local(2026, 11, 1).toISOString() },
  settings: { enabled: true, keyConfigured: true, remembersWordings: true, model: "gpt-6-luna", monthlyCapUsd: 40 },
  ...extra,
});

test("hourly usage is totalled and grouped into the viewer's local days, with quiet days as zero", () => {
  const range = { from: local(2026, 10, 6).toISOString(), to: local(2026, 10, 9).toISOString() };
  const summary = summarizeAiUsage(report([
    hour(local(2026, 10, 6, 9), { pages: 10, questionsAsked: 100, questionsFromTable: 40, modelCalls: 6, questionsSent: 60, inputTokens: 9000, outputTokens: 2000, costMicroUsd: 1900 }),
    hour(local(2026, 10, 6, 23), { pages: 2, questionsAsked: 20, questionsFromTable: 20 }),
    hour(local(2026, 10, 8, 0), { pages: 5, questionsAsked: 50, questionsFromTable: 40, modelCalls: 2, questionsSent: 10, costMicroUsd: 400 }),
  ]), range, local(2026, 10, 8, 12));
  assert.deepEqual(summary.days.map((day) => [day.day, day.costMicroUsd]), [["2026-10-06", 1900], ["2026-10-07", 0], ["2026-10-08", 400]]);
  assert.equal(summary.totals.costMicroUsd, 2300);
  assert.equal(summary.totals.questionsAsked, 170);
  assert.equal(summary.reuseRate, 58.8, "100 of 170 unanswered questions came from the learned table");
  assert.equal(summary.perApplicationMicroUsd, 2300 / 40);
});

test("month spend is shown against the cap with a month-end projection at the current pace", () => {
  const summary = summarizeAiUsage(report([]), null, local(2026, 10, 11));
  assert.equal(summary.month.capMicroUsd, 40_000_000);
  assert.equal(summary.month.capShare, 8.6);
  // $3.42 after 10 of 31 days -> about $10.60 for the month.
  assert.ok(Math.abs(summary.month.projectedMicroUsd - 10_602_000) < 2_000, String(summary.month.projectedMicroUsd));
  assert.equal(summary.month.projectedOverCap, false);
  const heavy = summarizeAiUsage(report([], { month: { ...report([]).month, costMicroUsd: 20_000_000 } }), null, local(2026, 10, 11));
  assert.equal(heavy.month.projectedOverCap, true);
  assert.equal(summarizeAiUsage(report([]), null, local(2026, 10, 1, 6)).month.projectedMicroUsd, null, "no projection in the first day");
});

test("status and settings: off, missing key, and wordings not being saved", () => {
  assert.equal(summarizeAiUsage(report([], { settings: { enabled: false } })).status, "OFF");
  assert.equal(summarizeAiUsage(report([], { settings: { enabled: true, keyConfigured: false } })).status, "NO_KEY");
  assert.equal(summarizeAiUsage(report([], { settings: { enabled: true, keyConfigured: true, remembersWordings: false } })).remembersWordings, false);
  assert.equal(summarizeAiUsage(report([])).reuseRate, null);
  assert.equal(summarizeAiUsage(null), null);
});

test("amounts read as dollars, with more precision below a cent", () => {
  assert.equal(formatUsd(3_420_000), "$3.42");
  assert.equal(formatUsd(2_100), "$0.0021");
  assert.equal(formatUsd(0), "$0.00");
  assert.equal(formatUsd(null), "—");
});

test("the Overview shows the section to Admins only and never displays keys", () => {
  const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const section = readFileSync(new URL("../src/features/overview/ai-usage-section.jsx", import.meta.url), "utf8");
  assert.match(app, /\{isAdmin \? \(\s*<Suspense fallback=\{<Loading text="Loading AI usage…" \/>\}>\s*<AiUsageSection/);
  assert.doesNotMatch(section, /OPENAI_API_KEY\b(?! is)|apiKey|sk-/);
  assert.match(section, /href="#\/application-guide"/);
});
