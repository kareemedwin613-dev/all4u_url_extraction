import test from "node:test";
import assert from "node:assert/strict";
import { startMatchPreviewPolling, previewFailureMessage } from "../src/features/application-matching/preview-polling.js";
import { previewBulkApplications } from "../src/features/bulk-applications/bulk-service.js";
import { hasPendingMatches } from "../src/features/application-matching/match-state.js";

const flush = () => new Promise(resolve => setImmediate(resolve));
function scheduler() {
  const timers = new Map(); let id = 0;
  return {
    timers,
    schedule: (run, delay) => { timers.set(++id, { run, delay }); return id; },
    cancel: key => timers.delete(key),
    async next(expectedDelay) {
      const [key, timer] = timers.entries().next().value || [];
      assert.ok(timer, "Expected a scheduled refresh");
      assert.equal(timer.delay, expectedDelay); timers.delete(key);
      await timer.run();
    },
  };
}
const pending = { combinations: [{ matchStatus: "PROCESSING" }] };
const completed = { combinations: [{ matchStatus: "COMPLETED" }] };
const shouldPoll = value => hasPendingMatches(value.combinations);

test("a failed refresh preserves the last snapshot, retries and clears its warning on recovery", async () => {
  const clock = scheduler(), outcomes = [pending, { retryable: true, message: "Connection unavailable" }, completed];
  let current, warning = "", calls = 0;
  const stop = startMatchPreviewPolling({ ...clock, shouldPoll,
    load: async () => { calls++; const value = outcomes.shift(); if (value.retryable) throw value; return value; },
    onSuccess: value => { current = value; warning = ""; },
    onError: (error, delay) => { warning = previewFailureMessage(error, delay); },
  });
  await flush(); assert.equal(current, pending);
  await clock.next(5000); assert.equal(current, pending); assert.match(warning, /Retrying in 5 seconds/);
  await clock.next(5000); assert.equal(current, completed); assert.equal(warning, "");
  assert.equal(calls, 3); assert.equal(clock.timers.size, 0); stop();
});

test("temporary failures back off and stop after three retries", async () => {
  const clock = scheduler(), delays = []; let calls = 0;
  const stop = startMatchPreviewPolling({ ...clock, shouldPoll,
    load: async () => { calls++; throw { retryable: true, message: "Timeout" }; },
    onSuccess: () => assert.fail("Unexpected success"), onError: (_error, delay) => delays.push(delay),
  });
  await flush();
  for (const delay of [5000, 10000, 20000]) await clock.next(delay);
  assert.equal(calls, 4); assert.deepEqual(delays, [5000, 10000, 20000, null]);
  assert.equal(clock.timers.size, 0); stop();
});

test("authorization, missing migrations and other permanent errors do not retry", async () => {
  for (const code of ["UNAUTHORIZED", "FORBIDDEN", "DATABASE_MIGRATION_REQUIRED", "DATABASE_ERROR"]) {
    const clock = scheduler(); let warned = false;
    const stop = startMatchPreviewPolling({ ...clock, shouldPoll,
      load: async () => { throw { code, retryable: false }; }, onSuccess: () => assert.fail("Unexpected success"),
      onError: (_error, delay) => { warned = true; assert.equal(delay, null); },
    });
    await flush(); assert.equal(warned, true); assert.equal(clock.timers.size, 0); stop();
  }
});

test("cleanup ignores both late results and late errors after changing the selected scope", async () => {
  for (const reject of [false, true]) {
    const clock = scheduler(); let finish;
    const stop = startMatchPreviewPolling({ ...clock, shouldPoll,
      load: () => new Promise((resolve, failure) => { finish = reject ? failure : resolve; }),
      onSuccess: () => assert.fail("Stale response"), onError: () => assert.fail("Stale error"),
    });
    stop(); finish(reject ? { retryable: true } : pending); await flush();
    assert.equal(clock.timers.size, 0);
  }
});

test("an existing initial snapshot delays the next fetch; cleanup cancels its timer", async () => {
  const clock = scheduler(); let calls = 0;
  const stop = startMatchPreviewPolling({ ...clock, initialDelay: 5000, shouldPoll,
    load: async () => { calls++; return pending; }, onSuccess: () => {}, onError: () => assert.fail("Unexpected error"),
  });
  await flush(); assert.equal(calls, 0);
  await clock.next(5000); assert.equal(calls, 1);
  stop(); assert.equal(clock.timers.size, 0);
});

test("category mode retries a temporary read failure but never polls for scores after success", async () => {
  const clock = scheduler(); let calls = 0;
  const stop = startMatchPreviewPolling({ ...clock, shouldPoll: () => false,
    load: async () => { if (++calls === 1) throw { retryable: true }; return { matchingMode: "CATEGORY", combinations: [] }; },
    onSuccess: () => {}, onError: () => {},
  });
  await flush(); await clock.next(5000);
  assert.equal(calls, 2); assert.equal(clock.timers.size, 0); stop();
});

test("preview errors retain request IDs and retryability without mutation-only instructions", async t => {
  const client = { auth: { getSession: async () => ({ data: { session: { access_token: "test" } } }) } };
  const originalFetch = globalThis.fetch; t.after(() => { globalThis.fetch = originalFetch; });
  const jd = "f3a34ffd-d66a-49f7-815e-c7786857576b";
  for (const [code, retryable] of [["DATABASE_TIMEOUT", true], ["DATABASE_UNAVAILABLE", true], ["REQUEST_TIMEOUT", true],
    ["FORBIDDEN", false], ["DATABASE_MIGRATION_REQUIRED", false], ["DATABASE_ERROR", false]]) {
    globalThis.fetch = async () => new Response(JSON.stringify({ code, message: "Preview unavailable", requestId: "req_test" }), { status: 503 });
    await assert.rejects(() => previewBulkApplications(client, "https://api.example.com", [jd]), error => {
      assert.equal(error.code, code); assert.equal(error.retryable, retryable);
      assert.match(error.message, /req_test/); assert.doesNotMatch(error.message, /Batch History|same key/);
      return true;
    });
  }
  for (const error of [new TypeError("Failed to fetch"), new DOMException("Aborted", "AbortError")]) {
    globalThis.fetch = async () => { throw error; };
    await assert.rejects(() => previewBulkApplications(client, "https://api.example.com", [jd]), result => result.retryable === true);
  }
});
