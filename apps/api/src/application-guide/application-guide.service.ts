import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import type { AuthenticatedUser } from "@resume-jd/contracts";
import { ApiException } from "../common/errors/api.exception.js";
import { SupabaseService } from "../supabase/supabase.service.js";
import type { CorrectLearnedWordingDto, SaveApplicationGuideDto } from "./application-guide.dto.js";

function fail(error: any, message: string): never {
  const raw = String(error?.message || "");
  if (error?.code === "PGRST202") {
    throw new ApiException("DATABASE_MIGRATION_REQUIRED", "The Application Guide is not available yet.", HttpStatus.SERVICE_UNAVAILABLE);
  }
  if (error?.code === "42501" || /row-level security|permission denied|FORBIDDEN:/i.test(raw)) {
    throw new ApiException("FORBIDDEN", "The database policy denied this operation.", HttpStatus.FORBIDDEN);
  }
  const known = raw.match(/([A-Z][A-Z0-9_]+):\s*([^\n]+)/);
  if (known) throw new ApiException(known[1], known[2], known[1].includes("NOT_FOUND") ? HttpStatus.NOT_FOUND : HttpStatus.BAD_REQUEST);
  throw new ApiException("DATABASE_ERROR", message, HttpStatus.BAD_GATEWAY);
}

@Injectable()
export class ApplicationGuideService {
  constructor(@Inject(SupabaseService) private readonly supabase: SupabaseService) {}

  async list(user: AuthenticatedUser) {
    const { data, error } = await this.supabase.forUser(user.token).rpc("list_application_guide_v3149");
    if (error) fail(error, "The Application Guide could not be loaded.");
    return data || [];
  }

  async save(user: AuthenticatedUser, body: SaveApplicationGuideDto) {
    const { data, error } = await this.supabase.forUser(user.token).rpc("save_application_guide_v3149", {
      p_id: body.id || null,
      p_question: body.question,
      p_meaning: body.meaning,
      p_how_to_answer: body.howToAnswer,
      p_example: body.exampleAnswer || "",
      p_status: body.status,
    });
    if (error) fail(error, "The guide entry could not be saved.");
    if (!body.autofill) return data;
    // Autofill settings are saved separately so they do not create a new published version for appliers.
    const rule = body.autofill;
    const saved = await this.supabase.forUser(user.token).rpc("save_application_guide_autofill_v3157", {
      p_id: (data as { id: string }).id,
      p_mode: rule.mode,
      p_value: rule.value || "",
      p_source: rule.mode === "DERIVED" ? rule.source || null : null,
      p_patterns: rule.patterns || [],
      p_sensitive: Boolean(rule.sensitive),
    });
    if (saved.error) fail(saved.error, "The guide entry was saved, but its Autofill setting could not be saved.");
    return saved.data;
  }

  async unresolvedQuestions(user: AuthenticatedUser, days: number) {
    const { data, error } = await this.supabase.forUser(user.token).rpc("list_autofill_unresolved_questions_v3157", { p_days: days, p_limit: 100 });
    if (error) fail(error, "Unanswered Autofill questions could not be loaded.");
    return data || [];
  }

  async dismissUnresolvedQuestion(user: AuthenticatedUser, id: string) {
    const { data, error } = await this.supabase.forUser(user.token).rpc("dismiss_autofill_unresolved_question_v3157", { p_id: id });
    if (error) fail(error, "The question could not be dismissed.");
    return data;
  }

  async learnedWordings(user: AuthenticatedUser) {
    const { data, error } = await this.supabase.forUser(user.token).rpc("list_autofill_learned_wordings_v3161", { p_limit: 200 });
    if (error) fail(error, "Learned Autofill wordings could not be loaded.");
    return data || { items: [], total: 0, month: { requests: 0, questions: 0, costMicroUsd: 0 } };
  }

  async correctLearnedWording(user: AuthenticatedUser, id: string, body: CorrectLearnedWordingDto) {
    const { data, error } = await this.supabase.forUser(user.token).rpc("correct_autofill_learned_wording_v3166", { p_id: id, p_target_key: body.targetKey, p_answer_kind: body.answerKind ?? null });
    if (error) fail(error, "The learned wording could not be corrected.");
    return data;
  }

  async removeLearnedWording(user: AuthenticatedUser, id: string) {
    const { data, error } = await this.supabase.forUser(user.token).rpc("delete_autofill_learned_wording_v3161", { p_id: id });
    if (error) fail(error, "The learned wording could not be removed.");
    return data;
  }

  async remove(user: AuthenticatedUser, id: string) {
    const { data, error } = await this.supabase.forUser(user.token).rpc("delete_application_guide_v3149", { p_id: id });
    if (error) fail(error, "The guide entry could not be removed.");
    return data;
  }
}
