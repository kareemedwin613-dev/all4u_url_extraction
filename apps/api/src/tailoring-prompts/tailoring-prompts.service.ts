import { Inject, Injectable } from "@nestjs/common";
import type { AuthenticatedUser } from "@resume-jd/contracts";
import { SupabaseService } from "../supabase/supabase.service.js";
import { ApiException } from "../common/errors/api.exception.js";
import type { CreatePromptDto, SavePromptDto } from "./tailoring-prompts.dto.js";

function fail(error: { code?: string; message?: string }): never {
  const match = /^(PROMPT_[A-Z_]+):\s*(.+)$/.exec(error.message || "");
  const code = match?.[1] || (error.code === "42501" ? "PROMPT_FORBIDDEN" : "DATABASE_ERROR");
  const status = code === "PROMPT_FORBIDDEN" ? 403 : code.includes("NOT_FOUND") ? 404
    : ["PROMPT_STALE", "PROMPT_CONFLICT", "PROMPT_FALLBACK_REQUIRED", "PROMPT_IMMUTABLE"].includes(code) ? 409
    : match ? 400 : 502;
  throw new ApiException(code, match?.[2] || "The prompt operation could not be completed.", status);
}

@Injectable()
export class TailoringPromptsService {
  constructor(@Inject(SupabaseService) private readonly supabase: SupabaseService) {}
  private async rpc(user: AuthenticatedUser, name: string, args: Record<string, unknown>) {
    const { data, error } = await this.supabase.forUser(user.token).rpc(name, args);
    if (error) fail(error);
    return data;
  }
  list(user: AuthenticatedUser) { return this.rpc(user, "read_tailoring_prompts_v1", {}); }
  detail(user: AuthenticatedUser, id: string) {
    return this.rpc(user, "read_tailoring_prompts_v1", { p_prompt_id: id });
  }
  async history(user: AuthenticatedUser, id: string) {
    const data = await this.detail(user, id);
    return { versions: data.versions, events: data.events };
  }
  create(user: AuthenticatedUser, body: CreatePromptDto) {
    return this.rpc(user, "manage_tailoring_prompt_v1", {
      p_action: "CREATE", p_name: body.name, p_body: body.instructions, p_priority: body.priority,
      p_scope: body.scope, p_primary_category_id: body.primaryCategoryId ?? null,
      p_subcategory_id: body.subcategoryId ?? null,
    });
  }
  save(user: AuthenticatedUser, id: string, body: SavePromptDto) {
    return this.rpc(user, "manage_tailoring_prompt_v1", {
      p_action: "SAVE", p_prompt_id: id, p_expected_revision: body.expectedRevision,
      p_name: body.name, p_body: body.instructions, p_priority: body.priority,
    });
  }
  publish(user: AuthenticatedUser, id: string, revision: number) {
    return this.mutate(user, id, revision, "PUBLISH");
  }
  archive(user: AuthenticatedUser, id: string, revision: number) {
    return this.mutate(user, id, revision, "ARCHIVE");
  }
  restore(user: AuthenticatedUser, id: string, revision: number, version: number) {
    return this.mutate(user, id, revision, "RESTORE", version);
  }
  private mutate(user: AuthenticatedUser, id: string, revision: number, action: string, version?: number) {
    return this.rpc(user, "manage_tailoring_prompt_v1", {
      p_action: action, p_prompt_id: id, p_expected_revision: revision,
      ...(version === undefined ? {} : { p_version: version }),
    });
  }
  preview(user: AuthenticatedUser, jobDescriptionId: string) {
    return this.rpc(user, "preview_tailoring_prompt_v1", { p_job_description_id: jobDescriptionId });
  }
  createTest(user: AuthenticatedUser, id: string, revision: number, applicationId: string) {
    return this.rpc(user, "create_tailoring_prompt_test_v113", { p_prompt_id: id, p_expected_revision: revision, p_application_id: applicationId });
  }
  testDetail(user: AuthenticatedUser, id: string) {
    return this.rpc(user, "read_tailoring_prompt_test_v113", { p_test_id: id });
  }
  async runTest(body: { ticket: string; action: string; result?: Record<string, unknown>; failureCode?: string }) {
    const { data, error } = await this.supabase.anonymous().rpc("run_tailoring_prompt_test_v113", {
      p_ticket: body.ticket, p_action: body.action, p_result: body.result ?? null, p_failure_code: body.failureCode ?? null,
    });
    if (error) fail(error);
    return data;
  }
}
