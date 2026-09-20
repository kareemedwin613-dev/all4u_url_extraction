import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { isAlive, readStatus } from "./worker-supervisor.mjs";

const activeStates = new Set(["STARTING", "RUNNING", "RETRYING"]);

export function monitorStatus(state, alive = isAlive, now = Date.now()) {
  if (!state) return "STATUS_UNAVAILABLE";
  if (!activeStates.has(state.status)) return state.status;
  if (!Number.isInteger(state.supervisorPid) || !alive(state.supervisorPid)) return "INTERRUPTED";
  if (!Number.isFinite(Date.parse(state.updatedAt)) || now - Date.parse(state.updatedAt) > 30000) return "HEARTBEAT_STALE";
  if (state.status === "RUNNING" && (!Number.isInteger(state.workerPid) || !alive(state.workerPid))) return "WORKER_EXITED_WAITING_FOR_SUPERVISOR";
  return state.status;
}

// Read only appended bytes; handle replacement/truncation when logs rotate.
export function createLogTail(path) {
  let offset = 0, identity, pending = "", first = true;
  return () => {
    let fd;
    try {
      fd = openSync(path, "r");
      const info = fstatSync(fd), nextIdentity = `${info.dev}:${info.ino}:${info.birthtimeMs}`;
      if (identity !== nextIdentity || info.size < offset) { offset = 0; pending = ""; }
      identity = nextIdentity;
      if (info.size === offset) return [];
      const bytes = Buffer.alloc(info.size - offset);
      const count = readSync(fd, bytes, 0, bytes.length, offset);
      offset += count;
      const lines = (pending + bytes.subarray(0, count).toString("utf8")).split("\n");
      pending = lines.pop();
      const result = first ? lines.slice(-100) : lines;
      first = false;
      return result.filter(Boolean);
    } catch (error) {
      if (["ENOENT", "EACCES", "EPERM", "EBUSY"].includes(error.code)) return [];
      throw error;
    } finally { if (fd !== undefined) closeSync(fd); }
  };
}

export async function watchWorker(paths, { output = console.log, signals = process, sleep = delay,
  alive = isAlive, now = Date.now, pollMs = 1000, heartbeatMs = 10000 } = {}) {
  const tail = createLogTail(paths.log);
  let stopped = false, previous, lastPrint = -Infinity;
  const stop = () => { stopped = true; };
  signals.once("SIGINT", stop); signals.once("SIGTERM", stop);
  output("Live monitor: Ctrl+C closes this view only; the background worker continues.");
  try {
    while (!stopped) {
      const state = readStatus(paths.status), timestamp = now();
      const status = monitorStatus(state, alive, timestamp);
      for (const line of tail()) output(line);
      if (status !== previous || timestamp - lastPrint >= heartbeatMs) {
        const age = state?.updatedAt ? Math.max(0, Math.floor((timestamp - Date.parse(state.updatedAt)) / 1000)) : null;
        output(`[${new Date(timestamp).toISOString()}] ${status} | restarts=${state?.restarts ?? "?"} | heartbeat=${Number.isFinite(age) ? `${age}s ago` : "unknown"} | last=${state?.lastEvent || "none"}${state?.lastCode ? ` | code=${state.lastCode}` : ""}`);
        previous = status; lastPrint = timestamp;
      }
      if (status === "INTERRUPTED" || (state && !activeStates.has(state.status))) return status;
      await sleep(pollMs);
    }
    output("Monitor closed. Use workers:logs -- <run-id> --follow to reconnect, or workers:stop -- <run-id> to stop the worker.");
    return "DETACHED";
  } finally {
    signals.removeListener("SIGINT", stop); signals.removeListener("SIGTERM", stop);
  }
}
