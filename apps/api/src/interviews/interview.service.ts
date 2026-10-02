import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import type { AuthenticatedUser } from "@resume-jd/contracts";
import { ApiException } from "../common/errors/api.exception.js";
import { SupabaseService } from "../supabase/supabase.service.js";
import { InterviewDto } from "./interview.dto.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(error: any, message: string): never {
  const raw = String(error?.message || "");
  if (error?.code === "42501" || /row-level security|permission denied|FORBIDDEN:/i.test(raw)) {
    throw new ApiException("FORBIDDEN", "The database policy denied this operation.", HttpStatus.FORBIDDEN);
  }
  const known = raw.match(/([A-Z][A-Z0-9_]+):\s*([^\n]+)/);
  if (known) {
    const status = known[1].includes("NOT_FOUND") ? HttpStatus.NOT_FOUND : known[1] === "FORBIDDEN" ? HttpStatus.FORBIDDEN : HttpStatus.BAD_REQUEST;
    throw new ApiException(known[1], known[2], status);
  }
  throw new ApiException("DATABASE_ERROR", message, HttpStatus.BAD_GATEWAY);
}

@Injectable()
export class InterviewService {
  constructor(@Inject(SupabaseService) private readonly supabase: SupabaseService) {}

  async list(user: AuthenticatedUser, from?: string, to?: string, applicationId?: string) {
    const application = String(applicationId || "").trim();
    if (application && !UUID.test(application)) {
      throw new ApiException("VALIDATION_ERROR", "The Application id is not valid.", HttpStatus.BAD_REQUEST);
    }
    const start = String(from || "").trim();
    const end = String(to || "").trim();
    if (!application && (!start || !end || Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end)))) {
      throw new ApiException("VALIDATION_ERROR", "Select an interview date range.", HttpStatus.BAD_REQUEST);
    }
    const { data, error } = await this.supabase.forUser(user.token).rpc("list_interviews_v139", {
      p_from: start || null,
      p_to: end || null,
      p_application_id: application || null,
    });
    if (error) fail(error, "Interviews could not be loaded.");
    return data || { items: [] };
  }

  async interviewees(user: AuthenticatedUser) {
    const { data, error } = await this.supabase.forUser(user.token).rpc("list_interviewee_users_v140");
    if (error) fail(error, "Interviewees could not be loaded.");
    return data || [];
  }

  async defaults(user: AuthenticatedUser, applicationId: string) {
    const { data, error } = await this.supabase.forUser(user.token).rpc("interview_application_defaults_v139", {
      p_application_id: applicationId,
    });
    if (error) fail(error, "The Application could not be prepared for an interview.");
    return data;
  }

  async get(user: AuthenticatedUser, id: string) {
    const { data, error } = await this.supabase.forUser(user.token).rpc("get_interview_v139", { p_id: id });
    if (error) fail(error, "The interview could not be loaded.");
    return data;
  }

  async save(user: AuthenticatedUser, body: InterviewDto, id?: string) {
    const { data, error } = await this.supabase.forUser(user.token).rpc("save_interview_v139", {
      p_payload: { ...body, ...(id ? { id } : {}), rounds: body.rounds || [] },
    });
    if (error) fail(error, "The interview could not be saved.");
    return data;
  }

  async remove(user: AuthenticatedUser, id: string) {
    const { data, error } = await this.supabase.forUser(user.token).rpc("delete_interview_v139", { p_id: id });
    if (error) fail(error, "The interview could not be deleted.");
    return data;
  }
}
