import { createCodexProvider } from "./codex-provider.mjs";
import { createOpenAIProvider } from "./openai-provider.mjs";
import { MatchingError } from "./scoring.mjs";
import { MATCH_TICKET, matchingApiBase } from "./api-client.mjs";

export function readRunnerArguments(args = [], environment = process.env) {
  const values = {};
  for (let index = 0; index < args.length; index++) {
    const name = args[index];
    if (name === "--once") { values.once = true; continue; }
    if (!["--batch-ticket", "--api-base-url"].includes(name) || values[name] !== undefined
      || !args[index + 1] || args[index + 1].startsWith("--")) throw new MatchingError("MATCH_RUNNER_ARGUMENTS_INVALID");
    values[name] = args[++index];
  }
  const ticket = values["--batch-ticket"] || environment.MATCHING_BATCH_TICKET;
  if (!MATCH_TICKET.test(ticket || "")) throw new MatchingError("MATCH_TICKET_INVALID");
  return { ticket, apiBaseUrl: matchingApiBase(values["--api-base-url"] || environment.MATCHING_API_BASE_URL), once: values.once === true };
}

export function readMatchingConfiguration(environment = process.env) {
  const providerName = (environment.MATCHING_PROVIDER || "codex").trim().toLowerCase();
  if (!["codex", "openai"].includes(providerName)) throw new MatchingError("MATCHING_PROVIDER_INVALID");
  const model = environment.MATCHING_MODEL?.trim();
  // The server ticket supplies the model; an optional local setting is an assertion,
  // not a way to silently score with a different model or another database.
  if (model && (model === "UNCONFIGURED" || !/^[a-z0-9][a-z0-9._-]{0,100}$/i.test(model))) throw new MatchingError("MATCHING_NOT_CONFIGURED");
  const concurrency = Number(environment.MATCHING_CONCURRENCY || (providerName === "codex" ? 1 : 2));
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new MatchingError("MATCHING_CONCURRENCY_INVALID");
  return { providerName, model, concurrency };
}

export function createMatchingProvider(config, environment = process.env) {
  if (config.providerName === "openai") return createOpenAIProvider({ model: config.model, apiKey: environment.OPENAI_API_KEY });
  return createCodexProvider({ model: config.model, environment,
    bin: environment.MATCHING_CODEX_BIN || environment.TAILORING_CODEX_BIN || "codex",
    reasoningEffort: (environment.MATCHING_CODEX_REASONING_EFFORT || "low").trim().toLowerCase(),
    serviceTier: (environment.MATCHING_CODEX_SERVICE_TIER || "default").trim().toLowerCase() });
}

export function matchingErrorMessage(error) {
  const messages = {
    MATCHING_NOT_CONFIGURED: "Configure a scoring model in Supabase settings; API-provider mode also requires OPENAI_API_KEY. Codex mode does not use an API key.",
    MATCH_RUNNER_ARGUMENTS_INVALID: "Copy the full scoring command from the dashboard, including --batch-ticket and --api-base-url.",
    MATCH_API_URL_INVALID: "Use the dashboard/API HTTPS origin, or localhost for development, with --api-base-url.",
    MATCH_TICKET_INVALID: "Generate a scoring command in the dashboard and pass its --batch-ticket. No Supabase service key is required.",
    MATCH_TICKET_EXPIRED: "Generate a new scoring command in the dashboard; completed scores remain cached.",
    MATCH_TICKET_SCOPE: "This command cannot access that job/document. Generate a new command for the intended selection.",
    MATCH_WORKER_VERSION_MISMATCH: "Update the worker or local model override and generate a fresh command to match database settings.",
    DATABASE_MIGRATION_REQUIRED: "Apply scoring migration v3.76 and deploy/restart the updated API for single-pass scoring, then restart this command.",
    MATCH_API_ERROR: "Check that the updated scoring API is deployed and reachable.",
    MATCH_API_NETWORK_ERROR: "The scoring API could not be reached. Retry the same command; job leases recover automatically.",
    MATCH_API_INVALID_RESPONSE: "The scoring API returned an unexpected response. Check API and worker versions.",
    MATCHING_PROVIDER_INVALID: "MATCHING_PROVIDER must be codex or openai.",
    MATCHING_CONCURRENCY_INVALID: "MATCHING_CONCURRENCY must be an integer from 1 through 4.",
    CODEX_NOT_AVAILABLE: "Install Codex CLI or set MATCHING_CODEX_BIN to its executable path.",
    CODEX_CHATGPT_LOGIN_REQUIRED: "Run codex login on this worker host and sign in with ChatGPT, then restart the worker.",
    CODEX_CONFIGURATION_ERROR: "Check the Codex CLI version, model access, reasoning effort, and service tier.",
  };
  const code = error instanceof MatchingError && Object.hasOwn(messages, error.code) ? error.code : "MATCH_WORKER_ERROR";
  return `Matching worker stopped [${code}]. ${messages[code] || "Check the private worker configuration and provider access."}`;
}
