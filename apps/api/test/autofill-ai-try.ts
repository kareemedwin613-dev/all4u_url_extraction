// Manual check of AI question recognition against the real model. No database, no Autofill session.
// Run from apps/api with the key in apps/api/.env (XAI_API_KEY=... and/or OPENAI_API_KEY=...):
//   npx tsx --env-file=.env test/autofill-ai-try.ts xai grok-4.20-0309-non-reasoning
//   npx tsx --env-file=.env test/autofill-ai-try.ts openai gpt-6-luna
// Sends only the sample wording; costs a fraction of a cent. The dashboard's "Test this model" runs the same check.
import { ANSWER_TARGETS } from "../src/autofill-ai/autofill-ai.service.js";
import { costMicroUsd, findModel, isProvider, PROVIDERS } from "../src/autofill-ai/model-catalog.js";
import { recognizeQuestions } from "../src/autofill-ai/recognizer.js";
import { SAMPLE_QUESTIONS, SAMPLE_TARGETS } from "../src/autofill-ai/sample-questions.js";

const [providerArg = "xai", modelArg] = process.argv.slice(2);
if (!isProvider(providerArg)) { console.error("Provider must be xai or openai."); process.exit(1); }
const provider = providerArg, model = modelArg || PROVIDERS[provider].defaultModel, apiKey = process.env[PROVIDERS[provider].keyEnv] || "";
if (!findModel(provider, model)) { console.error(`Unknown ${provider} model. Choose: ${PROVIDERS[provider].models.map((item) => item.id).join(", ")}`); process.exit(1); }
if (!apiKey) { console.error(`Set ${PROVIDERS[provider].keyEnv} in apps/api/.env (it is never printed).`); process.exit(1); }

const started = Date.now();
const output = await recognizeQuestions({
  provider, apiKey, model, targets: [...SAMPLE_TARGETS, ...ANSWER_TARGETS], timeoutMs: 20_000,
  questions: SAMPLE_QUESTIONS.map(([question, options], index) => ({ index, question, controlType: options.length ? "radio" : "input", options })),
});
const byIndex = new Map(output.results.map((item) => [item.index, item]));
let correct = 0;
for (const [index, [question, , expected]] of SAMPLE_QUESTIONS.entries()) {
  const got = byIndex.get(index), used = got && got.confidence >= 80 ? got.target : "none";
  const ok = expected.includes(used); if (ok) correct++;
  console.log(`${ok ? "OK  " : "MISS"} ${String(got?.confidence ?? "-").padStart(3)}%  ${used.padEnd(28)} ${question}${ok ? "" : `   (expected ${expected.join(" or ")})`}`);
}
const cost = costMicroUsd(provider, model, output.inputTokens, output.cachedTokens, output.outputTokens);
console.log(`\n${correct}/${SAMPLE_QUESTIONS.length} as expected · ${provider}/${model} · ${Date.now() - started} ms · ${output.inputTokens} in (${output.cachedTokens} cached) / ${output.outputTokens} out · $${(cost / 1e6).toFixed(5)}`);
