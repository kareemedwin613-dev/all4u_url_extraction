import test from "node:test";
import assert from "node:assert/strict";
import { createBatchTimeTracker, formatEstimatedDuration } from "../src/shared/batch-time-estimate.js";
import { matchingTimingItems } from "../src/features/application-matching/match-progress.js";
import { tailoringTimingItems } from "../src/features/tailoring/tailoring-time.js";

const now = 1_000_000;
const item = (id, status, fields = {}) => ({ id, status, ...fields });
const sample = item("finished", "COMPLETED", { durationMs: 40_000 });

test("estimates use actual parallel jobs and subtract elapsed processing time", () => {
  const parallel = createBatchTimeTracker().observe([sample,
    item("a", "PROCESSING", { startedAt: now - 10_000 }), item("b", "PROCESSING", { startedAt: now - 10_000 }),
    ...["c", "d", "e", "f"].map(id => item(id, "QUEUED")),
  ], now);
  assert.equal(parallel.status, "READY");
  assert.equal(parallel.averageMs, 40_000);
  assert.equal(parallel.concurrency, 2);
  assert.equal(parallel.remainingMs, 110_000);
  const serial = createBatchTimeTracker().observe([sample, item("a", "PROCESSING", { startedAt: now - 10_000 }),
    ...["b", "c", "d", "e", "f"].map(id => item(id, "QUEUED"))], now);
  assert.equal(serial.concurrency, 1);
  assert.equal(serial.remainingMs, 230_000);
});

test("cached scores and jobs already running when opened aren't mistaken for quick evaluations", () => {
  const tracker = createBatchTimeTracker();
  const cached = item("cached", "COMPLETED");
  assert.equal(tracker.observe([cached, item("a", "PROCESSING"), item("b", "QUEUED"), item("c", "QUEUED")], now).status, "LEARNING");
  let result = tracker.observe([cached, item("a", "COMPLETED"), item("b", "PROCESSING"), item("c", "QUEUED")], now + 5000);
  assert.equal(result.averageMs, null);
  result = tracker.observe([cached, item("a", "COMPLETED"), item("b", "COMPLETED"), item("c", "PROCESSING")], now + 35_000);
  assert.equal(result.status, "READY");
  assert.equal(result.sampleCount, 1);
  assert.equal(result.averageMs, 32_500);
});

test("short evaluations between polls use the polling interval as a conservative sample", () => {
  const tracker = createBatchTimeTracker();
  tracker.observe([item("a", "QUEUED"), item("b", "QUEUED")], now);
  const result = tracker.observe([item("a", "COMPLETED"), item("b", "PROCESSING")], now + 5000);
  assert.equal(result.averageMs, 5000);
  assert.ok(result.remainingMs > 0);
});

test("failures, skipped work and cached tailoring outputs don't lower the successful timing average", () => {
  const tracker = createBatchTimeTracker();
  const rows = [sample, item("failed", "FAILED", { durationMs: 1 }), item("skipped", "SKIPPED", { durationMs: 2 }),
    item("cached", "COMPLETED", { durationMs: null }), item("active", "PROCESSING")];
  const first = tracker.observe(rows, now), second = tracker.observe(rows, now);
  assert.equal(first.averageMs, 40_000);
  assert.equal(first.sampleCount, 1);
  assert.deepEqual(second, first);
});

test("pauses, stale responses and long observation gaps aren't counted as processing time", () => {
  for (const flag of ["paused", "unavailable", "incomplete"]) {
    const tracker = createBatchTimeTracker();
    tracker.observe([item("a", "QUEUED"), item("b", "QUEUED")], now);
    tracker.observe([item("a", "PROCESSING"), item("b", "QUEUED")], now + 5000);
    const suspended = tracker.observe([], now + 10_000, { [flag]: true });
    assert.equal(suspended.remainingMs, null);
    const result = tracker.observe([item("a", "COMPLETED"), item("b", "PROCESSING")], now + 20_000);
    assert.equal(result.status, "LEARNING");
    assert.equal(result.sampleCount, 0);
  }
  const tracker = createBatchTimeTracker();
  tracker.observe([item("a", "QUEUED"), item("b", "QUEUED")], now);
  const result = tracker.observe([item("a", "COMPLETED"), item("b", "PROCESSING")], now + 120_000);
  assert.equal(result.sampleCount, 0);
});

test("retry timing restarts from the new attempt and doesn't include the failed attempt or wait", () => {
  const tracker = createBatchTimeTracker();
  tracker.observe([item("a", "QUEUED", { attempt: 1 }), item("b", "QUEUED")], now);
  tracker.observe([item("a", "PROCESSING", { attempt: 1 }), item("b", "QUEUED")], now + 5000);
  tracker.observe([item("a", "QUEUED", { attempt: 2 }), item("b", "QUEUED")], now + 30_000);
  tracker.observe([item("a", "PROCESSING", { attempt: 2 }), item("b", "QUEUED")], now + 35_000);
  const result = tracker.observe([item("a", "COMPLETED", { attempt: 2 }), item("b", "PROCESSING")], now + 60_000);
  assert.equal(result.averageMs, 27_500);
  assert.equal(result.sampleCount, 1);
});

test("estimates don't show zero while running and stop projecting indefinitely stalled work", () => {
  const tracker = createBatchTimeTracker(), rows = [sample, item("a", "PROCESSING", { startedAt: now - 50_000 })];
  assert.ok(tracker.observe(rows, now).remainingMs > 0);
  assert.equal(tracker.observe(rows, now + 80_000).status, "SLOW");
  assert.equal(tracker.observe([sample, item("a", "COMPLETED")], now + 85_000).status, "DONE");
});

test("queueing, empty, cancelled and partial states show explanations instead of made-up countdowns", () => {
  assert.equal(createBatchTimeTracker().observe([], now).status, "EMPTY");
  assert.equal(createBatchTimeTracker().observe([sample], now).status, "DONE");
  assert.equal(createBatchTimeTracker().observe([sample], now).averageMs, 40_000);
  assert.equal(createBatchTimeTracker().observe([sample, item("a", "QUEUED")], now).status, "WAITING");
  assert.equal(createBatchTimeTracker().observe([sample, item("a", "NOT_STARTED")], now).status, "NOT_QUEUED");
  assert.equal(createBatchTimeTracker().observe([], now, { cancelled: true }).status, "CANCELLED");
  assert.equal(createBatchTimeTracker().observe([], now, { incomplete: true }).status, "INCOMPLETE");
});

test("changing assessment identities drops timing samples from the old source/model version", () => {
  const tracker = createBatchTimeTracker();
  tracker.observe([sample, item("active-v1", "PROCESSING")], now);
  const result = tracker.observe([item("new-assessment", "COMPLETED"), item("active-v2", "PROCESSING")], now + 5000);
  assert.equal(result.sampleCount, 0);
  assert.equal(result.status, "LEARNING");
});

test("large batches bound timing samples and ignore invalid recorded durations", () => {
  const rows = Array.from({ length: 500 }, (_, id) => item(String(id), "COMPLETED", { durationMs: 60_000 }));
  rows.push(...[0, -1, Infinity, NaN, "40000"].map((durationMs, index) => item(`bad-${index}`, "COMPLETED", { durationMs })), item("active", "PROCESSING"));
  const tracker = createBatchTimeTracker(), result = tracker.observe(rows, now);
  assert.equal(result.sampleCount, 20);
  assert.equal(result.averageMs, 60_000);
  assert.equal(tracker.observe(rows, now + 5000).averageMs, 60_000);
});

test("timing adapters exclude blocked scoring pairs and use real tailoring durations", () => {
  const scoring = matchingTimingItems([
    { key: "cached", matchStatus: "COMPLETED", assessmentId: "old" }, { key: "stale", matchStatus: "STALE" },
    { key: "queued", matchStatus: "PENDING", assessmentId: "current" }, { key: "blocked", matchStatus: "COMPLETED", exclusionCode: "EXISTING_APPLICATION" },
  ]);
  assert.equal(scoring.length, 3);
  assert.equal(scoring[0].durationMs, undefined);
  assert.equal(scoring[1].status, "NOT_STARTED");
  assert.equal(scoring[2].status, "QUEUED");
  const tailoring = tailoringTimingItems([
    { id: "done", status: "COMPLETED", duration_ms: 40_000, started_at: new Date(now - 40_000).toISOString(), attempt_count: 2 },
    { id: "pdf", status: "MATERIALIZING" }, { id: "retry", status: "WAITING_RETRY" },
  ]);
  assert.equal(tailoring[0].durationMs, 40_000);
  assert.equal(tailoring[0].startedAt, now - 40_000);
  assert.equal(tailoring[0].attempt, 2);
  assert.equal(tailoring[1].status, "PROCESSING");
  assert.equal(tailoring[2].status, "QUEUED");
});

test("duration labels are approximate and don't expose misleading millisecond precision", () => {
  for (const value of [null, undefined, 0, NaN, Infinity, -1]) assert.equal(formatEstimatedDuration(value), "—");
  assert.equal(formatEstimatedDuration(1200), "~5 sec");
  assert.equal(formatEstimatedDuration(51_000), "~55 sec");
  assert.equal(formatEstimatedDuration(60_000), "~1 min");
  assert.equal(formatEstimatedDuration(61_000), "~2 min");
  assert.equal(formatEstimatedDuration(3_660_000), "~1 hr 1 min");
});
