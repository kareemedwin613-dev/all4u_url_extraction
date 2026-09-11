import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { createMatchingProvider, matchingErrorMessage, readMatchingConfiguration, readRunnerArguments } from "./configuration.mjs";
import { EXTRACTOR_VERSION, RUBRIC_VERSION, MatchingError } from "./scoring.mjs";
import { createMatchingApiClient } from "./api-client.mjs";
import { createMatchingWorker } from "./worker.mjs";
import { createStageLogger, emitMatchingLog, matchingErrorFields } from "./logging.mjs";
import { SCORING_MODE } from "./direct-scoring.mjs";

const terminalLog = event => console.log(JSON.stringify(event));

export async function runMatchingCommand({ args = process.argv.slice(2), environment = process.env,
  createApi = createMatchingApiClient, createProvider = createMatchingProvider, log = terminalLog,
  sleep = delay, signals = process, now = Date.now } = {}) {
  if (args.includes("--help")) {
    console.log('npm run matching:run -- --batch-ticket "<dashboard-ticket>" --api-base-url "https://your-dashboard.example" [--once]\nCopy the scoring command from the dashboard, like tailoring. Codex uses your ChatGPT login; no Supabase credential is required. The model comes from the ticket. MATCHING_PROVIDER=openai explicitly opts into API-key model access.');
    return;
  }
  const started = now();
  const progress = createStageLogger(log);
  const runner = readRunnerArguments(args, environment);
  const config = readMatchingConfiguration(environment);
  progress.emit("matching.starting", { provider: config.providerName, concurrency: config.concurrency });
  const api = createApi(runner);
  const claim = await progress.run("ticket.claim", () => api.claim());
  if (claim?.scoringMode !== SCORING_MODE) throw new MatchingError("DATABASE_MIGRATION_REQUIRED");
  if (claim?.rubricVersion !== RUBRIC_VERSION || claim?.extractorVersion !== EXTRACTOR_VERSION
    || !/^[a-z0-9][a-z0-9._-]{0,100}$/i.test(claim?.modelId || "")
    || (config.model && config.model !== claim.modelId)) throw new MatchingError("MATCH_WORKER_VERSION_MISMATCH");
  const { concurrency, providerName } = config, model = claim.modelId;
  const provider = createProvider({ ...config, model }, environment);
  // Authentication failures must not claim jobs or consume their retry attempts.
  await progress.run("provider.check", () => provider.check?.());
  const rpc = api.rpc;
  const worker = createMatchingWorker({ rpc, provider, model, log });
  const settings = provider.settings || {};
  progress.emit("matching.started", { provider: providerName, model, concurrency, scoringMode: SCORING_MODE,
    reasoningEffort: ["none", "low", "medium", "high", "xhigh"].includes(settings.reasoningEffort) ? settings.reasoningEffort : undefined,
    serviceTier: ["auto", "default", "fast"].includes(settings.serviceTier) ? settings.serviceTier : undefined,
    modelTimeoutMs: Number.isInteger(settings.timeoutMs) ? settings.timeoutMs : undefined });
  let stopping = false, lastWaitingLog;
  const stop = () => {
    stopping = true;
    progress.emit("matching.stopping", { reason: "SIGNAL", activeJobs: worker.snapshot().activeJobs });
  };
  signals.once("SIGINT", stop);
  signals.once("SIGTERM", stop);
  try {
    const outcomes = await Promise.allSettled(Array.from({ length: concurrency }, async () => {
      try {
        while (!stopping) {
          let worked;
          try { worked = await worker.runOne(); }
          catch (error) {
            if (error.retryable && !error.stopWorker) {
              const retryAfterSeconds = Math.min(60, error.retryAfter || 5);
              progress.emit("matching.queue.retrying", { ...matchingErrorFields(error), retryAfterSeconds });
              await sleep(retryAfterSeconds * 1000); continue;
            }
            throw error;
          }
          if (!worked && (api.finished || runner.once)) break;
          if (!worked) {
            if (lastWaitingLog === undefined || now() - lastWaitingLog >= 15_000) {
              lastWaitingLog = now();
              const state = worker.snapshot();
              progress.emit("matching.waiting", { reason: state.cooldownRemainingMs > 0 ? "MODEL_COOLDOWN" : "NO_CLAIMABLE_JOBS",
                nextPollSeconds: api.retryAfterSeconds, ...state });
            }
            await sleep(api.retryAfterSeconds * 1000);
          }
        }
      } catch (error) { stopping = true; throw error; }
    }));
    const failed = outcomes.find(outcome => outcome.status === "rejected");
    if (failed) throw failed.reason;
    const summary = { ...worker.snapshot(), durationMs: now() - started };
    if (api.finished) progress.emit("matching.finished", { ...summary,
      failedCount: Number.isInteger(api.receipt?.failedCount) ? api.receipt.failedCount : 0 });
    else progress.emit("matching.paused", { ...summary, reason: stopping ? "SIGNAL" : "ONCE_NO_READY_WORK" });
  } finally {
    signals.removeListener("SIGINT", stop);
    signals.removeListener("SIGTERM", stop);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runMatchingCommand().catch(error => {
    emitMatchingLog(terminalLog, { event: "matching.stopped", ...matchingErrorFields(error) });
    console.error(matchingErrorMessage(error)); process.exitCode = 1;
  });
}
