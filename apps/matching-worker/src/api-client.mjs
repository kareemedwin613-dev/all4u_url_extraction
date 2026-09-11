import { MatchingError } from "./scoring.mjs";
import { SCORING_MODE } from "./direct-scoring.mjs";

export const MATCH_TICKET = /^mrb_[A-Za-z0-9_-]{43}$/;
export function matchingApiBase(value) {
  try {
    const url = new URL(value);
    if (!/^https?:\/\/[a-z0-9.-]+(?::\d+)?\/?$/i.test(value) || url.username || url.password
      || (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname))) throw new Error();
    return url.origin;
  } catch { throw new MatchingError("MATCH_API_URL_INVALID"); }
}

export function createMatchingApiClient({ apiBaseUrl, ticket, fetchImpl = fetch }) {
  const base = matchingApiBase(apiBaseUrl);
  if (!MATCH_TICKET.test(ticket || "")) throw new MatchingError("MATCH_TICKET_INVALID");
  let state = "WAITING", retryAfterSeconds = 5, receipt;
  const call = async (operation, payload = {}) => {
    let response;
    try {
      response = await fetchImpl(`${base}/api/v1/application-match-runner/${operation}`, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(30_000),
        headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, ticket }),
      });
    } catch { throw new MatchingError("MATCH_API_NETWORK_ERROR", true); }
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const known = new Set(["MATCH_TICKET_INVALID", "MATCH_TICKET_EXPIRED", "MATCH_TICKET_SCOPE", "MATCH_LEASE_EXPIRED",
        "MATCH_WORKER_VERSION_MISMATCH", "MATCH_INVALID_REQUEST", "MATCH_INVALID_RESULT", "DATABASE_MIGRATION_REQUIRED"]);
      const code = response.status === 429 ? "MATCH_API_RATE_LIMIT" : known.has(body?.code) ? body.code : "MATCH_API_ERROR";
      const error = new MatchingError(code, response.status === 429 || response.status >= 500,
        Math.max(5, Math.min(60, Number(response.headers.get("retry-after")) || 5)));
      if (["MATCH_TICKET_INVALID", "MATCH_TICKET_EXPIRED", "MATCH_TICKET_SCOPE", "MATCH_WORKER_VERSION_MISMATCH", "DATABASE_MIGRATION_REQUIRED"].includes(code)) error.stopWorker = true;
      throw error;
    }
    if (!body || !Object.hasOwn(body, "data")) throw new MatchingError("MATCH_API_INVALID_RESPONSE", true);
    return body.data;
  };
  return {
    get finished() { return state === "COMPLETED"; },
    get retryAfterSeconds() { return retryAfterSeconds; },
    get receipt() { return receipt; },
    claim: () => call("claim"),
    async rpc(name, args = {}, context) {
      if (name === "claim_application_match") {
        const next = await call("next", { modelId: args.p_model_id, rubricVersion: args.p_rubric_version,
          extractorVersion: args.p_extractor_version, scoringMode: SCORING_MODE });
        if (!["JOB", "WAITING", "COMPLETED"].includes(next?.state)) throw new MatchingError("MATCH_API_INVALID_RESPONSE", true);
        state = next.state; receipt = next;
        retryAfterSeconds = Math.max(5, Math.min(60, Number(next.retryAfterSeconds) || 5));
        if (state !== "JOB") return null;
        if (!["id", "leaseToken", "jdDocumentId", "resumeDocumentId"].every(key => /^[0-9a-f-]{36}$/i.test(next[key] || ""))) throw new MatchingError("MATCH_API_INVALID_RESPONSE", true);
        if (next.scoringMode !== SCORING_MODE) throw Object.assign(new MatchingError("DATABASE_MIGRATION_REQUIRED"), { stopWorker: true });
        return next;
      }
      if (["claim_application_match_document", "complete_application_match_document"].includes(name)) {
        if (!context?.id || !context?.leaseToken) throw new MatchingError("MATCH_TICKET_SCOPE");
        const payload = { jobId: context.id, leaseToken: context.leaseToken, documentId: args.p_id };
        return name === "claim_application_match_document" ? call("document", payload)
          : call("document-result", { ...payload, documentLeaseToken: args.p_lease_token, analysis: args.p_analysis });
      }
      if (name === "complete_application_match") return call("result", { jobId: args.p_id, leaseToken: args.p_lease_token, result: args.p_result });
      if (name === "fail_application_match") return call("failure", { jobId: args.p_id, leaseToken: args.p_lease_token,
        code: args.p_code, retryable: args.p_retryable, retryAfterSeconds: args.p_retry_after });
      throw new MatchingError("MATCH_INVALID_REQUEST");
    },
  };
}
