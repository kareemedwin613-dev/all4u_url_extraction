import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import type { AuthenticatedUser } from "@resume-jd/contracts";
import { createClient } from "@supabase/supabase-js";
import { ApiException } from "../common/errors/api.exception.js";
import { JsonLogger } from "../common/logging/json-logger.service.js";
import { environment, type Environment } from "../config/environment.js";
import { SupabaseService } from "../supabase/supabase.service.js";
import type { DraftAutofillAnswersDto, RecognizeAutofillQuestionsDto, SaveAutofillAiSettingsDto, TestAutofillAiModelDto } from "./autofill-ai.dto.js";
import { draftAnswers } from "./drafter.js";
import { costMicroUsd, findModel, isProvider, PROVIDERS, type ProviderId } from "./model-catalog.js";
import { recognizeQuestions, type RecognizerTarget } from "./recognizer.js";
import { SAMPLE_QUESTIONS, SAMPLE_TARGETS } from "./sample-questions.js";

const logger = new JsonLogger();
const MIN_CONFIDENCE = 80;

// The Resume answers Autofill can fill, described for the model. Values are never sent.
export const ANSWER_TARGETS: RecognizerTarget[] = [
  { key: "answer.authorized_to_work", question: "Is the candidate legally authorized to work in the United States? (yes/no)" },
  { key: "answer.requires_sponsorship", question: "Will the candidate now or in the future require visa sponsorship to work in the United States? (yes/no)" },
  { key: "answer.willing_to_relocate", question: "Is the candidate willing to relocate? (yes/no)" },
  { key: "answer.available_start_date", question: "When can the candidate start? (date)" },
  { key: "answer.desired_salary", question: "What are the candidate's salary expectations?" },
  { key: "answer.years_of_experience", question: "How many years of professional experience does the candidate have in total?" },
  { key: "answer.remote_work_preference", question: "Does the candidate prefer remote, hybrid or on-site work?" },
  { key: "answer.gender_identity", question: "Voluntary self-identification: gender" },
  { key: "answer.race_ethnicity", question: "Voluntary self-identification: race or ethnicity" },
  { key: "answer.veteran_status", question: "Voluntary self-identification: veteran status" },
];

// Emails, links and long digit runs never leave the API, even inside employer wording.
const scrub = (text: string) => String(text || "")
  .replace(/[\w.%+-]+@[\w.-]+\.[a-z]{2,}/gi, "[email]").replace(/https?:\/\/\S+/gi, "[link]").replace(/\d[\d ().-]{5,}\d/g, "[number]")
  .replace(/\s+/g, " ").trim().slice(0, 300);

// Not a question: a control's placeholder ("Select"), a generic control label ("checkbox label"), only option
// words ("Yes", "No Yes") or a cookie-banner item. Never sent to the model or remembered. Mirrors notAQuestion()
// in extension/autofill/form-context.js, for older extension builds.
const NOT_A_QUESTION = [
  /^\s*(?:select(?:\s+one)?|search|choose|type\s+to\s+search|please\s+select|select\s+an?\s+option|--+)\s*(?:\.{3}|…)?\s*\*?\s*$/i,
  /^\s*(?:checkbox|radio|toggle|switch|option|label|checkbox\s+label|radio\s+label|input|field|text|value|answer|response)\s*\*?\s*$/i,
  /^\s*(?:(?:yes|no|true|false|n\/?a|none|other|maybe|i\s+agree|agree|disagree|accept|decline|ok|okay)[\s,/|*.-]*)+$/i,
  /\bcookies?\b/i,
];
const PLACEHOLDER_ONLY = { test: (text: string) => !String(text || "").trim() || NOT_A_QUESTION.some((pattern) => pattern.test(text)) };

export type AiState = "USED" | "NOT_NEEDED" | "DISABLED" | "NOT_CONFIGURED" | "CAP_REACHED" | "FAILED";
// kind: for a question no known answer fits, what sort of question it is (ESSAY, SAME_FOR_EVERYONE, …).
export interface RecognizedQuestion { index: number; targetKey: string | null; source: "LEARNED" | "AI" | null; kind?: string | null }
export interface AiSettings {
  enabled: boolean; provider: ProviderId; recognitionModel: string; draftingModel: string; monthlyCapUsd: number;
  source: "dashboard" | "environment"; updatedAt?: string | null; updatedByName?: string | null;
}

// The Admin's saved settings, or the environment defaults until an Admin first saves. Unknown models fall
// back to the provider's default so every call stays priced.
export function resolveSettings(row: any, env: Environment = environment()): AiSettings {
  if (row && isProvider(row.provider)) {
    const provider = row.provider as ProviderId, model = (id: unknown) => typeof id === "string" && findModel(provider, id) ? id : PROVIDERS[provider].defaultModel;
    return { enabled: row.enabled === true, provider, recognitionModel: model(row.recognitionModel), draftingModel: model(row.draftingModel),
      monthlyCapUsd: Number(row.monthlyCapUsd) || 0, source: "dashboard", updatedAt: row.updatedAt || null, updatedByName: row.updatedByName || null };
  }
  const provider = env.AUTOFILL_AI_PROVIDER, model = env.AUTOFILL_AI_MODEL && findModel(provider, env.AUTOFILL_AI_MODEL) ? env.AUTOFILL_AI_MODEL : PROVIDERS[provider].defaultModel;
  return { enabled: env.AUTOFILL_AI_ENABLED, provider, recognitionModel: model, draftingModel: model, monthlyCapUsd: env.AUTOFILL_AI_MONTHLY_CAP_USD, source: "environment" };
}

const keyFor = (provider: ProviderId, env: Environment = environment()) => (env[PROVIDERS[provider].keyEnv] || "").trim();
// Whether each provider's key is set: never the key itself.
const keyStatus = (env: Environment = environment()) => ({ openai: Boolean(keyFor("openai", env)), xai: Boolean(keyFor("xai", env)) });

function databaseFailure(error: any, fallbackCode: string, fallback: string): never {
  const raw = String(error?.message || ""), known = raw.match(/^([A-Z][A-Z0-9_]+):\s*(.+)$/);
  if (error?.code === "PGRST202" || /could not find the function|schema cache/i.test(raw)) throw new ApiException("DATABASE_MIGRATION_REQUIRED", "Apply the pending Supabase migrations and retry.", HttpStatus.SERVICE_UNAVAILABLE);
  const code = known?.[1] || fallbackCode;
  const status = code === "FORBIDDEN" || error?.code === "42501" || code.includes("DENIED") ? HttpStatus.FORBIDDEN : code.includes("NOT_FOUND") ? HttpStatus.NOT_FOUND : code === "VALIDATION_ERROR" ? HttpStatus.BAD_REQUEST : HttpStatus.BAD_GATEWAY;
  throw new ApiException(code, known?.[2] || fallback, status);
}

@Injectable()
export class AutofillAiService {
  constructor(
    @Inject(SupabaseService) private readonly supabase: SupabaseService,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly adminClient: (url: string, key: string) => { rpc: (name: string, args: unknown) => PromiseLike<{ error: any }> } =
      (url, key) => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }),
  ) {}

  private async rpc(user: AuthenticatedUser, name: string, args: Record<string, unknown>, code: string, fallback: string) {
    const { data, error } = await this.supabase.forUser(user.token).rpc(name, args);
    if (error) databaseFailure(error, code, fallback);
    return data as any;
  }

  // Saved with the server key: an Applier can read mappings through their session but never write them.
  private async save(user: AuthenticatedUser, sessionId: string, model: string, items: unknown[], usage: Record<string, number>) {
    const env = environment();
    if (!env.SUPABASE_SECRET_KEY) return;
    const { error } = await this.adminClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY).rpc("save_autofill_learned_wordings_v3161", { p_user_id: user.id, p_session_id: sessionId, p_model: model, p_items: items, p_usage: usage });
    if (error) logger.warn("Learned Autofill wordings were not saved", { code: error.code });
  }

  // --- Admin: settings ------------------------------------------------------------------------------------

  async getSettings(user: AuthenticatedUser) {
    const data = await this.rpc(user, "get_autofill_ai_settings_v3161", {}, "AUTOFILL_AI_SETTINGS_FAILED", "AI settings could not be loaded.");
    const env = environment(), keys = keyStatus(env);
    return {
      settings: resolveSettings(data?.settings, env),
      history: Array.isArray(data?.history) ? data.history : [],
      providers: (Object.keys(PROVIDERS) as ProviderId[]).map((id) => ({ id, label: PROVIDERS[id].label, keyEnv: PROVIDERS[id].keyEnv, keyConfigured: keys[id], defaultModel: PROVIDERS[id].defaultModel, models: PROVIDERS[id].models })),
      remembersWordings: Boolean(env.SUPABASE_SECRET_KEY),
    };
  }

  async saveSettings(user: AuthenticatedUser, body: SaveAutofillAiSettingsDto) {
    const provider = body.provider;
    for (const model of [body.recognitionModel, body.draftingModel]) {
      if (!findModel(provider, model)) throw new ApiException("VALIDATION_ERROR", `${model} is not a ${PROVIDERS[provider].label} model this server can price. Choose one from the list.`, HttpStatus.BAD_REQUEST);
    }
    if (body.enabled && !keyFor(provider)) throw new ApiException("AUTOFILL_AI_KEY_MISSING", `Add ${PROVIDERS[provider].keyEnv} in Vercel before turning on ${PROVIDERS[provider].label}.`, HttpStatus.BAD_REQUEST);
    await this.rpc(user, "save_autofill_ai_settings_v3161", { p_enabled: body.enabled, p_provider: provider, p_recognition_model: body.recognitionModel, p_drafting_model: body.draftingModel, p_monthly_cap_usd: body.monthlyCapUsd },
      "AUTOFILL_AI_SETTINGS_FAILED", "AI settings could not be saved.");
    return this.getSettings(user);
  }

  // Runs the ten sample questions against a provider and model before an Admin saves them.
  async testModel(user: AuthenticatedUser, body: TestAutofillAiModelDto) {
    if (!findModel(body.provider, body.model)) throw new ApiException("VALIDATION_ERROR", "Choose a model from the list.", HttpStatus.BAD_REQUEST);
    const apiKey = keyFor(body.provider);
    if (!apiKey) throw new ApiException("AUTOFILL_AI_KEY_MISSING", `Add ${PROVIDERS[body.provider].keyEnv} in Vercel first.`, HttpStatus.BAD_REQUEST);
    const started = Date.now();
    let output;
    try {
      output = await recognizeQuestions({ provider: body.provider, apiKey, model: body.model, targets: [...SAMPLE_TARGETS, ...ANSWER_TARGETS], fetchImpl: this.fetchImpl, timeoutMs: 20_000,
        questions: SAMPLE_QUESTIONS.map(([question, options], index) => ({ index, question, controlType: options.length ? "radio" : "input", options })) });
    } catch (error: any) {
      throw new ApiException("AUTOFILL_AI_TEST_FAILED", `The ${PROVIDERS[body.provider].label} call failed (${error?.code || "MODEL_ERROR"}). Check the key and model.`, HttpStatus.BAD_GATEWAY);
    }
    const byIndex = new Map(output.results.map((item) => [item.index, item]));
    const results = SAMPLE_QUESTIONS.map(([question, , expected], index) => {
      const got = byIndex.get(index), used = got && got.confidence >= MIN_CONFIDENCE ? got.target : "none";
      return { question, expected: expected.join(" or "), got: used, confidence: got?.confidence ?? null, ok: expected.includes(used) };
    });
    return {
      provider: body.provider, model: body.model, correct: results.filter((item) => item.ok).length, total: results.length, ms: Date.now() - started,
      inputTokens: output.inputTokens, cachedTokens: output.cachedTokens, outputTokens: output.outputTokens,
      costMicroUsd: costMicroUsd(body.provider, body.model, output.inputTokens, output.cachedTokens, output.outputTokens), results,
    };
  }

  // Overview section (Admins): usage in the period plus the active settings. Never returns a key.
  async usage(user: AuthenticatedUser, from: string | null, to: string | null) {
    const [data, stored] = await Promise.all([
      this.rpc(user, "autofill_ai_usage_report_v3161", { p_from: from, p_to: to }, "AUTOFILL_AI_USAGE_FAILED", "AI usage could not be loaded."),
      this.rpc(user, "get_autofill_ai_settings_v3161", {}, "AUTOFILL_AI_SETTINGS_FAILED", "AI settings could not be loaded."),
    ]);
    const env = environment(), settings = resolveSettings(stored?.settings, env);
    return {
      ...(data as object),
      settings: { ...settings, model: settings.recognitionModel, providerLabel: PROVIDERS[settings.provider].label, keyConfigured: keyStatus(env)[settings.provider], remembersWordings: Boolean(env.SUPABASE_SECRET_KEY) },
    };
  }

  // --- Applier: drafting --------------------------------------------------------------------------------

  // Drafts answers for open-ended questions with the Admin's drafting model, from this session's Resume and job.
  async draft(user: AuthenticatedUser, sessionId: string, body: DraftAutofillAnswersDto): Promise<{ answers: Array<{ index: number; answer: string }>; ai: AiState }> {
    const questions = (body.questions || []).map((item, index) => ({ index, question: scrub(item.question), controlType: item.controlType, ...(item.maxLength ? { maxLength: item.maxLength } : {}) }));
    if (!questions.length) return { answers: [], ai: "NOT_NEEDED" };
    const context = await this.rpc(user, "get_autofill_draft_context_v3164", { p_session_id: sessionId }, "AUTOFILL_AI_DRAFT_CONTEXT_FAILED", "The Resume and job could not be loaded for drafting.");
    const settings = resolveSettings(context?.settings), apiKey = keyFor(settings.provider);
    if (!settings.enabled) return { answers: [], ai: "DISABLED" };
    if (!apiKey) return { answers: [], ai: "NOT_CONFIGURED" };
    if ((Number(context?.monthCostMicroUsd) || 0) >= settings.monthlyCapUsd * 1_000_000) return { answers: [], ai: "CAP_REACHED" };
    let output;
    try {
      output = await draftAnswers({ provider: settings.provider, apiKey, model: settings.draftingModel, context: { resume: context.resume, job: context.job }, questions, fetchImpl: this.fetchImpl });
    } catch (error: any) {
      logger.warn("Autofill answer drafting failed", { code: error?.code || "MODEL_ERROR", provider: settings.provider });
      return { answers: [], ai: "FAILED" };
    }
    const usage = { answers: output.answers.length, inputTokens: output.inputTokens, outputTokens: output.outputTokens,
      costMicroUsd: costMicroUsd(settings.provider, settings.draftingModel, output.inputTokens, output.cachedTokens, output.outputTokens) };
    const env = environment();
    if (env.SUPABASE_SECRET_KEY) {
      const { error } = await this.adminClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY).rpc("record_autofill_ai_draft_usage_v3164", { p_user_id: user.id, p_session_id: sessionId, p_usage: usage });
      if (error) logger.warn("Autofill drafting usage was not recorded", { code: error.code });
    }
    return { answers: output.answers, ai: "USED" };
  }

  // --- Applier: recognition -----------------------------------------------------------------------------

  async recognize(user: AuthenticatedUser, sessionId: string, body: RecognizeAutofillQuestionsDto): Promise<{ results: RecognizedQuestion[]; ai: AiState }> {
    const questions = (body.questions || []).map((item) => ({ ...item, question: scrub(item.question), options: (item.options || []).map(scrub).filter(Boolean) }));
    const results: RecognizedQuestion[] = questions.map((_, index) => ({ index, targetKey: null, source: null }));
    if (!questions.length) return { results, ai: "NOT_NEEDED" };
    const known = await this.rpc(user, "lookup_autofill_learned_wordings_v3161", { p_session_id: sessionId, p_questions: questions.map((item) => item.question) },
      "AUTOFILL_AI_LOOKUP_FAILED", "Known question wordings could not be loaded.") as { hits: Array<{ index: number; targetKey: string }>; targets: RecognizerTarget[]; monthCostMicroUsd: number; settings: any };
    for (const hit of known.hits || []) {
      if (!results[hit.index]) continue;
      results[hit.index] = { index: hit.index, targetKey: hit.targetKey === "none" ? null : hit.targetKey, source: "LEARNED", kind: hit.targetKey === "none" ? (hit as any).answerKind || null : null };
    }
    const misses = results.filter((item) => item.source === null && !PLACEHOLDER_ONLY.test(questions[item.index].question)).map((item) => item.index);
    if (!misses.length) return { results, ai: "NOT_NEEDED" };

    const settings = resolveSettings(known.settings), apiKey = keyFor(settings.provider);
    if (!settings.enabled) return { results, ai: "DISABLED" };
    if (!apiKey) return { results, ai: "NOT_CONFIGURED" };
    if ((Number(known.monthCostMicroUsd) || 0) >= settings.monthlyCapUsd * 1_000_000) return { results, ai: "CAP_REACHED" };

    const targets = [...(known.targets || []), ...ANSWER_TARGETS], allowed = new Set([...targets.map((target) => target.key), "none"]);
    let output;
    try {
      output = await recognizeQuestions({
        provider: settings.provider, apiKey, model: settings.recognitionModel, targets, fetchImpl: this.fetchImpl,
        questions: misses.map((index, position) => ({ index: position, question: questions[index].question, controlType: questions[index].controlType, options: questions[index].options })),
      });
    } catch (error: any) {
      logger.warn("Autofill question recognition failed", { code: error?.code || "MODEL_ERROR", provider: settings.provider });
      return { results, ai: "FAILED" };
    }
    const toSave: Array<{ question: string; targetKey: string; confidence: number; answerKind: string | null }> = [];
    for (const item of output.results) {
      const index = misses[item.index];
      if (index === undefined || !allowed.has(item.target) || results[index].source !== null) continue;
      // The kind is kept only when no known answer fits: it tells Admins which questions need a standard answer.
      toSave.push({ question: questions[index].question, targetKey: item.target, confidence: item.confidence, answerKind: item.target === "none" && item.kind ? item.kind.toUpperCase() : null });
      if (item.confidence >= MIN_CONFIDENCE && item.target !== "none") results[index] = { index, targetKey: item.target, source: "AI" };
      else if (item.target === "none" && item.kind) results[index] = { ...results[index], kind: item.kind.toUpperCase() };
    }
    const usage = { questions: misses.length, inputTokens: output.inputTokens, outputTokens: output.outputTokens,
      costMicroUsd: costMicroUsd(settings.provider, settings.recognitionModel, output.inputTokens, output.cachedTokens, output.outputTokens) };
    await this.save(user, sessionId, settings.recognitionModel, toSave, usage).catch(() => logger.warn("Learned Autofill wordings were not saved", { code: "SAVE_FAILED" }));
    return { results, ai: "USED" };
  }
}
