import { MatchingError, modelOutputError } from "./scoring.mjs";

// Opt-in transport. No credentials or provider calls exist in the browser/API process.
export function createOpenAIProvider({ apiKey, model, fetchImpl = fetch, timeoutMs = 60_000 }) {
  if (!apiKey || !model || model === "UNCONFIGURED") throw new MatchingError("MATCHING_NOT_CONFIGURED");
  return {
    settings: Object.freeze({ timeoutMs }),
    async generate({ name, schema, instructions, input }) {
      if (JSON.stringify(input).length > 160_000) throw new MatchingError("SOURCE_TOO_LARGE");
      let response;
      try {
        response = await fetchImpl("https://api.openai.com/v1/responses", {
          method: "POST", signal: AbortSignal.timeout(timeoutMs),
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model, store: false, instructions, input: JSON.stringify(input),
            max_output_tokens: 5000, text: { format: { type: "json_schema", name, strict: true, schema } } }),
        });
      } catch { throw new MatchingError("MODEL_NETWORK_ERROR", true); }
      if (!response.ok) {
        const wait = Number(response.headers.get("retry-after"));
        throw new MatchingError(response.status === 429 ? "MODEL_RATE_LIMIT" : `MODEL_HTTP_${response.status}`,
          response.status === 429 || response.status >= 500, Number.isFinite(wait) && wait > 0 ? Math.min(wait, 900) : 30);
      }
      let body;
      try { body = await response.json(); } catch { throw modelOutputError("API_RESPONSE_NOT_JSON"); }
      if (!body || !Array.isArray(body.output)) throw modelOutputError("API_RESPONSE_SHAPE_INVALID");
      const content = body.output.flatMap(item => item?.type === "message" && Array.isArray(item.content) ? item.content : []).filter(Boolean);
      if (content.some(item => item.type === "refusal")) throw new MatchingError("MODEL_REFUSED");
      if (body.status !== "completed") throw new MatchingError("MODEL_INCOMPLETE", true);
      try { return JSON.parse(content.filter(item => item.type === "output_text").map(item => item.text).join("")); }
      catch { throw modelOutputError("MODEL_OUTPUT_NOT_JSON"); }
    },
  };
}
