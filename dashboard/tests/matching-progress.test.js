import test from "node:test";
import assert from "node:assert/strict";
import { matchEvaluationState, matchingProgress } from "../src/features/application-matching/match-progress.js";

const row = (matchStatus, fields = {}) => ({ matchStatus, ...fields });

test("progress partitions pending, processing, unstarted, terminal failures and completed scores", () => {
  const progress = matchingProgress([
    row("COMPLETED", { eligible: true }), row("COMPLETED", { exclusionCode: "BELOW_THRESHOLD" }),
    row("PENDING"), row("PROCESSING"), row("NOT_ASSESSED"), row("STALE", { matchScore: 90 }),
    row("FAILED"), row("INSUFFICIENT_DATA"),
  ]);
  assert.deepEqual(progress, { total: 8, completed: 2, processing: 1, queued: 1, notStarted: 2, failed: 1, insufficient: 1,
    skipped: 0, eligible: 1, belowThreshold: 1, notEligible: 2, finished: 4, remaining: 4, percent: 50, status: "PROCESSING" });
});

test("duplicates and blocked pairs don't inflate either completion or the scoring denominator", () => {
  const blocked = ["EXISTING_APPLICATION", "BANNED_COMPANY", "INACTIVE_JD", "INACTIVE_RESUME", "UNAPPROVED_JD", "PRIMARY_CATEGORY_MISMATCH", "MATCHING_NOT_CONFIGURED"];
  const rows = blocked.map(exclusionCode => row("COMPLETED", { exclusionCode, eligible: false }));
  rows.push(row("PROCESSING", { existingApplicationId: "existing" }), row("COMPLETED", { matchingMode: "CATEGORY" }), row("COMPLETED", { resumeType: "TAILORED" }));
  const progress = matchingProgress([...rows, row("PENDING")]);
  assert.equal(progress.total, 1);
  assert.equal(progress.skipped, rows.length);
  assert.equal(progress.completed, 0);
  assert.equal(progress.eligible, 0);
  assert.equal(progress.notEligible, 0);
  assert.equal(progress.percent, 0);
  assert.equal(progress.status, "QUEUED");
});

test("below-threshold scores finish successfully; failed and insufficient results finish with issues", () => {
  const complete = matchingProgress([row("COMPLETED", { exclusionCode: "BELOW_THRESHOLD" })]);
  assert.equal(complete.status, "COMPLETED");
  assert.equal(complete.percent, 100);
  assert.equal(complete.eligible, 0);
  assert.equal(complete.notEligible, 1);
  for (const status of ["FAILED", "INSUFFICIENT_DATA"]) {
    const progress = matchingProgress([row("COMPLETED"), row(status)]);
    assert.equal(progress.status, "FINISHED_WITH_ISSUES");
    assert.equal(progress.completed, 1);
    assert.equal(progress.finished, 2);
    assert.equal(progress.remaining, 0);
    assert.equal(progress.percent, 100);
  }
});

test("eligibility counts use final results, never unfinished evaluations or failures", () => {
  const pending = ["PENDING", "PROCESSING", "NOT_ASSESSED", "STALE", "NEW_UNKNOWN_STATE", "FAILED"];
  for (const state of pending) {
    const progress = matchingProgress([row(state, { eligible: true, matchScore: 95 })]);
    assert.equal(progress.eligible, 0, `${state} is not an eligible result`);
    assert.equal(progress.notEligible, 0, `${state} is not a negative result`);
  }
  const insufficient = matchingProgress([{ exclusionCode: "MATCH_INSUFFICIENT_DATA" }]);
  assert.equal(insufficient.notEligible, 1);
  assert.equal(insufficient.eligible, 0);
  assert.equal(insufficient.remaining, 0);
  const rescoring = matchingProgress([row("PENDING", { exclusionCode: "MATCH_PENDING" })]);
  assert.equal(rescoring.notEligible, 0);
  assert.equal(rescoring.remaining, 1);
});

test("empty and stale/unstarted selections are not reported as complete or actively processing", () => {
  assert.equal(matchingProgress([]).status, "EMPTY");
  assert.equal(matchingProgress([]).percent, 0);
  const progress = matchingProgress([row("STALE"), row("NOT_ASSESSED"), row("NEW_UNKNOWN_STATE")]);
  assert.equal(progress.status, "NOT_STARTED");
  assert.equal(progress.notStarted, 3);
  assert.equal(progress.remaining, 3);
  assert.equal(matchEvaluationState({ exclusionCode: "MATCH_FAILED" }), "FAILED");
});

test("a retry moves failed work back to remaining and 100% is reserved for fully finished work", () => {
  const rows = Array.from({ length: 999 }, () => row("COMPLETED"));
  assert.equal(matchingProgress([...rows, row("FAILED")]).percent, 100);
  const retry = matchingProgress([...rows, row("PENDING")]);
  assert.equal(retry.percent, 99);
  assert.equal(retry.failed, 0);
  assert.equal(retry.remaining, 1);
  assert.equal(retry.status, "QUEUED");
});
