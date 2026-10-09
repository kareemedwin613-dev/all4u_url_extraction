import test from "node:test";
import assert from "node:assert/strict";
import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";

Object.assign(process.env, {
  NODE_ENV: "test", PORT: "3001", API_BASE_PATH: "api/v1", CORS_ORIGINS: "http://localhost:4173",
  SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_OR_PUBLISHABLE_KEY: "publishable-test-key-with-safe-length",
  SUPABASE_JWT_ISSUER: "https://example.supabase.co/auth/v1", SUPABASE_JWKS_URL: "https://example.supabase.co/auth/v1/.well-known/jwks.json",
  RATE_LIMIT_TTL_MS: "60000", RATE_LIMIT_MAX: "60", INGESTION_RATE_LIMIT_MAX: "20", LOG_LEVEL: "error", SWAGGER_ENABLED: "false",
  SUPABASE_SECRET_KEY: "server-secret-test-key-0000000", OPENAI_API_KEY: "openai-test-key-000000000000", XAI_API_KEY: "xai-test-key-00000000000000000",
  AUTOFILL_AI_ENABLED: "true", AUTOFILL_AI_PROVIDER: "openai", AUTOFILL_AI_MODEL: "gpt-6-luna",
});
const { resetEnvironmentForTests } = await import("../src/config/environment.js");
const { AutofillAiService, resolveSettings } = await import("../src/autofill-ai/autofill-ai.service.js");
const { RecognizeAutofillQuestionsDto, SaveAutofillAiSettingsDto } = await import("../src/autofill-ai/autofill-ai.dto.js");
const { costMicroUsd } = await import("../src/autofill-ai/model-catalog.js");

const user = { id: "10000000-0000-4000-8000-000000000001", token: "jwt", email: "a@example.com" } as any;
const session = "00000000-0000-4000-8000-000000000001", guide = "guide.a0000000-0000-4000-8000-000000000001";
const env = (values: Record<string, string>) => { Object.assign(process.env, values); resetEnvironmentForTests(); };
const xaiSettings = { enabled: true, provider: "xai", recognitionModel: "grok-4.20-0309-non-reasoning", draftingModel: "grok-4.3", monthlyCapUsd: 50 };

// Answers like either provider: OpenAI Responses or xAI Chat Completions.
function modelResponse(url: string, model: any, usage = { input: 1000, cached: 0, output: 200 }) {
  const text = JSON.stringify(model);
  return url.includes("api.x.ai")
    ? { choices: [{ finish_reason: "stop", message: { role: "assistant", content: text } }], usage: { prompt_tokens: usage.input, completion_tokens: usage.output, prompt_tokens_details: { cached_tokens: usage.cached } } }
    : { status: "completed", usage: { input_tokens: usage.input, output_tokens: usage.output, input_tokens_details: { cached_tokens: usage.cached } }, output: [{ type: "message", content: [{ type: "output_text", text }] }] };
}

function harness({ hits = [] as any[], monthCostMicroUsd = 0, model = { results: [] as any[] }, status = 200, settings = null as any, usage = undefined as any, rpcData = {} as Record<string, any> } = {}) {
  const calls: any = { rpc: [], model: [], save: [] };
  const supabase = { forUser: (token: string) => ({ rpc: async (name: string, args: any) => {
    calls.rpc.push({ token, name, args });
    if (name in rpcData) return rpcData[name];
    return { data: { hits, settings, targets: [{ key: guide, question: "Are you legally authorized to work in the US?", wordings: ["authorized to work"] }], monthCostMicroUsd }, error: null };
  } }) } as any;
  const fetchImpl = (async (url: string, init: any) => {
    calls.model.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization });
    return { ok: status === 200, status, headers: new Headers(), json: async () => modelResponse(url, model, usage) };
  }) as any;
  const admin = (url: string, key: string) => ({ rpc: async (name: string, args: any) => { calls.save.push({ url, key, name, args }); return { error: null }; } });
  return { calls, service: new AutofillAiService(supabase, fetchImpl, admin) };
}
const ask = (...questions: string[]) => ({ questions: questions.map((question) => ({ question, controlType: "radio", options: ["Yes", "No"] })) }) as any;

test("v3.161 validates recognition requests: wording and option labels only, bounded", async () => {
  assert.deepEqual(await validate(plainToInstance(RecognizeAutofillQuestionsDto, ask("Are you authorized?"))), []);
  assert.ok((await validate(plainToInstance(RecognizeAutofillQuestionsDto, { questions: [{ question: "Q", controlType: "file" }] }))).length > 0);
  assert.ok((await validate(plainToInstance(RecognizeAutofillQuestionsDto, { questions: Array.from({ length: 31 }, () => ({ question: "Q", controlType: "input" })) }))).length > 0);
});

test("v3.161 answers known wordings from the table without calling the model", async () => {
  env({ AUTOFILL_AI_ENABLED: "true" });
  const { calls, service } = harness({ hits: [{ index: 0, targetKey: guide, confidence: 93 }, { index: 1, targetKey: "none", confidence: 90 }] });
  const out = await service.recognize(user, session, ask("Are you authorised to work in the U.S.?", "Why us?"));
  assert.equal(out.ai, "NOT_NEEDED");
  assert.deepEqual(out.results, [{ index: 0, targetKey: guide, source: "LEARNED", kind: null }, { index: 1, targetKey: null, source: "LEARNED", kind: null }]);
  assert.equal(calls.model.length, 0);
  assert.equal(calls.rpc[0].token, "jwt", "lookup runs as the Applier");
  assert.equal(calls.rpc[0].name, "lookup_autofill_learned_wordings_v3161");
});

test("v3.161 asks the model only for new wordings, keeps confident known targets, and saves with the server key", async () => {
  env({ AUTOFILL_AI_ENABLED: "true", AUTOFILL_AI_PROVIDER: "openai", AUTOFILL_AI_MODEL: "gpt-6-luna" });
  const { calls, service } = harness({
    hits: [{ index: 0, targetKey: guide, confidence: 93 }],
    model: { results: [
      { index: 0, target: "answer.requires_sponsorship", confidence: 91 },
      { index: 1, target: "none", confidence: 88 },
      { index: 2, target: guide, confidence: 55 },
      { index: 3, target: "answer.favourite_colour", confidence: 99 },
    ] },
  });
  const out = await service.recognize(user, session, ask("Known one", "Will you need sponsorship? Email jobs@acme.com", "Why us?", "Unsure one", "Made-up key"));
  assert.equal(out.ai, "USED");
  assert.deepEqual(out.results.map((item: any) => [item.targetKey, item.source]), [[guide, "LEARNED"], ["answer.requires_sponsorship", "AI"], [null, null], [null, null], [null, null]]);
  const sent = calls.model[0].body, input = JSON.parse(sent.input);
  assert.equal(calls.model[0].url, "https://api.openai.com/v1/responses");
  assert.equal(sent.model, "gpt-6-luna");
  assert.equal(sent.store, false);
  assert.deepEqual(input.questions.map((item: any) => item.question), ["Will you need sponsorship? Email [email]", "Why us?", "Unsure one", "Made-up key"], "only misses are sent, scrubbed");
  assert.deepEqual(Object.keys(input), ["targets", "questions"], "unchanging targets first, so they are billed at the cached rate");
  assert.doesNotMatch(sent.input, /"value"|150K|candidate@/i, "no answers or candidate values are sent");
  const save = calls.save[0];
  assert.equal(save.key, "server-secret-test-key-0000000");
  assert.equal(save.name, "save_autofill_learned_wordings_v3161");
  assert.equal(save.args.p_user_id, user.id);
  assert.deepEqual(save.args.p_items.map((item: any) => item.targetKey), ["answer.requires_sponsorship", "none", guide], "unknown targets are never saved; the database drops low confidence");
  assert.deepEqual(save.args.p_usage, { questions: 4, inputTokens: 1000, outputTokens: 200, costMicroUsd: 200 });
});

test("v3.161 the Admin's saved settings choose Grok: xAI chat completions with a strict schema, cached tokens priced lower", async () => {
  env({ AUTOFILL_AI_ENABLED: "false", AUTOFILL_AI_PROVIDER: "openai" });
  const { calls, service } = harness({ settings: xaiSettings, model: { results: [{ index: 0, target: guide, confidence: 95 }] }, usage: { input: 3000, cached: 2400, output: 100 } });
  const out = await service.recognize(user, session, ask("Can you lawfully work in the US?"));
  assert.equal(out.ai, "USED", "dashboard settings override the environment default (off)");
  assert.equal(calls.model[0].url, "https://api.x.ai/v1/chat/completions");
  assert.equal(calls.model[0].auth, "Bearer xai-test-key-00000000000000000");
  const body = calls.model[0].body;
  assert.equal(body.model, "grok-4.20-0309-non-reasoning");
  assert.equal(body.response_format.type, "json_schema");
  assert.equal(body.response_format.json_schema.strict, true);
  assert.equal(body.messages[0].role, "system");
  // 600 uncached x $1.25 + 2,400 cached x $0.20 + 100 out x $2.50 per million = 750 + 480 + 250 micro-USD.
  assert.equal(calls.save[0].args.p_usage.costMicroUsd, 1480);
  assert.equal(calls.save[0].args.p_model, "grok-4.20-0309-non-reasoning");
});

test("v3.161 never calls the model when switched off, without the chosen provider's key, or over the cap", async () => {
  let h = harness({ settings: { ...xaiSettings, enabled: false } });
  assert.equal((await h.service.recognize(user, session, ask("New?"))).ai, "DISABLED");
  env({ XAI_API_KEY: "" });
  h = harness({ settings: xaiSettings });
  assert.equal((await h.service.recognize(user, session, ask("New?"))).ai, "NOT_CONFIGURED", "Grok chosen but only the OpenAI key is set");
  env({ XAI_API_KEY: "xai-test-key-00000000000000000" });
  h = harness({ settings: xaiSettings, monthCostMicroUsd: 50_000_000 });
  assert.equal((await h.service.recognize(user, session, ask("New?"))).ai, "CAP_REACHED");
  assert.equal(h.calls.model.length, 0);
});

test("v3.161 a model failure leaves the questions for a person and blocks nothing", async () => {
  env({ AUTOFILL_AI_ENABLED: "true", AUTOFILL_AI_PROVIDER: "openai" });
  const { calls, service } = harness({ status: 500 });
  const out = await service.recognize(user, session, ask("New?"));
  assert.equal(out.ai, "FAILED");
  assert.deepEqual(out.results, [{ index: 0, targetKey: null, source: null }]);
  assert.equal(calls.save.length, 0);
});

test("v3.161 without the server key, recognized wordings are used but not saved", async () => {
  env({ AUTOFILL_AI_ENABLED: "true", SUPABASE_SECRET_KEY: "" });
  const { calls, service } = harness({ model: { results: [{ index: 0, target: guide, confidence: 95 }] } });
  const out = await service.recognize(user, session, ask("Can you work in the US?"));
  assert.equal(out.results[0].targetKey, guide);
  assert.equal(calls.save.length, 0);
  env({ SUPABASE_SECRET_KEY: "server-secret-test-key-0000000" });
});

test("v3.161 settings resolve from the dashboard first, then the environment; unknown models fall back to a priced default", () => {
  env({ AUTOFILL_AI_ENABLED: "true", AUTOFILL_AI_PROVIDER: "xai", AUTOFILL_AI_MODEL: "", AUTOFILL_AI_MONTHLY_CAP_USD: "50" });
  assert.deepEqual(resolveSettings(null), { enabled: true, provider: "xai", recognitionModel: "grok-4.20-0309-non-reasoning", draftingModel: "grok-4.20-0309-non-reasoning", monthlyCapUsd: 50, source: "environment" });
  const saved = resolveSettings({ ...xaiSettings, recognitionModel: "grok-99-imaginary", updatedByName: "Kareem" });
  assert.equal(saved.source, "dashboard");
  assert.equal(saved.recognitionModel, "grok-4.20-0309-non-reasoning");
  assert.equal(saved.draftingModel, "grok-4.3");
  assert.equal(saved.updatedByName, "Kareem");
  assert.equal(costMicroUsd("openai", "gpt-6-luna", 1000, 0, 200), 200);
  assert.equal(costMicroUsd("xai", "unknown-model", 1000, 0, 0), 2000, "unknown models are charged at the highest listed price");
});

test("v3.161 Admin settings: models must be priced, a provider needs its key to be switched on, and keys are never returned", async () => {
  env({ XAI_API_KEY: "", OPENAI_API_KEY: "openai-test-key-000000000000" });
  const settingsRow = { data: { settings: xaiSettings, history: [] }, error: null };
  const { calls, service } = harness({ rpcData: { get_autofill_ai_settings_v3161: settingsRow, save_autofill_ai_settings_v3161: { data: xaiSettings, error: null } } });
  assert.deepEqual(await validate(plainToInstance(SaveAutofillAiSettingsDto, { ...xaiSettings, provider: "claude" })).then((errors) => errors.length > 0), true);
  await assert.rejects(service.saveSettings(user, { ...xaiSettings, recognitionModel: "grok-99-imaginary" } as any), (error: any) => error.code === "VALIDATION_ERROR" || /price/.test(error.message));
  await assert.rejects(service.saveSettings(user, xaiSettings as any), (error: any) => /XAI_API_KEY/.test(error.message), "Grok cannot be switched on without its key");
  const off = await service.saveSettings(user, { ...xaiSettings, enabled: false } as any);
  assert.ok(calls.rpc.some((call: any) => call.name === "save_autofill_ai_settings_v3161" && call.token === "jwt" && call.args.p_provider === "xai"));
  assert.deepEqual(off.providers.map((item: any) => [item.id, item.keyConfigured]), [["xai", false], ["openai", true]]);
  assert.doesNotMatch(JSON.stringify(off), /openai-test-key|xai-test-key|server-secret/, "keys never leave the server");
  env({ XAI_API_KEY: "xai-test-key-00000000000000000" });
});

test("v3.161 'Test this model' runs the ten samples and reports accuracy and cost", async () => {
  const results = [{ index: 0, target: "guide.work-authorization", confidence: 95 }, { index: 1, target: "answer.requires_sponsorship", confidence: 90 }, { index: 5, target: "none", confidence: 90 }];
  const { calls, service } = harness({ model: { results } });
  const out: any = await service.testModel(user, { provider: "xai", model: "grok-4.3" });
  assert.equal(calls.model[0].url, "https://api.x.ai/v1/chat/completions");
  assert.equal(out.total, 10);
  assert.equal(out.results[0].ok, true);
  assert.equal(out.results[2].ok, false, "a missing answer counts as none, not as a guess");
  assert.ok(out.correct >= 3);
  assert.equal(typeof out.costMicroUsd, "number");
});

test("v3.161 usage report runs as the Admin and returns settings without the key", async () => {
  env({ AUTOFILL_AI_ENABLED: "true", AUTOFILL_AI_PROVIDER: "xai" });
  const { calls, service } = harness({ rpcData: {
    autofill_ai_usage_report_v3161: { data: { hours: [], autofilledApplications: 3, month: { costMicroUsd: 1200 }, learnedWordings: 9 }, error: null },
    get_autofill_ai_settings_v3161: { data: { settings: xaiSettings, history: [] }, error: null },
  } });
  const out: any = await service.usage(user, "2026-10-01T04:00:00.000Z", "2026-10-09T04:00:00.000Z");
  assert.deepEqual(calls.rpc.find((call: any) => call.name === "autofill_ai_usage_report_v3161").args, { p_from: "2026-10-01T04:00:00.000Z", p_to: "2026-10-09T04:00:00.000Z" });
  assert.equal(out.settings.provider, "xai");
  assert.equal(out.settings.providerLabel, "Grok (xAI)");
  assert.equal(out.settings.model, "grok-4.20-0309-non-reasoning");
  assert.equal(out.settings.keyConfigured, true);
  assert.equal(out.autofilledApplications, 3);
  assert.doesNotMatch(JSON.stringify(out), /test-key|server-secret/, "keys never leave the server");
});

test("v3.161 usage report maps a non-Admin refusal to 403", async () => {
  const supabase = { forUser: () => ({ rpc: async () => ({ data: null, error: { code: "42501", message: "FORBIDDEN: Only an Admin can view AI usage and cost." } }) }) } as any;
  await assert.rejects(new AutofillAiService(supabase).usage(user, null, null), (error: any) => error.getStatus?.() === 403 || error.status === 403);
});

test("v3.161 a control's placeholder ('Select', 'Search') is never sent to the model or remembered", async () => {
  env({ AUTOFILL_AI_ENABLED: "true", AUTOFILL_AI_PROVIDER: "openai", SUPABASE_SECRET_KEY: "server-secret-test-key-0000000" });
  const { calls, service } = harness({ model: { results: [{ index: 0, target: "none", confidence: 90 }] } });
  const out = await service.recognize(user, session, ask("Select", "Search", "Why us?"));
  assert.deepEqual(JSON.parse(calls.model[0].body.input).questions.map((item: any) => item.question), ["Why us?"]);
  assert.deepEqual(calls.save[0].args.p_items.map((item: any) => item.question), ["Why us?"]);
  assert.deepEqual(out.results.slice(0, 2), [{ index: 0, targetKey: null, source: null }, { index: 1, targetKey: null, source: null }]);
});

test("v3.162 the model says what kind of question has no standard answer; only that kind is saved", async () => {
  env({ AUTOFILL_AI_ENABLED: "true", AUTOFILL_AI_PROVIDER: "openai", SUPABASE_SECRET_KEY: "server-secret-test-key-0000000" });
  const { calls, service } = harness({ model: { results: [
    { index: 0, target: "none", confidence: 90, kind: "same_for_everyone" },
    { index: 1, target: "none", confidence: 88, kind: "essay" },
    { index: 2, target: guide, confidence: 95, kind: "same_for_everyone" },
    { index: 3, target: "none", confidence: 90, kind: "made_up" },
  ] } });
  await service.recognize(user, session, ask("Open to hybrid, 3 days a week?", "Why us?", "Can you work in the US?", "Odd one"));
  const schema = calls.model[0].body.text.format.schema.properties.results.items;
  assert.deepEqual(schema.required, ["index", "target", "confidence", "kind"]);
  assert.deepEqual(schema.properties.kind.enum, ["same_for_everyone", "depends_on_profile", "essay", "not_a_question"]);
  assert.deepEqual(calls.save[0].args.p_items.map((item: any) => item.answerKind), ["SAME_FOR_EVERYONE", "ESSAY", null, null], "a matched question has no kind; an unknown kind is dropped");
});

test("v3.163 option words, generic control labels and cookie-banner items are never sent or remembered", async () => {
  env({ AUTOFILL_AI_ENABLED: "true", AUTOFILL_AI_PROVIDER: "openai", SUPABASE_SECRET_KEY: "server-secret-test-key-0000000" });
  const { calls, service } = harness({ model: { results: [{ index: 0, target: "none", confidence: 90, kind: "same_for_everyone" }] } });
  await service.recognize(user, session, ask("Yes", "No Yes", "checkbox label", "Targeting Cookies", "Open to contract roles?"));
  assert.deepEqual(JSON.parse(calls.model[0].body.input).questions.map((item: any) => item.question), ["Open to contract roles?"]);
  assert.deepEqual(calls.save[0].args.p_items.map((item: any) => item.question), ["Open to contract roles?"]);
});

test("v3.164 drafts open-ended answers with the drafting model from the session's Resume and job, without contact details", async () => {
  env({ AUTOFILL_AI_ENABLED: "true", SUPABASE_SECRET_KEY: "server-secret-test-key-0000000", XAI_API_KEY: "xai-test-key-00000000000000000" });
  const context = { data: {
    resume: { summary: "Engineer. Email jane@x.com, call 555-111-2222, https://linkedin.com/in/jane", skills: "Java, AWS", experience: [{ jobTitle: "Senior Engineer", company: "Initech", details: "Led payments." }], education: [] },
    job: { company: "Acme", title: "Senior Engineer", description: "Payments platform." }, settings: xaiSettings, monthCostMicroUsd: 0,
  }, error: null };
  const answers = { answers: [
    { index: 0, answer: "I want to build Acme's payments platform because I led payments at Initech.\nI love it.", skip: false },
    { index: 1, answer: "", skip: true },
    { index: 2, answer: "One line\nanswer that is far too long for the box", skip: false },
  ] };
  const { calls, service } = harness({ rpcData: { get_autofill_draft_context_v3164: context }, model: answers });
  const out = await service.draft(user, session, { questions: [
    { question: "Why do you want to work at Acme?", controlType: "textarea" },
    { question: "Please list two references", controlType: "textarea" },
    { question: "Your motivation in one line", controlType: "input", maxLength: 25 },
  ] } as any);
  assert.equal(out.ai, "USED");
  assert.equal(calls.model[0].url, "https://api.x.ai/v1/chat/completions");
  assert.equal(calls.model[0].body.model, "grok-4.3", "the drafting model, not the recognition model");
  const sent = calls.model[0].body.messages[1].content;
  assert.doesNotMatch(sent, /jane@x\.com|555-111-2222|linkedin\.com\/in\/jane/, "contact details never reach the model");
  assert.match(sent, /\[email\].*\[phone\].*\[link\]/);
  assert.deepEqual(out.answers.map((item) => item.index), [0, 2], "skipped questions are left for a person");
  assert.equal(out.answers[1].answer.includes("\n"), false, "one-line inputs get one line");
  assert.ok(out.answers[1].answer.length <= 25, "answers keep within the field's limit");
  assert.equal(calls.save[0].name, "record_autofill_ai_draft_usage_v3164");
  assert.equal(calls.save[0].args.p_usage.answers, 2);
});

test("v3.164 drafting respects the off switch and the monthly cap", async () => {
  const base = { resume: {}, job: {}, monthCostMicroUsd: 0 };
  let h = harness({ rpcData: { get_autofill_draft_context_v3164: { data: { ...base, settings: { ...xaiSettings, enabled: false } }, error: null } } });
  assert.equal((await h.service.draft(user, session, { questions: [{ question: "Why us?", controlType: "textarea" }] } as any)).ai, "DISABLED");
  h = harness({ rpcData: { get_autofill_draft_context_v3164: { data: { ...base, settings: xaiSettings, monthCostMicroUsd: 50_000_000 }, error: null } } });
  assert.equal((await h.service.draft(user, session, { questions: [{ question: "Why us?", controlType: "textarea" }] } as any)).ai, "CAP_REACHED");
  assert.equal(h.calls.model.length, 0);
});
