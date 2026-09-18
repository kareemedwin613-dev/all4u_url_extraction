import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { resolve, win32 } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

export const RUN_ID = /^(matching|tailoring)-[a-f0-9]{24}$/;
const finalStates = new Set(["COMPLETED", "COMPLETED_WITH_FAILURES", "STOPPED", "ACTION_REQUIRED"]);
export const runIdentity = (kind, ticket, apiBaseUrl) => `${kind}-${createHash("sha256").update(`${apiBaseUrl}|${ticket}`).digest("hex").slice(0, 24)}`;
export const isAlive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; } };
export function runPaths(root, runId) {
  if (!RUN_ID.test(runId)) throw Error("Invalid worker run ID.");
  const directory = resolve(root, "artifacts/worker-runs", runId);
  return { directory, status: resolve(directory, "status.json"), log: resolve(directory, "events.jsonl"), lock: resolve(directory, "owner.json"), stop: resolve(directory, "stop.request") };
}
export function readStatus(path) { try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; } }

// Windows readers/antivirus can briefly deny replacement of an open file.
function replaceStatus(source, target) {
  for (let attempt = 0; ; attempt++) {
    try { renameSync(source, target); return; }
    catch (error) {
      if (process.platform !== "win32" || !["EPERM", "EACCES", "EBUSY"].includes(error.code) || attempt >= 5) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
}

// Persist metadata, never arbitrary stderr, prompts, responses, argv or credentials.
export function safeEvent(value = {}) {
  const result = {};
  for (const key of ["event", "stage", "code", "reason", "status", "signal"]) {
    if (typeof value[key] === "string" && /^[A-Za-z][A-Za-z0-9_.-]{0,100}$/.test(value[key])
      && !/^(?:mrb|trb|trt|sk)[_-]/i.test(value[key])) result[key] = value[key];
  }
  for (const key of ["durationMs", "attempt", "completedCount", "failedCount", "activeJobs", "retryAfterSeconds", "exitCode", "pid", "restarts"]) {
    if (Number.isSafeInteger(value[key])) result[key] = value[key];
  }
  for (const key of ["id", "batchId", "jobId", "itemId"]) {
    if (typeof value[key] === "string" && /^[a-f0-9-]{36}$/i.test(value[key])) result[key] = value[key];
  }
  return result;
}

export function workerCommand(root, kind, args, ticket) {
  const workerDirectory = resolve(root, `apps/${kind}-worker`);
  const loader = kind === "tailoring"
    ? ["--import", pathToFileURL(createRequire(resolve(workerDirectory, "package.json")).resolve("tsx")).href] : [];
  return {
    command: process.execPath,
    args: [`--env-file-if-exists=${resolve(workerDirectory, ".env")}`, ...loader,
      resolve(workerDirectory, kind === "matching" ? "src/cli.mjs" : "src/cli.ts"), ...args],
    options: { cwd: root, shell: false, windowsHide: true,
      env: { ...process.env, INIT_CWD: root, ...(ticket ? { [`${kind.toUpperCase()}_BATCH_TICKET`]: ticket } : {}) } },
  };
}

function stopOwnedWorker(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    const killer = spawn(win32.join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe"),
      ["/PID", String(child.pid), "/T", "/F"], { shell: false, windowsHide: true, stdio: "ignore" });
    killer.on("error", () => child.kill());
  } else {
    try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill(); }
  }
}

export function launchWorker(config, onEvent, { spawnImpl = spawn, stopChild = stopOwnedWorker } = {}) {
  let child, result;
  const command = workerCommand(config.root, config.kind, config.args, config.ticket);
  const done = new Promise(resolveExit => {
    try {
      child = spawnImpl(command.command, command.args, {
        ...command.options, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe", "ipc"],
      });
    } catch { resolveExit({ result: { status: "ACTION_REQUIRED", code: "WORKER_LAUNCH_FAILED" }, code: null }); return; }
    child.on("message", message => {
      if (message?.type === "worker.result" && (finalStates.has(message.status) || message.status === "RETRYABLE_ERROR")) result = safeEvent(message);
      if (message?.type === "worker.event") onEvent(safeEvent(message));
    });
    // Existing matching JSON progress is useful; discard non-JSON/raw model logs.
    for (const stream of [child.stdout, child.stderr]) {
      let pending = "";
      stream.on("data", chunk => {
        pending = (pending + chunk.toString("utf8")).slice(-65536);
        let end;
        while ((end = pending.indexOf("\n")) >= 0) {
          const line = pending.slice(0, end); pending = pending.slice(end + 1);
          try { const entry = JSON.parse(line); if (config.kind === "matching" && entry.event?.startsWith("matching.")) onEvent(safeEvent(entry)); } catch { /* No source text in saved logs. */ }
        }
      });
    }
    child.once("error", () => { result = { status: "ACTION_REQUIRED", code: "WORKER_LAUNCH_FAILED" }; });
    child.once("close", (code, signal) => resolveExit({ result, code, signal }));
  });
  return { pid: child?.pid, done, stop: () => child && stopChild(child) };
}

export async function supervise(config, { launch = launchWorker, sleep = delay, signals = process, heartbeatMs = 5000, maxRestarts = 5 } = {}) {
  const paths = runPaths(config.root, config.runId);
  mkdirSync(paths.directory, { recursive: true });
  const oldOwner = readStatus(paths.lock);
  if (oldOwner && isAlive(oldOwner.pid)) return; // The same ticket already has a supervisor.
  if (oldOwner) rmSync(paths.lock, { force: true });
  try { writeFileSync(paths.lock, JSON.stringify({ pid: process.pid }), { flag: "wx", mode: 0o600 }); }
  catch (error) { if (error.code === "EEXIST") return; throw error; }
  rmSync(paths.stop, { force: true });
  let active, stopping = false, diagnosticsFailed = false, consecutiveFailures = 0;
  const state = { runId: config.runId, kind: config.kind, supervisorPid: process.pid, status: "STARTING", restarts: 0, startedAt: new Date().toISOString() };
  const save = () => {
    state.updatedAt = new Date().toISOString();
    writeFileSync(`${paths.status}.tmp`, JSON.stringify(state, null, 2), { mode: 0o600 });
    replaceStatus(`${paths.status}.tmp`, paths.status);
  };
  const record = event => {
    const safe = safeEvent(event);
    state.lastEvent = safe.event;
    if (safe.code) state.lastCode = safe.code;
    if (safe.event === "matching.completed" || safe.event === "tailoring.completed") consecutiveFailures = 0;
    if (existsSync(paths.log) && statSync(paths.log).size > 8 * 1024 * 1024) {
      rmSync(`${paths.log}.previous`, { force: true }); renameSync(paths.log, `${paths.log}.previous`);
    }
    appendFileSync(paths.log, `${JSON.stringify({ ...safe, timestamp: new Date().toISOString() })}\n`, { mode: 0o600 });
    save();
  };
  const stop = () => { stopping = true; active?.stop(); };
  const recordWorkerEvent = event => { try { record(event); } catch { diagnosticsFailed = true; stop(); } };
  signals.once("SIGINT", stop); signals.once("SIGTERM", stop);
  const timer = setInterval(() => {
    try {
      if (existsSync(paths.stop) && !stopping) stop();
      save();
    } catch { diagnosticsFailed = true; stop(); } // Do not continue unattended after losing diagnostics.
  }, heartbeatMs);
  try {
    record({ event: "supervisor.started", pid: process.pid });
    while (!stopping) {
      state.status = "RUNNING";
      active = launch(config, recordWorkerEvent); state.workerPid = active.pid; save();
      record({ event: "worker.started", pid: active.pid });
      const { result, code, signal } = await active.done;
      active = undefined; delete state.workerPid;
      record({ event: "worker.exited", exitCode: code, signal });
      if (stopping) break;
      // Only an explicit terminal receipt can declare success. A silent exit is retried.
      if (result && finalStates.has(result.status)) {
        state.status = result.status;
        record({ event: "supervisor.finished", ...result });
        return;
      }
      if (++consecutiveFailures > maxRestarts) {
        state.status = "ACTION_REQUIRED";
        record({ event: "supervisor.finished", code: "RESTART_LIMIT_REACHED", status: state.status }); return;
      }
      state.restarts++;
      state.status = "RETRYING";
      const seconds = Math.min(60, 5 * 2 ** (consecutiveFailures - 1));
      record({ event: "supervisor.retrying", code: result?.code || "UNEXPECTED_WORKER_EXIT", retryAfterSeconds: seconds, restarts: state.restarts });
      for (let second = 0; second < seconds && !stopping; second++) {
        if (existsSync(paths.stop)) { stopping = true; break; }
        await sleep(1000);
      }
    }
    state.status = diagnosticsFailed ? "ACTION_REQUIRED" : "STOPPED";
    record({ event: "supervisor.finished", status: state.status, ...(diagnosticsFailed ? { code: "DIAGNOSTICS_UNAVAILABLE" } : {}) });
  } catch {
    state.status = "ACTION_REQUIRED";
    try { record({ event: "supervisor.finished", code: "SUPERVISOR_ERROR", status: state.status }); } catch { /* Disk may be unavailable. */ }
    throw Error("Supervisor failed; inspect local run status and directory permissions.");
  } finally {
    clearInterval(timer); signals.removeListener("SIGINT", stop); signals.removeListener("SIGTERM", stop);
    active?.stop();
    rmSync(paths.lock, { force: true });
  }
}
