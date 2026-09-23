import { pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { createCodexProvider } from "../../matching-worker/src/codex-provider.mjs";
import { failed, decide, instructions, modelInput, PROMPT_VERSION, savedSource, schemaFor } from "./review.mjs";

const safeCode = error => /^[A-Z][A-Z0-9_]{1,80}$/.test(error?.code || "") ? error.code : "JD_REVIEW_WORKER_ERROR";
export function configuration(args = process.argv.slice(2), env = process.env) {
  const option = name => args[args.indexOf(name) + 1];
  const ticket = args.includes("--batch-ticket") ? option("--batch-ticket") : env.JD_REVIEW_BATCH_TICKET;
  if (!/^jrb_[A-Za-z0-9_-]{43}$/.test(ticket || "")) throw Object.assign(Error(), { code: "JD_REVIEW_TICKET_INVALID" });
  const url = new URL(args.includes("--api-base-url") ? option("--api-base-url") : "");
  if (url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)
    || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost","127.0.0.1"].includes(url.hostname)))) throw Object.assign(Error(), { code: "JD_REVIEW_API_URL_INVALID" });
  return { ticket, apiBaseUrl: url.origin };
}
export function createApi(config, fetchImpl = fetch, wait = sleep) {
  return async (operation, body = {}) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetchImpl(`${config.apiBaseUrl}/api/v1/jd-review-runner`, {
          method: "POST", redirect: "error", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operation, ticket: config.ticket, ...body }), signal: AbortSignal.timeout(20000),
        });
        const payload = await response.json();
        if (!response.ok) throw Object.assign(Error(), { code: payload.code || "JD_REVIEW_API_ERROR", retryable: response.status === 429 || response.status >= 500 });
        return payload.data;
      } catch (error) {
        if (error.retryable === false || (error.code && error.retryable !== true)) throw error;
        if (attempt === 2) throw Object.assign(Error(), { code: safeCode(error) === "JD_REVIEW_WORKER_ERROR" ? "JD_REVIEW_API_UNAVAILABLE" : safeCode(error), retryable: true });
        await wait((attempt + 1) * 2000);
      }
    }
  };
}
export async function runReview({ api, provider = createCodexProvider, emit = () => {}, wait = sleep, signals = process } = {}) {
  let stopping = false, activeJobs = 0, completedCount = 0, failedCount = 0, batchFailedCount = 0;
  const stop = () => { stopping = true; };
  signals.on("SIGINT",stop); signals.on("SIGTERM",stop);
  const heartbeat = setInterval(() => emit({ event: "jd-review.heartbeat", activeJobs, completedCount, failedCount }),10000);
  const providers = new Map();
  emit({ event: "jd-review.started" });
  try {
    const lanes = await Promise.allSettled([0,1].map(async () => {
      while (!stopping) {
        let item;
        try { item = await api("next"); } catch (error) { stopping = true; throw error; }
        if (!item?.itemId) {
          if (item?.done) { batchFailedCount = Math.max(batchFailedCount, item.failedCount || 0); return; }
          await wait(5000); continue;
        }
        activeJobs++; const started = Date.now();
        try {
          if (item.promptVersion !== PROMPT_VERSION) throw Object.assign(Error(), { code: "JD_REVIEW_NEW_BATCH_REQUIRED", stopWorker: true });
          emit({ event: "jd-review.processing", stage: "SAVED_JD", itemId: item.itemId });
          const page = savedSource(item.job);
          let result;
          if (page.error) result = decide(null,page,item);
          else {
            if (!providers.has(item.model)) providers.set(item.model,provider({ model: item.model, reasoningEffort: "medium", serviceTier: "default" }));
            const engine = providers.get(item.model);
            emit({ event: "jd-review.processing", stage: "MODEL", itemId: item.itemId });
            let raw;
            for (let attempt = 0; attempt < 2; attempt++) {
              try { raw = await engine.generate({ schema:schemaFor(item),instructions,input: modelInput(item,page) }); break; }
              catch (error) {
                if (error.stopWorker) throw error;
                // Quota exhaustion is a worker problem, not a defect in every JD.
                if (error.code === "MODEL_RATE_LIMIT" && attempt === 1) throw error;
                if (!error.retryable || attempt === 1) { result = failed(safeCode(error)); break; }
                emit({ event: "jd-review.retry", stage: "MODEL", code: safeCode(error), itemId: item.itemId, attempt: attempt + 1 });
                await wait(error.code === "MODEL_RATE_LIMIT" ? 60000 : 2000);
              }
            }
            if (!result) result = decide(raw,page,item);
          }
          result.verification = { source: "SAVED_JD", liveUrlChecked: false, checkedAt: new Date().toISOString() };
          emit({ event: "jd-review.processing", stage: "SAVE", itemId: item.itemId });
          let saved;
          try { saved = await api("submit", { itemId: item.itemId, leaseToken: item.leaseToken, result }); }
          catch (error) {
            if (!["JD_REVIEW_RESULT_INVALID","JD_REVIEW_DATABASE_ERROR"].includes(error.code)) throw error;
            saved = await api("submit", { itemId: item.itemId, leaseToken: item.leaseToken, result: {
              ...failed("SAVE_REJECTED", "Proposed changes failed validation; original fields preserved."), verification: result.verification,
            } });
          }
          completedCount++;
          if (saved.status === "FAILED") failedCount++;
          emit({ event: "jd-review.completed", itemId: item.itemId, status: saved.status, durationMs: Date.now()-started, completedCount, failedCount });
        } catch (error) {
          if (["JD_REVIEW_LEASE_INVALID","JD_REVIEW_LEASE_EXPIRED"].includes(error.code)) {
            emit({ event: "jd-review.lease_lost", itemId: item.itemId, code: error.code });
          } else { stopping = true; throw error; }
        } finally { activeJobs--; }
      }
    }));
    const failure = lanes.find(x => x.status === "rejected");
    if (failure) throw failure.reason;
    return { status: stopping ? "STOPPED" : batchFailedCount || failedCount ? "COMPLETED_WITH_FAILURES" : "COMPLETED", completedCount, failedCount };
  } finally { clearInterval(heartbeat); signals.removeListener("SIGINT",stop); signals.removeListener("SIGTERM",stop); }
}
function report(message) { if (process.connected) process.send?.(message); }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  Promise.resolve().then(() => {
    const config = configuration();
    console.log("JD classification: saved description only / no URL visits / medium reasoning / concurrency 2. Keep the computer awake.");
    return runReview({ api: createApi(config), emit: event => { console.log(JSON.stringify(event)); report({ type: "worker.event", ...event }); } });
  }).then(result => { report({ type: "worker.result", ...result }); if (process.connected) process.disconnect(); })
    .catch(error => {
      const code = safeCode(error);
      console.error(["JD_REVIEW_LEGACY_BATCH","JD_REVIEW_NEW_BATCH_REQUIRED"].includes(code)
        ? `JD classification stopped [${code}]. Update the worker and apply migration v3.107, then create a new classification batch. Old batch history is preserved.`
        : `JD classification stopped [${code}]. Check Codex login and worker logs; no tickets or source text are logged.`);
      report({ type: "worker.result", status: error.retryable && !error.stopWorker ? "RETRYABLE_ERROR" : "ACTION_REQUIRED", code });
      process.exitCode = 1; if (process.connected) process.disconnect();
    });
}
