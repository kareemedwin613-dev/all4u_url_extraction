import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { appendFileSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogTail, monitorStatus, watchWorker } from "../scripts/worker-monitor.mjs";

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "worker-monitor-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return { log: join(directory, "events.jsonl"), status: join(directory, "status.json") };
}
const timestamp = Date.parse("2026-09-18T12:00:00Z");
const running = { status: "RUNNING", supervisorPid: 100, workerPid: 101, updatedAt: new Date(timestamp).toISOString(), restarts: 0 };

test("monitor distinguishes live, retrying, stale, interrupted and terminal states", () => {
  assert.equal(monitorStatus(running, () => true, timestamp), "RUNNING");
  assert.equal(monitorStatus({ ...running, status: "RETRYING", workerPid: undefined }, () => true, timestamp), "RETRYING");
  assert.equal(monitorStatus(running, () => false, timestamp), "INTERRUPTED");
  assert.equal(monitorStatus(running, pid => pid === 100, timestamp), "WORKER_EXITED_WAITING_FOR_SUPERVISOR");
  assert.equal(monitorStatus(running, () => true, timestamp + 31000), "HEARTBEAT_STALE");
  for (const status of ["COMPLETED", "COMPLETED_WITH_FAILURES", "STOPPED", "ACTION_REQUIRED"]) {
    assert.equal(monitorStatus({ ...running, status }, () => false, timestamp), status);
  }
});

test("log tail shows last 100, appends without duplicates, partial lines and rotation", t => {
  const paths = fixture(t), tail = createLogTail(paths.log);
  assert.deepEqual(tail(), []);
  writeFileSync(paths.log, Array.from({ length: 105 }, (_, i) => `${i}\n`).join(""));
  assert.equal(tail().length, 100);
  assert.deepEqual(tail(), []);
  appendFileSync(paths.log, "partial"); assert.deepEqual(tail(), []);
  appendFileSync(paths.log, " line\n"); assert.deepEqual(tail(), ["partial line"]);
  renameSync(paths.log, `${paths.log}.previous`);
  writeFileSync(paths.log, "rotated\n"); assert.deepEqual(tail(), ["rotated"]);
  writeFileSync(paths.log, "new\n"); assert.deepEqual(tail(), ["new"]);
});

test("live monitor prints idle heartbeats, new progress and final completion", async t => {
  const paths = fixture(t), signals = new EventEmitter(), output = [];
  let time = timestamp, polls = 0;
  writeFileSync(paths.status, JSON.stringify(running));
  writeFileSync(paths.log, '{"event":"matching.started"}\n');
  const result = await watchWorker(paths, { signals, output: line => output.push(line), alive: () => true,
    now: () => time, sleep: async () => {
      polls++; time += 10000;
      if (polls === 2) appendFileSync(paths.log, '{"event":"matching.completed"}\n');
      writeFileSync(paths.status, JSON.stringify({ ...running, updatedAt: new Date(time).toISOString(), status: polls === 3 ? "COMPLETED" : "RUNNING" }));
    } });
  assert.equal(result, "COMPLETED");
  assert.equal(output.filter(line => line.includes("RUNNING | restarts")).length, 3);
  assert.equal(output.filter(line => line.includes('"matching.completed"')).length, 1);
  assert.match(output.at(-1), /COMPLETED/);
  assert.equal(signals.listenerCount("SIGINT"), 0);
});

test("Ctrl+C detaches monitor without changing worker state or requesting a stop", async t => {
  const paths = fixture(t), signals = new EventEmitter();
  writeFileSync(paths.status, JSON.stringify(running));
  assert.equal(await watchWorker(paths, { signals, output() {}, now: () => timestamp, alive: () => true,
    sleep: async () => signals.emit("SIGINT") }), "DETACHED");
  assert.equal(signals.listenerCount("SIGTERM"), 0);
  // The monitor has no worker process handle and never sends process signals.
  assert.equal(monitorStatus(running, () => true, timestamp), "RUNNING");
});

test("unexpected supervisor death is reported immediately without waiting forever", async t => {
  const paths = fixture(t), output = [];
  writeFileSync(paths.status, JSON.stringify(running));
  const result = await watchWorker(paths, { signals: new EventEmitter(), output: line => output.push(line),
    alive: () => false, now: () => timestamp, sleep: async () => assert.fail("must not wait") });
  assert.equal(result, "INTERRUPTED");
  assert.match(output.at(-1), /INTERRUPTED/);
});
