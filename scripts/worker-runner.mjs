import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { isAlive, readStatus, runIdentity, runPaths, RUN_ID, supervise, workerCommand } from "./worker-supervisor.mjs";
import { watchWorker } from "./worker-monitor.mjs";

const self = fileURLToPath(import.meta.url), root = resolve(dirname(self), "..");
const [operation, ...args] = process.argv.slice(2);

async function main() {
  if (operation === "_supervise") {
    let input = "";
    const timeout = setTimeout(() => process.exit(1), 10000);
    for await (const chunk of process.stdin) { input += chunk; if (input.length > 65536) throw Error("Runner configuration is too large."); }
    clearTimeout(timeout);
    const config = JSON.parse(input);
    if (config.root !== root || !["matching", "tailoring"].includes(config.kind) || !Array.isArray(config.args)
      || config.runId !== runIdentity(config.kind, config.ticket, config.apiBaseUrl)) throw Error("Invalid runner configuration.");
    await supervise(config); return;
  }
  if (["status", "logs", "stop"].includes(operation)) {
    if (operation === "status") {
      const directory = resolve(root, "artifacts/worker-runs");
      const runs = existsSync(directory) ? readdirSync(directory).filter(id => RUN_ID.test(id)) : [];
      for (const id of runs) {
        const state = readStatus(runPaths(root, id).status);
        if (!state) continue;
        const live = isAlive(state.supervisorPid);
        console.log(`${id}  ${live ? state.status : ["RUNNING", "RETRYING", "STARTING"].includes(state.status) ? "INTERRUPTED" : state.status}  restarts=${state.restarts}  last=${state.lastCode || state.lastEvent || "—"}`);
      }
      if (!runs.length) console.log("No background worker runs yet.");
      return;
    }
    const paths = runPaths(root, args[0]);
    if (operation === "logs") {
      if (args.includes("--follow")) {
        if (!readStatus(paths.status)) throw Error("Worker run not found.");
        await watchWorker(paths);
      } else console.log(readFileSync(paths.log, "utf8").split("\n").slice(-101).join("\n"));
      return;
    }
    const state = readStatus(paths.status);
    if (!state || !isAlive(state.supervisorPid) || !["STARTING", "RUNNING", "RETRYING"].includes(state.status)) {
      console.log("This worker is not running."); return;
    }
    writeFileSync(paths.stop, "stop", { mode: 0o600 }); console.log("Stop requested. Completed results are preserved."); return;
  }
  if (!["matching", "tailoring"].includes(operation)) throw Error("Use matching, tailoring, status, logs or stop.");
  const ticketIndex = args.indexOf("--batch-ticket"), ticket = ticketIndex >= 0 ? args[ticketIndex + 1] : undefined;
  const foreground = args.includes("--foreground") || args.includes("--once") || !ticket;
  if (foreground) {
    const command = workerCommand(root, operation, args.filter(arg => arg !== "--foreground"));
    const child = spawn(command.command, command.args, { ...command.options, stdio: "inherit" });
    child.on("error", () => { console.error("Worker launch failed."); process.exitCode = 1; });
    child.on("exit", code => { process.exitCode = code ?? 1; }); return;
  }
  if (!(operation === "matching" ? /^mrb_[A-Za-z0-9_-]{43}$/ : /^trb_[A-Za-z0-9_-]{43}$/).test(ticket || "")) throw Error("Invalid batch ticket. Copy the command from the dashboard.");
  const urlIndex = args.indexOf("--api-base-url"), apiBaseUrl = args[urlIndex + 1];
  if (urlIndex < 0 || !apiBaseUrl) throw Error("A batch command requires --api-base-url.");
  const url = new URL(apiBaseUrl);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))) throw Error("Invalid API base URL.");
  const workerArgs = args.filter((arg, index) => index !== ticketIndex && index !== ticketIndex + 1 && !["--detach", "--follow"].includes(arg));
  const runId = runIdentity(operation, ticket, url.origin), paths = runPaths(root, runId);
  const previous = readStatus(paths.status);
  if (["COMPLETED", "COMPLETED_WITH_FAILURES"].includes(previous?.status)) {
    console.log(`This run already finished: ${runId} (${previous.status}). See npm run workers:logs -- ${runId}`); return;
  }
  if (!previous || !isAlive(previous.supervisorPid) || !["STARTING", "RUNNING", "RETRYING"].includes(previous.status)) {
    const child = spawn(process.execPath, [self, "_supervise"], {
      cwd: root, detached: true, windowsHide: true, shell: false, stdio: ["pipe", "ignore", "ignore"],
    });
    await new Promise((accept, reject) => { child.once("spawn", accept); child.once("error", reject); });
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify({ root, kind: operation, args: workerArgs, ticket, apiBaseUrl: url.origin, runId }));
    child.unref();
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const state = readStatus(paths.status);
      if (state?.supervisorPid === child.pid || (state && isAlive(state.supervisorPid) && ["STARTING", "RUNNING", "RETRYING"].includes(state.status))) { ready = true; break; }
      await delay(100);
    }
    if (!ready) throw Error("The background worker did not start. Retry with --foreground to inspect startup errors.");
  }
  console.log(`Background ${operation} run: ${runId}\nYou can close this terminal; the worker continues and retries unexpected exits.\nLog: ${paths.log}\nStatus: npm run workers:status\nLogs: npm run workers:logs -- ${runId} --follow\nStop: npm run workers:stop -- ${runId}`);
  if (!args.includes("--detach") && (process.stdout.isTTY || args.includes("--follow"))) await watchWorker(paths);
}
main().catch(() => { console.error("Worker runner failed. Check the command, dependencies and artifact-directory permissions; use --foreground for detailed worker diagnostics."); process.exitCode = 1; });
