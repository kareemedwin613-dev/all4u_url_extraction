import { pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { createCodexProvider, runCodexCommand } from "../../matching-worker/src/codex-provider.mjs";
import { prepareImages } from "./images.mjs";
import { instructions, modelInput, PROMPT_VERSION, schema } from "./review.mjs";

const errorCode = e => /^[A-Z][A-Z0-9_]{1,80}$/.test(e?.code || "") ? e.code : "SCREENSHOT_REVIEW_WORKER_ERROR";
export function configuration(args = process.argv.slice(2), env = process.env) {
  const option = name => args[args.indexOf(name) + 1];
  const ticket = args.includes("--batch-ticket") ? option("--batch-ticket") : env.SCREENSHOT_REVIEW_BATCH_TICKET;
  if (!/^srb_[A-Za-z0-9_-]{43}$/.test(ticket || "")) throw Object.assign(Error(), { code: "SCREENSHOT_REVIEW_TICKET_INVALID" });
  const url = new URL(args.includes("--api-base-url") ? option("--api-base-url") : "");
  if (url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)
    || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))) throw Object.assign(Error(), { code: "SCREENSHOT_REVIEW_API_URL_INVALID" });
  return { ticket, apiBaseUrl: url.origin };
}
export function createApi(config, fetchImpl = fetch, wait = sleep) {
  return async (operation, body = {}) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetchImpl(`${config.apiBaseUrl}/api/v1/screenshot-review-runner`, {
          method: "POST", redirect: "error", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operation, ticket: config.ticket, ...body }), signal: AbortSignal.timeout(25000),
        });
        const payload = await response.json();
        if (!response.ok) throw Object.assign(Error(), { code: payload.code || "SCREENSHOT_REVIEW_API_ERROR", retryable: response.status === 429 || response.status >= 500 });
        return payload.data;
      } catch (error) {
        if (error.retryable === false) throw error;
        if (attempt === 2) throw Object.assign(Error(), { code: errorCode(error), retryable: true });
        await wait((attempt + 1) * 2000);
      }
    }
  };
}
export function visionProvider(model) {
  return createCodexProvider({ model, reasoningEffort: "medium", serviceTier: "default",
    // Vision has a five-minute DB lease. Do not change the matching worker's timeout.
    execute: options => runCodexCommand({ ...options, timeoutMs: options.args[0] === "exec" ? 180000 : options.timeoutMs }),
  });
}
export async function runReview({ api, provider = visionProvider, prepare = prepareImages, emit = () => {}, wait = sleep, signals = process } = {}) {
  let stopping = false, activeJobs = 0, completedCount = 0, failedCount = 0, batchFailedCount = 0;
  const stop = () => { stopping = true; }; signals.on("SIGINT", stop); signals.on("SIGTERM", stop);
  const heartbeat = setInterval(() => emit({ event: "screenshot-review.heartbeat", activeJobs, completedCount, failedCount }), 10000);
  const engines = new Map();
  emit({ event: "screenshot-review.started" });
  try {
    const lanes = await Promise.allSettled([0, 1].map(async () => {
      while (!stopping) {
        let item;
        try { item = await api("next"); } catch (error) { stopping = true; throw error; }
        if (!item?.itemId) { if (item?.done) { batchFailedCount = Math.max(batchFailedCount, item.failedCount || 0); break; } await wait(5000); continue; }
        const claim = { itemId: item.itemId, leaseToken: item.leaseToken }, started = Date.now();
        activeJobs++; let images;
        try {
          if (item.promptVersion !== PROMPT_VERSION) throw Object.assign(Error(), { code: "SCREENSHOT_REVIEW_NEW_WORKER_REQUIRED", stopWorker: true });
          if (!engines.has(item.model)) engines.set(item.model, provider(item.model));
          const engine = engines.get(item.model); await engine.check();
          emit({ event: "screenshot-review.processing", stage: "IMAGES", itemId: item.itemId });
          images = await prepare(item);
          emit({ event: "screenshot-review.processing", stage: "MODEL", itemId: item.itemId });
          const result = await engine.generate({ schema, instructions, input: modelInput(item, images.manifest), images: images.paths });
          emit({ event: "screenshot-review.processing", stage: "SAVE", itemId: item.itemId });
          const saved = await api("submit", { ...claim, result });
          completedCount++; if (["FAILED", "CANNOT_VERIFY"].includes(saved.status)) failedCount++;
          emit({ event: "screenshot-review.completed", itemId: item.itemId, status: saved.status, durationMs: Date.now() - started, completedCount, failedCount });
        } catch (error) {
          const code = errorCode(error);
          if (error.stopWorker || code === "MODEL_RATE_LIMIT" || code.startsWith("CODEX_") || error.retryable) { stopping = true; throw error; }
          if (!code.includes("LEASE_")) {
            try { await api("fail", { ...claim, code }); } catch (saveError) { stopping = true; throw saveError; }
          }
          failedCount++;
          emit({ event: "screenshot-review.failed", itemId: item.itemId, code, durationMs: Date.now() - started });
        } finally { activeJobs--; await images?.cleanup(); }
      }
    }));
    const failed = lanes.find(x => x.status === "rejected"); if (failed) throw failed.reason;
    return { status: stopping ? "STOPPED" : batchFailedCount || failedCount ? "COMPLETED_WITH_FAILURES" : "COMPLETED", completedCount, failedCount };
  } finally { clearInterval(heartbeat); signals.removeListener("SIGINT", stop); signals.removeListener("SIGTERM", stop); }
}
const report = message => { if (process.connected) process.send?.(message); };
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  Promise.resolve().then(() => runReview({ api: createApi(configuration()), emit: event => { console.log(JSON.stringify(event)); report({ type: "worker.event", ...event }); } }))
    .then(result => { report({ type: "worker.result", ...result }); if (process.connected) process.disconnect(); })
    .catch(error => {
      const code = errorCode(error); console.error(`Screenshot review stopped [${code}]. Check Codex login, model access and batch diagnostics. No screenshots or credentials are logged.`);
      report({ type: "worker.result", status: error.retryable && !error.stopWorker ? "RETRYABLE_ERROR" : "ACTION_REQUIRED", code });
      process.exitCode = 1; if (process.connected) process.disconnect();
    });
}
