import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { isAlive, launchWorker, readStatus, runIdentity, runPaths, safeEvent, supervise, workerCommand } from "../scripts/worker-supervisor.mjs";

const ticket = `mrb_${"x".repeat(43)}`, apiBaseUrl = "https://example.test";
const configFor = root => ({ root, kind: "matching", ticket, apiBaseUrl, args: ["--api-base-url", apiBaseUrl], runId: runIdentity("matching", ticket, apiBaseUrl) });
async function harness(t) {
  const root = await mkdtemp(resolve(tmpdir(), "worker-supervisor-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = configFor(root), paths = runPaths(root, config.runId), signals = new EventEmitter();
  return { config, paths, signals, sleep: async () => {}, heartbeatMs: 10 };
}

test("logs persist only metadata and never ticket, raw output, credentials or command", () => {
  assert.deepEqual(safeEvent({ event: "matching.failed", code: "MODEL_TIMEOUT", exitCode: 1, signal: "SIGTERM",
    ticket, raw: "PRIVATE_RESUME", message: "PRIVATE_JD", argv: [ticket], environment: { key: "PRIVATE" } }),
  { event: "matching.failed", code: "MODEL_TIMEOUT", signal: "SIGTERM", exitCode: 1 });
  assert.deepEqual(safeEvent({ code: ticket }), {});
  assert.throws(() => runPaths(".", "../../unrelated"), /Invalid worker run ID/);
});

test("unexpected exits restart the same ticket and terminal receipts stop restarts", async t => {
  const h = await harness(t), observed = [];
  let calls = 0;
  await supervise(h.config, { ...h, launch: config => {
    observed.push(config.ticket);
    const outcome = calls++ === 0 ? { code: null, signal: "SIGTERM" } : { result: { status: "COMPLETED" }, code: 0 };
    return { pid: 123, stop() {}, done: Promise.resolve(outcome) };
  } });
  assert.deepEqual(observed, [ticket, ticket]);
  assert.equal(readStatus(h.paths.status).status, "COMPLETED");
  assert.equal(readStatus(h.paths.status).restarts, 1);
  const logs = await readFile(h.paths.log, "utf8");
  assert.match(logs, /SIGTERM/); assert.match(logs, /supervisor.retrying/);
  assert.doesNotMatch(logs + await readFile(h.paths.status, "utf8"), /mrb_|example\.test|PRIVATE/);
  assert.equal(h.signals.listenerCount("SIGTERM"), 0);
});

test("an unexplained zero exit is not mistaken for batch completion", async t => {
  const h = await harness(t);
  let calls = 0;
  await supervise(h.config, { ...h, launch: () => ({ pid: 123, stop() {}, done: Promise.resolve(++calls === 1
    ? { code: 0 } : { code: 0, result: { status: "COMPLETED_WITH_FAILURES", failedCount: 2 } }) }) });
  assert.equal(calls, 2);
  assert.equal(readStatus(h.paths.status).status, "COMPLETED_WITH_FAILURES");
});

test("auth/ticket/configuration errors stop; transient errors retry with a bounded budget", async t => {
  const h = await harness(t);
  let calls = 0;
  await supervise(h.config, { ...h, maxRestarts: 2, launch: () => ({ pid: 123, stop() {}, done: Promise.resolve({ code: 1,
    result: { status: "RETRYABLE_ERROR", code: "MATCH_API_NETWORK_ERROR" } }) }) });
  assert.equal(readStatus(h.paths.status).lastCode, "RESTART_LIMIT_REACHED");
  assert.equal(readStatus(h.paths.status).restarts, 2);
  await supervise(h.config, { ...h, launch: () => { calls++; return { pid: 123, stop() {}, done: Promise.resolve({ code: 1,
    result: { status: "ACTION_REQUIRED", code: "MATCH_TICKET_EXPIRED" } }) }; } });
  assert.equal(calls, 1); assert.equal(readStatus(h.paths.status).lastCode, "MATCH_TICKET_EXPIRED");
});

test("stop requests interrupt backoff and never restart intentionally stopped work", async t => {
  const h = await harness(t);
  let calls = 0;
  await supervise(h.config, { ...h, sleep: async () => writeFile(h.paths.stop, "stop"), launch: () => {
    calls++; return { pid: 123, stop() {}, done: Promise.resolve({ code: 1 }) };
  } });
  assert.equal(calls, 1); assert.equal(readStatus(h.paths.status).status, "STOPPED");
});

test("a stop request terminates the owned active worker", async t => {
  const h = await harness(t);
  let stopped = false, finish;
  await supervise(h.config, { ...h, launch: () => {
    void writeFile(h.paths.stop, "stop");
    return { pid: 123, done: new Promise(resolveDone => { finish = resolveDone; }), stop: () => { stopped = true; finish({ code: null, signal: "SIGTERM" }); } };
  } });
  assert.equal(stopped, true); assert.equal(readStatus(h.paths.status).status, "STOPPED");
});

test("a live owner prevents a duplicate supervisor for the same ticket", async t => {
  const h = await harness(t);
  let entered, finish;
  const started = new Promise(done => { entered = done; });
  const first = supervise(h.config, { ...h, launch: () => { entered(); return { pid: 123, stop() {},
    done: new Promise(done => { finish = done; }) }; } });
  await started;
  await supervise(h.config, { ...h, launch: () => { throw Error("Duplicate worker launched"); } });
  finish({ code: 0, result: { status: "COMPLETED" } }); await first;
});

test("worker children receive tickets in memory, not argv, and stdout is redacted", async () => {
  const config = configFor(process.cwd()), events = [];
  const command = workerCommand(config.root, config.kind, config.args, config.ticket);
  assert.equal(command.options.env.MATCHING_BATCH_TICKET, ticket);
  assert.ok(!command.args.join(" ").includes(ticket));
  const task = launchWorker(config, event => events.push(event), { spawnImpl: (_bin, _args, options) => {
    assert.equal(options.windowsHide, true); assert.equal(options.shell, false);
    const child = Object.assign(new EventEmitter(), { pid: 123, stdout: new PassThrough(), stderr: new PassThrough() });
    setImmediate(() => {
      child.stderr.write(`PRIVATE_RESUME ${ticket}\n`);
      child.stdout.write(JSON.stringify({ event: "matching.failed", code: "MODEL_TIMEOUT", raw: "PRIVATE_JD" }) + "\n");
      child.emit("message", { type: "worker.result", status: "COMPLETED", ticket });
      child.emit("close", 0, null);
    });
    return child;
  } });
  assert.deepEqual((await task.done).result, { status: "COMPLETED" });
  assert.deepEqual(events, [{ event: "matching.failed", code: "MODEL_TIMEOUT" }]);
});

for (const kind of ["matching", "tailoring"]) test(`background ${kind} worker outlives the launcher without making any real model calls`, { timeout: 20000 }, async t => {
  let release;
  const gate = new Promise(done => { release = done; });
  const server = createServer(async (request, response) => {
    await gate;
    // Matching fails preflight; tailoring claims an empty completed batch. Neither calls a model.
    const data = kind === "matching" ? {} : request.url.endsWith("/claim")
      ? { batchId: "11111111-1111-1111-1111-111111111111", selectedCount: 0 } : { state: "COMPLETED", failedCount: 0 };
    response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ data }));
  });
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  const url = `http://127.0.0.1:${server.address().port}`, localTicket = `${kind === "matching" ? "mrb" : "trb"}_${randomBytes(32).toString("base64url")}`;
  const runId = runIdentity(kind, localTicket, url), paths = runPaths(process.cwd(), runId);
  t.after(async () => {
    release();
    const current = readStatus(paths.status);
    if (current && isAlive(current.supervisorPid)) await writeFile(paths.stop, "stop");
    for (let attempt = 0; attempt < 100 && isAlive(readStatus(paths.status)?.supervisorPid); attempt++) await delay(50);
    await new Promise(done => server.close(done));
    await rm(paths.directory, { recursive: true, force: true });
  });
  const launcher = spawn(process.execPath, ["scripts/worker-runner.mjs", kind, "--batch-ticket", localTicket, "--api-base-url", url], {
    windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, TAILORING_ACCESS_TOKEN: "" },
  });
  let output = ""; launcher.stdout.on("data", data => { output += data; }); launcher.stderr.on("data", data => { output += data; });
  const code = await new Promise(done => launcher.on("exit", done));
  assert.equal(code, 0, output);
  assert.ok(isAlive(readStatus(paths.status).supervisorPid), "the launcher exited but its supervisor is still alive");
  assert.doesNotMatch(output, new RegExp(localTicket));
  release();
  const expected = kind === "matching" ? "ACTION_REQUIRED" : "COMPLETED";
  for (let attempt = 0; attempt < 100 && readStatus(paths.status)?.status !== expected; attempt++) await delay(50);
  assert.equal(readStatus(paths.status)?.status, expected);
  if (kind === "matching") assert.equal(readStatus(paths.status).lastCode, "DATABASE_MIGRATION_REQUIRED");
});
