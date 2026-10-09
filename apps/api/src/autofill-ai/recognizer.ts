// The API's AI calls (scripts/security-check.mjs allows them in this folder and the isolated workers only):
//   recognizeQuestions: which known answer an employer question asks for. Sends question wording, option labels and
//     the names of known answers, never candidate, Resume or JD content.
//   structuredCall: the provider call itself, shared with drafting (drafter.ts).
import type { ProviderId } from "./model-catalog.js";

export interface RecognizerTarget { key: string; question: string; wordings?: string[] }
export interface RecognizerQuestion { index: number; question: string; controlType: string; options?: string[] }
export type AnswerKind = "same_for_everyone" | "depends_on_profile" | "essay" | "not_a_question";
export interface RecognizerResult { index: number; target: string; confidence: number; kind: AnswerKind | null }
const KINDS = new Set(["same_for_everyone", "depends_on_profile", "essay", "not_a_question"]);
export interface Usage { inputTokens: number; cachedTokens: number; outputTokens: number }
export interface RecognizerOutput extends Usage { results: RecognizerResult[] }

const INSTRUCTIONS = [
  "You match job-application form questions to answers a candidate profile already has.",
  "For each question, choose the one target whose stored answer would correctly answer the question exactly as it is asked.",
  "Choose \"none\" when no target fits, when the question asks for something narrower or different (another country, a specific skill or tool, a specific number of years, an essay or explanation), or when it combines several questions.",
  "Option labels show what kind of answer the form expects. Do not guess.",
  "confidence is 0-100: how sure you are that the chosen target answers this exact question.",
  "kind says what sort of question it is: same_for_everyone (every candidate would give the same answer, such as work arrangement, schedule, travel, contract roles, notice period),",
  "depends_on_profile (the answer comes from the candidate's own background, such as years with a skill, a licence, a degree), essay (open-ended, such as why this company or describe a project),",
  "or not_a_question (a statement, consent, attestation, signature or heading).",
].join(" ");

const SCHEMA = {
  type: "object", additionalProperties: false, required: ["results"],
  properties: {
    results: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["index", "target", "confidence", "kind"],
        properties: { index: { type: "integer" }, target: { type: "string" }, confidence: { type: "integer" }, kind: { type: "string", enum: [...KINDS] } },
      },
    },
  },
};

export class RecognizerError extends Error {
  constructor(readonly code: string) { super(code); }
}

async function post(fetchImpl: typeof fetch, url: string, apiKey: string, body: unknown, timeoutMs: number) {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST", signal: AbortSignal.timeout(timeoutMs),
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
  } catch { throw new RecognizerError("MODEL_NETWORK_ERROR"); }
  if (!response.ok) throw new RecognizerError(response.status === 429 ? "MODEL_RATE_LIMIT" : `MODEL_HTTP_${response.status}`);
  try { return await response.json(); } catch { throw new RecognizerError("MODEL_RESPONSE_NOT_JSON"); }
}

// One model call with a strict JSON schema. OpenAI: Responses API with store: false. xAI (Grok): OpenAI-compatible
// Chat Completions, stateless. Returns the parsed JSON and token usage.
export async function structuredCall(
  { provider, apiKey, model, instructions, input, name, schema, maxOutputTokens, temperature = 0, fetchImpl = fetch, timeoutMs = 10_000 }:
  { provider: ProviderId; apiKey: string; model: string; instructions: string; input: string; name: string; schema: object; maxOutputTokens: number; temperature?: number; fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<{ data: any } & Usage> {
  let text: string, usage: Usage;
  if (provider === "xai") {
    const body: any = await post(fetchImpl, "https://api.x.ai/v1/chat/completions", apiKey, {
      model, temperature, max_tokens: maxOutputTokens,
      messages: [{ role: "system", content: instructions }, { role: "user", content: input }],
      response_format: { type: "json_schema", json_schema: { name, strict: true, schema } },
    }, timeoutMs);
    const choice = Array.isArray(body?.choices) ? body.choices[0] : null;
    if (!choice?.message) throw new RecognizerError("MODEL_INCOMPLETE");
    if (choice.message.refusal) throw new RecognizerError("MODEL_REFUSED");
    if (choice.finish_reason && choice.finish_reason !== "stop") throw new RecognizerError("MODEL_INCOMPLETE");
    text = String(choice.message.content || "");
    usage = { inputTokens: Number(body?.usage?.prompt_tokens) || 0, cachedTokens: Number(body?.usage?.prompt_tokens_details?.cached_tokens) || 0, outputTokens: Number(body?.usage?.completion_tokens) || 0 };
  } else {
    const body: any = await post(fetchImpl, "https://api.openai.com/v1/responses", apiKey, {
      model, store: false, instructions, max_output_tokens: maxOutputTokens, input,
      text: { format: { type: "json_schema", name, strict: true, schema } },
    }, timeoutMs);
    if (body?.status !== "completed" || !Array.isArray(body?.output)) throw new RecognizerError("MODEL_INCOMPLETE");
    const content = body.output.flatMap((item: any) => item?.type === "message" && Array.isArray(item.content) ? item.content : []);
    if (content.some((item: any) => item?.type === "refusal")) throw new RecognizerError("MODEL_REFUSED");
    text = content.filter((item: any) => item?.type === "output_text").map((item: any) => item.text).join("");
    usage = { inputTokens: Number(body?.usage?.input_tokens) || 0, cachedTokens: Number(body?.usage?.input_tokens_details?.cached_tokens) || 0, outputTokens: Number(body?.usage?.output_tokens) || 0 };
  }
  try { return { data: JSON.parse(text), ...usage }; } catch { throw new RecognizerError("MODEL_OUTPUT_INVALID"); }
}

export async function recognizeQuestions(
  { provider, apiKey, model, targets, questions, fetchImpl = fetch, timeoutMs = 10_000 }:
  { provider: ProviderId; apiKey: string; model: string; targets: RecognizerTarget[]; questions: RecognizerQuestion[]; fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<RecognizerOutput> {
  // Targets come before questions, so the long unchanging start of each request is billed at the cached rate.
  const { data, ...usage } = await structuredCall({ provider, apiKey, model, instructions: INSTRUCTIONS, input: JSON.stringify({ targets, questions }),
    name: "autofill_question_targets", schema: SCHEMA, maxOutputTokens: 1500, fetchImpl, timeoutMs });
  const results = (Array.isArray(data?.results) ? data.results : [])
    .filter((item: any) => Number.isInteger(item?.index) && typeof item?.target === "string" && Number.isFinite(item?.confidence))
    .map((item: any) => ({ index: item.index, target: item.target, confidence: Math.max(0, Math.min(100, Math.round(item.confidence))), kind: KINDS.has(item.kind) ? item.kind : null }));
  return { results, ...usage };
}
