export function matchingRunnerCommand(runner, apiBaseUrl) {
  if (!/^mrb_[A-Za-z0-9_-]{43}$/.test(runner?.ticket || "")) return "";
  const base = apiBaseUrl || globalThis.location?.origin || "";
  if (!/^https?:\/\/[a-z0-9.-]+(?::\d+)?\/?$/i.test(base)) return "";
  const url = new URL(base);
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) return "";
  return `npm run matching:run -- --batch-ticket "${runner.ticket}" --api-base-url "${url.origin}"`;
}
